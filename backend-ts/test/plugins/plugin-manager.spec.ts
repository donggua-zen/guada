import { PluginManager, PluginInstance } from "../../src/modules/plugins/plugin.manager";
import { PluginBase } from "../../src/modules/plugins/base-plugin";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";
import {
  PluginManifest,
  ToolHandlerDef,
  PluginContext,
  PROMPTS_META_KEY,
} from "../../src/modules/plugins/types/plugin.types";

// ── 辅助函数：创建 mock 插件 ──

function createMockPlugin(
  id: string,
  name: string,
  tools: ToolHandlerDef[] = [],
  extra?: Partial<PluginBase>,
): PluginBase {
  const manifest: PluginManifest = {
    id, name, description: `${name} description`,
    version: "1.0.0", category: "core",
  };
  if (!PluginRegistry.has(id)) {
    PluginRegistry.registerManifest(manifest);
  }
  for (const t of tools) {
    const reg = (PluginRegistry as any).registrations.get(id);
    if (reg && !reg.tools.find((x: any) => x.name === t.name)) {
      reg.tools.push(t);
    }
  }
  const plugin: PluginBase = {
    manifest,
    _enabled: true,
    ...extra,
  };
  return plugin;
}

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  afterEach(async () => {
    for (const id of PluginRegistry.getAllIds()) {
      await manager.unregisterPlugin(id);
    }
  });

  // ── 基础注册 ──

  describe("registerPlugin", () => {
    it("should register a plugin", async () => {
      const plugin = createMockPlugin("test_plugin", "测试插件");
      await manager.registerPlugin(plugin);
      expect(manager.isPluginEnabled("test_plugin")).toBe(true);
    });

    it("should not register duplicate plugins", async () => {
      const plugin = createMockPlugin("dup", "重复插件");
      await manager.registerPlugin(plugin);
      await manager.registerPlugin(plugin);
      const plugins = manager.getAllPlugins();
      expect(plugins.length).toBe(1);
    });
  });

  // ── 工具加载模式 ──

  describe("getTools (loadMode resolution)", () => {
    it("should return empty for disabled plugins", async () => {
      const plugin = createMockPlugin("disabled_p", "禁用插件");
      await manager.registerPlugin(plugin, false);
      const result = await manager.getTools();
      expect(result).toHaveLength(0);
    });

    it("should return tools for enabled plugins without condition", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "tool_a", description: "Tool A", parameters: { type: "object", properties: {} }, handler: async () => "ok" },
      ];
      const plugin = createMockPlugin("simple", "简单插件", tools);
      await manager.registerPlugin(plugin);
      const result = await manager.getTools();
      expect(result).toHaveLength(1);
      expect(result[0].tools).toHaveLength(1);
      expect(result[0].tools[0].name).toBe("tool_a");
    });

    it("should skip plugin when condition guard returns false", async () => {
      const plugin = createMockPlugin("guarded", "守卫插件");
      PluginRegistry.extractCondition("guarded", {
        __plugin_condition__: async () => false, // 注册时评估，false = 不入注册
      });
      await manager.registerPlugin(plugin);
      expect(manager.isPluginEnabled("guarded")).toBe(false);
      const result = await manager.getTools();
      expect(result).toHaveLength(0);
    });

    it("should include plugin when condition guard returns true", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "bot_only", description: "Bot Tool", parameters: { type: "object", properties: {} }, handler: async () => "ok" },
      ];
      const plugin = createMockPlugin("bot_tool", "Bot工具", tools);
      PluginRegistry.extractCondition("bot_tool", {
        __plugin_condition__: async () => true, // 注册时评估
      });
      await manager.registerPlugin(plugin);
      expect(manager.isPluginEnabled("bot_tool")).toBe(true);
      const result = await manager.getTools();
      expect(result).toHaveLength(1);
      expect(result[0].tools[0].name).toBe("bot_only");
    });
  });

  // ── ToolSet 解析 ──

  describe("ToolSet resolution", () => {
    it("should handle ToolSet handler that throws", async () => {
      const plugin = createMockPlugin("ts_error", "ToolSet错误");
      PluginRegistry.registerToolSet("ts_error", {
        id: "broken",
        name: "broken",
        tools: [],
        loadMode: "lazy",
        handler: async () => { throw new Error("handler error"); },
      });
      await manager.registerPlugin(plugin);
      const result = await manager.getTools({ sessionId: "s1", sessionType: "web", workspacePath: "/tmp" });
      expect(result).toHaveLength(0);
    });
  });

  // ── 提示词收集 ──

  describe("collectPrompts", () => {
    it("should collect eager prompts and skip lazy", async () => {
      const plugin = createMockPlugin("prompt_test", "提示词测试");
      const proto: any = { __plugin_manifest__: plugin.manifest };
      proto[PROMPTS_META_KEY] = [
        { methodName: "eagerPrompt", frequency: "STATIC", loadMode: "eager", description: "Eager", handler: async () => "eager content" },
        { methodName: "lazyPrompt", frequency: "REGULAR", loadMode: "lazy", description: "Lazy", handler: async () => "lazy content" },
      ];
      PluginRegistry.extractFromPrototype("prompt_test", proto);
      await manager.registerPlugin(plugin);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };

      const eager = await manager.collectPrompts(ctx);
      expect(eager).toHaveLength(1);
      expect(eager[0].content).toBe("eager content");

      const lazy = await manager.collectLazyPrompts(ctx);
      expect(lazy).toHaveLength(1);
      expect(lazy[0].content).toBe("lazy content");
    });

    it("should sort by frequency: STATIC < REGULAR < VOLATILE, then by pluginId", async () => {
      // 两个插件，各注册 STATIC / REGULAR / VOLATILE 三种 prompt
      const pluginA = createMockPlugin("plugin_a", "A插件");
      const protoA: any = { __plugin_manifest__: pluginA.manifest };
      protoA[PROMPTS_META_KEY] = [
        { methodName: "a_volatile", frequency: "VOLATILE", loadMode: "eager", description: "A-VOL", handler: async () => "A-VOLATILE" },
        { methodName: "a_static",   frequency: "STATIC",   loadMode: "eager", description: "A-STA", handler: async () => "A-STATIC" },
        { methodName: "a_regular",  frequency: "REGULAR",  loadMode: "eager", description: "A-REG", handler: async () => "A-REGULAR" },
      ];
      PluginRegistry.extractFromPrototype("plugin_a", protoA);

      const pluginB = createMockPlugin("plugin_b", "B插件");
      const protoB: any = { __plugin_manifest__: pluginB.manifest };
      protoB[PROMPTS_META_KEY] = [
        { methodName: "b_regular",  frequency: "REGULAR",  loadMode: "eager", description: "B-REG", handler: async () => "B-REGULAR" },
        { methodName: "b_static",   frequency: "STATIC",   loadMode: "eager", description: "B-STA", handler: async () => "B-STATIC" },
        { methodName: "b_volatile", frequency: "VOLATILE", loadMode: "eager", description: "B-VOL", handler: async () => "B-VOLATILE" },
      ];
      PluginRegistry.extractFromPrototype("plugin_b", protoB);

      await manager.registerPlugin(pluginA);
      await manager.registerPlugin(pluginB);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };

      const all = await manager.collectPrompts(ctx);
      expect(all).toHaveLength(6);

      // 排序：STATIC(0) < REGULAR(1) < VOLATILE(2)
      // 同频率按 pluginId 字典序
      expect(all.map(p => p.content)).toEqual([
        "A-STATIC",   // STATIC, plugin_a
        "B-STATIC",   // STATIC, plugin_b
        "A-REGULAR",  // REGULAR, plugin_a
        "B-REGULAR",  // REGULAR, plugin_b
        "A-VOLATILE", // VOLATILE, plugin_a
        "B-VOLATILE", // VOLATILE, plugin_b
      ]);
    });

    it("should place prompts without frequency at REGULAR position", async () => {
      const plugin = createMockPlugin("freq_test", "频率测试");
      const proto: any = { __plugin_manifest__: plugin.manifest };
      proto[PROMPTS_META_KEY] = [
        { methodName: "noFreq",  frequency: undefined, loadMode: "eager", description: "NoFreq", handler: async () => "NO-FREQ" },
        { methodName: "withReg", frequency: "REGULAR", loadMode: "eager", description: "Reg",    handler: async () => "WITH-REG" },
      ];
      PluginRegistry.extractFromPrototype("freq_test", proto);
      await manager.registerPlugin(plugin);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };

      const all = await manager.collectPrompts(ctx);
      expect(all).toHaveLength(2);
      // 两者都在 REGULAR 位置，按 pluginId 排序（相同插件，注册顺序）
      expect(all[0].content).toBe("NO-FREQ");
      expect(all[1].content).toBe("WITH-REG");
    });

    it("should maintain stable order within the same pluginId", async () => {
      // 同插件同频率，应保持注册顺序
      const plugin = createMockPlugin("stable", "稳定测试");
      const proto: any = { __plugin_manifest__: plugin.manifest };
      proto[PROMPTS_META_KEY] = [
        { methodName: "first",  frequency: "REGULAR", loadMode: "eager", description: "First",  handler: async () => "FIRST" },
        { methodName: "second", frequency: "REGULAR", loadMode: "eager", description: "Second", handler: async () => "SECOND" },
        { methodName: "third",  frequency: "REGULAR", loadMode: "eager", description: "Third",  handler: async () => "THIRD" },
      ];
      PluginRegistry.extractFromPrototype("stable", proto);
      await manager.registerPlugin(plugin);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };

      const all = await manager.collectPrompts(ctx);
      expect(all).toHaveLength(3);
      expect(all.map(p => p.content)).toEqual(["FIRST", "SECOND", "THIRD"]);
    });
  });

  // ── 激活词 ──

  describe("getToolActivators", () => {
    it("should return activator for lazy ToolSets", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "lazy_tool", description: "Lazy", parameters: { type: "object", properties: {} }, handler: async () => "ok", toolSet: "lazy_set" },
      ];
      const plugin = createMockPlugin("act_test", "激活测试", tools);

      PluginRegistry.registerToolSet("act_test", {
        id: "lazy_set",
        name: "lazy_set",
        tools: ["lazy_tool"],
        loadMode: "lazy",
        activator: "当需要懒加载时使用",
      });

      await manager.registerPlugin(plugin);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const activators = await manager.getToolActivators(ctx);
      expect(activators).toHaveLength(1);
      expect(activators[0]).toContain("lazy_set");
      expect(activators[0]).toContain("当需要懒加载时使用");
    });

    it("should skip eager ToolSets in activators", async () => {
      const plugin = createMockPlugin("eager_act", "Eager激活");
      PluginRegistry.registerToolSet("eager_act", {
        id: "eager_set",
        name: "eager_set",
        tools: [],
        loadMode: "eager",
        handler: async () => ({ loadMode: "eager" as const }),
      });
      await manager.registerPlugin(plugin);
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const activators = await manager.getToolActivators(ctx);
      expect(activators).toHaveLength(0);
    });
  });
});
