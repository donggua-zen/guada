/**
 * ChatRunner 消费用户队列（M3）：
 * - 队首一条一条启动；失败保留并暂停；
 * - 忙碌竞态回队列等待；
 * - 立即发送：忙碌时 abort 当前回合，终态结算里恢复消费；
 * - 用户队列优先于系统通知队列。
 */
import { HttpException, HttpStatus } from "@nestjs/common";
import { ChatRunnerService } from "../../src/modules/chat/chat-runner.service";
import { UserInputQueueService } from "../../src/modules/chat/user-input-queue.service";

function build() {
  const streamManager = {
    hasActiveStream: jest.fn(() => false),
    startStream: jest.fn(() => true),
    stopStream: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(() => () => {}),
    abortStream: jest.fn(),
    getActiveStreams: jest.fn(() => []),
  };
  const sessionService = {
    getSessionById: jest.fn(async () => ({ id: "s1", settings: {} })),
    updateLastActiveAt: jest.fn(async () => {}),
  };
  const sessionContextFactory = {
    createFromSession: jest.fn(async () => ({
      sessionId: "s1",
      sessionType: "web",
      workspacePath: "/tmp",
    })),
  };
  const agentEngine = {
    run: jest.fn(async () => ({ finishReason: "stop" })),
  };
  const eventBus = { emit: jest.fn() };
  const queue = new UserInputQueueService(eventBus as any);
  const runner = new ChatRunnerService(
    streamManager as any,
    sessionService as any,
    agentEngine as any,
    sessionContextFactory as any,
    eventBus as any,
    queue,
  );
  // 只测消费编排：不让真实 startStream 启动后台引擎
  (runner as any).startStream = jest.fn(async () => () => {});
  return { runner, queue, streamManager, eventBus };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("ChatRunnerService 用户队列消费", () => {
  it("逐条启动队首，携带冻结设置/附件/编辑目标与来源标记", async () => {
    const { runner, queue } = build();
    queue.enqueue({
      sessionId: "s1",
      content: "A",
      files: [{ mediaType: "text/plain", bytes: 1, url: "u1" }],
      injectedBlocks: [{ type: "text", text: "injected" }],
      knowledgeBaseIds: ["kb1"],
      replaceTurnId: "turn-1",
      settingsOverride: { modelId: "prov:m" },
      clientId: "client-1",
    });
    queue.enqueue({ sessionId: "s1", content: "B" });

    await runner.drainUserQueue("s1");

    expect((runner as any).startStream).toHaveBeenCalledTimes(1);
    expect((runner as any).startStream).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        userMessage: expect.objectContaining({
          content: "A",
          injectedBlocks: [{ type: "text", text: "injected" }],
          knowledgeBaseIds: ["kb1"],
          replaceTurnId: "turn-1",
        }),
        settingsOverride: { modelId: "prov:m" },
        source: expect.objectContaining({
          kind: "user",
          clientId: "client-1",
          queueItemIds: [expect.any(String)],
        }),
      }),
    );
    // 只发一条，剩下等 turn_finished
    expect(queue.getSnapshot("s1").items.map((i) => i.content)).toEqual(["B"]);
  });

  it("忙碌竞态：恢复为 queued，不标记失败", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });
    (runner as any).startStream = jest.fn(async () => {
      throw new HttpException(
        { error: "busy", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      );
    });

    await runner.drainUserQueue("s1");

    const snapshot = queue.getSnapshot("s1");
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].status).toBe("queued");
    expect(snapshot.paused).toBeNull();
  });

  it("启动失败：保留并标记 failed，同时暂停队列", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });
    (runner as any).startStream = jest.fn(async () => {
      throw new Error("network down");
    });

    await runner.drainUserQueue("s1");

    const snapshot = queue.getSnapshot("s1");
    expect(snapshot.items[0].status).toBe("failed");
    expect(snapshot.items[0].error).toContain("network down");
    expect(snapshot.paused).toMatchObject({ reason: "error" });
  });

  it("立即发送（空闲）：提升后直接消费并清掉 promotion", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });
    const b = queue.enqueue({ sessionId: "s1", content: "B" }).item.id;

    const snapshot = await runner.sendQueuedNow("s1", b);
    await flush();

    expect(snapshot.promotionId).toBeNull();
    expect((runner as any).startStream).toHaveBeenCalledTimes(1);
    expect(
      (runner as any).startStream.mock.calls[0][0].userMessage.content,
    ).toBe("B");
    expect(queue.getSnapshot("s1").items.map((i) => i.content)).toEqual(["A"]);
  });

  it("立即发送（忙碌）：abort 当前回合，终态结算优先补发而不是暂停", async () => {
    const { runner, queue, streamManager } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });
    const b = queue.enqueue({ sessionId: "s1", content: "B" }).item.id;
    streamManager.hasActiveStream.mockReturnValue(true);

    const snapshot = await runner.sendQueuedNow("s1", b);

    expect(streamManager.abortStream).toHaveBeenCalledWith("s1");
    expect(snapshot.promotionId).toBe(b);
    expect(snapshot.items.map((i) => i.content)).toEqual(["B", "A"]);

    // 当前回合以 user_cancel 收尾：promotion 覆盖暂停策略
    streamManager.hasActiveStream.mockReturnValue(false);
    (runner as any).settleUserQueueAfterTurn("s1", "user_cancel", false);
    await flush();

    const after = queue.getSnapshot("s1");
    expect(after.paused).toBeNull();
    expect(after.items.map((i) => i.content)).toEqual(["A"]);
    expect((runner as any).startStream).toHaveBeenCalledTimes(1);
    expect(
      (runner as any).startStream.mock.calls[0][0].userMessage.content,
    ).toBe("B");
  });

  it("普通停止（无 promotion）：用户队列暂停，不自动发下一条", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });

    (runner as any).settleUserQueueAfterTurn("s1", "user_cancel", false);
    await flush();

    expect(queue.getSnapshot("s1").paused).toMatchObject({
      reason: "stopped",
    });
    expect((runner as any).startStream).not.toHaveBeenCalled();
  });

  it("正常收尾：自动消费下一条", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });

    (runner as any).settleUserQueueAfterTurn("s1", "stop", true);
    await flush();

    expect((runner as any).startStream).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot("s1").items).toHaveLength(0);
  });

  it("系统通知队列让路：用户队列非空时不处理系统项", async () => {
    const { runner, queue } = build();
    queue.enqueue({ sessionId: "s1", content: "A" });
    (runner as any).queues.set("s1", {
      items: [{ id: "sys" }],
      isProcessing: false,
    });

    await runner.processQueue("s1");

    expect((runner as any).startStream).not.toHaveBeenCalled();
    expect((runner as any).queues.get("s1").items).toHaveLength(1);
  });

  it("hasActiveWork 纳入用户队列", () => {
    const { runner, queue } = build();
    expect(runner.hasActiveWork()).toBe(false);
    queue.enqueue({ sessionId: "s1", content: "A" });
    expect(runner.hasActiveWork()).toBe(true);
  });
});
