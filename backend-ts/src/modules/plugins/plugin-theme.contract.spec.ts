import { PluginRegistry } from "./registry/plugin-registry";
import { PluginsController } from "./plugins.controller";
import type { ResolvedPluginInfo } from "./types/plugin.types";

/**
 * 插件主题注册契约测试
 *
 * 验证两条链路：
 * 1. PluginRegistry.registerTheme：幂等注册 + getThemes 读取 + clearPlugin 清理
 * 2. PluginsController.getSlots：已启用插件的主题出现在响应 themes 中（含 cssFile/rev）
 */

describe("PluginRegistry.registerTheme (主题注册契约)", () => {
  afterEach(() => {
    for (const id of PluginRegistry.getAllIds()) {
      PluginRegistry.clearPlugin(id);
    }
  });

  function registerBase(pluginId: string) {
    PluginRegistry.registerManifest({
      id: pluginId,
      name: pluginId,
      version: "1.0.0",
      description: "",
      category: "extended",
    });
  }

  it("注册主题并幂等去重", () => {
    registerBase("p1");
    PluginRegistry.registerTheme("p1", {
      id: "p1.neon",
      name: "霓虹",
      primaryColor: "#0ff",
      cssFile: "neon.css",
    });
    // 同 id 重复注册不追加
    PluginRegistry.registerTheme("p1", {
      id: "p1.neon",
      name: "霓虹",
      cssFile: "neon.css",
    });
    const themes = PluginRegistry.getThemes("p1");
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ id: "p1.neon", cssFile: "neon.css" });
  });

  it("不同插件主题相互隔离，可跨插件聚合", () => {
    registerBase("p1");
    registerBase("p2");
    PluginRegistry.registerTheme("p1", { id: "p1.a", name: "A", cssFile: "a.css" });
    PluginRegistry.registerTheme("p2", { id: "p2.b", name: "B", cssFile: "b.css" });
    const all = PluginRegistry.getAllThemes();
    expect(all.map((x) => x.reg.id).sort()).toEqual(["p1.a", "p2.b"]);
  });

  it("clearPlugin 清除主题注册（禁用/卸载路径）", () => {
    registerBase("p1");
    PluginRegistry.registerTheme("p1", { id: "p1.a", name: "A", cssFile: "a.css" });
    PluginRegistry.clearPlugin("p1");
    expect(PluginRegistry.getThemes("p1")).toHaveLength(0);
  });
});

describe("PluginsController.getSlots (themes 随清单下发)", () => {
  afterEach(() => {
    for (const id of PluginRegistry.getAllIds()) {
      PluginRegistry.clearPlugin(id);
    }
  });

  function buildController(overrides?: Partial<ResolvedPluginInfo>[]) {
    return new PluginsController(
      {
        resolvePlugins: jest.fn().mockResolvedValue(
          overrides || [
            {
              enabled: true,
              effective: "global",
              plugin: { id: "p1", name: "p1", version: "2.0.0", description: "" },
              allTools: [],
              enabledTools: [],
              enabledToolKits: [],
              workspaceProviders: [],
              attachmentTypes: [],
              uiPages: [],
              source: "user",
            } as any,
          ],
        ),
      } as any,
      { getPluginPath: jest.fn().mockReturnValue("/tmp/plugins/p1") } as any,
      { resolveString: jest.fn((_id: string, s: string) => s) } as any,
      {} as any,
    );
  }

  it("已启用插件的主题出现在 themes 响应中（含 cssFile/rev）", async () => {
    PluginRegistry.registerManifest({
      id: "p1",
      name: "p1",
      version: "2.0.0",
      description: "",
      category: "extended",
    });
    PluginRegistry.registerTheme("p1", {
      id: "p1.neon",
      name: "霓虹",
      primaryColor: "#0ff",
      secondaryColor: "#f0f",
      mode: "dark",
      cssFile: "neon.css",
    });

    const controller = buildController();
    const result = await controller.getSlots("zh-CN");

    expect(result.slots).toEqual({});
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]).toMatchObject({
      pluginId: "p1",
      id: "p1.neon",
      name: "霓虹",
      primaryColor: "#0ff",
      secondaryColor: "#f0f",
      mode: "dark",
      cssFile: "neon.css",
    });
    // rev 取 dist 最新 mtime（非空字符串即可；无 dist 目录时返回 ""）
    expect(typeof result.themes[0].rev).toBe("string");
  });

  it("未启用插件（enabled=false）的主题不进入响应", async () => {
    PluginRegistry.registerManifest({
      id: "p1",
      name: "p1",
      version: "1.0.0",
      description: "",
      category: "extended",
    });
    PluginRegistry.registerTheme("p1", { id: "p1.a", name: "A", cssFile: "a.css" });

    const controller = buildController([
      {
        enabled: false,
        effective: "global",
        plugin: { id: "p1", name: "p1", version: "1.0.0", description: "" },
        allTools: [],
        enabledTools: [],
        enabledToolKits: [],
        workspaceProviders: [],
        attachmentTypes: [],
        uiPages: [],
      } as any,
    ]);
    const result = await controller.getSlots("zh-CN");
    expect(result.themes).toHaveLength(0);
  });
});
