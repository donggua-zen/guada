import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FileChangeEvent,
  WorkspaceWatcherService,
} from "../../src/common/services/workspace-watcher.service";

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

async function waitFor(
  predicate: () => boolean,
  timeout = 10000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(50);
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
    service.onFileChange("session", (event) => events.push(event));
    // 等待 parcel 订阅初始化
    await sleep(1000);

    const subFile = path.join(childPath, "first.txt");
    fs.writeFileSync(subFile, "first");

    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "first.txt"),
      ),
    );
  }, 15000);

  it("文件内容修改触发 change 事件", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.onFileChange("session", (event) => events.push(event));
    await sleep(1000);

    const target = path.join(childPath, "data.txt");
    fs.writeFileSync(target, "v1");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" && event.path === path.join("src", "data.txt"),
      ),
    );

    events.length = 0;
    fs.appendFileSync(target, "-changed");
    await waitFor(() =>
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
    service.onFileChange("session", (event) => events.push(event));
    await sleep(1000);

    fs.rmSync(childPath, { recursive: true, force: true });
    await waitFor(() =>
      events.some((event) => event.type === "unlink" && event.path === "src"),
    );

    fs.mkdirSync(childPath);
    await waitFor(() =>
      events.some((event) => event.type === "addDir" && event.path === "src"),
    );

    events.length = 0;
    fs.writeFileSync(path.join(childPath, "restored.txt"), "restored");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "restored.txt"),
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
    const unsubscribeParent = service.onFileChange("parent-session", (event) =>
      parentEvents.push(event),
    );
    service.onFileChange("child-session", (event) => childEvents.push(event));
    await sleep(1000);

    unsubscribeParent();
    releaseParent();
    await sleep(300);

    fs.writeFileSync(path.join(childPath, "remaining.txt"), "remaining");
    await waitFor(() =>
      childEvents.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "remaining.txt"),
      ),
    );
    expect(parentEvents).toHaveLength(0);
  }, 15000);
});