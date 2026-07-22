import * as path from "path";
import * as chokidar from "chokidar";
import { FileWatcherService } from "../../src/common/services/file-watcher.service";

jest.mock("chokidar", () => ({
  watch: jest.fn(),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
}));

type WatchEventHandler = (event: string, filePath: string) => void;

class MockWatcher {
  readonly handlers = new Map<string, (...args: any[]) => void>();
  readonly _closers = new Map<string, unknown>();
  readonly _watched = new Map<string, { dispose: jest.Mock }>();
  readonly _symlinkPaths = new Map<string, unknown>();
  readonly _removeIgnoredPath = jest.fn();
  readonly watchedDirAdd = jest.fn();
  readonly _getWatchedDir = jest.fn().mockReturnValue({
    add: this.watchedDirAdd,
    dispose: jest.fn(),
  });
  readonly add = jest.fn((paths: string | string[]) => {
    const targetPaths = Array.isArray(paths) ? paths : [paths];
    targetPaths.forEach((targetPath) => {
      this._closers.set(targetPath, []);
    });
    return this;
  });
  readonly unwatch = jest.fn((paths: string | string[]) => {
    const targetPaths = Array.isArray(paths) ? paths : [paths];
    targetPaths.forEach((targetPath) => {
      this._closers.delete(targetPath);
    });
    return this;
  });
  readonly close = jest.fn().mockResolvedValue(undefined);

  on(event: string, handler: (...args: any[]) => void): this {
    this.handlers.set(event, handler);
    return this;
  }

  emitAll(event: string, filePath: string): void {
    (this.handlers.get("all") as WatchEventHandler | undefined)?.(
      event,
      filePath,
    );
  }
}

function flattenPathCalls(mock: jest.Mock): string[] {
  return mock.mock.calls.flatMap(([paths]) =>
    Array.isArray(paths) ? paths : [paths],
  );
}

async function settleWatcher(service: FileWatcherService): Promise<void> {
  await (service as any).waitForSynchronization();
}

describe("FileWatcherService", () => {
  let watcher: MockWatcher;
  let service: FileWatcherService;
  const watchMock = chokidar.watch as jest.MockedFunction<typeof chokidar.watch>;

  beforeEach(() => {
    watcher = new MockWatcher();
    watchMock.mockReset();
    watchMock.mockReturnValue(watcher as unknown as chokidar.FSWatcher);
    service = new FileWatcherService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("所有会话共享一个 chokidar 实例和相同物理目录", async () => {
    const workspacePath = path.resolve("workspace", "shared");

    service.startWatching("session-a", workspacePath, "client-a");
    service.startWatching("session-b", workspacePath, "client-b");
    await settleWatcher(service);

    expect(watchMock).toHaveBeenCalledTimes(1);
    expect(watchMock).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        depth: 0,
        ignoreInitial: true,
        followSymlinks: false,
      }),
    );
    expect(flattenPathCalls(watcher.add)).toEqual([workspacePath]);
  });

  it("聚合同一会话多个客户端的展开目录", async () => {
    const workspacePath = path.resolve("workspace", "multi-client");
    service.startWatching("session", workspacePath, "client-a");
    service.startWatching("session", workspacePath, "client-b");
    await settleWatcher(service);
    watcher.add.mockClear();

    service.updateExpandedPaths("session", "client-a", ["src"]);
    service.updateExpandedPaths("session", "client-b", ["docs"]);
    await settleWatcher(service);

    expect(flattenPathCalls(watcher.add)).toEqual([
      path.join(workspacePath, "src"),
      path.join(workspacePath, "docs"),
    ]);
  });

  it("同一客户端的连接独立释放且释放函数幂等", async () => {
    const workspacePath = path.resolve("workspace", "reconnect");
    const releaseFirst = service.startWatching(
      "session",
      workspacePath,
      "client",
    );
    const releaseSecond = service.startWatching(
      "session",
      workspacePath,
      "client",
    );
    await settleWatcher(service);
    watcher.unwatch.mockClear();

    releaseFirst();
    releaseFirst();
    await settleWatcher(service);
    expect(service.getWorkspacePath("session")).toBe(workspacePath);
    expect(watcher.unwatch).not.toHaveBeenCalled();

    releaseSecond();
    await settleWatcher(service);
    expect(service.getWorkspacePath("session")).toBeUndefined();
    expect(flattenPathCalls(watcher.unwatch)).toEqual([workspacePath]);
  });

  it("共享目录在最后一个会话释放前不会 unwatch", async () => {
    const workspacePath = path.resolve("workspace", "shared-release");
    const releaseA = service.startWatching(
      "session-a",
      workspacePath,
      "client-a",
    );
    const releaseB = service.startWatching(
      "session-b",
      workspacePath,
      "client-b",
    );
    await settleWatcher(service);
    watcher.unwatch.mockClear();

    releaseA();
    await settleWatcher(service);
    expect(watcher.unwatch).not.toHaveBeenCalled();

    releaseB();
    await settleWatcher(service);
    expect(flattenPathCalls(watcher.unwatch)).toEqual([workspacePath]);
  });

  it("折叠目录时移除物理监听并停止逻辑路由", async () => {
    const workspacePath = path.resolve("workspace", "collapse");
    const childPath = path.join(workspacePath, "src");
    service.startWatching("session", workspacePath, "client");
    service.updateExpandedPaths("session", "client", ["src"]);
    await settleWatcher(service);
    watcher.unwatch.mockClear();

    service.updateExpandedPaths("session", "client", []);
    await settleWatcher(service);

    expect(flattenPathCalls(watcher.unwatch)).toEqual([childPath]);
    expect(watcher._removeIgnoredPath).toHaveBeenCalledWith(
      childPath.replace(/\\/g, "/"),
    );
    expect(watcher.watchedDirAdd).toHaveBeenCalledWith("src");

    const listener = jest.fn();
    service.onFileChange("session", listener);
    watcher.emitAll("change", path.join(childPath, "index.ts"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("按事件直接父目录精确路由到感兴趣的会话", () => {
    const workspacePath = path.resolve("workspace", "routing");
    const srcFile = path.join(workspacePath, "src", "index.ts");
    service.startWatching("session-a", workspacePath, "client-a");
    service.startWatching("session-b", workspacePath, "client-b");
    service.updateExpandedPaths("session-a", "client-a", ["src"]);

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    service.onFileChange("session-a", listenerA);
    service.onFileChange("session-b", listenerB);

    watcher.emitAll("change", srcFile);

    expect(listenerA).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "change",
        path: path.join("src", "index.ts"),
        sessionId: "session-a",
      }),
    );
    expect(listenerB).not.toHaveBeenCalled();
  });

  it("为共享工作目录中的每个感兴趣会话各发送一次事件", () => {
    const workspacePath = path.resolve("workspace", "shared-routing");
    const filePath = path.join(workspacePath, "src", "index.ts");
    service.startWatching("session-a", workspacePath, "client-a");
    service.startWatching("session-b", workspacePath, "client-b");
    service.updateExpandedPaths("session-a", "client-a", ["src"]);
    service.updateExpandedPaths("session-b", "client-b", ["src"]);

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    service.onFileChange("session-a", listenerA);
    service.onFileChange("session-b", listenerB);

    watcher.emitAll("add", filePath);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("拒绝绝对路径和越过工作目录的展开路径", async () => {
    const workspacePath = path.resolve("workspace", "safe-paths");
    service.startWatching("session", workspacePath, "client");
    await settleWatcher(service);
    watcher.add.mockClear();

    service.updateExpandedPaths("session", "client", [
      path.resolve("outside"),
      `..${path.sep}outside`,
      "src",
    ]);
    await settleWatcher(service);

    expect(flattenPathCalls(watcher.add)).toEqual([
      path.join(workspacePath, "src"),
    ]);
  });

  it("SSE 建连前上报的展开状态会在连接时生效", async () => {
    const workspacePath = path.resolve("workspace", "pending-paths");

    service.updateExpandedPaths("session", "client", ["src"], 1);
    service.startWatching("session", workspacePath, "client");
    await settleWatcher(service);

    expect(flattenPathCalls(watcher.add)).toEqual([
      workspacePath,
      path.join(workspacePath, "src"),
    ]);
  });

  it("丢弃迟到的旧版本展开状态", () => {
    const workspacePath = path.resolve("workspace", "versioned-paths");
    service.startWatching("session", workspacePath, "client");

    service.updateExpandedPaths("session", "client", ["src"], 2);
    service.updateExpandedPaths("session", "client", ["docs"], 1);

    const listener = jest.fn();
    service.onFileChange("session", listener);
    watcher.emitAll("change", path.join(workspacePath, "src", "index.ts"));
    watcher.emitAll("change", path.join(workspacePath, "docs", "index.ts"));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ path: path.join("src", "index.ts") }),
    );
  });

  it("显式重绑后旧 SSE 快照不会覆盖新工作目录", async () => {
    const oldWorkspacePath = path.resolve("workspace", "old-snapshot");
    const newWorkspacePath = path.resolve("workspace", "new-current");

    service.rebindWorkspace("session", newWorkspacePath);
    service.startWatching("session", oldWorkspacePath, "client");
    await settleWatcher(service);

    expect(service.getWorkspacePath("session")).toBe(newWorkspacePath);
    expect(flattenPathCalls(watcher.add)).toEqual([newWorkspacePath]);
  });

  it("工作目录变更后切换根目录并清空旧展开目录", async () => {
    const oldWorkspacePath = path.resolve("workspace", "old");
    const newWorkspacePath = path.resolve("workspace", "new");
    service.startWatching("session", oldWorkspacePath, "client");
    service.updateExpandedPaths("session", "client", ["src"]);
    await settleWatcher(service);
    watcher.add.mockClear();

    service.rebindWorkspace("session", newWorkspacePath);
    await settleWatcher(service);

    expect(service.getWorkspacePath("session")).toBe(newWorkspacePath);
    expect(flattenPathCalls(watcher.add)).toEqual([newWorkspacePath]);
  });

  it("工作目录重绑时主动关闭现有连接以触发客户端重连", () => {
    const forceCloseA = jest.fn();
    const forceCloseB = jest.fn();
    service.startWatching(
      "session",
      path.resolve("workspace", "old-shared"),
      "client-a",
      forceCloseA,
    );
    service.startWatching(
      "session",
      path.resolve("workspace", "old-shared"),
      "client-b",
      forceCloseB,
    );

    service.rebindWorkspace("session", path.resolve("workspace", "new-shared"));

    expect(forceCloseA).toHaveBeenCalledTimes(1);
    expect(forceCloseB).toHaveBeenCalledTimes(1);
  });

  it("强制停止会话时主动关闭连接", () => {
    const forceClose = jest.fn();
    service.startWatching(
      "session",
      path.resolve("workspace", "force-close"),
      "client",
      forceClose,
    );

    service.stopWatchingSession("session");

    expect(forceClose).toHaveBeenCalledTimes(1);
    expect(service.getWorkspacePath("session")).toBeUndefined();
  });

  it("模块销毁时只关闭全局 watcher 一次", async () => {
    await service.onModuleDestroy();
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });
});
