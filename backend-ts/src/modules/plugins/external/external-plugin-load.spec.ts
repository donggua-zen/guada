import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExternalPluginLoader } from "./external-plugin-loader";

describe("ExternalPluginLoader (local dir contract)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guada-plugin-load-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writePlugin(files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
  }

  it("loads manifest, entry and calls onLoad with the plugin api", async () => {
    writePlugin({
      "manifest.json": JSON.stringify({
        id: "demo-plugin",
        name: "Demo",
        version: "1.0.0",
        description: "demo",
        main: "index.js",
        apiVersion: 2,
        permissions: ["prompt"],
      }),
      "index.js": `
        class Demo {
          constructor() { this.manifest = { id: 'inline', name: 'Inline', version: '0.0.0', description: 'x' }; }
          async onLoad(api) {
            api.registerSlot({ name: 'settings', component: 'SettingsPage', meta: { label: 'Demo' } });
          }
        }
        module.exports = Demo;
      `,
    });

    const registered: any[] = [];
    const slotCalls: any[] = [];
    const manager = {
      getPlugin: () => undefined,
      registerPlugin: async (instance: any) => {
        registered.push(instance);
        await instance.onLoad({
          registerSlot: (reg: any) => slotCalls.push(reg),
        });
      },
    };
    const config = { get: () => undefined };
    const nls = { registerBundle: () => undefined };
    const eventBus = { emit: () => undefined };

    const loader = new ExternalPluginLoader(
      manager as any,
      config as any,
      nls as any,
      eventBus as any,
    );

    await (loader as any).loadExternalPlugin(root, "user");

    expect(registered).toHaveLength(1);
    expect(registered[0].manifest.id).toBe("demo-plugin");
    expect(registered[0].manifest.apiVersion).toBe(2);
    expect(registered[0].manifest.permissions).toEqual(["prompt"]);
    expect(slotCalls).toEqual([
      expect.objectContaining({ name: "settings", component: "SettingsPage" }),
    ]);
  });

  it("rejects an apiVersion newer than the host", async () => {
    writePlugin({
      "manifest.json": JSON.stringify({
        id: "future-plugin",
        name: "Future",
        version: "1.0.0",
        description: "future",
        apiVersion: 999,
      }),
      "index.js": "module.exports = class {};",
    });

    const loader = new ExternalPluginLoader(
      { getPlugin: () => undefined, registerPlugin: async () => undefined } as any,
      { get: () => undefined } as any,
      { registerBundle: () => undefined } as any,
      { emit: () => undefined } as any,
    );

    await expect((loader as any).loadExternalPlugin(root, "user")).rejects.toThrow(
      /apiVersion 999/,
    );
  });
});

describe("ExternalPluginLoader (install dir naming)", () => {
  let userDir: string;
  let srcRoot: string;

  beforeEach(() => {
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), "guada-plugin-user-"));
    srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guada-plugin-src-"));
  });

  afterEach(() => {
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(srcRoot, { recursive: true, force: true });
  });

  function writeSource(dirName: string, manifest: Record<string, unknown>) {
    const dir = path.join(srcRoot, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ name: "Demo", version: "1.0.0", description: "d", ...manifest }),
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "index.js"), "module.exports = class {};", "utf8");
    return dir;
  }

  function makeLoader() {
    const registered: any[] = [];
    const loader = new ExternalPluginLoader(
      {
        getPlugin: () => undefined,
        registerPlugin: async (instance: any) => {
          registered.push(instance);
        },
      } as any,
      {
        get: (key: string) => (key === "PLUGINS_USER_DIR" ? userDir : undefined),
      } as any,
      { registerBundle: () => undefined } as any,
      { emit: () => undefined } as any,
    );
    return { loader, registered };
  }

  it("installs into <userDir>/<manifest.id>, not the source folder name", async () => {
    const src = writeSource("guada-plugin-demo", {
      id: "demo",
      apiVersion: 4,
    });
    const { loader } = makeLoader();

    const result = await (loader as any).doInstall(`local:${src}`);

    expect(result.id).toBe("demo");
    expect(result.dir).toBe(path.join(userDir, "demo"));
    expect(fs.existsSync(path.join(userDir, "demo", "manifest.json"))).toBe(true);
    // 不再按源目录名建目录
    expect(fs.existsSync(path.join(userDir, "guada-plugin-demo"))).toBe(false);
    // 暂存目录应清理干净
    expect(
      fs.readdirSync(userDir).filter((name) => name.startsWith(".staging-")),
    ).toEqual([]);
  });

  it("detects an existing install under a legacy folder name", async () => {
    // 旧版按源名建目录：目录叫 legacy-dir，但 manifest.id 是 demo
    const legacy = path.join(userDir, "legacy-dir");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(
      path.join(legacy, "manifest.json"),
      JSON.stringify({ id: "demo", name: "Demo", version: "1.0.0", description: "d" }),
      "utf8",
    );

    const src = writeSource("guada-plugin-demo", { id: "demo" });
    const { loader } = makeLoader();

    await expect((loader as any).doInstall(`local:${src}`)).rejects.toThrow(
      /已安装（目录 legacy-dir）/,
    );
    // 失败后不留暂存目录
    expect(
      fs.readdirSync(userDir).filter((name) => name.startsWith(".staging-")),
    ).toEqual([]);
  });

  it("rejects an install whose manifest has no id", async () => {
    const dir = path.join(srcRoot, "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ name: "NoId", version: "1.0.0", description: "d" }),
      "utf8",
    );
    const { loader } = makeLoader();

    await expect((loader as any).doInstall(`local:${dir}`)).rejects.toThrow(
      /缺少 id/,
    );
    expect(fs.readdirSync(userDir)).toEqual([]);
  });
});
