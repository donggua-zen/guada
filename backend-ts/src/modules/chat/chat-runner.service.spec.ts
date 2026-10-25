/**
 * ChatRunnerService.startStream 僵尸流泄漏回归测试
 *
 * 背景 bug：startStream 原顺序为 startStream()（创建 ActiveStream）→ subscribe →
 * createFromSession → runAgentEngine（引擎才有错误兜底）。中间两处抛错
 * （subscribe 失败 / createFromSession 失败如 MODEL_NOT_RESOLVED）会让
 * ActiveStream 残留为僵尸：isRunning 永远 true，会话永久 SESSION_BUSY，
 * /stop 只 abort 无引擎消费信号，只能重启进程。
 *
 * 修复：createFromSession 上移到 startStream 之前（只读装配）+ startStream 后
 * 段落整体 try/catch（catch 里 stopStream 回收再 rethrow）。
 */
jest.mock("./session.service", () => ({ SessionService: class {} }));
jest.mock("./agent-engine.service", () => ({ AgentEngine: class {} }));
jest.mock("./session-context.factory", () => ({ SessionContextFactory: class {} }));
jest.mock("../../common/events/event-bus.service", () => ({
  EventBusService: class {},
}));

import { HttpException } from "@nestjs/common";
import { ChatRunnerService } from "./chat-runner.service";
import { SessionStreamManager } from "./session-stream.manager";

describe("ChatRunnerService.startStream 流生命周期", () => {
  const sessionId = "s-zombie";
  const session = { id: sessionId, sessionType: "web", settings: {} };

  let streamManager: SessionStreamManager;
  let sessionService: {
    getSessionById: jest.Mock;
    updateLastActiveAt: jest.Mock;
  };
  let agentEngine: { run: jest.Mock };
  let sessionContextFactory: { createFromSession: jest.Mock };
  let eventBus: { emit: jest.Mock };
  let runner: ChatRunnerService;

  beforeEach(() => {
    streamManager = new SessionStreamManager();
    sessionService = {
      getSessionById: jest.fn().mockResolvedValue(session),
      updateLastActiveAt: jest.fn().mockResolvedValue(undefined),
    };
    agentEngine = { run: jest.fn() };
    sessionContextFactory = { createFromSession: jest.fn() };
    eventBus = { emit: jest.fn() };
    const userInputQueue = {
      hasPending: jest.fn(() => false),
      hasAnyPending: jest.fn(() => false),
      getState: jest.fn(() => undefined),
      consumePromotion: jest.fn(() => null),
      resume: jest.fn(),
      pause: jest.fn(),
    };
    runner = new ChatRunnerService(
      streamManager,
      sessionService as any,
      agentEngine as any,
      sessionContextFactory as any,
      eventBus as any,
      userInputQueue as any,
    );
  });

  it("createFromSession 抛错：错误原样上抛，不残留僵尸流", async () => {
    const boom = new Error("MODEL_NOT_RESOLVED: no model configured");
    sessionContextFactory.createFromSession.mockRejectedValue(boom);

    await expect(
      runner.startStream({
        sessionId,
        userMessage: { content: "hi" },
      }),
    ).rejects.toThrow("MODEL_NOT_RESOLVED");

    // 关键断言：ActiveStream 从未创建/已被回收——会话不会被卡死在 SESSION_BUSY
    expect(streamManager.hasActiveStream(sessionId)).toBe(false);
    // 失败后立即可重试（修复前第二次必 SESSION_BUSY）
    await expect(
      runner.startStream({
        sessionId,
        userMessage: { content: "hi" },
      }),
    ).rejects.toThrow("MODEL_NOT_RESOLVED");
    expect(streamManager.hasActiveStream(sessionId)).toBe(false);
  });

  it("callbacks 订阅失败：stopStream 回收 ActiveStream，错误码透传", async () => {
    sessionContextFactory.createFromSession.mockResolvedValue({
      sessionId,
      workspacePath: "/tmp",
      sessionType: "web",
    });
    // 强制 subscribe 失败（返回 null → SUBSCRIBE_FAILED）
    jest.spyOn(streamManager, "subscribe").mockReturnValue(null);

    let caught: any;
    try {
      await runner.startStream(
        { sessionId, userMessage: { content: "hi" } },
        { onEvent: jest.fn(), onComplete: jest.fn(), onError: jest.fn() },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(409);
    expect(caught.getResponse()).toMatchObject({ code: "SUBSCRIBE_FAILED" });
    expect(streamManager.hasActiveStream(sessionId)).toBe(false);
  });

  it("正常路径：引擎结束后流被收尾关闭（重排不破坏生命周期）", async () => {
    sessionContextFactory.createFromSession.mockResolvedValue({
      sessionId,
      workspacePath: "/tmp",
      sessionType: "web",
    });
    // 引擎 Promise 由测试手动控制，消除"立即 resolve 的 mock 抢跑断言"的竞态
    let resolveEngine!: (v: { finishReason: string }) => void;
    agentEngine.run.mockImplementation(
      () => new Promise((res) => (resolveEngine = res)),
    );

    const unsubscribe = await runner.startStream({
      sessionId,
      userMessage: { content: "hi" },
    });
    expect(typeof unsubscribe).toBe("function");
    // startStream 返回时引擎在后台运行，流处于活跃态
    expect(streamManager.hasActiveStream(sessionId)).toBe(true);
    expect(agentEngine.run).toHaveBeenCalledTimes(1);

    // 引擎正常结束 → runAgentEngine 收尾关闭流
    resolveEngine({ finishReason: "stop" });
    await new Promise((r) => setTimeout(r, 20));

    expect(streamManager.hasActiveStream(sessionId)).toBe(false);
    // 状态事件：running → completed 成对广播
    const statuses = eventBus.emit.mock.calls
      .filter((c) => c[0] === "stream.status_changed")
      .map((c) => c[1].payload.status);
    expect(statuses).toEqual(["running", "completed"]);
  });
});
