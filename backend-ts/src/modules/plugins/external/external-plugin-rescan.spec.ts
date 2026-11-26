import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExternalPluginLoader } from "./external-plugin-loader";

/**
 * 目录重扫契约。
 *
 * 背景：插件目录只在 onModuleInit 时扫描一次，前端「刷新」只重拉 /plugins/query
 * （读内存注册表），于是手工拷进 plugins/ 的插件永远看不到。
 * rescanExternalPlugins 负责把磁盘状态同步到运行态。
 */
describe("ExternalPluginLoader rescanExternalPlugins", () => {
  let root: string;
  let userDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guada-plugin-rescan-"));
    userDir = path.join(root, "plugins");
    fs.mkdirSync(userDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 写入一个可加载的最小插件（entryName 用于区分文件内容以便改动 mtime/size） */
  function writePlugin(dirName: string, id: string, body = "module.exports = class {};") {
    const dir = path.join(userDir, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        id,
        name: id,
        version: "1.0.0",
        description: "d",
        main: "index.js",
        apiVersion: 2,
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "index.js"), body, "utf8");
    return dir;
  }

  function makeLoader() {
    const registered = new Map<string, any>();
    const loadCalls: string[] = [];
    const loader = new ExternalPluginLoader(
      {
        getPlugin: (id: string) => registered.get(id),
        registerPlugin: async (instance: any) => {
          registered.set(instance.manifest.id, instance);
          loadCalls.push(instance.manifest.id);
        },
        unregisterPlugin: async (id: string) => {
          registered.delete(id);
        },
      } as any,
      {
        get: (key: string) => (key === "PLUGINS_USER_DIR" ? userDir : undefined),
      } as any,
      { registerBundle: () => undefined } as any,
      { emit: () => undefined } as any,
    );
    return { loader, registered, loadCalls };
  }

  it("loads a plugin that appeared on disk after startup", async () => {
    const { loader, registered } = makeLoader();

    // 启动扫描时目录是空的
    await loader.loadAllExternalPlugins();
    expect(registered.size).toBe(0);

    // 之后手工拷进来一个插件
    writePlugin("demo", "demo");

    const result = await loader.rescanExternalPlugins();

    expect(result.added).toEqual(["demo"]);
    expect(result.reloaded).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(registered.has("demo")).toBe(true);
    expect(loader.getPluginPath("demo")).toBe(path.join(userDir, "demo"));
  });

  it("reports unchanged on a second rescan and does not reload", async () => {
    const { loader, loadCalls } = makeLoader();
    writePlugin("demo", "demo");

    await loader.rescanExternalPlugins();
    const callsAfterFirst = loadCalls.length;

    const second = await loader.rescanExternalPlugins();

    expect(second.added).toEqual([]);
    expect(second.reloaded).toEqual([]);
    expect(second.unchanged).toEqual(["demo"]);
    // 幂等：没有改动就不应重跑 onLoad
    expect(loadCalls.length).toBe(callsAfterFirst);
  });

  it("reloads a plugin whose entry file changed", async () => {
    const { loader, registered } = makeLoader();
    const dir = writePlugin("demo", "demo");

    await loader.rescanExternalPlugins();
    const firstInstance = registered.get("demo");

    // 改文件内容 → 指纹变化
    fs.writeFileSync(
      path.join(dir, "index.js"),
      "module.exports = class { constructor() { this.changed = true; } };",
      "utf8",
    );

    const result = await loader.rescanExternalPlugins();

    expect(result.reloaded).toEqual(["demo"]);
    expect(registered.has("demo")).toBe(true);
    // 实例被替换（旧实例已注销）
    expect(registered.get("demo")).not.toBe(firstInstance);
  });

  it("unregisters a plugin whose directory disappeared", async () => {
    const { loader, registered } = makeLoader();
    const dir = writePlugin("demo", "demo");

    await loader.rescanExternalPlugins();
    expect(registered.has("demo")).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });

    const result = await loader.rescanExternalPlugins();

    expect(result.removed).toEqual(["demo"]);
    expect(registered.has("demo")).toBe(false);
    expect(loader.getPluginPath("demo")).toBeUndefined();
  });

  it("collects per-plugin errors instead of failing the whole scan", async () => {
    const { loader, registered } = makeLoader();
    writePlugin("good", "good");

    // 坏插件：manifest 的 apiVersion 超出宿主支持范围
    const badDir = path.join(userDir, "bad");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(
      path.join(badDir, "manifest.json"),
      JSON.stringify({
        id: "bad",
        name: "bad",
        version: "1.0.0",
        description: "d",
        apiVersion: 999,
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(badDir, "index.js"), "module.exports = class {};", "utf8");

    const result = await loader.rescanExternalPlugins();

    expect(result.added).toEqual(["good"]);
    expect(registered.has("good")).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].pluginId).toBe("bad");
    expect(result.errors[0].message).toMatch(/apiVersion 999/);
  });

  it("does not pick up directories without manifest.json", async () => {
    const { loader, registered } = makeLoader();
    fs.mkdirSync(path.join(userDir, "not-a-plugin"), { recursive: true });

    const result = await loader.rescanExternalPlugins();

    expect(result.added).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(registered.size).toBe(0);
  });

  it("skips directories starting with a dot (staging leftovers)", async () => {
    const { loader, registered } = makeLoader();
    writePlugin(".staging-123", "staging-demo");

    const result = await loader.rescanExternalPlugins();

    expect(result.added).toEqual([]);
    expect(registered.size).toBe(0);
  });
});
