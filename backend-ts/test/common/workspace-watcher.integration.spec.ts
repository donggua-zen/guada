import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FileChangeEvent,
  WorkspaceWatcherService,
} from "../../src/common/services/workspace-watcher.service";

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

/** 等待根 watcher 订阅就绪（parcel subscribe 原生 Promise resolve 后 entry.ready 置位） */
async function waitReady(service: WorkspaceWatcherService): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const entries = (service as any).watchers as Map<
      string,
      { ready: boolean }
    >;
    if (
      entries.size > 0 &&
      Array.from(entries.values()).every((e) => e.ready)
    ) {
      return;
    }
    await sleep(50);
  }
  throw new Error("Timed out waiting for parcel watcher to become ready");
}

/**
 * 反复执行 mutate 直到 predicate 命中。
 * 真实文件系统 watcher 事件非确定性（订阅武装窗口 / 负载下偶发丢失）：单次 fs 操作的事件
 * 可能被丢，周期性重复操作保证「事件最终可达」——前提是 watcher 订阅仍存活，因此该方法
 * 同时隐式验证订阅未被意外释放。
 */
async function waitForEvent(
  mutate: () => void,
  predicate: () => boolean,
  timeout = 10000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    mutate();
    await sleep(250);
  }
  throw new Error("Timed out waiting for file watcher event");
}

describe("WorkspaceWatcherService 真实文件系统集成", () => {
  let service: WorkspaceWatcherService;
  let workspacePath: string;
  let childPath: string;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "ws-watch-"));
    childPath = path.join(workspacePath, "src");
    fs.mkdirSync(childPath);
    service = new WorkspaceWatcherService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it("递归监听根目录并捕获子目录新增文件", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.setWatchScope("session", "client", "file", true);
    service.onFileChange("session", (event) => events.push(event));
    // 等待 parcel 订阅初始化（watcher 由连接级 scope 驱动激活）
    await waitReady(service);

    const subFile = path.join(childPath, "first.txt");
    fs.writeFileSync(subFile, "first");
    // create 若在武装窗口丢失，append 产生的 change 事件同样证明捕获
    await waitForEvent(
      () => fs.appendFileSync(subFile, "x"),
      () =>
        events.some(
          (event) =>
            event.path === path.join("src", "first.txt") &&
            (event.type === "add" || event.type === "change"),
        ),
    );
  }, 15000);

  it("文件内容修改触发 change 事件", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.setWatchScope("session", "client", "file", true);
    service.onFileChange("session", (event) => events.push(event));
    await waitReady(service);

    const target = path.join(childPath, "data.txt");
    fs.writeFileSync(target, "v1");
    await waitForEvent(
      () => fs.appendFileSync(target, "x"),
      () =>
        events.some(
          (event) =>
            event.path === path.join("src", "data.txt") &&
            (event.type === "add" || event.type === "change"),
        ),
    );

    events.length = 0;
    await waitForEvent(
      () => fs.appendFileSync(target, "x"),
      () =>
        events.some(
          (event) =>
            event.type === "change" &&
            event.path === path.join("src", "data.txt"),
        ),
    );
  }, 15000);

  it("目录删除重建后递归监听自动恢复", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.setWatchScope("session", "client", "file", true);
    service.onFileChange("session", (event) => events.push(event));
    await waitReady(service);

    // 阶段 1：删除 src → unlink（每次迭代重建再删，事件丢失时下一轮必再触发）
    await waitForEvent(
      () => {
        if (!fs.existsSync(childPath)) fs.mkdirSync(childPath);
        fs.rmSync(childPath, { recursive: true, force: true });
      },
      () =>
        events.some(
          (event) => event.type === "unlink" && event.path === "src",
        ),
    );
    if (fs.existsSync(childPath)) {
      fs.rmSync(childPath, { recursive: true, force: true });
    }

    // 阶段 2：重建 src → addDir（确保目录不存在再建，事件丢失时下一轮先删后建再触发）
    await waitForEvent(
      () => {
        if (fs.existsSync(childPath)) {
          fs.rmSync(childPath, { recursive: true, force: true });
        }
        fs.mkdirSync(childPath);
      },
      () =>
        events.some(
          (event) => event.type === "addDir" && event.path === "src",
        ),
    );

    // 阶段 3：恢复后子目录新文件仍被捕获
    events.length = 0;
    const restored = path.join(childPath, "restored.txt");
    fs.writeFileSync(restored, "restored");
    await waitForEvent(
      () => fs.appendFileSync(restored, "x"),
      () =>
        events.some(
          (event) =>
            event.path === path.join("src", "restored.txt") &&
            (event.type === "add" || event.type === "change"),
        ),
    );
  }, 15000);

  it("父会话退出后子会话共享同一目录仍继续监听", async () => {
    const parentEvents: FileChangeEvent[] = [];
    const childEvents: FileChangeEvent[] = [];
    const releaseParent = service.startWatching(
      "parent-session",
      workspacePath,
      "parent-client",
    );
    service.startWatching("child-session", workspacePath, "child-client");
    service.setWatchScope("parent-session", "parent-client", "file", true);
    service.setWatchScope("child-session", "child-client", "file", true);
    const unsubscribeParent = service.onFileChange("parent-session", (event) =>
      parentEvents.push(event),
    );
    service.onFileChange("child-session", (event) => childEvents.push(event));
    await waitReady(service);

    unsubscribeParent();
    releaseParent();
    await sleep(300);

    const target = path.join(childPath, "remaining.txt");
    fs.writeFileSync(target, "remaining");
    // 共享 watcher 未被父会话释放波及：重复操作直到子会话事件可达
    await waitForEvent(
      () => fs.appendFileSync(target, "x"),
      () =>
        childEvents.some(
          (event) =>
            event.path === path.join("src", "remaining.txt") &&
            (event.type === "add" || event.type === "change"),
        ),
    );
    expect(parentEvents).toHaveLength(0);
  }, 15000);
});
