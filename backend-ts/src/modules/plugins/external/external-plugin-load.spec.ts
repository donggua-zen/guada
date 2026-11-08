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
