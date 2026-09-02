/// <reference types="jest" />

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import { foldEvents, createInitialState } from "../../src/common/persistence/replayer";
import type { BaseEvent } from "../../src/common/persistence/types";
import type { Turn } from "../../src/common/types/conversation.types";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

/** 一轮基础事件（turn/start + user + assistant + tool + turn/finish） */
function roundEvents(startSeq: number, roundIdx: number): BaseEvent[] {
  const tid = `t${roundIdx}`;
  return [
    { type: "turn/start", seq: startSeq, time: 1, data: { turnId: tid, kind: "turn", metadata: {} } },
    { type: "user/message", seq: startSeq + 1, time: 2, data: { messageId: `u${roundIdx}`, kind: "user", blocks: [{ type: "text", contentId: `u${roundIdx}`, text: `q${roundIdx}` }], metadata: {} } },
    { type: "assistant/message", seq: startSeq + 2, time: 3, data: { messageId: `a${roundIdx}`, content: [{ type: "text", contentId: `a${roundIdx}`, text: `ans${roundIdx}` }], metadata: {} } },
    { type: "turn/finish", seq: startSeq + 3, time: 4, data: { turnId: tid, promptTokens: 1, completionTokens: 1, totalTokens: 2, finishReason: "stop" } },
  ] as BaseEvent[];
}

describe("JsonlBackend.readEventsFrom（跨卷增量读）", () => {
  let backend: JsonlBackend;
  const sid = "read-from-test";

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" }); // seq0 = session/init
    await backend.appendEvents(sid, roundEvents(1, 1)); // seq1-4
    await backend.splitSegment(sid); // 段1 [0..4] 归档；新段 startSeq=5（rotate seq5）
    await backend.appendEvents(sid, roundEvents(6, 2)); // seq6-9
    await backend.splitSegment(sid); // 段2 [5..9] 归档；新段 startSeq=10（rotate seq10）
    await backend.appendEvents(sid, roundEvents(11, 3)); // seq11-14
  });

  it("fromSeq=0 返回全部事件（含 rotate）", async () => {
    const events = await backend.readEventsFrom(sid, 0);
    expect(events.length).toBe(15); // init+4+rotate+4+rotate+4
    expect(events[0].seq).toBe(0);
    expect(events[events.length - 1].seq).toBe(14);
  });

  it("fromSeq 在归档段内：从该段 fromSeq 起跨卷读", async () => {
    const events = await backend.readEventsFrom(sid, 6);
    expect(events[0].seq).toBe(6);
    expect(events[events.length - 1].seq).toBe(14);
    // 连续性（含跨段 rotate seq10）
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("fromSeq 恰在分卷边界（= 新段首条 seq）：从该段起", async () => {
    const events = await backend.readEventsFrom(sid, 10);
    expect(events.map((e) => e.seq)).toEqual([10, 11, 12, 13, 14]);
  });

  it("fromSeq 超过全部段末尾：返回空数组（快照即最新场景）", async () => {
    const events = await backend.readEventsFrom(sid, 100);
    expect(events).toEqual([]);
  });

  it("fromSeq 指向活跃段内部：从活跃段内起读", async () => {
    const events = await backend.readEventsFrom(sid, 12);
    expect(events.map((e) => e.seq)).toEqual([12, 13, 14]);
  });
});

describe("快照恢复链路（finalizeTurn 每轮快照 + 跨卷增量）", () => {
  const sid = "snapshot-recovery";

  async function appendRounds(service: JsonlMessageService, count: number) {
    let seq = await service.getLastProcessedSeq(sid) + 1;
    for (let i = 0; i < count; i++) {
      const { turnId } = await service.beginTurn(sid);
      await service.appendMessages(sid, [
        { id: `u${i}`, role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", contentId: `u${i}`, text: `q${i}` }] },
        { id: `a${i}`, role: "assistant", kind: "model", source: { kind: "model", provider: "p", model: "m" }, metadata: {}, content: [{ type: "text", contentId: `a${i}`, text: `ans${i}` }] },
      ]);
      await service.finalizeTurn(sid, turnId, 10, { finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
      seq = await service.getLastProcessedSeq(sid);
    }
    return seq;
  }

  beforeEach(async () => {
    const backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  it("冷加载（新实例）恢复结果与全量重放一致；且跨分卷", async () => {
    const s1 = new JsonlMessageService(new JsonlBackend());
    await appendRounds(s1, 5); // 5 轮 → 每轮末写快照

    // 制造跨卷：压缩分卷路径（recordCompaction×5 触发 splitSegment），再写 2 轮
    const backend = new JsonlBackend();
    for (let i = 0; i < 5; i++) await backend.recordCompaction(sid);
    await appendRounds(s1, 2);

    // 冷加载：全新实例（无缓存）→ rebuildState = 快照 + 跨卷增量
    const s2 = new JsonlMessageService(new JsonlBackend());
    const stateFromSnapshot = await (s2 as any).getState(sid);

    // 全量重放基准
    const events = await backend.getAllEvents(sid);
    const stateFull = foldEvents(events, createInitialState());

    expect(stateFromSnapshot.lastProcessedSeq).toBe(stateFull.lastProcessedSeq);
    
    expect(stateFromSnapshot.messages).toEqual(stateFull.messages);
    
  });

  it("快照丢失 → 全量回退且结果一致", async () => {
    const s1 = new JsonlMessageService(new JsonlBackend());
    await appendRounds(s1, 3);

    const backend = new JsonlBackend();
    // 删除快照文件模拟丢失
    const dir = (backend as any).getSessionDir(sid) as string;
    fs.rmSync(path.join(dir, "snapshot.json"), { force: true });

    const s2 = new JsonlMessageService(new JsonlBackend());
    const state = await (s2 as any).getState(sid);
    const events = await backend.getAllEvents(sid);
    const full = foldEvents(events, createInitialState());
    expect(state.messages).toEqual(full.messages);
    
  });

  it("旧格式快照（turns 形状，version<2）→ 形状守卫回退全量重放", async () => {
    const s1 = new JsonlMessageService(new JsonlBackend());
    await appendRounds(s1, 2);
    const backend = new JsonlBackend();
    // 用旧格式（三层 turns 形状）覆写快照文件
    const dir = (backend as any).getSessionDir(sid) as string;
    const oldSnapshot = {
      version: 1,
      sessionId: sid,
      snapshotSeq: 0,
      createdAt: new Date().toISOString(),
      state: { turns: [{ id: "x", kind: "turn", metadata: {}, messages: [], visible: true }], currentTurnId: null, envelope: null, lastProcessedSeq: 999 },
    };
    fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(oldSnapshot), "utf-8");

    // 冷加载：形状不匹配 → 全量重放（数据与日志一致，不被旧快照污染）
    const s2 = new JsonlMessageService(new JsonlBackend());
    const state = await (s2 as any).getState(sid);
    const events = await backend.getAllEvents(sid);
    const full = foldEvents(events, createInitialState());
    expect(state.messages).toEqual(full.messages);
    
  });

  it("每轮 finalizeTurn 后快照 seq = 最新事件 seq（含 turn/finish）", async () => {
    const s1 = new JsonlMessageService(new JsonlBackend());
    await appendRounds(s1, 2);
    const snap = await s1["backend"].readSnapshot(sid) as { snapshotSeq: number; state: unknown };
    const lastSeq = await s1.getLastProcessedSeq(sid);
    expect(snap.snapshotSeq).toBe(lastSeq);
  });
});

describe("importTurns 上下文占用锚点（重建路径）", () => {
  const sid = "import-anchor-test";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  /** 一个回合：user + assistant（metadata.usage 为运行时落库位置） */
  function turnWithUsage(usage?: any): Turn {
    return {
      id: "t1",
      kind: "turn",
      metadata: {},
      messages: [
        {
          id: "u1",
          role: "user",
          kind: "user",
          source: { kind: "user" },
          metadata: {},
          content: [{ type: "text", contentId: "c1", text: "q" }],
        },
        {
          id: "a1",
          role: "assistant",
          kind: "model",
          source: { kind: "model", provider: "p", model: "m" },
          metadata: usage ? { usage } : {},
          content: [{ type: "text", contentId: "c2", text: "a" }],
        },
      ],
      visible: true,
    };
  }

  it("turn/finish 携带 usedTokens（回合 usage）+ effectiveContextWindow（opts）", async () => {
    const store = new JsonlMessageService(backend);
    const { imported } = await store.importTurns(sid, [turnWithUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    })], { effectiveContextWindow: 1000000 });
    expect(imported).toBe(2);
    const events = await backend.getAllEvents(sid);
    const finish = events.find((e) => e.type === "turn/finish");
    expect(finish?.data).toMatchObject({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      usedTokens: 150,
      effectiveContextWindow: 1000000,
    });
  });

  it("无窗口 opts → 不写 effectiveContextWindow（usedTokens 仍写）", async () => {
    const store = new JsonlMessageService(backend);
    await store.importTurns(sid, [turnWithUsage({
      promptTokens: 60,
      completionTokens: 20,
    })]);
    const events = await backend.getAllEvents(sid);
    const finish = events.find((e) => e.type === "turn/finish");
    expect((finish?.data as any)?.usedTokens).toBe(80); // 60 + 20
    expect((finish?.data as any)?.effectiveContextWindow).toBeUndefined();
  });

  it("无 provider usage → turn/finish 用累计 surface 启发式锚点", async () => {
    const store = new JsonlMessageService(backend);
    // user 'q'(1字符) + assistant 'a'(1字符) → ceil(1/4)+ceil(1/4) = 2
    await store.importTurns(sid, [turnWithUsage(undefined)]);
    const events = await backend.getAllEvents(sid);
    const finish = events.find((e) => e.type === "turn/finish");
    expect(finish).toBeDefined();
    expect((finish?.data as any)?.usedTokens).toBe(2);
    expect((finish?.data as any)?.promptTokens).toBe(0);
  });
});
