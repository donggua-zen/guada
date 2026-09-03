/**
 * WorkspaceWatcherService 单测（@parcel/watcher 重构后适配版）
 *
 * 覆盖新 API 语义：
 * - watcher 由连接级 scope（setWatchScope 'file'/'git'）驱动激活，startWatching 不自动订阅
 * - 同工作目录多会话共享一份 watcher，事件按会话广播（各自 sessionId + 相对路径）
 * - create → stat 判定 add/addDir；update → change；delete → unlink
 * - 合并窗口内同路径只保留最新事件
 * - scope 关闭 → 立即退订；stopWatchingSession → force-close + TTL 惰性释放
 * - .git 订阅（setWatchScope 'git'）→ 防抖后推 type:'git'
 * - onModuleDestroy → 清理全部订阅与回调
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitActivity } from "../../src/common/services/git-activity";
import {
  WorkspaceWatcherService,
  FileChangeEvent,
} from "../../src/common/services/workspace-watcher.service";
import * as parcelWatcher from "@parcel/watcher";

/// <reference types="jest" />

jest.mock("@parcel/watcher", () => ({
  subscribe: jest.fn(),
}));

/** 一次 subscribe 调用的捕获（dir = 被监听目录，cb = 事件回调） */
interface SubscribeCapture {
  dir: string;
  cb: (error: Error | null, events?: parcelWatcher.Event[]) => void;
  unsubscribe: jest.Mock<Promise<void>>;
}

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

/** 等待 entry.ready（subscribe 的 Promise resolve 后置位） */
async function waitReady(service: WorkspaceWatcherService): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const entries = (service as any).watchers as Map<
      string,
      { ready: boolean }
    >;
    if (
      entries.size > 0 &&
      Array.from(entries.values()).every((e) => e.ready)
    ) {
      await sleep(5);
      return;
    }
    await sleep(5);
  }
  throw new Error("watcher did not become ready");
}

function setup(service: WorkspaceWatcherService): SubscribeCapture[] {
  const caps: SubscribeCapture[] = [];
  (parcelWatcher.subscribe as unknown as jest.Mock).mockImplementation(
    (dir: string, cb: (error: Error | null, events?: parcelWatcher.Event[]) => void) => {
      const unsubscribe = jest.fn(async () => undefined);
      caps.push({ dir, cb, unsubscribe });
      return Promise.resolve({ unsubscribe });
    },
  );
  return caps;
}

/** 找到监听某目录的订阅并模拟 parcel 回调（事件路径为绝对路径） */
function fireParcel(
  caps: SubscribeCapture[],
  dir: string,
  events: Array<{ type: string; path: string }>,
): SubscribeCapture {
  const cap = caps.find((c) => path.resolve(c.dir) === path.resolve(dir));
  if (!cap) throw new Error(`No watcher captured for dir ${dir}`);
  cap.cb(null, events as parcelWatcher.Event[]);
  return cap;
}

describe("WorkspaceWatcherService", () => {
  let service: WorkspaceWatcherService;
  let ws: string;
  let caps: SubscribeCapture[];

  beforeEach(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "ws-watch-unit-"));
    service = new WorkspaceWatcherService();
    caps = setup(service);
    gitActivity.lastReadAt = 0; // 抑制窗口复位，保证 .git 事件可推送
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    fs.rmSync(ws, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("相同工作目录被多个会话共享时只建立一份订阅，事件按会话广播", async () => {
    service.startWatching("session-a", ws, "client-a");
    service.startWatching("session-b", ws, "client-b");
    service.setWatchScope("session-a", "client-a", "file", true);
    service.setWatchScope("session-b", "client-b", "file", true);
    await waitReady(service);

    expect(caps).toHaveLength(1); // 共享一份 watcher
    expect(parcelWatcher.subscribe).toHaveBeenCalledTimes(1);

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    service.onFileChange("session-a", listenerA);
    service.onFileChange("session-b", listenerB);

    const abs = path.join(ws, "src", "index.ts");
    fireParcel(caps, ws, [{ type: "update", path: abs }]);
    await sleep(80); // COALESCE_MS(60) 窗口

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

  it("startWatching 不自动订阅：无 file scope 时 parcel subscribe 不被调用", async () => {
    service.startWatching("session", ws, "client");
    await sleep(20);
    expect(parcelWatcher.subscribe).not.toHaveBeenCalled();
  });

  it("create 事件经 stat 判定为 add（文件）/ addDir（目录）", async () => {
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    const fileAbs = path.join(ws, "file.ts");
    const dirAbs = path.join(ws, "subdir");
    fs.writeFileSync(fileAbs, "x");
    fs.mkdirSync(dirAbs);

    fireParcel(caps, ws, [
      { type: "create", path: fileAbs },
      { type: "create", path: dirAbs },
    ]);
    await sleep(80);

    const addCall = listener.mock.calls.find((c) => c[0].type === "add");
    const addDirCall = listener.mock.calls.find((c) => c[0].type === "addDir");
    expect(addCall?.[0]).toEqual(
      expect.objectContaining({ type: "add", path: "file.ts" }),
    );
    expect(addDirCall?.[0]).toEqual(
      expect.objectContaining({ type: "addDir", path: "subdir" }),
    );
  });

  it("delete 事件 → unlink 透传", async () => {
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireParcel(caps, ws, [{ type: "delete", path: path.join(ws, "old.ts") }]);
    await sleep(80);

    const delCall = listener.mock.calls.find((c) => c[0].type === "unlink");
    expect(delCall?.[0]).toEqual(
      expect.objectContaining({ type: "unlink", path: "old.ts" }),
    );
  });

  it("事件在合并窗口内被批量推送（同路径只保留最新）", async () => {
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);
    const listener = jest.fn();
    service.onFileChange("session", listener);

    const abs = path.join(ws, "a.ts");
    for (let i = 0; i < 5; i++) {
      fireParcel(caps, ws, [{ type: "update", path: abs }]);
    }
    await sleep(80);

    const changeCalls = listener.mock.calls.filter(
      (c) => c[0].type === "change",
    );
    expect(changeCalls.length).toBe(1);
    expect(changeCalls[0][0].path).toBe("a.ts");
  });

  it("file scope 关闭 → 立即退订根 watcher", async () => {
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);
    expect(caps).toHaveLength(1);

    service.setWatchScope("session", "client", "file", false);
    await sleep(20);

    expect(caps[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("stopWatchingSession 触发 force-close，watcher 置为 TTL 惰性释放（不退订）", async () => {
    const forceClose = jest.fn();
    service.startWatching("session", ws, "client", forceClose);
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);

    service.stopWatchingSession("session");
    expect(forceClose).toHaveBeenCalledTimes(1);

    const entries = (service as any).watchers as Map<
      string,
      { sessionIds: Set<string>; idleTimer: unknown }
    >;
    expect(entries.size).toBe(1);
    const entry = Array.from(entries.values())[0];
    expect(entry.sessionIds.size).toBe(0);
    expect(entry.idleTimer).not.toBeNull();
    // TTL 惰性释放：订阅仍保持（未立即退订），供会话重建复用
    expect(caps[0].unsubscribe).not.toHaveBeenCalled();
  });

  it("git scope → 订阅 .git 目录，变化防抖后推 type:'git'", async () => {
    // 构造 git 仓库形态（.git 为目录即可触发订阅；订阅本身被 mock）
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "git", true);
    // ready 仅由根(file)订阅置位，git-only 不置位 → 用短等待代替 waitReady
    await sleep(20);

    const gitDir = path.join(ws, ".git");
    const gitCap = caps.find(
      (c) => path.resolve(c.dir) === path.resolve(gitDir),
    );
    expect(gitCap).toBeTruthy();

    const listener = jest.fn();
    service.onFileChange("session", listener);

    // 模拟 .git 内连续写入（一次 commit 多次事件）→ 防抖合并为单次 git 通知
    gitCap!.cb(null);
    await sleep(30);
    gitCap!.cb(null);
    await sleep(400); // GIT_DEBOUNCE_MS(300) 窗口

    const gitCalls = listener.mock.calls.filter((c) => c[0].type === "git");
    expect(gitCalls.length).toBe(1);
    expect(gitCalls[0][0]).toEqual(
      expect.objectContaining({ type: "git", sessionId: "session" }),
    );
  });

  it("非 git 仓库：git scope 不订阅（resolveGitDir 为 null）", async () => {
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "git", true);
    await sleep(20);
    expect(parcelWatcher.subscribe).not.toHaveBeenCalled();
  });

  it("onModuleDestroy 退订全部 watcher 并触发 force-close 回调", async () => {
    const forceCloseA = jest.fn();
    const forceCloseB = jest.fn();
    const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "ws-watch-unit-b-"));
    fs.mkdirSync(path.join(ws, ".git"));
    fs.mkdirSync(path.join(wsB, ".git"));

    service.startWatching("session-a", ws, "client-a", forceCloseA);
    service.setWatchScope("session-a", "client-a", "file", true);
    service.setWatchScope("session-a", "client-a", "git", true);
    service.startWatching("session-b", wsB, "client-b", forceCloseB);
    service.setWatchScope("session-b", "client-b", "file", true);
    service.setWatchScope("session-b", "client-b", "git", true);
    await sleep(30); // 两个路径的 file+git 订阅各自 resolve

    // 每个 pathKey 一份 entry，各挂 root + .git 两个订阅
    expect((service as any).watchers.size).toBe(2);
    expect(caps).toHaveLength(4);

    await service.onModuleDestroy();

    for (const cap of caps) {
      expect(cap.unsubscribe).toHaveBeenCalled();
    }
    expect((service as any).watchers.size).toBe(0);
    expect(forceCloseA).toHaveBeenCalledTimes(1);
    expect(forceCloseB).toHaveBeenCalledTimes(1);

    fs.rmSync(wsB, { recursive: true, force: true });
  });

  it("getWorkspacePath 返回已注册会话的工作目录", async () => {
    service.startWatching("session", ws, "client");
    expect(service.getWorkspacePath("session")).toBe(ws);
    expect(service.getWorkspacePath("unknown")).toBeUndefined();
  });
});
