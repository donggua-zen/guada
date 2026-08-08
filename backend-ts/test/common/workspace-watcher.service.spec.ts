import * as path from "path";
import { WorkspaceWatcherService } from "../../src/common/services/workspace-watcher.service";
import type { FileChangeEvent as ProviderFileChangeEvent, WorkspaceProvider } from "../../src/common/workspace/workspace-provider.interface";

interface MockProvider extends WorkspaceProvider {
  watch: jest.Mock<() => void, [string[], unknown, (e: ProviderFileChangeEvent) => void]>;
}

function createMockProvider(): MockProvider {
  const watchCallbacks: ((e: ProviderFileChangeEvent) => void)[] = [];
  const cleanupFn = jest.fn();

  const provider: MockProvider = {
    scheme: "file",
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
    watch: jest.fn((_paths, _opts, cb) => {
      watchCallbacks.push(cb);
      return cleanupFn;
    }),
    readFile: jest.fn(),
    readFileRange: jest.fn(),
    writeFile: jest.fn(),
    replaceInFile: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    mkdir: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
    glob: jest.fn(),
    grep: jest.fn(),
    execute: jest.fn(),
    poll: jest.fn(),
    kill: jest.fn(),
    writeToStdin: jest.fn(),
    listBySession: jest.fn(),
    drainCompleted: jest.fn(),
  } as unknown as MockProvider;

  return {
    ...provider,
    // expose callbacks for test access
    __callbacks: watchCallbacks,
    __cleanup: cleanupFn,
  } as unknown as MockProvider & {
    __callbacks: ((e: ProviderFileChangeEvent) => void)[];
    __cleanup: jest.Mock;
  };
}

function fireProviderEvent(
  provider: MockProvider,
  event: ProviderFileChangeEvent,
): void {
  const cb = (provider as any).__callbacks as ((e: ProviderFileChangeEvent) => void)[];
  cb.forEach((fn) => fn(event));
}

async function tick(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function awaitReady(service: WorkspaceWatcherService): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const entries = (service as any).watchers as Map<string, { ready: boolean }>;
    if (entries.size > 0 && Array.from(entries.values()).every((e) => e.ready)) {
      await tick(2);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("watcher did not become ready");
}

describe("WorkspaceWatcherService", () => {
  let service: WorkspaceWatcherService;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    mockProvider = createMockProvider();
    const mockResolver = {
      resolve: jest.fn().mockResolvedValue(mockProvider),
    } as any;
    service = new WorkspaceWatcherService(mockResolver);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("相同工作目录被多个会话共享时只建立一份订阅", async () => {
    const ws = path.resolve("/workspace/proj");
    service.startWatching("session-a", ws, "client-a");
    service.startWatching("session-b", ws, "client-b");
    await awaitReady(service);

    expect(mockProvider.watch).toHaveBeenCalledTimes(1);
    expect(mockProvider.watch).toHaveBeenCalledWith(
      [ws],
      expect.objectContaining({ recursive: true }),
      expect.any(Function),
    );

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    service.onFileChange("session-a", listenerA);
    service.onFileChange("session-b", listenerB);

    fireProviderEvent(mockProvider, {
      type: "change",
      path: "src/index.ts",
    });
    await tick();

    expect(listenerA.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "change",
        path: path.join("src", "index.ts"),
        sessionId: "session-a",
      }),
    );
    expect(listenerB.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "change",
        path: path.join("src", "index.ts"),
        sessionId: "session-b",
      }),
    );
  });

  it("add 和 addDir 事件直接透传（provider 已做 stat 判断）", async () => {
    const ws = path.resolve("/workspace/proj");
    service.startWatching("session", ws, "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireProviderEvent(mockProvider, { type: "add", path: "file.ts" });
    await tick(10);

    fireProviderEvent(mockProvider, { type: "addDir", path: "subdir" });
    await tick(10);

    const addCall = listener.mock.calls.find((c) => c[0].type === "add");
    const addDirCall = listener.mock.calls.find((c) => c[0].type === "addDir");
    expect(addCall?.[0]).toEqual(
      expect.objectContaining({ type: "add", path: "file.ts" }),
    );
    expect(addDirCall?.[0]).toEqual(
      expect.objectContaining({ type: "addDir", path: "subdir" }),
    );
  });

  it("unlink 事件直接透传", async () => {
    const ws = path.resolve("/workspace/proj");
    service.startWatching("session", ws, "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireProviderEvent(mockProvider, { type: "unlink", path: "old.ts" });
    await tick(10);

    const delCall = listener.mock.calls.find((c) => c[0].type === "unlink");
    expect(delCall?.[0]).toEqual(
      expect.objectContaining({ type: "unlink", path: "old.ts" }),
    );
  });

  it("事件在合并窗口内被批量推送（同路径只保留最新）", async () => {
    const ws = path.resolve("/workspace/proj");
    service.startWatching("session", ws, "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    for (let i = 0; i < 5; i++) {
      fireProviderEvent(mockProvider, { type: "change", path: "a.ts" });
    }
    await tick();

    const changeCalls = listener.mock.calls.filter((c) => c[0].type === "change");
    expect(changeCalls.length).toBe(1);
    expect(changeCalls[0][0].path).toBe("a.ts");
  });

  it("stopWatchingSession 触发 force-close 并置为待释放（TTL）", async () => {
    const ws = path.resolve("/workspace/proj");
    const forceClose = jest.fn();
    service.startWatching("session", ws, "client", forceClose);
    await awaitReady(service);

    service.stopWatchingSession("session");
    expect(forceClose).toHaveBeenCalledTimes(1);

    await tick(5);
    expect((mockProvider as any).__cleanup).not.toHaveBeenCalled();
    const entries = (service as any).watchers as Map<
      string,
      { sessionIds: Set<string>; idleTimer: unknown }
    >;
    const entry = Array.from(entries.values())[0];
    expect(entry.sessionIds.size).toBe(0);
    expect(entry.idleTimer).not.toBeNull();
  });

  it("onModuleDestroy 立即取消所有订阅", async () => {
    const ws = path.resolve("/workspace/proj");
    service.startWatching("session", ws, "client");
    await awaitReady(service);
    await service.onModuleDestroy();
    expect((mockProvider as any).__cleanup).toHaveBeenCalled();
  });
});
