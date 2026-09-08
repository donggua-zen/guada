/**
 * 每会话写互斥（runExclusive）回归测试
 *
 * 背景：文件级 seq 分配是「读内存游标 → 构建事件 → 落盘 → 推进游标」的跨 await
 * 非原子序列。两个并发写入方（如 workflow 尾事件与父循环 tool/result）会读到同一
 * 旧游标而分配出重复 seq，加载端连续性校验拒绝加载（会话永久损坏，生产已复现）。
 *
 * 覆盖：
 * - 并发 appendWorkflowEvent + appendMessages → 落盘 seq 严格连续无重复
 * - 并发混合写路径（beginTurn/appendMessages/finalizeTurn/appendWorkflowEvent/appendAskAsked）
 * - 错误隔离：一个写入方失败不阻断排队中的其他写入方
 * - CorruptSessionLogError 报错方向区分（重复/回退 vs 真缺口）
 */
/// <reference types="jest" />
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import { CorruptSessionLogError } from "../../src/common/persistence/errors";
import type { Message } from "../../src/common/types/conversation.types";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-mutex-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

/** 活跃段文件路径 */
async function activeSegmentPath(backend: JsonlBackend, sid: string): Promise<string> {
  const dir = (backend as any).getSessionDir(sid) as string;
  const info = await backend.getActiveSegmentInfo(sid);
  return path.join(dir, info!.file);
}

/** 读取活跃段全部事件的 seq 序列 */
async function readSeqs(backend: JsonlBackend, sid: string): Promise<number[]> {
  const file = await activeSegmentPath(backend, sid);
  const content = fs.readFileSync(file, "utf-8");
  return content
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => (JSON.parse(l) as { seq: number }).seq);
}

function toolMessage(toolCallId: string): Message {
  return {
    id: `m_${toolCallId}`,
    role: "tool",
    kind: "model",
    source: { kind: "tool", toolCallId },
    metadata: {},
    content: [{ type: "tool-result", toolCallId, name: "workflow_run", content: "ok" }],
  } as unknown as Message;
}

describe("每会话写互斥：并发写入 seq 连续性", () => {
  const sid = "mutex-test";
  let backend: JsonlBackend;
  let store: JsonlMessageService;


  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
    store = new JsonlMessageService(backend);

  });

  it("并发 appendAskAsked + appendMessages：落盘 seq 严格连续无重复", async () => {
    await store.beginTurn(sid);
    await store.appendMessages(sid, [
      {
        id: "u1",
        role: "user",
        kind: "user",
        source: { kind: "user" },
        metadata: {},
        content: [{ type: "text", text: "q" }],
      },
    ]);

    // 模拟并发写入：审批事件族（ask 钩子）与父循环 tool/result 同时写
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      writes.push(
        store.appendAskAsked(sid, {
          requestId: `ask_${i}`,
          kind: "ask",
          questions: [],
        }),
      );
      writes.push(store.appendMessages(sid, [toolMessage(`call_${i}`)]));
    }
    await Promise.all(writes);

    // 落盘 seq 严格连续（session/init=0 起）
    const seqs = await readSeqs(backend, sid);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
    // 40 条写入（20×ask + 20×tool）+ init + turn/start + user = 43 行
    expect(seqs).toHaveLength(43);
    // 无重复
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("并发混合写路径（turn 生命周期 + command + ask）：seq 连续", async () => {
    const writes: Promise<unknown>[] = [
      store.beginTurn(sid).then((r) => r.turnId),
      store.appendCommand(sid, {
        commandId: "cmd_1",
        name: "deploy",
        args: { target: "staging" },
      }),
      store.appendAskAsked(sid, {
        requestId: "ask_1",
        kind: "ask",
        questions: [],
      }),
    ];
    const turnId = (await Promise.all(writes))[0] as string;

    // turnId 拿到后并发收尾 + 命令完成事件
    await Promise.all([
      store.finalizeTurn(sid, turnId, 10, {
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
      store.appendAskAnswered(sid, {
        requestId: "ask_1",
        answers: [],
      }),
    ]);

    const seqs = await readSeqs(backend, sid);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("错误隔离：锁内写入失败不阻断后续排队写入", async () => {
    // 先建立会话游标
    await store.beginTurn(sid);

    // backend 层故障注入：临时替换 appendEvent 使其第一次调用抛错
    const originalAppendEvent = (backend as any).appendEvent.bind(backend);
    let failFirst = true;
    (backend as any).appendEvent = async (...args: unknown[]) => {
      if (failFirst) {
        failFirst = false;
        throw new Error("disk full");
      }
      return originalAppendEvent(...args);
    };

    const failing = store.appendAskAsked(sid, {
      requestId: "ask_fail",
      kind: "ask",
      questions: [],
    });
    const following = store.appendMessages(sid, [toolMessage("call_ok")]);
    await expect(failing).rejects.toThrow("disk full");
    await following; // 不应被前序失败卡死
    (backend as any).appendEvent = originalAppendEvent;

    const seqs = await readSeqs(backend, sid);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });
});

describe("CorruptSessionLogError 方向区分", () => {
  const sid = "direction-test";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  it("重复 seq → 报「重复/回退」且可诊断", async () => {
    const store = new JsonlMessageService(backend);
    await store.beginTurn(sid);
    // 手动写重复 seq 行（模拟事故现场）
    const file = await activeSegmentPath(backend, sid);
    const lines = fs.readFileSync(file, "utf-8").trimEnd();
    const lastSeq = (JSON.parse(lines.split("\n").pop()!) as { seq: number }).seq;
    fs.appendFileSync(
      file,
      JSON.stringify({
        type: "workflow/event",
        seq: lastSeq,
        time: 1,
        data: { runId: "r", seq: 1, kind: "run-log", time: 1, payload: { message: "dup" } },
      }) + "\n",
    );

    const s2 = new JsonlMessageService(backend);
    await expect((s2 as any).getState(sid)).rejects.toThrow(/重复\/回退/);
    await expect((s2 as any).getState(sid)).rejects.toBeInstanceOf(CorruptSessionLogError);
  });

  it("真缺口 → 报「缺口（数据丢失）」", async () => {
    const store = new JsonlMessageService(backend);
    await store.beginTurn(sid);
    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(
      file,
      `{"type":"user/message","seq":999,"time":1,"data":{"messageId":"x1","kind":"user","content":"x","metadata":{}}}` + "\n",
    );

    const s2 = new JsonlMessageService(backend);
    await expect((s2 as any).getState(sid)).rejects.toThrow(/seq 缺口（期望 2，实际 999）/);
    await expect((s2 as any).getState(sid)).rejects.toBeInstanceOf(CorruptSessionLogError);
  });
});
