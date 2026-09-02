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
