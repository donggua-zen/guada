import { PluginManager } from "../../src/modules/plugins/plugin.manager";
import { PluginBase } from "../../src/modules/plugins/base-plugin";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";

// ==================== Mock Helpers ====================

function createMockPlugin(id: string, category: "system" | "core" | "extended" | "user" = "extended"): PluginBase {
  return {
    manifest: { id, name: id, version: "1.0", description: "", category },
    _enabled: true,
  } as PluginBase;
}

function createEssentialPlugin(id: string): PluginBase {
  return {
    manifest: { id, name: id, version: "1.0", description: "", category: "extended", essential: true },
    _enabled: true,
  } as PluginBase;
}

function createMockToolKit(id: string) {
  return { def: { id, name: id, loadMode: "eager" as const }, tools: [], prompts: [] };
}

describe("PluginManager", () => {
  let manager: PluginManager;
  let mockSettingsStorage: any;
  let mockLogger: any;

  beforeEach(() => {
    (PluginRegistry as any).registrations?.clear?.();
    mockSettingsStorage = { getSettings: jest.fn().mockResolvedValue({}), updateSettings: jest.fn() };
    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    manager = new (PluginManager as any)(mockSettingsStorage, null, null, null, null, null);
    (manager as any).logger = mockLogger;
    (manager as any).instances = new Map();
  });

  /** 快捷注册插件到 instances */
  function addPlugin(id: string, category: "system" | "core" | "extended" | "user") {
    (manager as any).instances.set(id, {
      manifest: { id, category },
      plugin: createMockPlugin(id, category),
    });
  }

  function addEssentialPlugin(id: string) {
    (manager as any).instances.set(id, {
      manifest: { id: id, category: "extended", essential: true },
      plugin: createEssentialPlugin(id),
    });
  }

  // ==================== 基础流程 ====================

  describe("基础流程", () => {
    it("system/core 插件默认启用，extended/user 默认禁用", async () => {
      addPlugin("p_sys", "system");
      addPlugin("p_core", "core");
      addPlugin("p_ext", "extended");
      addPlugin("p_user", "user");
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_sys")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_ext")?.enabled).toBe(false);
      expect(r.find((x) => x.plugin.id === "p_user")?.enabled).toBe(false);
    });
  });

  // ==================== 全局层：禁用已启用的插件 ====================

  describe("全局层", () => {
    beforeEach(() => {
      addPlugin("p_core", "core"); // 初始启用
    });

    it("全局配置 { enabled: false } 可禁用 core 插件", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ p_core: { enabled: false } });
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
      expect(r.find((x) => x.plugin.id === "p_core")?.effective).toBe("global");
    });
  });

  // ==================== 层级收窄：全局禁用 → 角色无法复活 ====================

  describe("层级收窄", () => {
    beforeEach(() => {
      addPlugin("p_core", "core"); // 初始启用
      mockSettingsStorage.getSettings.mockResolvedValue({ p_core: { enabled: false } }); // 全局禁用
    });

    it("全局禁用后角色层无法通过 { enabled: true } 复活", async () => {
      const r = await manager.resolvePlugins(undefined, { p_core: { enabled: true } });
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });

    it("全局禁用后角色层无法通过白名单复活", async () => {
      const r = await manager.resolvePlugins(undefined, { __default: false, p_core: { enabled: true } });
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });
  });

  // ==================== 角色层：黑名单 ====================

  describe("角色层黑名单", () => {
    beforeEach(() => {
      addPlugin("p_a", "core");
      addPlugin("p_b", "core");
      mockSettingsStorage.getSettings.mockResolvedValue({ p_a: { enabled: true }, p_b: { enabled: true } });
    });

    it("角色层 { enabled: false } 可禁用单个插件", async () => {
      const r = await manager.resolvePlugins(undefined, { p_a: { enabled: false } });
      expect(r.find((x) => x.plugin.id === "p_a")?.enabled).toBe(false);
      expect(r.find((x) => x.plugin.id === "p_a")?.effective).toBe("role");
      expect(r.find((x) => x.plugin.id === "p_b")?.enabled).toBe(true);
    });
  });

  // ==================== 角色层：白名单 ====================

  describe("角色层白名单 (__default: false)", () => {
    beforeEach(() => {
      addPlugin("p_a", "core");
      addPlugin("p_b", "core");
      mockSettingsStorage.getSettings.mockResolvedValue({ p_a: { enabled: true }, p_b: { enabled: true } });
    });

    it("__default: false 时仅显式 { enabled: true } 的插件启用", async () => {
      const r = await manager.resolvePlugins(undefined, { __default: false, p_a: { enabled: true } });
      expect(r.find((x) => x.plugin.id === "p_a")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_b")?.enabled).toBe(false);
      expect(r.find((x) => x.plugin.id === "p_b")?.effective).toBe("role");
    });

    it("__default: false 影响所有非显式配置的插件（system 也不例外）", async () => {
      addPlugin("p_sys", "system");
      const r = await manager.resolvePlugins(undefined, { __default: false });
      // system 插件没有在配置条目中 → 也被禁用
      expect(r.find((x) => x.plugin.id === "p_sys")?.enabled).toBe(false);
    });
  });

  // ==================== deny_nonsystem 策略 ====================

  describe("deny_nonsystem 策略", () => {
    beforeEach(() => {
      addPlugin("p_sys", "system");
      addPlugin("p_core", "core");
    });

    it("deny_nonsystem 禁用所有非 system 插件", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ __strategy: "deny_nonsystem" });
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_sys")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });

    it("角色层 deny_nonsystem 覆盖全局", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ p_core: { enabled: true } });
      const r = await manager.resolvePlugins(undefined, { __strategy: "deny_nonsystem" });
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });
  });

  // ==================== MCP Toolkit 过滤 ====================

  describe("MCP Toolkit 过滤", () => {
    beforeEach(() => {
      addPlugin("mcp", "system");
      jest.spyOn(PluginRegistry, "getToolKits").mockImplementation((pluginId: string) => {
        if (pluginId === "mcp") return [createMockToolKit("mcp_srv1"), createMockToolKit("mcp_srv2")];
        return [];
      });
    });
    afterEach(() => jest.restoreAllMocks());

    it("默认黑名单：toolkits_deny 中的工具包被拒绝", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { enabled: true, toolkits_filter: "deny", toolkits_deny: ["mcp_srv1"] },
      });
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      expect(mcp.enabledToolKits.map((k) => k.id)).not.toContain("mcp_srv1");
      expect(mcp.enabledToolKits.map((k) => k.id)).toContain("mcp_srv2");
    });

    it("白名单：toolkits_allow 中的工具包被保留", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { enabled: true, toolkits_filter: "allow", toolkits_allow: ["mcp_srv2"] },
      });
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      expect(mcp.enabledToolKits.map((k) => k.id)).toContain("mcp_srv2");
      expect(mcp.enabledToolKits.map((k) => k.id)).not.toContain("mcp_srv1");
    });

    it("空 tk_allow 拒绝所有工具包", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { enabled: true, toolkits_filter: "allow", toolkits_allow: [] },
      });
      expect(r.find((x) => x.plugin.id === "mcp")?.enabledToolKits).toHaveLength(0);
    });

    it("白名单 + 全局禁用插件：层级收窄", async () => {
      addPlugin("p_ext", "extended");
      mockSettingsStorage.getSettings.mockResolvedValue({ p_ext: { enabled: false } });
      const r = await manager.resolvePlugins(undefined, {
        __default: false,
        p_ext: { enabled: true },
        mcp: { enabled: true, toolkits_filter: "deny", toolkits_deny: ["mcp_srv1"] },
      });
      // extended 插件初始禁用，全局也禁用 → 无法复活
      expect(r.find((x) => x.plugin.id === "p_ext")?.enabled).toBe(false);
      // MCP 黑名单拒绝
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      expect(mcp.enabledToolKits.map((k) => k.id)).not.toContain("mcp_srv1");
      expect(mcp.enabledToolKits.map((k) => k.id)).toContain("mcp_srv2");
    });
  });

  // ==================== essential 插件：不可被任何方式禁用 ====================

  describe("essential 插件保护", () => {
    beforeEach(() => {
      addEssentialPlugin("p_ess");
      addPlugin("p_ext", "extended"); // 对照组
      mockSettingsStorage.getSettings.mockResolvedValue({});
    });

    it("essential 插件默认启用", async () => {
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("全局 { enabled: false } 不能禁用 essential", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ p_ess: { enabled: false } });
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("角色层 { enabled: false } 不能禁用 essential", async () => {
      const r = await manager.resolvePlugins(undefined, { p_ess: { enabled: false } });
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("白名单模式 (__default: false) 不能禁用 essential", async () => {
      const r = await manager.resolvePlugins(undefined, { __default: false });
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("deny_nonsystem 不能禁用 essential", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ __strategy: "deny_nonsystem" });
      const r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("非 essential 插件不受影响（对照组可被禁用）", async () => {
      const r = await manager.resolvePlugins(undefined, {
        __default: false,
        p_ext: { enabled: false },
      });
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_ext")?.enabled).toBe(false);
    });
  });

  // ==================== setPluginEnabled 持久化格式 ====================

  describe("setPluginEnabled 持久化", () => {
    beforeEach(() => {
      addPlugin("p_ext", "extended");
    });

    it("启用插件时 updateSettings 应保存对象格式 { enabled: true }", async () => {
      await manager.setPluginEnabled("p_ext", true);
      expect(mockSettingsStorage.updateSettings).toHaveBeenCalledWith("plugins_config", {
        p_ext: { enabled: true },
      });
    });

    it("禁用插件时 updateSettings 应保存对象格式 { enabled: false }", async () => {
      await manager.setPluginEnabled("p_ext", false);
      expect(mockSettingsStorage.updateSettings).toHaveBeenCalledWith("plugins_config", {
        p_ext: { enabled: false },
      });
    });

    it("setPluginEnabled 后 instance.enabled 同步更新", async () => {
      const inst = (manager as any).instances.get("p_ext");
      expect(inst.enabled).toBeUndefined(); // 初始无状态

      await manager.setPluginEnabled("p_ext", true);
      expect(inst.enabled).toBe(true);

      await manager.setPluginEnabled("p_ext", false);
      expect(inst.enabled).toBe(false);
    });

    it("setPluginEnabled 保存后 resolvePlugins 能正确读取（对象格式）", async () => {
      // 用 core 插件测试（默认启用，resolvePlugins 可处理 enabled:true/false）
      addPlugin("p_core", "core");

      // 模拟禁用
      mockSettingsStorage.getSettings.mockResolvedValue({
        p_core: { enabled: false },
      });
      let r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);

      // 模拟启用
      mockSettingsStorage.getSettings.mockResolvedValue({
        p_core: { enabled: true },
      });
      r = await manager.resolvePlugins();
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(true);
    });
  });

  it("setPluginEnabled 对不存在的插件无操作", async () => {
    await manager.setPluginEnabled("non_existent", true);
    expect(mockSettingsStorage.updateSettings).not.toHaveBeenCalled();
  });

  it("setPluginEnabled 不能禁用 system 插件", async () => {
    addPlugin("p_sys", "system");
    await manager.setPluginEnabled("p_sys", false);
    const inst = (manager as any).instances.get("p_sys");
    expect(inst.enabled).not.toBe(false); // 保持原始状态
  });
});
