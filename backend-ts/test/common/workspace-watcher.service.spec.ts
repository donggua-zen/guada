import * as path from "path";
import * as fs from "fs";
import * as parcelWatcher from "@parcel/watcher";
import { WorkspaceWatcherService } from "../../src/common/services/workspace-watcher.service";

jest.mock("@parcel/watcher", () => ({
  subscribe: jest.fn(),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  statSync: jest.fn(),
}));

const subscribeMock = parcelWatcher.subscribe as jest.MockedFunction<
  typeof parcelWatcher.subscribe
>;
const statSyncMock = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

interface MockSubscription {
  unsubscribe: jest.Mock;
}

type SubscribeHandler = NonNullable<Parameters<typeof parcelWatcher.subscribe>[1]>;

function captureCallback(): {
  handlers: SubscribeHandler[];
  subscription: MockSubscription;
} {
  const handlers: SubscribeHandler[] = [];
  const subscription: MockSubscription = {
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  };
  subscribeMock.mockImplementation((_dir, fn) => {
    handlers.push(fn);
    return Promise.resolve(
      subscription as unknown as parcelWatcher.AsyncSubscription,
    );
  });
  return { handlers, subscription };
}

function fireParcelEvents(
  handler: SubscribeHandler,
  events: parcelWatcher.Event[],
): void {
  handler(null, events);
}

async function tick(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** 等待所有 watcher 就绪（订阅 Promise 已 resolve） */
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

  function mockStatWasDir(isDir: boolean): void {
    statSyncMock.mockReturnValue({
      isDirectory: () => isDir,
    } as fs.Stats);
  }

  beforeEach(() => {
    subscribeMock.mockReset();
    statSyncMock.mockReset();
    statSyncMock.mockReturnValue({ isDirectory: () => false } as fs.Stats);
    service = new WorkspaceWatcherService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("相同工作目录被多个会话共享时只建立一份订阅", async () => {
    const { handlers } = captureCallback();
    service.startWatching("session-a", path.resolve("/workspace/proj"), "client-a");
    service.startWatching("session-b", path.resolve("/workspace/proj"), "client-b");
    await awaitReady(service);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      path.resolve("/workspace/proj"),
      expect.any(Function),
      expect.objectContaining({ ignore: expect.any(Array) }),
    );

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    service.onFileChange("session-a", listenerA);
    service.onFileChange("session-b", listenerB);

    fireParcelEvents(handlers[0], [
      { type: "update", path: path.resolve("/workspace/proj/src/index.ts") },
    ]);
    await tick();

    const changeA = listenerA.mock.calls[0];
    const changeB = listenerB.mock.calls[0];
    expect(changeA?.[0]).toEqual(
      expect.objectContaining({ type: "change", path: path.join("src", "index.ts"), sessionId: "session-a" }),
    );
    expect(changeB?.[0]).toEqual(
      expect.objectContaining({ type: "change", path: path.join("src", "index.ts"), sessionId: "session-b" }),
    );
  });

  it("create 事件通过 stat 判断 add（文件）与 addDir（目录）", async () => {
    const { handlers } = captureCallback();
    service.startWatching("session", path.resolve("/workspace/proj"), "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireParcelEvents(handlers[0], [
      { type: "create", path: path.resolve("/workspace/proj/file.ts") },
    ]);
    await tick();

    mockStatWasDir(true);
    fireParcelEvents(handlers[0], [
      { type: "create", path: path.resolve("/workspace/proj/subdir") },
    ]);
    await tick();

    const addCall = listener.mock.calls.find((c) => c[0].type === "add");
    const addDirCall = listener.mock.calls.find((c) => c[0].type === "addDir");
    expect(addCall?.[0]).toEqual(
      expect.objectContaining({ type: "add", path: "file.ts" }),
    );
    expect(addDirCall?.[0]).toEqual(
      expect.objectContaining({ type: "addDir", path: "subdir" }),
    );
  });

  it("delete 事件映射为 unlink", async () => {
    const { handlers } = captureCallback();
    service.startWatching("session", path.resolve("/workspace/proj"), "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireParcelEvents(handlers[0], [
      { type: "delete", path: path.resolve("/workspace/proj/old.ts") },
    ]);
    await tick();
    const delCall = listener.mock.calls.find((c) => c[0].type === "unlink");
    expect(delCall?.[0]).toEqual(
      expect.objectContaining({ type: "unlink", path: "old.ts" }),
    );
  });

  it("事件在合并窗口内被批量推送（同路径只保留最新）", async () => {
    const { handlers } = captureCallback();
    service.startWatching("session", path.resolve("/workspace/proj"), "client");
    await awaitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    for (let i = 0; i < 5; i++) {
      fireParcelEvents(handlers[0], [
        { type: "update", path: path.resolve("/workspace/proj/a.ts") },
      ]);
    }
    await tick();

    const changeCalls = listener.mock.calls.filter((c) => c[0].type === "change");
    expect(changeCalls.length).toBe(1);
    expect(changeCalls[0][0].path).toBe("a.ts");
  });

  it("stopWatchingSession 触发 force-close 并置为待释放（TTL）", async () => {
    const { subscription } = captureCallback();
    const forceClose = jest.fn();
    service.startWatching("session", path.resolve("/workspace/proj"), "client", forceClose);
    await awaitReady(service);

    service.stopWatchingSession("session");
    expect(forceClose).toHaveBeenCalledTimes(1);

    // 处于惰性释放待定状态：watcher 仍存在但无会话引用，计时器未触发前不 dispose
    await tick(5);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    const entries = (service as any).watchers as Map<
      string,
      { sessionIds: Set<string>; idleTimer: unknown }
    >;
    const entry = Array.from(entries.values())[0];
    expect(entry.sessionIds.size).toBe(0);
    expect(entry.idleTimer).not.toBeNull();
  });

  it("onModuleDestroy 立即取消所有订阅", async () => {
    const { subscription } = captureCallback();
    service.startWatching("session", path.resolve("/workspace/proj"), "client");
    await awaitReady(service);
    await service.onModuleDestroy();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});