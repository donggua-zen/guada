/// <reference types="jest" />

/**
 * 轨迹投影服务测试（真实 JsonlBackend + JsonlMessageService 落盘 → TrajectoryService 投影）
 *
 * 覆盖：
 * - 主循环多迭代 + 辅助调用 + envelope 变更的完整投影（IN/OUT 区间、usage、status）
 * - 重试（attemptIndex）与失败收口（error → status='error'）
 * - unclosed 孤儿卡（写入侧兜底失败时投影不丢卡）
 * - 旧会话（无 step 事件）：steps=[] + available=false，不伪造
 * - limit 截取最近 N 个卡 + totalSteps 保留全量计数
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import { TrajectoryService } from "../../src/modules/trajectory/trajectory.service";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trajectory-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

function msg(id: string, role: "user" | "assistant" | "tool", extra: any = {}) {
  return {
    id,
    role,
    kind: role === "user" ? "user" : "model",
    source:
      role === "assistant"
        ? ({ kind: "model", provider: "p", model: "m1" } as any)
        : role === "tool"
          ? ({ kind: "tool", toolCallId: `call_${id}` } as any)
          : ({ kind: "user" } as any),
    metadata: {},
    content: [{ type: "text", text: `${role}:${id}` }],
    ...extra,
  } as any;
}

async function seedSession(sid: string): Promise<JsonlMessageService> {
  const backend = new JsonlBackend();
  if (await backend.hasSession(sid)) await backend.deleteSession(sid);
  await backend.createSession(sid, { title: "t" });
  const store = new JsonlMessageService(backend);

  // envelope initial（主循环 beginStep 内写入）
  await store.appendEnvelope(sid, { reason: "initial", system: "sys", model: "m1", provider: "p1" });

  // 回合 1：两次迭代（step 1 正常、step 2 重试后成功）
  const { turnId } = await store.beginTurn(sid);
  await store.appendMessages(sid, [msg("u1", "user")]);

  await store.appendStepStart(sid, {
    turnId, step: 1, source: "main_turn", model: "m1", provider: "p1", requestId: "a1",
  });
  await store.appendMessages(sid, [msg("a1", "assistant")]);
  await store.appendMessages(sid, [msg("t1", "tool")]);
  await store.appendStepEnd(sid, {
    requestId: "a1", attemptIndex: 0, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    finishReason: "tool-calls", durationMs: 1200, assistantMessageId: "a1",
  });

  await store.appendStepStart(sid, {
    turnId, step: 2, source: "main_turn", model: "m1", provider: "p1", requestId: "a2",
    transient: [msg("transient-1", "user")],
  });
  await store.appendMessages(sid, [msg("a2", "assistant")]);
  await store.appendStepEnd(sid, {
    requestId: "a2", attemptIndex: 2, usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
    finishReason: "stop", durationMs: 3000, assistantMessageId: "a2",
  });

  // Token 收敛：turn/finish 不再携带 usage/占用快照（读侧聚合/锚点归 context/stats）
  await store.finalizeTurn(sid, turnId, 5000, {
    finishReason: "stop",
  });

  // 辅助调用：标题（失败收口示例）
  await store.appendStepStart(sid, {
    turnId: null, step: 1, source: "session_title", requestId: "title-1", model: "m2",
    fullInput: [msg("title-input", "user")],
  });
  await store.appendStepEnd(sid, {
    requestId: "title-1", attemptIndex: 0, durationMs: 400,
    error: { name: "Error", message: "upstream 500" },
  });

  // envelope change（模型切换）
  await store.appendEnvelope(sid, { reason: "change", system: "sys2", model: "m2", provider: "p1" });

  // unclosed 孤儿卡（模拟进程中断，无 step/end）
  await store.appendStepStart(sid, {
    turnId: null, step: 1, source: "memory_sync", requestId: "mem-1",
  });

  return store;
}

describe("TrajectoryService 投影", () => {
  const sid = "traj-1";
  let service: TrajectoryService;

  beforeAll(async () => {
    await seedSession(sid);
    const backend = new JsonlBackend();
    service = new TrajectoryService(new JsonlMessageService(backend) as any);
  });

  it("完整投影：时间线共享一份、step 卡按事件序、IN/OUT 区间正确", async () => {
    const view = await service.getTrajectory(sid);
    expect(view.available).toBe(true);
    expect(view.totalSteps).toBe(4); // 主循环 2 + 标题 1 + 孤儿 memory_sync 1
    expect(view.steps).toHaveLength(4);

    // 共享时间线 = 折叠 surface（不含 step 事件本身）
    expect(view.timeline.map((n) => n.id)).toEqual(["u1", "a1", "t1", "a2"]);

    // 卡 1：主循环迭代 1（OUT 区含 assistant + tool 结果）
    const s1 = view.steps[0]!;
    expect(s1).toMatchObject({
      turnId: expect.any(String),
      step: 1, source: "main_turn", model: "m1", provider: "p1", requestId: "a1",
      status: "complete", finishReason: "tool-calls", attemptIndex: 0,
    });
    expect(s1.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    expect(s1.output.assistantMessageId).toBe("a1");
    expect(s1.endSeq).toBe(s1.output.toSeq);
    // OUT 区从 start 之后到 end（含 assistant/tool 消息事件）
    expect(s1.endSeq! - s1.startSeq).toBe(3); // assistant + tool/result + step/end 前共 2 消息事件

    // 卡 2：主循环迭代 2（transient verbatim 随 step/start；attemptIndex=2）
    const s2 = view.steps[1]!;
    expect(s2.status).toBe("complete");
    expect(s2.attemptIndex).toBe(2);
    expect(s2.input.transient).toHaveLength(1);
    expect(s2.input.transient![0]!.id).toBe("transient-1");

    // IN 区：卡 2 的输入 = 卡 1 收口之后到卡 2 start 之前（无新增 surface 消息 → 空区间）
    expect(s2.input.fromSeq).toBe(s1.endSeq! + 1);
    expect(s2.input.toSeq).toBe(s2.startSeq - 1);
    expect(s2.input.toSeq).toBeLessThan(s2.input.fromSeq); // 空区间（IN 与上一卡共享）

    // 卡 3：标题（error 收口 + fullInput）
    const s3 = view.steps[2]!;
    expect(s3).toMatchObject({ source: "session_title", status: "error", model: "m2" });
    expect(s3.error).toEqual({ name: "Error", message: "upstream 500" });
    expect(s3.input.fullInput).toHaveLength(1);
    expect(s3.turnId).toBeNull();

    // 卡 4：unclosed 孤儿卡
    const s4 = view.steps[3]!;
    expect(s4.status).toBe("unclosed");
    expect(s4.endSeq).toBeNull();
    expect(s4.completedAt).toBeNull();
    expect(s4.durationMs).toBeNull();
  });

  it("usage 投影合成：主循环 step/end 无 usage → 从括号内 assistant 消息 metadata.usage 取", async () => {
    const backend = new JsonlBackend();
    const sid2 = "traj-synthesis";
    if (await backend.hasSession(sid2)) await backend.deleteSession(sid2);
    await backend.createSession(sid2, { title: "t" });
    const store = new JsonlMessageService(backend);
    await store.beginTurn(sid2);
    await store.appendMessages(sid2, [msg("u1", "user")]);
    // 主循环 step：不带 usage（Token 收敛——usage 事实单载体在 assistant/message 上）
    await store.appendStepStart(sid2, {
      turnId: null, step: 1, source: "main_turn", model: "m1", requestId: "m1-r1",
    });
    await store.appendMessages(sid2, [msg("a1", "assistant", {
      metadata: { usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 } },
    })]);
    await store.appendStepEnd(sid2, {
      requestId: "m1-r1", attemptIndex: 0, durationMs: 900, finishReason: "stop",
      assistantMessageId: "a1",
    });

    const view = await service.getTrajectory(sid2);
    const s1 = view.steps[0]!;
    expect(s1.usage).toEqual({ promptTokens: 300, completionTokens: 120, totalTokens: 420 });
  });

  it("envelope 追踪：取最后一次 envelope 事件（change 覆盖 initial）", async () => {
    const view = await service.getTrajectory(sid);
    expect(view.envelope).toMatchObject({ reason: "change", system: "sys2", model: "m2" });
  });

  it("limit：截取最近 N 个卡，totalSteps 保留全量", async () => {
    const view = await service.getTrajectory(sid, 2);
    expect(view.totalSteps).toBe(4);
    expect(view.steps).toHaveLength(2);
    expect(view.steps[0]!.source).toBe("session_title");
    expect(view.steps[1]!.source).toBe("memory_sync");
    // 时间线仍全量（共享时间线不随 limit 截断）
    expect(view.timeline).toHaveLength(4);
  });

  it("旧会话（无 step 事件）：steps=[] + available=false，envelope 正常折叠", async () => {
    const backend = new JsonlBackend();
    const legacy = "traj-legacy";
    if (await backend.hasSession(legacy)) await backend.deleteSession(legacy);
    await backend.createSession(legacy, { title: "t" });
    const store = new JsonlMessageService(backend);
    await store.beginTurn(legacy);
    await store.appendMessages(legacy, [msg("u1", "user"), msg("a1", "assistant")]);

    const view = await service.getTrajectory(legacy);
    expect(view.available).toBe(false);
    expect(view.steps).toEqual([]);
    expect(view.totalSteps).toBe(0);
    expect(view.timeline.map((n) => n.id)).toEqual(["u1", "a1"]);
    expect(view.envelope).toBeNull();
  });
});
