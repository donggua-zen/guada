import { WorkspaceEventsController } from "../../src/modules/chat/workspace-events.controller";

/**
 * workspace 控制面（REST）只保留 setWatchScope：
 * 数据面（文件变化事件）已迁到 WebSocket 的 workspace/watch + event。
 */
describe("WorkspaceEventsController 控制面", () => {
  function createController(sessionExists = true) {
    const sessionService = {
      getSessionById: jest
        .fn()
        .mockResolvedValue(sessionExists ? { id: "session" } : null),
    };
    const watcher = { setWatchScope: jest.fn() };
    const controller = new WorkspaceEventsController(
      sessionService as any,
      watcher as any,
    );
    return { controller, sessionService, watcher };
  }

  it("合法 scope → 委托 watcher.setWatchScope（含 clientId 与 enabled）", async () => {
    const { controller, watcher } = createController();

    await controller.setWatchScope("session", "client-1", {
      scope: "git",
      enabled: true,
    });

    expect(watcher.setWatchScope).toHaveBeenCalledWith(
      "session",
      "client-1",
      "git",
      true,
    );
  });

  it("enabled=false → 退订", async () => {
    const { controller, watcher } = createController();

    await controller.setWatchScope("session", "client-1", {
      scope: "file",
      enabled: false,
    });

    expect(watcher.setWatchScope).toHaveBeenCalledWith(
      "session",
      "client-1",
      "file",
      false,
    );
  });

  it("非法 scope → 报错且不委托", async () => {
    const { controller, watcher } = createController();

    await expect(
      controller.setWatchScope("session", "client-1", { scope: "nope" }),
    ).rejects.toThrow("Invalid watch scope");
    expect(watcher.setWatchScope).not.toHaveBeenCalled();
  });

  it("会话不存在 → 报错", async () => {
    const { controller } = createController(false);

    await expect(
      controller.setWatchScope("session", "client-1", { scope: "file" }),
    ).rejects.toThrow("Session not found");
  });
});
