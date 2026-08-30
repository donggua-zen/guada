import { PluginManager } from "../../src/modules/plugins/plugin.manager";
import { PluginBase } from "../../src/modules/plugins/base-plugin";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";

// ==================== Mock Helpers ====================
// V3 决议语义：全局层控插件启停；角色层只裁剪工具包（能力包），
// 不消费 entry.enabled（旧插件级开关被忽略）

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

describe("PluginManager", () => {
  let manager: PluginManager;
  let mockSettingsStorage: any;
  let mockLogger: any;

  beforeEach(() => {
    (PluginRegistry as any).registrations?.clear?.();
    mockSettingsStorage = { getSettings: jest.fn().mockResolvedValue({}), updateSettings: jest.fn() };
    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    manager = new (PluginManager as any)(
      mockSettingsStorage,
      null,
      null,
      null,
      { emit: jest.fn() },
    );
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

  /** 给实例挂一个真实注册的工具包（eager，含一个工具），供角色层裁剪测试 */
  function addKit(pluginId: string, kitId: string) {
    const inst = (manager as any).instances.get(pluginId);
    expect(inst).toBeDefined();
    PluginRegistry.registerManifest({ ...inst.manifest, name: inst.manifest.id ?? pluginId, version: "1.0", description: "" } as any);
    PluginRegistry.registerToolKit(pluginId, {
      def: { id: kitId, name: kitId, loadMode: "eager" as const },
      tools: [{
        name: `${kitId}_tool`,
        description: "",
        parameters: { type: "object", properties: {} },
        handler: async () => ({ content: "" }),
        toolSet: kitId,
      }],
      prompts: [],
    } as any);
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

    it("全局禁用后角色层无法通过旧格式 { enabled: true } 复活", async () => {
      const r = await manager.resolvePlugins(undefined, { p_core: { enabled: true } } as any);
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });

    it("全局禁用后角色层无法通过白名单复活", async () => {
      const r = await manager.resolvePlugins(undefined, { __default: false, p_core: { toolkits_filter: "allow", toolkits_allow: ["k"] } } as any);
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(false);
    });
  });

  // ==================== 角色层：只控工具包，不控插件启停 ====================

  describe("角色层黑名单（toolkits_deny）", () => {
    beforeEach(() => {
      addPlugin("p_a", "core");
      addKit("p_a", "ka1");
      addKit("p_a", "ka2");
      addPlugin("p_b", "core");
      mockSettingsStorage.getSettings.mockResolvedValue({});
    });

    it("角色层 { enabled: false }（旧格式）被忽略，不影响插件与工具包", async () => {
      const r = await manager.resolvePlugins(undefined, { p_a: { enabled: false } } as any);
      expect(r.find((x) => x.plugin.id === "p_a")?.enabled).toBe(true);
      expect(r.find((x) => x.plugin.id === "p_a")?.enabledToolKits.every((k) => k.enabled)).toBe(true);
    });

    it("toolkits_deny 裁剪指定工具包，其余保留，插件仍启用", async () => {
      const r = await manager.resolvePlugins(undefined, { p_a: { toolkits_deny: ["ka1"] } } as any);
      const pa = r.find((x) => x.plugin.id === "p_a")!;
      expect(pa.enabled).toBe(true);
      expect(pa.enabledToolKits.find((k) => k.id === "ka1")!.enabled).toBe(false);
      expect(pa.enabledToolKits.find((k) => k.id === "ka2")!.enabled).toBe(true);
      // eager 工具包被拒后其工具不进 enabledTools
      expect(pa.enabledTools.map((t) => t.name)).not.toContain("ka1_tool");
      expect(pa.enabledTools.map((t) => t.name)).toContain("ka2_tool");
    });

    it("未配置的其它插件不受影响", async () => {
      const r = await manager.resolvePlugins(undefined, { p_a: { toolkits_deny: ["ka1"] } } as any);
      expect(r.find((x) => x.plugin.id === "p_b")?.enabled).toBe(true);
    });
  });

  // ==================== 角色层：白名单 (__default: false) ====================

  describe("角色层白名单 (__default: false)", () => {
    beforeEach(() => {
      addPlugin("p_a", "core");
      addKit("p_a", "ka1");
      addPlugin("p_b", "core");
      addKit("p_b", "kb1");
      mockSettingsStorage.getSettings.mockResolvedValue({});
    });

    it("__default: false 时仅显式 allow 的工具包放行", async () => {
      const r = await manager.resolvePlugins(undefined, {
        __default: false,
        p_a: { toolkits_filter: "allow", toolkits_allow: ["ka1"] },
      } as any);
      const pa = r.find((x) => x.plugin.id === "p_a")!;
      expect(pa.enabled).toBe(true); // 插件不被禁用
      expect(pa.enabledToolKits.find((k) => k.id === "ka1")!.enabled).toBe(true);

      // 未显式配置的插件：全部工具包默认拒绝
      const pb = r.find((x) => x.plugin.id === "p_b")!;
      expect(pb.enabled).toBe(true);
      expect(pb.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    });

    it("system 分类插件的工具包同样受白名单约束，但插件本体不禁用", async () => {
      addPlugin("mcp", "system");
      addKit("mcp", "mcp_srv1");
      const r = await manager.resolvePlugins(undefined, { __default: false } as any);
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      expect(mcp.enabled).toBe(true);
      expect(mcp.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    });
  });

  // ==================== deny_nonsystem 策略（角色层=拒绝全部非 essential 工具包） ====================

  describe("deny_nonsystem 策略", () => {
    beforeEach(() => {
      addPlugin("p_sys", "system");
      addKit("p_sys", "sys_k");
      addPlugin("p_core", "core");
      addKit("p_core", "core_k");
    });

    it("全局层的 __strategy 不再消费（仅角色层生效）", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ __strategy: "deny_nonsystem" });
      const r = await manager.resolvePlugins();
      // 全局层只读 entry.enabled；__strategy 被忽略 → 插件保持默认状态
      expect(r.find((x) => x.plugin.id === "p_core")?.enabled).toBe(true);
    });

    it("角色层 deny_nonsystem 拒绝所有非 essential 插件的工具包，但不禁用插件", async () => {
      const r = await manager.resolvePlugins(undefined, { __strategy: "deny_nonsystem" } as any);
      const core = r.find((x) => x.plugin.id === "p_core")!;
      expect(core.enabled).toBe(true);
      expect(core.enabledToolKits.every((k) => !k.enabled)).toBe(true);
      const sys = r.find((x) => x.plugin.id === "p_sys")!;
      expect(sys.enabled).toBe(true);
      expect(sys.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    });
  });

  // ==================== MCP Toolkit 过滤 ====================

  describe("MCP Toolkit 过滤", () => {
    beforeEach(() => {
      addPlugin("mcp", "system");
      addKit("mcp", "mcp_srv1");
      addKit("mcp", "mcp_srv2");
    });

    it("默认黑名单：toolkits_deny 中的工具包被标记禁用", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { toolkits_filter: "deny", toolkits_deny: ["mcp_srv1"] },
      } as any);
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      const byId = Object.fromEntries(mcp.enabledToolKits.map((k) => [k.id, k.enabled]));
      expect(byId["mcp_srv1"]).toBe(false);
      expect(byId["mcp_srv2"]).toBe(true);
    });

    it("白名单：toolkits_allow 中的工具包被保留", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { toolkits_filter: "allow", toolkits_allow: ["mcp_srv2"] },
      } as any);
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      const byId = Object.fromEntries(mcp.enabledToolKits.map((k) => [k.id, k.enabled]));
      expect(byId["mcp_srv2"]).toBe(true);
      expect(byId["mcp_srv1"]).toBe(false);
    });

    it("空 allow 列表拒绝所有工具包", async () => {
      const r = await manager.resolvePlugins(undefined, {
        mcp: { toolkits_filter: "allow", toolkits_allow: [] },
      } as any);
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      expect(mcp.enabledToolKits.every((k) => !k.enabled)).toBe(true);
      // 全部工具包仍完整列出（供 UI 渲染）
      expect(mcp.enabledToolKits).toHaveLength(2);
    });

    it("白名单 + 全局禁用插件：插件级禁用优先，无能力可裁剪", async () => {
      addPlugin("p_ext", "extended");
      mockSettingsStorage.getSettings.mockResolvedValue({ p_ext: { enabled: false } });
      const r = await manager.resolvePlugins(undefined, {
        __default: false,
        p_ext: { enabled: true }, // 旧格式，被忽略且无法复活
        mcp: { toolkits_deny: ["mcp_srv1"] },
      } as any);
      expect(r.find((x) => x.plugin.id === "p_ext")?.enabled).toBe(false);
      const mcp = r.find((x) => x.plugin.id === "mcp")!;
      const byId = Object.fromEntries(mcp.enabledToolKits.map((k) => [k.id, k.enabled]));
      expect(byId["mcp_srv1"]).toBe(false);
      expect(byId["mcp_srv2"]).toBe(true);
    });
  });

  // ==================== essential 插件：不可被任何方式禁用/裁剪 ====================

  describe("essential 插件保护", () => {
    beforeEach(() => {
      addEssentialPlugin("p_ess");
      addKit("p_ess", "ess_k");
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

    it("角色层条目不能禁用 essential", async () => {
      const r = await manager.resolvePlugins(undefined, { p_ess: { enabled: false } } as any);
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("白名单模式 (__default: false) 不能禁用 essential 插件本体", async () => {
      const r = await manager.resolvePlugins(undefined, { __default: false } as any);
      expect(r.find((x) => x.plugin.id === "p_ess")?.enabled).toBe(true);
    });

    it("deny_nonsystem 不能裁剪 essential 的工具包", async () => {
      const r = await manager.resolvePlugins(undefined, { __strategy: "deny_nonsystem" } as any);
      const ess = r.find((x) => x.plugin.id === "p_ess")!;
      expect(ess.enabled).toBe(true);
      expect(ess.enabledToolKits.every((k) => k.enabled)).toBe(true);
    });

    it("非 essential 插件不受保护（对照组可被全局禁用）", async () => {
      mockSettingsStorage.getSettings.mockResolvedValue({ p_ext: { enabled: false } });
      const r = await manager.resolvePlugins();
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
