import { EventEmitter } from "events";
import { WorkspaceEventsController } from "../../src/modules/chat/workspace-events.controller";

describe("WorkspaceEventsController", () => {
  it("SSE 连接关闭时只清理一次监听资源", async () => {
    const releaseWatching = jest.fn();
    const unsubscribe = jest.fn();
    const sessionService = {
      getSessionById: jest.fn().mockResolvedValue({
        id: "session",
        userId: "user",
      }),
    };
    const fileWatcherService = {
      startWatching: jest.fn().mockReturnValue(releaseWatching),
      onFileChange: jest.fn().mockReturnValue(unsubscribe),
    };
    const workspaceService = {
      resolveSessionWorkspaceDir: jest
        .fn()
        .mockResolvedValue("D:\\workspace"),
    };
    const controller = new WorkspaceEventsController(
      sessionService as any,
      fileWatcherService as any,
      workspaceService as any,
    );
    const response = Object.assign(new EventEmitter(), { destroyed: false });
    const request = Object.assign(new EventEmitter(), { res: response });

    const events = await controller.subscribeWorkspaceEvents(
      "session",
      "client",
      { id: "user" },
      request as any,
    );
    const subscription = events.subscribe();

    response.emit("close");
    response.emit("close");
    subscription.unsubscribe();

    expect(fileWatcherService.startWatching).toHaveBeenCalledWith(
      "session",
      "D:\\workspace",
      "client",
      expect.any(Function),
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseWatching).toHaveBeenCalledTimes(1);
  });
});
