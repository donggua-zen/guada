import { describe, it, expect, vi } from "vitest";
import { WorkspaceWatcherService } from "./WorkspaceWatcherService";

/**
 * workspace 监听服务现在是全局 WS 之上的一层：
 * - setWatchScope → SessionEventsService.setWorkspaceWatch
 * - 收到 workspace 事件后按 currentSessionId 过滤
 * - 连接重连（onConnected）时重放期望 scopes
 */
function createSessionEvents() {
  const connected = new Set<() => void>();
  const workspace = new Set<(event: any) => void>();
  return {
    getClientId: () => "client-1",
    onConnected: (cb: () => void) => {
      connected.add(cb);
      return () => connected.delete(cb);
    },
    onWorkspaceEvent: (cb: (event: any) => void) => {
      workspace.add(cb);
      return () => workspace.delete(cb);
    },
    setWorkspaceWatch: vi.fn(),
    fireConnected: () => connected.forEach((cb) => cb()),
    fireWorkspace: (event: any) => workspace.forEach((cb) => cb(event)),
  };
}

describe("WorkspaceWatcherService（WS 委托）", () => {
  it("connect 记录当前会话；setWatchScope 下发 scope", async () => {
    const events = createSessionEvents();
    const service = new WorkspaceWatcherService(events as any);

    service.connect("s1", () => {});
    await service.setWatchScope("s1", "file", true);

    expect(service.getSessionId()).toBe("s1");
    expect(events.setWorkspaceWatch).toHaveBeenCalledWith("s1", ["file"], true);

    await service.setWatchScope("s1", "file", false);
    expect(events.setWorkspaceWatch).toHaveBeenLastCalledWith(
      "s1",
      ["file"],
      false,
    );
  });

  it("workspace 事件按当前会话过滤后通知监听器", () => {
    const events = createSessionEvents();
    const service = new WorkspaceWatcherService(events as any);
    const listener = vi.fn();
    service.onChange(listener);
    service.connect("s1", () => {});

    events.fireWorkspace({ sessionId: "s2", path: "other" });
    events.fireWorkspace({ sessionId: "s1", path: "a.ts" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.ts" }),
    );
  });

  it("重连（onConnected）时重放全部期望 scopes", async () => {
    const events = createSessionEvents();
    const service = new WorkspaceWatcherService(events as any);
    service.connect("s1", () => {});
    await service.setWatchScope("s1", "file", true);
    await service.setWatchScope("s1", "git", true);
    events.setWorkspaceWatch.mockClear();

    events.fireConnected();

    expect(events.setWorkspaceWatch).toHaveBeenCalledWith(
      "s1",
      expect.arrayContaining(["file", "git"]),
      true,
    );
  });

  it("切换会话清空旧订阅；disconnect 清空当前会话", async () => {
    const events = createSessionEvents();
    const service = new WorkspaceWatcherService(events as any);
    service.connect("s1", () => {});
    await service.setWatchScope("s1", "file", true);

    service.connect("s2", () => {});
    events.setWorkspaceWatch.mockClear();
    events.fireConnected(); // s1 的期望已被清空，不应重放
    expect(events.setWorkspaceWatch).not.toHaveBeenCalled();

    service.disconnect();
    expect(service.getSessionId()).toBeNull();
  });
});
