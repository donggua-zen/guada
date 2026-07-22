import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  FileChangeEvent,
  FileWatcherService,
} from "../../src/common/services/file-watcher.service";

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

async function waitFor(
  predicate: () => boolean,
  timeout = 5000,
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

describe("FileWatcherService 真实文件系统集成", () => {
  let service: FileWatcherService;
  let workspacePath: string;
  let childPath: string;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-watch-"));
    childPath = path.join(workspacePath, "src");
    fs.mkdirSync(childPath);
    service = new FileWatcherService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it("折叠后释放子目录监听且不影响根目录和后续重新展开", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.updateExpandedPaths("session", "client", ["src"]);
    service.onFileChange("session", (event) => events.push(event));
    await sleep(800);

    const firstFile = path.join(childPath, "first.txt");
    fs.writeFileSync(firstFile, "first");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "first.txt"),
      ),
    );

    events.length = 0;
    service.updateExpandedPaths("session", "client", []);
    await sleep(300);

    fs.writeFileSync(path.join(childPath, "collapsed.txt"), "collapsed");
    await sleep(600);
    expect(
      events.some((event) => event.path === path.join("src", "collapsed.txt")),
    ).toBe(false);

    events.length = 0;
    service.updateExpandedPaths("session", "client", ["src"]);
    await (service as any).waitForSynchronization();
    fs.appendFileSync(firstFile, "-changed");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "change" &&
          event.path === path.join("src", "first.txt"),
      ),
    );

    events.length = 0;
    service.updateExpandedPaths("session", "client", []);
    await (service as any).waitForSynchronization();
    fs.rmSync(childPath, { recursive: true, force: true });
    await waitFor(() =>
      events.some((event) => event.type === "unlinkDir" && event.path === "src"),
    );

    fs.mkdirSync(childPath);
    await waitFor(() =>
      events.some((event) => event.type === "addDir" && event.path === "src"),
    );

    events.length = 0;
    service.updateExpandedPaths("session", "client", ["src"]);
    await sleep(500);

    fs.writeFileSync(path.join(childPath, "reopened.txt"), "reopened");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "reopened.txt"),
      ),
    );
  }, 15000);

  it("已展开目录删除重建后自动恢复子项监听", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.updateExpandedPaths("session", "client", ["src"]);
    service.onFileChange("session", (event) => events.push(event));
    await (service as any).waitForSynchronization();

    fs.rmSync(childPath, { recursive: true, force: true });
    await waitFor(() =>
      events.some((event) => event.type === "unlinkDir" && event.path === "src"),
    );

    fs.mkdirSync(childPath);
    await waitFor(() =>
      events.some((event) => event.type === "addDir" && event.path === "src"),
    );
    await (service as any).waitForSynchronization();

    events.length = 0;
    fs.writeFileSync(path.join(childPath, "restored.txt"), "restored");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "add" &&
          event.path === path.join("src", "restored.txt"),
      ),
    );
  }, 10000);

  it("快速展开折叠后不会遗留子目录监听", async () => {
    const events: FileChangeEvent[] = [];
    service.startWatching("session", workspacePath, "client");
    service.onFileChange("session", (event) => events.push(event));

    for (let index = 0; index < 20; index++) {
      service.updateExpandedPaths("session", "client", ["src"]);
      service.updateExpandedPaths("session", "client", []);
    }
    await (service as any).waitForSynchronization();

    const physicalTargets = (service as any).physicalTargets as Map<
      string,
      string
    >;
    expect(Array.from(physicalTargets.values())).toEqual([workspacePath]);

    fs.writeFileSync(path.join(childPath, "rapid.txt"), "rapid");
    await sleep(600);
    expect(
      events.some((event) => event.path === path.join("src", "rapid.txt")),
    ).toBe(false);
  }, 10000);

  it("父工作区会话退出后子工作区会话仍继续监听", async () => {
    const parentEvents: FileChangeEvent[] = [];
    const childEvents: FileChangeEvent[] = [];
    const releaseParent = service.startWatching(
      "parent-session",
      workspacePath,
      "parent-client",
    );
    service.startWatching("child-session", childPath, "child-client");
    const unsubscribeParent = service.onFileChange("parent-session", (event) =>
      parentEvents.push(event),
    );
    service.onFileChange("child-session", (event) => childEvents.push(event));
    await sleep(800);

    unsubscribeParent();
    releaseParent();
    await sleep(500);

    fs.writeFileSync(path.join(childPath, "remaining.txt"), "remaining");
    await waitFor(() =>
      childEvents.some(
        (event) => event.type === "add" && event.path === "remaining.txt",
      ),
    );
    expect(parentEvents).toHaveLength(0);
  }, 10000);
});
