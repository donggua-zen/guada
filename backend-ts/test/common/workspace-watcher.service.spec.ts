/**
 * WorkspaceWatcherService 单测（@parcel/watcher 重构后适配版）
 *
 * 覆盖新 API 语义：
 * - watcher 由连接级 scope（setWatchScope 'file'/'git'）驱动激活，startWatching 不自动订阅
 * - 同工作目录多会话共享一份 watcher，事件按会话广播（各自 sessionId + 相对路径）
 * - create → stat 判定 add/addDir；update → change；delete → unlink
 * - 合并窗口内同路径只保留最新事件
 * - scope 关闭 → 立即退订；stopWatchingSession → force-close + TTL 惰性释放
 * - git 订阅（setWatchScope 'git'）→ 订阅 .git 目录 **与工作区根目录**（工作树文件的增删改
 *   不触碰 .git，只有根 watcher 看得到），两路来源共用防抖定时器后推 type:'git'
 *   （.git 300ms / 工作树 1000ms）
 * - 读命令抑制窗口只作用于 .git 来源，工作树来源一律放行
 * - onModuleDestroy → 清理全部订阅与回调
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gitActivity } from "../../src/common/services/git-activity";
import {
  WorkspaceWatcherService,
  FileChangeEvent,
  parseWatchIgnoreLines,
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
    // 既有用例断言「scope 关闭立即退订」；宽限行为由单独的用例覆盖
    service.setOptionsForTesting({ scopeUnsubscribeGraceMs: 0 });
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
    // git-only 现在也会订阅根 watcher（工作树变化同样要刷新 git 状态）→ ready 会置位
    await waitReady(service);

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

  it("git scope（无 file）也监听工作树：编辑文件不改 .git，仍推 type:'git'", async () => {
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "git", true);
    await waitReady(service);

    // 根 watcher（工作树）+ .git watcher 各一份订阅
    expect(caps).toHaveLength(2);
    expect(caps.some((c) => path.resolve(c.dir) === path.resolve(ws))).toBe(true);

    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireParcel(caps, ws, [
      { type: "update", path: path.join(ws, "src", "index.ts") },
    ]);
    await sleep(1200); // GIT_WORKTREE_DEBOUNCE_MS(1000) 窗口

    const gitCalls = listener.mock.calls.filter((c) => c[0].type === "git");
    expect(gitCalls).toHaveLength(1);
    expect(gitCalls[0][0]).toEqual(
      expect.objectContaining({ type: "git", sessionId: "session" }),
    );
  });

  it("仅 file scope（无 git）时工作树变化不推 type:'git'", async () => {
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);

    const listener = jest.fn();
    service.onFileChange("session", listener);

    fireParcel(caps, ws, [{ type: "update", path: path.join(ws, "a.ts") }]);
    await sleep(1200);

    expect(listener.mock.calls.filter((c) => c[0].type === "git")).toHaveLength(0);
    // 文件事件本身照常推送（file scope 语义未变）
    expect(
      listener.mock.calls.filter((c) => c[0].type === "change"),
    ).toHaveLength(1);
  });

  it("读命令抑制窗口只作用于 .git 来源：工作树变化仍推送，.git 变化被抑制", async () => {
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "git", true);
    await waitReady(service);

    const listener = jest.fn();
    service.onFileChange("session", listener);
    const gitCalls = () =>
      listener.mock.calls.filter((c) => c[0].type === "git");

    // 全程保持「本端刚跑过读命令」，让抑制窗口在两个断言时刻都有效
    const keepRecentRead = setInterval(() => {
      gitActivity.lastReadAt = Date.now();
    }, 20);
    try {
      // ① 工作树来源：由编辑动作直接产生，与读命令噪声无关 → 必须放行
      fireParcel(caps, ws, [{ type: "update", path: path.join(ws, "a.ts") }]);
      await sleep(1200);
      expect(gitCalls()).toHaveLength(1);

      // ② .git 来源：窗口内一律忽略，否则形成 读命令→事件→刷新→读命令 的死循环
      const gitCap = caps.find(
        (c) => path.resolve(c.dir) === path.resolve(path.join(ws, ".git")),
      );
      gitCap!.cb(null);
      await sleep(400);
      expect(gitCalls()).toHaveLength(1);
    } finally {
      clearInterval(keepRecentRead);
    }
  });

  it("防抖分档：.git 来源 300ms 推送，工作树来源 1s 才推送", async () => {
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "git", true);
    await waitReady(service);

    const listener = jest.fn();
    service.onFileChange("session", listener);
    const gitCalls = () =>
      listener.mock.calls.filter((c) => c[0].type === "git");

    const gitCap = caps.find(
      (c) => path.resolve(c.dir) === path.resolve(path.join(ws, ".git")),
    );
    gitCap!.cb(null);
    await sleep(400); // GIT_DEBOUNCE_MS(300) 窗口
    expect(gitCalls()).toHaveLength(1);

    // 工作树来源用更长窗口：400ms 时尚未推送（否则批量写文件会被拆成多轮 git status）
    fireParcel(caps, ws, [{ type: "update", path: path.join(ws, "a.ts") }]);
    await sleep(400);
    expect(gitCalls()).toHaveLength(1);

    await sleep(800);
    expect(gitCalls()).toHaveLength(2);
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

  it("file/git scope 隔离：文件事件只到 file 会话，git 事件只到 git 会话", async () => {
    fs.mkdirSync(path.join(ws, ".git"));
    service.startWatching("session-file", ws, "client-file");
    service.setWatchScope("session-file", "client-file", "file", true);
    service.startWatching("session-git", ws, "client-git");
    service.setWatchScope("session-git", "client-git", "git", true);
    await waitReady(service);

    const fileListener = jest.fn();
    const gitListener = jest.fn();
    service.onFileChange("session-file", fileListener);
    service.onFileChange("session-git", gitListener);

    // 先验证 git 事件：.git watcher 先触发时用 300ms 窗口
    const gitCap = caps.find(
      (c) => path.resolve(c.dir) === path.resolve(path.join(ws, ".git")),
    );
    gitCap!.cb(null);
    await sleep(400);

    expect(
      gitListener.mock.calls.filter((c) => c[0].type === "git"),
    ).toHaveLength(1);
    expect(
      fileListener.mock.calls.filter((c) => c[0].type === "git"),
    ).toHaveLength(0);

    // 再验证文件事件：只有 file scope 会话收到 change
    fireParcel(caps, ws, [{ type: "update", path: path.join(ws, "a.ts") }]);
    await sleep(80);

    expect(
      fileListener.mock.calls.filter((c) => c[0].type === "change"),
    ).toHaveLength(1);
    expect(
      gitListener.mock.calls.filter((c) => c[0].type === "change"),
    ).toHaveLength(0);
  });

  it("事件风暴：degraded 只发一条 overflow，不逐文件推送", async () => {
    const burstService = new WorkspaceWatcherService();
    burstService.setOptionsForTesting({
      scopeUnsubscribeGraceMs: 0,
      eventRateThreshold: 10,
    });
    const burstCaps = setup(burstService);
    burstService.startWatching("session", ws, "client");
    burstService.setWatchScope("session", "client", "file", true);
    await waitReady(burstService);

    const listener = jest.fn();
    burstService.onFileChange("session", listener);

    fireParcel(
      burstCaps,
      ws,
      Array.from({ length: 20 }, (_, i) => ({
        type: "update",
        path: path.join(ws, `f${i}.ts`),
      })),
    );
    await sleep(650); // DEGRADED_COALESCE_MS(500)

    expect(
      listener.mock.calls.filter((c) => c[0].type === "overflow"),
    ).toHaveLength(1);
    expect(
      listener.mock.calls.filter((c) => c[0].type === "change"),
    ).toHaveLength(0);

    await burstService.onModuleDestroy();
  });

  it("degraded 下 create 事件不逐条 enqueue，只发 overflow", async () => {
    const burstService = new WorkspaceWatcherService();
    burstService.setOptionsForTesting({
      scopeUnsubscribeGraceMs: 0,
      eventRateThreshold: 1,
    });
    const burstCaps = setup(burstService);
    burstService.startWatching("session", ws, "client");
    burstService.setWatchScope("session", "client", "file", true);
    await waitReady(burstService);

    const listener = jest.fn();
    burstService.onFileChange("session", listener);

    fs.writeFileSync(path.join(ws, "ghost-1"), "x");
    fs.writeFileSync(path.join(ws, "ghost-2"), "x");
    fireParcel(burstCaps, ws, [
      { type: "create", path: path.join(ws, "ghost-1") },
      { type: "create", path: path.join(ws, "ghost-2") },
    ]);
    await sleep(650);

    // 正常模式这里会是两条 add；degraded 直接熔断为一条 overflow
    expect(
      listener.mock.calls.filter(
        (c) => c[0].type === "add" || c[0].type === "addDir",
      ),
    ).toHaveLength(0);
    expect(
      listener.mock.calls.filter((c) => c[0].type === "overflow"),
    ).toHaveLength(1);

    await burstService.onModuleDestroy();
  });

  it("scope 解除有宽限：期间恢复不退订，超时后退订", async () => {
    const graceService = new WorkspaceWatcherService();
    graceService.setOptionsForTesting({ scopeUnsubscribeGraceMs: 60 });
    const graceCaps = setup(graceService);
    graceService.startWatching("session", ws, "client");
    graceService.setWatchScope("session", "client", "file", true);
    await waitReady(graceService);

    graceService.setWatchScope("session", "client", "file", false);
    await sleep(20);
    graceService.setWatchScope("session", "client", "file", true);
    await sleep(120);
    expect(graceCaps[0].unsubscribe).not.toHaveBeenCalled();

    graceService.setWatchScope("session", "client", "file", false);
    await sleep(120);
    expect(graceCaps[0].unsubscribe).toHaveBeenCalledTimes(1);

    await graceService.onModuleDestroy();
  });

  it(".guada/watch-ignore 解析并合并到 parcel ignore", async () => {
    fs.mkdirSync(path.join(ws, ".guada"));
    fs.writeFileSync(
      path.join(ws, ".guada", "watch-ignore"),
      ["# comment", "workbuddy-market/", "*.log", "src/generated.ts"].join("\n"),
    );

    service.startWatching("session", ws, "client");
    service.setWatchScope("session", "client", "file", true);
    await waitReady(service);

    const rootCall = (
      parcelWatcher.subscribe as unknown as jest.Mock
    ).mock.calls.find((call) => path.resolve(call[0]) === path.resolve(ws));
    const ignore = rootCall?.[2]?.ignore as string[];
    expect(ignore).toEqual(
      expect.arrayContaining([
        "**/workbuddy-market/**",
        "**/*.log",
        "**/src/generated.ts",
      ]),
    );
  });
});

describe("parseWatchIgnoreLines", () => {
  it("解析常见 gitignore 子集", () => {
    expect(
      parseWatchIgnoreLines(
        ["# comment", "foo/", "*.log", "src/generated.ts", "node_modules"].join(
          "\n",
        ),
      ),
    ).toEqual([
      "**/foo/**",
      "**/*.log",
      "**/src/generated.ts",
      "**/node_modules/**",
    ]);
  });
});
