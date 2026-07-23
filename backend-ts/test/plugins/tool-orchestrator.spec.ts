import { Test, TestingModule } from "@nestjs/testing";
import { ToolOrchestrator } from "../../src/modules/tools/tool-orchestrator.service";
import { PluginManager } from "../../src/modules/plugins/plugin.manager";
import { SettingsStorage } from "../../src/common/utils/settings-storage.util";
import { PluginRegistry } from "../../src/modules/plugins/registry/plugin-registry";
import { ToolCallRequest } from "../../src/modules/tools/interfaces/tool-provider.interface";
import { PluginContext, ToolHandlerDef, ToolKitRegistration } from "../../src/modules/plugins/types/plugin.types";
import { PluginBase } from "../../src/modules/plugins/base-plugin";
import { PluginApi } from "../../src/modules/plugins/api/plugin-api";
import { ISessionContext } from "../../src/modules/chat/session-context";
import { TokenizerService } from "../../src/common/utils/tokenizer.service";
import { PromptCollector } from "../../src/modules/plugins/prompt-collector.service";
import { CommandProviderRegistry } from "../../src/modules/commands/command-provider-registry.service";
import { z } from "zod";

// ── Mock SettingsStorage ──

jest.mock("../../src/common/utils/settings-storage.util", () => ({
  SettingsStorage: jest.fn().mockImplementation(() => ({
    getSettings: jest.fn().mockResolvedValue(true),
  })),
}));

// ── Helper: create a mock ISessionContext ──

function createMockSessionContext(): ISessionContext {
  return {
    sessionId: "s1",
    userId: "u1",
    sessionType: "web",
    workspacePath: "/tmp",
    getRunMode: () => "normal",
    setRunMode: jest.fn(),
    getModelConfig: () => ({ id: "m1", modelName: "test", name: "Test", provider: { id: "p1", provider: "test", protocol: "openai" }, modelType: "chat", config: { temperature: 0.7, topP: 1, frequencyPenalty: 0 } }),
    supportsFeature: () => false,
    getThinkingEffort: () => undefined,
    getResolvedPlugins: jest.fn(() => []),
    getSettings: () => ({}),
    getToolApprovalConfig: () => ({ enabled: false, requiresApproval: [] }),
    getMemoryConfig: () => ({}),
    getEffectiveContextWindow: () => 4096,
    getWorkspacePath: () => "/tmp",
    setMessageCursor: jest.fn(),
    initialize: jest.fn(),
    getMessages: jest.fn(),
    getHistory: jest.fn(),
    appendParts: jest.fn(),
    persist: jest.fn(),
    addUserMessage: jest.fn(),
    addAssistantMessageVersion: jest.fn(),
    generateId: () => "id-" + Math.random().toString(36),
    getTokenCount: () => 0,
    getTokenBreakdown: () => ({ system: 0, summary: 0, user: 0, history: 0, tools: 0, total: 0 }),
    shouldCompress: jest.fn(),
    compress: jest.fn(),
  } as any;
}

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
        { provide: PromptCollector, useValue: { addPrompt: jest.fn() } },
        { provide: CommandProviderRegistry, useValue: { register: jest.fn() } },
        { provide: TokenizerService, useValue: { countTextTokens: jest.fn().mockResolvedValue(1), encode: jest.fn().mockResolvedValue([]), decode: jest.fn().mockResolvedValue("") } },
      ],
    }).compile();

    orchestrator = module.get<ToolOrchestrator>(ToolOrchestrator);
    pluginManager = module.get<PluginManager>(PluginManager);
  });

  // ── resolvePlugins + executeTool ──

  describe("executeTool", () => {
    it("should execute a tool and return result", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "hello", description: "Hello", parameters: { type: "object", properties: {} }, handler: async () => "Hello World" },
      ];
      const plugin = createMockPluginBase("exec_test", "Exec Test", tools);
      await pluginManager.registerPlugin(plugin);

      const session = createMockSessionContext();
      // Resolve plugins so the session context returns the resolved list
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);

      const result = await orchestrator.executeTool("hello", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("Hello World");
    });

    it("should return error for unknown tool", async () => {
      const session = createMockSessionContext();
      (session.getResolvedPlugins as jest.Mock).mockReturnValue([]);

      await expect(
        orchestrator.executeTool("unknown_tool", {}, "r1", session, undefined),
      ).rejects.toThrow("is not available or disabled");
    });
  });

  // ── executeBatch ──

  describe("executeBatch", () => {
    it("should execute multiple tools in batch", async () => {
      const tools: ToolHandlerDef[] = [
        { name: "alpha", description: "Alpha", parameters: { type: "object", properties: {} }, handler: async () => "alpha result" },
        { name: "beta", description: "Beta", parameters: { type: "object", properties: {} }, handler: async () => "beta result" },
      ];
      const plugin = createMockPluginBase("batch_test", "Batch Test", tools);
      await pluginManager.registerPlugin(plugin);

      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);

      const requests: ToolCallRequest[] = [
        { id: "r1", name: "alpha", arguments: {} },
        { id: "r2", name: "beta", arguments: {} },
      ];
      const results = await orchestrator.executeBatch(requests, session);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe("alpha result");
      expect(results[1].content).toBe("beta result");
    });
  });

  // ── tool_load with inputSchema (Zod path) ──

  describe("tool_load with inputSchema (Zod)", () => {
    it("should display parameters when tools registered via inputSchema", async () => {
      class ZodTestPlugin extends PluginBase {
        manifest = { id: "zod_test", name: "Zod Test", description: "test", version: "1.0.0", category: "core" as const };
        async onLoad(api: PluginApi) {
          api.registerToolKit({ id: "myset", name: "myset", loadMode: "lazy", activator: "test" });
          const tk = api.registerToolKit({ id: "myset2", name: "myset2", loadMode: "lazy" });
          tk.registerTool({
            name: "greet", description: "向用户打招呼",
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

      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);

      // Verify the tool was registered with the toolkit
      const allToolKits = PluginRegistry.getAllToolKits();
      const zodKit = allToolKits.find((k) => k.kit.def.id === "myset2");
      expect(zodKit).toBeDefined();
      expect(zodKit!.kit.tools[0].name).toBe("greet");
    });
  });
});

// ── Helper ──

function createMockPluginBase(
  id: string,
  name: string,
  tools: ToolHandlerDef[] = [],
  extra?: Partial<PluginBase>,
): PluginBase {
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
