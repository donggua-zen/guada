/// <reference types="jest" />

import { HttpException } from "@nestjs/common";
import { MessagesController } from "./messages.controller";

/**
 * 清空聊天记录端点契约：
 * - 流式输出中拒绝（409 SESSION_STREAMING），不清空、不广播；
 * - 成功后广播 session.cleared（带发起窗口 source），其他窗口据此清树重拉；
 * - 清空失败不广播（避免其他窗口白清一遍）。
 */
describe("MessagesController 清空聊天记录", () => {
  function createController() {
    const messageStore = {
      ensureSession: jest.fn(async () => undefined),
      clearSessionTurns: jest.fn(async () => undefined),
    };
    const hasActiveStream = jest.fn(() => false);
    const eventBus = { emit: jest.fn() };
    const getEventPage = jest.fn(async () => ({
      events: [],
      endSeq: 0,
      nextBeforeSeq: null,
      hasMore: false,
    }));
    const controller = new MessagesController(
      messageStore as any,
      { hasActiveStream } as any,
      { getEventPage } as any,
      eventBus as any,
    );
    return { controller, messageStore, hasActiveStream, eventBus, getEventPage };
  }

  it("流式输出中 → 409，且不清空、不广播", async () => {
    const { controller, messageStore, eventBus, hasActiveStream } =
      createController();
    hasActiveStream.mockReturnValue(true);

    let caught: unknown;
    try {
      await controller.clearSessionMessages("s1", "client-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(409);
    expect((caught as HttpException).getResponse()).toMatchObject({
      code: "SESSION_STREAMING",
      activeSessionId: "s1",
    });
    expect(messageStore.clearSessionTurns).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("成功清空 → 广播 session.cleared（带发起窗口 source）", async () => {
    const { controller, messageStore, eventBus, hasActiveStream } =
      createController();

    await controller.clearSessionMessages("s1", "client-1");

    expect(hasActiveStream).toHaveBeenCalledWith("s1");
    expect(messageStore.clearSessionTurns).toHaveBeenCalledWith("s1");
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "session.cleared",
      expect.objectContaining({
        sessionId: "s1",
        source: "client-1",
        timestamp: expect.any(String),
      }),
    );
  });

  it("清空失败 → 不广播", async () => {
    const { controller, messageStore, eventBus } = createController();
    messageStore.clearSessionTurns.mockRejectedValueOnce(new Error("disk"));

    await expect(controller.clearSessionMessages("s1")).rejects.toThrow("disk");
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("无发起窗口标识（缺 x-client-id）→ source 缺省", async () => {
    const { controller, eventBus } = createController();

    await controller.clearSessionMessages("s1");

    expect(eventBus.emit).toHaveBeenCalledWith(
      "session.cleared",
      expect.objectContaining({ sessionId: "s1", source: undefined }),
    );
  });
});
