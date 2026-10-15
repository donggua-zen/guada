/// <reference types="jest" />

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import { CorruptSessionLogError } from "../../src/common/persistence/errors";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "torn-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

/** 活跃段文件路径（访问 backend 私有 getSessionDir/getActiveSegmentFile） */
async function activeSegmentPath(backend: JsonlBackend, sid: string): Promise<string> {
  const dir = (backend as any).getSessionDir(sid) as string;
  const info = await backend.getActiveSegmentInfo(sid);
  return path.join(dir, info!.file);
}

describe("torn-tail 修复（坏行截断 + 合成 interrupted）", () => {
  const sid = "torn-repair";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  it("冷加载修复活跃段坏行：截断 + 未闭合回合合成 interrupted", async () => {
    const s1 = new JsonlMessageService(backend);
    // 写一个未闭合回合（不开 turn/finish）
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
      { id: "a1", role: "assistant", kind: "model", source: { kind: "model", provider: "p", model: "m" }, metadata: {}, content: [{ type: "text", text: "ans" }] },
    ]);

    // 模拟崩溃：活跃段追加一条不完整 turn/finish
    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(file, `{"type":"turn/finish","turnId":"${turnId}","data":{...`, "utf-8");

    // 冷加载：新实例 → rebuildState → repairActiveSegmentIfNeeded
    const s2 = new JsonlMessageService(backend);
    const state = await (s2 as any).getState(sid);

    // 1) 文件已截断干净（重扫无坏行）
    const { events, truncateTo, gap } = await backend.scanActiveSegment(sid);
    expect(truncateTo).toBeNull();
    expect(gap).toBeNull();
    expect(events.some(e => e.type === "turn/finish" && (e.data as any).finishReason === "interrupted")).toBe(true);

    // 2) 折叠态：合成的 interrupted turn/finish 已清游标；已交付消息完整保留
    expect(state.currentTurnId).toBeNull();
    expect(state.messages.map((n) => n.id)).toEqual(["u1", "a1"]);
    // 3) seq 连续：合成事件 seq = 最后完整事件 seq + 1
    expect(state.lastProcessedSeq).toBe(events[events.length - 1].seq);
  });

  it("无未闭合回合时坏行截断即可，不合成", async () => {
    const s1 = new JsonlMessageService(backend);
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
    ]);
    await s1.finalizeTurn(sid, turnId, 10, { finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });

    // 坏行（模拟损坏残留）
    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(file, `{"type":"broken",`, "utf-8");

    const s2 = new JsonlMessageService(backend);
    const state = await (s2 as any).getState(sid);

    const { events, truncateTo } = await backend.scanActiveSegment(sid);
    expect(truncateTo).toBeNull();
    // 未开新回合 → 不合成 interrupted
    expect(events.some(e => (e.data as any)?.finishReason === "interrupted")).toBe(false);
    // 原回合完整（finish 后游标已清，消息保留）
    expect(state.currentTurnId).toBeNull();
    expect(state.messages.some((n) => n.id === "u1")).toBe(true);
  });

  it("seq 缺口 → 拒绝加载（抛 CorruptSessionLogError）", async () => {
    const s1 = new JsonlMessageService(backend);
    await s1.beginTurn(sid);
    // 手动写跳号行（模拟中间事件丢失）
    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(
      file,
      `{"type":"user/message","seq":999,"time":1,"data":{"messageId":"x1","kind":"user","content":"x","metadata":{}}}` + "\n",
      "utf-8",
    );

    const s2 = new JsonlMessageService(backend);
    await expect((s2 as any).getState(sid)).rejects.toBeInstanceOf(CorruptSessionLogError);
  });

  it("归档段坏行 → getAllEvents 拒绝（历史损坏）", async () => {
    const s1 = new JsonlMessageService(backend);
    await s1.beginTurn(sid);
    await backend.splitSegment(sid); // 归档 seg-0000（含 init + turn/start）
    // 在归档段末尾追加坏行
    const dir = (backend as any).getSessionDir(sid) as string;
    fs.appendFileSync(path.join(dir, "seg-0000.jsonl"), `{"type":"corrupt",` + "\n", "utf-8");

    const s2 = new JsonlMessageService(backend);
    await expect((s2 as any).getState(sid)).rejects.toBeInstanceOf(CorruptSessionLogError);
  });

  it("活跃段坏行：getAllEvents 返回截断事件（display 语义，不抛）", async () => {
    const s1 = new JsonlMessageService(backend);
    await s1.beginTurn(sid);
    await s1.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
    ]);
    const before = (await backend.getAllEvents(sid)).length;

    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(file, `{"type":"broken",`, "utf-8");

    // display 读盘路径：坏行被忽略返回截断事件（不抛；修复归冷加载）
    const after = (await backend.getAllEvents(sid)).length;
    expect(after).toBe(before);
  });
});

describe("torn-tail 修复补未配对 tool-call 错误结果（对齐 DSH interruptedTurnClosers）", () => {
  it("未闭合回合含未配对 tool-call → 合成错误 tool/result + interrupted turn/finish", async () => {
    const sid = "torn-tool-repair";
    const backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
    const s1 = new JsonlMessageService(backend);
    await s1.beginTurn(sid);
    await s1.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
      {
        id: "a1", role: "assistant", kind: "model",
        source: { kind: "model", provider: "test", model: "m" },
        metadata: {},
        content: [
          {
            type: "tool-call", toolCallId: "call_1", name: "shell",
            arguments: "{}",
          },
        ],
      },
    ]);
    // 破坏：活跃段尾部追加坏行，制造 torn tail
    const file = await activeSegmentPath(backend, sid);
    fs.appendFileSync(file, `{"type":"assistant/message","seq":999,` + "\n", "utf-8");

    // 冷加载触发修复
    const s2 = new JsonlMessageService(backend);
    await s2.getLastProcessedSeq(sid);

    // 修复后：未配对 tool-call 应有合成错误结果 + interrupted turn/finish
    const all = await backend.getAllEvents(sid);
    const toolResults = all.filter((e) => e.type === "tool/result");
    const finish = all.find((e) => e.type === "turn/finish");
    expect(toolResults.length).toBeGreaterThan(0);
    expect(toolResults[0].data.toolCallId).toBe("call_1");
    expect(String(toolResults[0].data.content)).toContain("interrupted before dispatch");
    expect(toolResults[0].data.isError).toBe(true);
    expect(finish?.data.finishReason).toBe("interrupted");
  });
});

describe("冷加载收口：事件流完整但停在未闭合回合（无坏行，torn 尾修复不触发）", () => {
  const sid = "clean-interrupt-close";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  /** 造一个未闭合回合：user + assistant(tool-call)，无 tool/result、无 turn/finish */
  async function seedOpenTurnWithDanglingCall(service: JsonlMessageService): Promise<void> {
    await service.beginTurn(sid);
    await service.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
      {
        id: "a1",
        role: "assistant",
        kind: "model",
        source: { kind: "model", provider: "test", model: "m" },
        metadata: {},
        content: [
          { type: "tool-call", toolCallId: "call_9", name: "shell", arguments: "{}" },
        ],
      },
    ]);
  }

  it("冷加载即补合成结果并闭合回合（不依赖坏行）", async () => {
    await seedOpenTurnWithDanglingCall(new JsonlMessageService(backend));

    // 无坏行：进程被杀在两次 append 之间的典型残留
    const { truncateTo } = await backend.scanActiveSegment(sid);
    expect(truncateTo).toBeNull();

    const cold = new JsonlMessageService(backend);
    const state = await (cold as any).getState(sid);

    const all = await backend.getAllEvents(sid);
    const toolResults = all.filter((e) => e.type === "tool/result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].data.toolCallId).toBe("call_9");
    expect(String(toolResults[0].data.content)).toContain("interrupted before dispatch");
    expect(toolResults[0].data.isError).toBe(true);
    expect(all.find((e) => e.type === "turn/finish")?.data.finishReason).toBe("interrupted");
    // 折叠态与磁盘一致：回合已闭合
    expect(state.currentTurnId).toBeNull();
  });

  it("同进程内再次重建不重复收口（TTL 过期重建不得误闭在途回合）", async () => {
    // 写入方与冷加载方是两个实例（生产语义：写入发生在重启前的进程里，收口发生在启动后）
    const writer = new JsonlMessageService(backend);
    await seedOpenTurnWithDanglingCall(writer);

    const cold = new JsonlMessageService(backend);
    await (cold as any).getState(sid);
    const afterCold = await backend.getAllEvents(sid);
    expect(afterCold.filter((e) => e.type === "tool/result")).toHaveLength(1);
    expect(afterCold.filter((e) => e.type === "turn/finish")).toHaveLength(1);

    // 冷加载后同进程内开新回合（在途）→ 强制重建（TTL 过期路径）不得当成中断收口
    await seedOpenTurnWithDanglingCall(cold);
    await (cold as any).getState(sid, true);

    const afterRebuild = await backend.getAllEvents(sid);
    expect(afterRebuild.filter((e) => e.type === "turn/start")).toHaveLength(2);
    expect(afterRebuild.filter((e) => e.type === "tool/result")).toHaveLength(1);
    expect(afterRebuild.filter((e) => e.type === "turn/finish")).toHaveLength(1);
  });
});

describe("repairDanglingToolCalls（配对非法错误的自愈入口）", () => {
  const sid = "heal-dangling";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  function assistantWithCall(id: string, callId: string) {
    return {
      id,
      role: "assistant" as const,
      kind: "model" as const,
      source: { kind: "model" as const, provider: "test", model: "m" },
      metadata: {},
      content: [{ type: "tool-call" as const, toolCallId: callId, name: "shell", arguments: "{}" }],
    };
  }

  it("未闭合回合末条 assistant 的悬空调用 → 补 isError 结果（紧邻调用，配对完整）", async () => {
    const service = new JsonlMessageService(backend);
    await service.beginTurn(sid);
    await service.appendMessages(sid, [assistantWithCall("a1", "call_x")]);

    const repaired = await service.repairDanglingToolCalls(sid);
    expect(repaired).toBe(1);

    const state = await (service as any).getState(sid);
    const ids = state.messages.map((n: any) => n.id);
    // 结果紧邻调用之后 → wire 上形状合法（不是"结果隔在别的消息之后"）
    expect(ids).toEqual(["a1", expect.stringContaining("m_")]);
    const result = state.messages[1];
    expect(result.source).toEqual({ kind: "tool", toolCallId: "call_x" });
    expect(result.content[0]).toMatchObject({ isError: true, toolCallId: "call_x" });
    expect(String(result.content[0].content)).toContain("interrupted before dispatch");
    // 自愈不闭合回合：回合仍在进行中（后续消息继续归属当前回合）
    expect(state.currentTurnId).not.toBeNull();
  });

  it("末条不是 assistant（悬空调用在更早的消息里）→ 不补（补了会被别的消息隔开，仍非法）", async () => {
    const service = new JsonlMessageService(backend);
    await service.beginTurn(sid);
    await service.appendMessages(sid, [
      assistantWithCall("a1", "call_x"),
      { id: "u2", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "next" }] },
    ]);

    expect(await service.repairDanglingToolCalls(sid)).toBe(0);
    const all = await backend.getAllEvents(sid);
    expect(all.filter((e) => e.type === "tool/result")).toHaveLength(0);
  });

  it("已闭合回合里的悬空调用 → 不补（消息事件会错归到当前回合；该残骸由请求侧占位兜底）", async () => {
    const service = new JsonlMessageService(backend);
    const { turnId } = await service.beginTurn(sid);
    await service.appendMessages(sid, [assistantWithCall("a1", "call_x")]);
    await service.finalizeTurn(sid, turnId, 5, { finishReason: "error" } as any);

    expect(await service.repairDanglingToolCalls(sid)).toBe(0);
    const all = await backend.getAllEvents(sid);
    expect(all.filter((e) => e.type === "tool/result")).toHaveLength(0);
  });
});
