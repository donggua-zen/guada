import * as fs from "fs";
import * as path from "path";
import { ExternalPluginLoader } from "../../src/modules/plugins/external/external-plugin-loader";
import { PluginManager } from "../../src/modules/plugins/plugin.manager";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";

/**
 * 内置主题插件随包分发（生产形态）回归
 *
 * 回归背景：主题从 frontend/public/themes 迁到 plugins/guada-themes 后，
 * 打包清单不含 plugins/、生产也不注入内置插件目录，且入口是 .ts（生产 node dist/main
 * 没有 TS loader）——结果是打包版非默认主题静默回退到 default。
 *
 * 现在要求：入口为无依赖的 CommonJS JS，可按 builtin 来源加载，且每个主题的 CSS
 * 都真实存在于插件目录内（assets 端点按插件目录解析）。
 */
describe("内置主题插件随包分发（生产形态）", () => {
  const pluginDir = path.resolve(__dirname, "../../../plugins/guada-themes");

  beforeEach(() => {
    for (const id of PluginRegistry.getAllIds()) {
      PluginRegistry.clearPlugin(id);
    }
  });

  function makeLoader(config: Record<string, string | undefined> = {}) {
    const manager = new (PluginManager as any)(
      { getSettings: async () => ({}), updateSettings: async () => undefined },
      null,
      null,
      null,
      { emit: jest.fn() },
    );
    const loader = new ExternalPluginLoader(
      manager,
      { get: (key: string) => config[key] } as any,
      null as any,
      { emit: jest.fn() } as any,
    );
    return { manager, loader };
  }

  it("入口是纯 JS、manifest 指向它，且不依赖 backend 源码路径", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf-8"),
    );
    expect(manifest.main).toBe("index.js");
    expect(fs.existsSync(path.join(pluginDir, manifest.main))).toBe(true);
    // .ts 入口在生产 require 不了，必须已移除
    expect(fs.existsSync(path.join(pluginDir, "index.ts"))).toBe(false);

    const source = fs.readFileSync(path.join(pluginDir, manifest.main), "utf-8");
    // 打包后只有 dist/，插件不能 import backend-ts/src
    expect(source).not.toMatch(/require\(\s*["'][^"']*backend-ts/);
  });

  it("按 builtin 来源加载：注册全部主题且 CSS 文件都在插件目录内", async () => {
    const { loader } = makeLoader();
    await loader.loadExternalPlugin(pluginDir, "builtin");

    const themes = PluginRegistry.getThemes("guada-themes");
    // 迁移时 id 沿用原内置 id（用户持久化设置无缝衔接）
    const ids = themes.map((t) => t.id);
    for (const id of [
      "brutalist",
      "blueprint",
      "steampunk",
      "y2k",
      "pop-comic",
      "famicom",
      "e-ink",
      "doodle",
      "cyberpunk",
      "wandering-earth",
      "winxp",
    ]) {
      expect(ids).toContain(id);
    }

    // assets 端点按插件目录解析 cssFile：文件必须真实存在，否则主题加载 404
    for (const t of themes) {
      expect(t.cssFile).toBeTruthy();
      expect(fs.existsSync(path.join(pluginDir, t.cssFile!))).toBe(true);
    }

    expect(loader.getPluginPath("guada-themes")).toBe(pluginDir);
    expect(loader.getPluginSource("guada-themes")).toBe("builtin");
  });

  it("扫描顺序：builtin 优先于 user/dev（官方插件不被副本遮蔽）", () => {
    const { loader } = makeLoader({
      PLUGINS_BUILTIN_DIR: "/opt/guada/plugins",
      PLUGINS_USER_DIR: "/home/me/.guada/plugins",
      PLUGINS_DEV_DIR: "/repo/plugins",
    });
    const dirs = (loader as any).getScanDirs() as Array<{ dir: string; source: string }>;
    expect(dirs.map((d) => d.source)).toEqual(["builtin", "user", "dev"]);
  });
});
