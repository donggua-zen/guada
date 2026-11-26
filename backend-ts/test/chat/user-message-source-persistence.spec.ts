/// <reference types="jest" />

/**
 * user/message 事件的结构化 source 落盘与回放。
 *
 * 背景：工具边界注入的作业完成通知是 role='user' + source.kind='sub_agent'
 * （job-notifier.service.handleStepHandoffBoundary → sessionContext.appendMessages）。
 * 若 appendMessages 不把 source 写进事件，冷回放会退化成 {kind:'user'}，前端识别不出
 * job-notice 卡，整张卡片在刷新后消失。
 *
 * 覆盖：
 * - 非人类来源（sub_agent / plugin）随事件落盘，foldEvents 回放后 source 一致
 * - 真实用户（kind='user'）不写 source 字段（体积与兼容哨兵），回放仍为 {kind:'user'}
 * - tool/result、assistant/message 分支 shape 不受影响
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-msg-source-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

function userMsg(
  id: string,
  source: any,
  text = `<system_reminder>Background job job-x (subagent: t) finished.</system_reminder>`,
) {
  return {
    id,
    role: "user",
    kind: "user",
    source,
    metadata: {},
    content: [{ type: "text", text }],
  } as any;
}

function assistantMsg(id: string) {
  return {
    id,
    role: "assistant",
    kind: "model",
    source: { kind: "model", provider: "p", model: "m" },
    metadata: {},
    content: [{ type: "text", text: `assistant:${id}` }],
  } as any;
}

function toolMsg(id: string) {
  return {
    id,
    role: "tool",
    kind: "model",
    source: { kind: "tool", toolCallId: `call_${id}` },
    metadata: {},
    content: [{ type: "tool-result", toolCallId: `call_${id}`, name: "read", content: "ok" }],
  } as any;
}

async function freshBackend(sid: string): Promise<JsonlBackend> {
  const backend = new JsonlBackend();
  if (await backend.hasSession(sid)) await backend.deleteSession(sid);
  await backend.createSession(sid, { title: "t" });
  return backend;
}

function replay(events: BaseEvent[]) {
  return foldEvents(events, createInitialState());
}

describe("user/message 结构化 source 落盘", () => {
  it("sub_agent 通知：事件含 source，回放后 source.kind 仍为 sub_agent", async () => {
    const sid = "src-subagent";
    const backend = await freshBackend(sid);
    const store = new JsonlMessageService(backend);

    const source = {
      kind: "sub_agent",
      subSessionId: "session-child",
      agentName: "调研",
      jobId: "job-1",
    };
    await store.beginTurn(sid);
    await store.appendMessages(sid, [userMsg("u1", source)]);

    const events = await store.getAllEvents(sid);
    const ev = events.find((e) => e.type === "user/message")!;
    expect((ev.data as any).source).toEqual(source);

    const state = replay(events);
    const node = state.messages.find((m) => m.id === "u1")!;
    expect(node.source.kind).toBe("sub_agent");
    expect((node.source as any).subSessionId).toBe("session-child");
  });

  it("plugin 注入：回放后 source 与写入一致", async () => {
    const sid = "src-plugin";
    const backend = await freshBackend(sid);
    const store = new JsonlMessageService(backend);

    const source = { kind: "plugin", plugin: "plan-mode" };
    await store.beginTurn(sid);
    await store.appendMessages(sid, [userMsg("u1", source, "注入提示")]);

    const state = replay(await store.getAllEvents(sid));
    const node = state.messages.find((m) => m.id === "u1")!;
    expect(node.source).toEqual(source);
  });

  it("真实用户（kind='user'）：事件不含 source 字段，回放兜底 {kind:'user'}", async () => {
    const sid = "src-real-user";
    const backend = await freshBackend(sid);
    const store = new JsonlMessageService(backend);

    await store.beginTurn(sid);
    await store.appendMessages(sid, [userMsg("u1", { kind: "user" }, "你好")]);

    const events = await store.getAllEvents(sid);
    const ev = events.find((e) => e.type === "user/message")!;
    expect(Object.prototype.hasOwnProperty.call(ev.data, "source")).toBe(false);

    const state = replay(events);
    const node = state.messages.find((m) => m.id === "u1")!;
    expect(node.source).toEqual({ kind: "user" });
  });

  it("tool/result 与 assistant/message 分支 shape 不变（未被 source 改动波及）", async () => {
    const sid = "src-other-branches";
    const backend = await freshBackend(sid);
    const store = new JsonlMessageService(backend);

    await store.beginTurn(sid);
    await store.appendMessages(sid, [assistantMsg("a1"), toolMsg("t1")]);

    const events = await store.getAllEvents(sid);
    const assistant = events.find((e) => e.type === "assistant/message")!;
    const tool = events.find((e) => e.type === "tool/result")!;
    expect(assistant).toBeTruthy();
    expect(tool).toBeTruthy();
    // 两者都不带 user/message 的 source 字段（结果由事件名与 toolCallId 承载）
    expect(Object.prototype.hasOwnProperty.call(assistant.data, "source")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(tool.data, "source")).toBe(false);

    const state = replay(events);
    expect(state.messages.find((m) => m.id === "a1")!.source.kind).toBe("model");
    expect(state.messages.find((m) => m.id === "t1")!.source.kind).toBe("tool");
  });
});
