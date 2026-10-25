/**
 * SessionQueueController：会话级队列 REST 入口（M3）
 * 只做参数校验与委派；状态机在 UserInputQueueService / ChatRunnerService。
 */
import { BadRequestException } from "@nestjs/common";
import { SessionQueueController } from "../../src/modules/chat/session-queue.controller";

function build() {
  const queue = {
    getSnapshot: jest.fn(() => "snapshot"),
    remove: jest.fn(() => "snapshot"),
    reorder: jest.fn(() => "snapshot"),
    pause: jest.fn(() => "snapshot"),
    resume: jest.fn(() => "snapshot"),
  };
  const runner = {
    sendQueuedNow: jest.fn(async () => "snapshot"),
  };
  const controller = new SessionQueueController(queue as any, runner as any);
  return { controller, queue, runner };
}

describe("SessionQueueController", () => {
  it("GET 返回服务端快照", () => {
    const { controller, queue } = build();
    expect(controller.getQueue("s1")).toBe("snapshot");
    expect(queue.getSnapshot).toHaveBeenCalledWith("s1");
  });

  it("DELETE 撤回指定项", () => {
    const { controller, queue } = build();
    expect(controller.removeItem("s1", "i1")).toBe("snapshot");
    expect(queue.remove).toHaveBeenCalledWith("s1", "i1");
  });

  it("send-now 交给 runner 抢断/提升", async () => {
    const { controller, runner } = build();
    await expect(controller.sendNow("s1", "i1")).resolves.toBe("snapshot");
    expect(runner.sendQueuedNow).toHaveBeenCalledWith("s1", "i1");
  });

  it("pause 固定 manual 原因；resume 清暂停", () => {
    const { controller, queue } = build();
    controller.pause("s1");
    expect(queue.pause).toHaveBeenCalledWith("s1", "manual");
    controller.resume("s1");
    expect(queue.resume).toHaveBeenCalledWith("s1");
  });

  it("reorder 校验 itemId 与 direction", () => {
    const { controller, queue } = build();
    expect(() => controller.reorder("s1", {} as any)).toThrow(
      BadRequestException,
    );
    expect(() => controller.reorder("s1", { itemId: "i1", direction: 0 })).toThrow(
      BadRequestException,
    );

    expect(controller.reorder("s1", { itemId: "i1", direction: 1 })).toBe(
      "snapshot",
    );
    expect(queue.reorder).toHaveBeenCalledWith("s1", "i1", 1);
  });
});
