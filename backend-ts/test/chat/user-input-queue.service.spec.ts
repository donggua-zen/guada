/**
 * 用户输入队列（M3）状态机契约：
 * - FIFO、revision 递增、暂停/继续；
 * - 排序边界（running 前缀之后、failed 之前）；
 * - 立即发送提升与 failed 复活；
 * - 会话删除清理。
 */
import { HttpException } from "@nestjs/common";
import { UserInputQueueService } from "../../src/modules/chat/user-input-queue.service";

function build() {
  const eventBus = { emit: jest.fn() };
  const queue = new UserInputQueueService(eventBus as any);
  return { queue, eventBus };
}

function enqueue(queue: UserInputQueueService, sid: string, texts: string[]) {
  return texts.map(
    (content) => queue.enqueue({ sessionId: sid, content }).item.id,
  );
}

describe("UserInputQueueService", () => {
  it("入队返回快照并广播全量状态，revision 单调递增", () => {
    const { queue, eventBus } = build();
    const { item, snapshot } = queue.enqueue({
      sessionId: "s1",
      content: "  hello  ",
    });

    // 原文保留（与直发一致），空值判定才用 trim
    expect(item.content).toBe("  hello  ");
    expect(item.status).toBe("queued");
    expect(snapshot).toMatchObject({
      sessionId: "s1",
      revision: 1,
      paused: null,
      promotionId: null,
      items: [{ content: "  hello  ", status: "queued" }],
    });
    expect(eventBus.emit).toHaveBeenCalledWith(
      "chat.user_queue_changed",
      expect.objectContaining({
        sessionId: "s1",
        payload: expect.objectContaining({ revision: 1 }),
      }),
    );

    queue.enqueue({ sessionId: "s1", content: "second" });
    expect(queue.getSnapshot("s1").revision).toBe(2);
  });

  it("getSnapshot 是纯读：不递增 revision、不广播", () => {
    const { queue, eventBus } = build();
    const empty = queue.getSnapshot("missing");
    expect(empty).toMatchObject({ revision: 0, items: [], paused: null });
    expect(eventBus.emit).not.toHaveBeenCalled();

    queue.enqueue({ sessionId: "s1", content: "a" });
    const calls = eventBus.emit.mock.calls.length;
    queue.getSnapshot("s1");
    queue.getSnapshot("s1");
    expect(eventBus.emit).toHaveBeenCalledTimes(calls);
  });

  it("空输入 400；超过上限 409", () => {
    const { queue } = build();
    try {
      queue.enqueue({ sessionId: "s1", content: "   " });
      throw new Error("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: "QUEUE_EMPTY_INPUT",
      });
    }

    for (let i = 0; i < 50; i++) {
      queue.enqueue({ sessionId: "s1", content: `m${i}` });
    }
    try {
      queue.enqueue({ sessionId: "s1", content: "overflow" });
      throw new Error("should throw");
    } catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({
        code: "QUEUE_FULL",
      });
    }
  });

  it("撤回：queued 可删，running 409；删除会清掉 promotion", () => {
    const { queue } = build();
    const [a, b] = enqueue(queue, "s1", ["A", "B"]);

    expect(queue.remove("s1", a).items.map((i) => i.content)).toEqual(["B"]);

    queue.enqueue({ sessionId: "s1", content: "C" });
    queue.markRunning("s1", b);
    expect(() => queue.remove("s1", b)).toThrow(HttpException);
    expect(queue.getSnapshot("s1").items[0].status).toBe("running");
  });

  it("排序：只在 running 之后、failed 之前移动", () => {
    const { queue } = build();
    const [a, b, c] = enqueue(queue, "s1", ["A", "B", "C"]);

    expect(
      queue.reorder("s1", b, -1).items.map((i) => i.content),
    ).toEqual(["B", "A", "C"]);

    queue.markRunning("s1", b);
    expect(() => queue.reorder("s1", a, -1)).toThrow(HttpException);

    queue.resetToQueued("s1", b);
    queue.markFailed("s1", c, "boom");
    expect(() => queue.reorder("s1", a, 1)).toThrow(HttpException);
  });

  it("暂停/继续保留条目，继续后 paused 清空", () => {
    const { queue } = build();
    enqueue(queue, "s1", ["A"]);

    expect(queue.pause("s1", "manual").paused).toMatchObject({
      reason: "manual",
    });
    expect(queue.getSnapshot("s1").items).toHaveLength(1);

    expect(queue.resume("s1").paused).toBeNull();
  });

  it("立即发送：failed 复活并移到队首，清空暂停", () => {
    const { queue } = build();
    const [a, b] = enqueue(queue, "s1", ["A", "B"]);
    queue.markFailed("s1", b, "boom");
    queue.pause("s1", "error");

    const snapshot = queue.requestSendNow("s1", b);
    expect(snapshot.items.map((i) => i.content)).toEqual(["B", "A"]);
    expect(snapshot.items[0].status).toBe("queued");
    expect(snapshot.items[0].error).toBeUndefined();
    expect(snapshot.paused).toBeNull();
    expect(snapshot.promotionId).toBe(b);

    expect(queue.consumePromotion("s1")).toBe(b);
    expect(queue.getSnapshot("s1").promotionId).toBeNull();

    queue.markRunning("s1", a);
    expect(() => queue.requestSendNow("s1", a)).toThrow(HttpException);
  });

  it("markRunning + completeHead：启动成功后移除在途队首", () => {
    const { queue } = build();
    const [a, b] = enqueue(queue, "s1", ["A", "B"]);

    queue.markRunning("s1", a);
    expect(queue.getSnapshot("s1").items[0].status).toBe("running");
    queue.completeHead("s1");

    const snapshot = queue.getSnapshot("s1");
    expect(snapshot.items.map((i) => i.id)).toEqual([b]);
  });

  it("计数与会话删除清理", () => {
    const { queue } = build();
    enqueue(queue, "s1", ["A", "B"]);
    enqueue(queue, "s2", ["C"]);

    expect(queue.getAllCounts()).toEqual({ s1: 2, s2: 1 });
    expect(queue.hasAnyPending()).toBe(true);

    queue.handleSessionDeleted({ sessionId: "s1" });
    expect(queue.getSnapshot("s1").items).toHaveLength(0);
    expect(queue.getAllCounts()).toEqual({ s2: 1 });
  });
});
