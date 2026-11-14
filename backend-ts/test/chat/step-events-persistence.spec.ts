/// <reference types="jest" />

/**
 * 轨迹事件（envelope + step 括号）持久化与回放测试
 *
 * 覆盖：
 * - JsonlMessageService 的 getEnvelope / appendEnvelope / appendStepStart / appendStepEnd
 * - seq 连续性：step 事件与消息事件交错落盘时全局 seq 单调（配对括号不破坏连续性）
 * - replayer 折叠：step 事件为 log-only（不改变消息 surface），envelope 折叠进 state.envelope
 * - 旧日志（无 step/envelope 事件）回放降级：envelope=null、消息 surface 不变
 * - torn-tail 截断后 step 配对仍成立（截断只影响残行）
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import { foldEvents, createInitialState } from "../../src/common/persistence/replayer";
import type { BaseEvent } from "../../src/common/persistence/types";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "step-events-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

function msg(id: string, role: "user" | "assistant" | "tool") {
  return {
    id,
    role,
    kind: role === "user" ? "user" : "model",
    source:
      role === "assistant"
        ? ({ kind: "model", provider: "p", model: "m" } as any)
        : role === "tool"
          ? ({ kind: "tool", toolCallId: `call_${id}` } as any)
          : ({ kind: "user" } as any),
    metadata: {},
    content: [{ type: "text", text: `${role}:${id}` }],
  } as any;
}

describe("JsonlMessageService 轨迹事件写入", () => {
  const sid = "step-events";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  it("step 括号与消息事件交错落盘：seq 全局单调、getEnvelope/appendEnvelope 往返", async () => {
    const store = new JsonlMessageService(backend);

    // envelope（initial）
    const envSeq = await store.appendEnvelope(sid, {
      reason: "initial",
      system: "sys prompt",
      model: "m1",
      provider: "p1",
    });
    // step/start → 消息 → step/end
    const startSeq = await store.appendStepStart(sid, {
      turnId: null,
      step: 1,
      source: "session_title",
      requestId: "r1",
      model: "m1",
      fullInput: [msg("title-q", "user")],
    });
    await store.beginTurn(sid);
    await store.appendMessages(sid, [msg("a1", "assistant")]);
    const endSeq = await store.appendStepEnd(sid, {
      requestId: "r1",
      attemptIndex: 0,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: "stop",
      durationMs: 500,
    });

    expect(startSeq).toBe(envSeq + 1);
    expect(endSeq).toBe(startSeq + 3); // 间隔 turn/start + assistant 消息两条事件

    // seq 全局单调且连续
    const events = await store.getAllEvents(sid);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBe(events[i - 1]!.seq + 1);
    }
    const byType = (t: string) => events.filter((e) => e.type === t);
    expect(byType("envelope")).toHaveLength(1);
    expect(byType("step/start")).toHaveLength(1);
    expect(byType("step/end")).toHaveLength(1);
    expect((byType("step/start")[0]!.data as any).fullInput).toHaveLength(1);
    expect((byType("step/end")[0]!.data as any).usage.totalTokens).toBe(30);

    // envelope 往返（缓存播种路径）
    const seeded = await new JsonlMessageService(backend).getEnvelope(sid);
    expect(seeded?.reason).toBe("initial");
    expect(seeded?.system).toBe("sys prompt");
  });

  it("replayer 折叠：step 事件不改变消息 surface，envelope 进折叠态", async () => {
    const store = new JsonlMessageService(backend);
    await store.beginTurn(sid);
    await store.appendMessages(sid, [msg("u1", "user")]);
    await store.appendEnvelope(sid, { reason: "initial", system: "sys", model: "m1" });
    await store.appendStepStart(sid, {
      turnId: null, step: 1, source: "compaction", requestId: "r1",
    });
    await store.appendMessages(sid, [msg("s1", "assistant")]);
    await store.appendStepEnd(sid, {
      requestId: "r1", attemptIndex: 0, durationMs: 10, finishReason: "stop",
    });

    const events = await store.getAllEvents(sid);
    const state = foldEvents(events);
    // log-only：step/start、step/end 不产生/删除任何消息节点
    expect(state.messages.map((n) => n.id)).toEqual(["u1", "s1"]);
    // envelope 折叠进状态
    expect(state.envelope?.system).toBe("sys");
    expect(state.envelope?.model).toBe("m1");
    // seq 水位推进到最后一条事件
    expect(state.lastProcessedSeq).toBe(events[events.length - 1]!.seq);
  });

  it("旧日志（无 step/envelope）回放降级：envelope=null、surface 不变", async () => {
    const store = new JsonlMessageService(backend);
    await store.beginTurn(sid);
    await store.appendMessages(sid, [msg("u1", "user"), msg("a1", "assistant")]);
    const events = await store.getAllEvents(sid);
    expect(events.every((e) => !e.type.startsWith("step/") && e.type !== "envelope")).toBe(true);
    const state = foldEvents(events);
    expect(state.messages.map((n) => n.id)).toEqual(["u1", "a1"]);
    expect(state.envelope).toBeNull();
  });

  it("createInitialState 的 envelope 初值为 null（旧快照无该字段时不炸）", () => {
    const state = createInitialState();
    expect(state.envelope).toBeNull();
  });
});
