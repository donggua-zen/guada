import { Test, TestingModule } from "@nestjs/testing";
import { ToolOrchestrator } from "../../src/modules/tools/tool-orchestrator.service";
import { PluginManager } from "../../src/modules/plugins/plugin.manager";
import { SettingsStorage } from "../../src/common/utils/settings-storage.util";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";
import { ToolCallRequest, ToolCallResponse } from "../../src/modules/tools/interfaces/tool-provider.interface";
import { PluginContext, ToolHandlerDef } from "../../src/modules/plugins/types/plugin.types";
import { PluginBase } from "../../src/modules/plugins/base-plugin";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";
import { z } from "zod";

// ── Mock SettingsStorage ──

jest.mock("../../src/common/utils/settings-storage.util", () => ({
  SettingsStorage: jest.fn().mockImplementation(() => ({
    getSettings: jest.fn().mockResolvedValue(true),
  })),
}));

describe("ToolOrchestrator", () => {
  let orchestrator: ToolOrchestrator;
  let pluginManager: PluginManager;

  beforeEach(async () => {
    // 重置 PluginRegistry 内部状态
    const reg = (PluginRegistry as any).registrations;
    if (reg) reg.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolOrchestrator,
        PluginManager,
        { provide: SettingsStorage, useFactory: () => ({ getSettings: jest.fn().mockResolvedValue(true) }) },
      ],
    }).compile();

    orchestrator = module.get<ToolOrchestrator>(ToolOrchestrator);
    pluginManager = module.get<PluginManager>(PluginManager);
  });

  // ── buildToolRuntime ──

  describe("buildToolRuntime", () => {
    it("should build empty runtime when no plugins", async () => {
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);
      expect(runtime.eagerTools.size).toBe(0);
      expect(runtime.lazyToolSets.size).toBe(0);
    });

    it("should group eager tools and lazy tools separately", async () => {
      // 注册一个 eager 插件
      const eagerTools: ToolHandlerDef[] = [
        { name: "eager_tool", description: "Eager", parameters: { type: "object", properties: {} }, handler: async () => "eager" },
      ];
      const eagerPlugin = createMockPluginBase("eager_plugin", "Eager Plugin", eagerTools);
      await pluginManager.registerPlugin(eagerPlugin);

      // 注册一个 lazy 插件（通过 ToolSet）
      const lazyTools: ToolHandlerDef[] = [
        { name: "lazy_tool", description: "Lazy", parameters: { type: "object", properties: {} }, handler: async () => "lazy", toolSet: "lazy_set" },
      ];
      const lazyPlugin = createMockPluginBase("lazy_plugin", "Lazy Plugin", lazyTools);
      PluginRegistry.registerToolSet("lazy_plugin", {
        id: "lazy_set",
        name: "lazy_set",
        tools: ["lazy_tool"],
        loadMode: "lazy",
      });
      await pluginManager.registerPlugin(lazyPlugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      // eager 应在 eagerTools Map 中
      expect(runtime.eagerTools.has("eager_tool")).toBe(true);
      expect(runtime.eagerTools.get("eager_tool")?.name).toBe("eager_tool");

      // lazy 应在 lazyToolSets Map 中
      const lazySet = runtime.lazyToolSets.get("lazy_set");
      expect(lazySet).toBeDefined();
      expect(lazySet!.tools).toHaveLength(1);
      expect(lazySet!.tools[0].name).toBe("lazy_tool");
      expect(lazySet!.pluginId).toBe("lazy_plugin");
    });
  });

  // ── tool_load ──

  describe("tool_load", () => {
    it("should return error for unknown toolSet", async () => {
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);
      const request: ToolCallRequest = { id: "r1", name: "tool_load", arguments: { toolSet: "nonexistent" } };

      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(true);
      expect(result.content).toContain("未知");
    });

    it("should load lazy tools successfully", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "loadable", description: "Loadable", parameters: { type: "object", properties: {} }, handler: async () => "loaded", toolSet: "test_set" },
      ];
      const plugin = createMockPluginBase("load_plugin", "Load Plugin", tools);
      PluginRegistry.registerToolSet("load_plugin", {
        id: "test_set",
        name: "test_set",
        tools: ["loadable"],
        loadMode: "lazy",
      });
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      // 验证 loadable 在懒加载工具集中
      expect(runtime.hasTool("loadable")).toBe(true);
      expect(runtime.lazyToolSets.has("test_set")).toBe(true);
      expect(runtime.lazyToolSets.get("test_set")!.tools[0].name).toBe("loadable");

      // 测试 tool_load 按 toolSet 名称加载
      const request: ToolCallRequest = { id: "r1", name: "tool_load", arguments: { toolSet: "test_set" } };
      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toContain("test_set");
      expect(result.content).toContain("loadable");
    });

    it("should show parameters in tool_load output when tools have parameter definitions", async () => {
      // 模拟 subagent 风格的工具集：工具通过 inputSchema 注册，有实际参数
      const tools: ToolHandlerDef[] = [
        {
          name: "spawn", description: "创建一个子代理",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "子代理名称" },
              task: { type: "string", description: "任务描述" },
              provider: { type: "string", description: "供应商", enum: ["openai", "anthropic"] },
            },
            required: ["name", "task"],
          },
          handler: async () => "done", toolSet: "subagent",
        },
        {
          name: "close", description: "关闭子代理",
          parameters: {
            type: "object",
            properties: {
              sessionId: { type: "string", description: "会话 ID" },
            },
            required: ["sessionId"],
          },
          handler: async () => "done", toolSet: "subagent",
        },
      ];
      const plugin = createMockPluginBase("sub_agent", "SubAgent", tools);
      PluginRegistry.registerToolSet("sub_agent", {
        id: "subagent", name: "subagent", tools: ["spawn", "close"], loadMode: "lazy",
      });
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      const request: ToolCallRequest = { id: "r1", name: "tool_load", arguments: { toolSet: "subagent" } };
      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(false);
      // 工具名和描述应该显示
      expect(result.content).toContain("spawn");
      expect(result.content).toContain("创建一个子代理");
      expect(result.content).toContain("close");
      // 参数应该显示
      expect(result.content).toContain("子代理名称");
      expect(result.content).toContain("任务描述");
      expect(result.content).toContain("供应商");
      expect(result.content).toContain("会话 ID");
      // required 标记
      expect(result.content).toContain("必填");
    });
  });

  // ── tool_execute ──

  describe("executeTool", () => {
    it("should execute a tool and return result", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "hello", description: "Hello", parameters: { type: "object", properties: {} }, handler: async () => "Hello World" },
      ];
      const plugin = createMockPluginBase("exec_test", "Exec Test", tools);
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      const request: ToolCallRequest = { id: "r1", name: "hello", arguments: {} };
      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("Hello World");
    });

    it("should return error for unknown tool", async () => {
      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);
      const request: ToolCallRequest = { id: "r1", name: "unknown_tool", arguments: {} };

      await expect(orchestrator["executeTool"]("unknown_tool", {}, "r1", runtime, undefined))
        .rejects.toThrow("is not available or disabled");
    });

    it("should truncate long content", async () => {
      const longContent = "x".repeat(60000);
      const tools: ToolHandlerDef[] = [
        { name: "long_tool", description: "Long", parameters: { type: "object", properties: {} }, handler: async () => longContent },
      ];
      const plugin = createMockPluginBase("trunc_test", "Trunc Test", tools);
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      const request: ToolCallRequest = { id: "r1", name: "long_tool", arguments: {} };
      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content);
      expect(parsed.warning).toContain("truncated");
    });
  });

  // ── ExecuteBatch ──

  describe("executeBatch", () => {
    it("should execute multiple tools in batch", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "alpha", description: "Alpha", parameters: { type: "object", properties: {} }, handler: async () => "alpha result" },
        { name: "beta", description: "Beta", parameters: { type: "object", properties: {} }, handler: async () => "beta result" },
      ];
      const plugin = createMockPluginBase("batch_test", "Batch Test", tools);
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      const requests: ToolCallRequest[] = [
        { id: "r1", name: "alpha", arguments: {} },
        { id: "r2", name: "beta", arguments: {} },
      ];
      const results = await orchestrator.executeBatch(requests, runtime);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe("alpha result");
      expect(results[1].content).toBe("beta result");
    });
  });

  // ── tool_load with inputSchema (Zod path) ──

  describe("tool_load with inputSchema (Zod)", () => {
    it("should display parameters when tools registered via inputSchema", async () => {
      // 模拟 subagent 风格：通过 onLoad + api.registerTool({ inputSchema: z.object(...) })
      class ZodTestPlugin extends PluginBase {
        manifest = { id: "zod_test", name: "Zod Test", description: "test", version: "1.0.0", category: "core" as const };
        async onLoad(api: PluginApi) {
          api.registerToolSet({ name: "myset", loadMode: "lazy", activator: "test" });
          api.registerTool({
            name: "greet", toolSet: "myset",
            description: "向用户打招呼",
            inputSchema: z.object({
              name: z.string().describe("用户名称"),
              age: z.number().optional().describe("年龄"),
            }),
            execute: async (args) => "hello",
            display: { action: "打招呼", icon: "chat" },
          });
        }
      }

      const plugin = new ZodTestPlugin();
      await pluginManager.registerPlugin(plugin);

      const ctx: PluginContext = { sessionId: "s1", sessionType: "web", workspacePath: "/tmp" };
      const runtime = await orchestrator.buildToolRuntime(ctx, {} as any, undefined);

      // 验证工具在懒加载工具集中
      expect(runtime.lazyToolSets.has("myset")).toBe(true);
      expect(runtime.lazyToolSets.get("myset")!.tools[0].name).toBe("greet");

      // 验证 tool_load 输出包含参数
      const request: ToolCallRequest = { id: "r1", name: "tool_load", arguments: { toolSet: "myset" } };
      const result = await orchestrator["execute"](request, runtime, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toContain("greet");
      expect(result.content).toContain("向用户打招呼");
      expect(result.content).toContain("用户名称");
      expect(result.content).toContain("年龄");
    });
  });
});

// ── Helper ──

function createMockPluginBase(
  id: string,
  name: string,
  tools: ToolHandlerDef[] = [],
  extra?: Partial<import("../../src/modules/plugins/base-plugin").PluginBase>,
): import("../../src/modules/plugins/base-plugin").PluginBase {
  const manifest: import("../../src/modules/plugins/types/plugin.types").PluginManifest = {
    id, name, description: `${name} desc`, version: "1.0.0", category: "core",
  };
  if (!PluginRegistry.has(id)) {
    PluginRegistry.registerManifest(manifest);
  }
  const reg = (PluginRegistry as any).registrations.get(id);
  if (reg) {
    for (const t of tools) {
      if (!reg.tools.find((x: any) => x.name === t.name)) {
        reg.tools.push(t);
      }
    }
  }
  return {
    manifest,
    _enabled: true,
    ...extra,
  } as any;
}
