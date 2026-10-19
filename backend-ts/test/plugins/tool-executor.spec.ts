import { Test, TestingModule } from "@nestjs/testing";
import { ToolExecutor } from "../../src/modules/tools/tool-executor.service";
import { UniversalToolsPlugin } from "../../src/modules/tools/plugins/universal-tools.plugin";
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
import { NlsService } from "../../src/modules/plugins/i18n/nls.service";
import { EventBusService } from "../../src/common/events/event-bus.service";
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
    sessionType: "web",
    workspacePath: "/tmp",
    getSandboxMode: () => "workspace-write",
    setSandboxMode: jest.fn(),
    getPlanEnabled: jest.fn(() => false),
    setPlanEnabled: jest.fn(),
    getPlanModeEpoch: jest.fn(() => null),
    appendSessionModeChanged: jest.fn(),
    setToolScope: jest.fn(),
    getToolScope: () => null,
    getModelConfig: () => ({ id: "m1", modelName: "test", name: "Test", provider: { id: "p1", provider: "test", protocol: "openai" }, modelType: "chat", config: { temperature: 0.7, topP: 1, frequencyPenalty: 0 } }),
    supportsFeature: () => false,
    getThinkingEffort: () => undefined,
    getResolvedPlugins: jest.fn(() => []),
    getSettings: () => ({}),
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
    getTokenBreakdown: () => ({ systemPrompt: 0, history: 0, tools: 0 }),
    shouldCompress: jest.fn(),
    compress: jest.fn(),
  } as any;
}

describe("ToolExecutor", () => {
  let orchestrator: ToolExecutor;
  let pluginManager: PluginManager;

  beforeEach(async () => {
    // 重置 PluginRegistry 内部状态
    const reg = (PluginRegistry as any).registrations;
    if (reg) reg.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutor,
        PluginManager,
        { provide: SettingsStorage, useFactory: () => ({ getSettings: jest.fn().mockResolvedValue(true) }) },
        { provide: PromptCollector, useValue: { addPrompt: jest.fn() } },
        { provide: CommandProviderRegistry, useValue: { register: jest.fn() } },
        { provide: NlsService, useValue: { registerBundle: jest.fn(), resolveString: (_p: string, v: any) => v, resolveDisplay: (_p: string, d: any) => d } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        { provide: TokenizerService, useValue: { countTextTokens: jest.fn().mockResolvedValue(1), encode: jest.fn().mockResolvedValue([]), decode: jest.fn().mockResolvedValue("") } },
      ],
    }).compile();

    orchestrator = module.get<ToolExecutor>(ToolExecutor);
    pluginManager = module.get<PluginManager>(PluginManager);
  });

  // ── 计划模式门（协作状态的强制力） ──

  describe("plan mode gate", () => {
    /** 建一个含四种能力形态的工具集，并让会话返回决议后的插件列表 */
    async function setupPlanTools() {
      const tools: ToolHandlerDef[] = [
        { name: "ro_tool", description: "read only", parameters: { type: "object", properties: {} }, handler: async () => "ro", readOnly: true },
        { name: "write_tool", description: "writes", parameters: { type: "object", properties: {} }, handler: async () => "wrote" },
        { name: "escape_tool", description: "escape hatch", parameters: { type: "object", properties: {} }, handler: async () => "escaped", allowedInPlanMode: true },
        { name: "approval_tool", description: "needs human", parameters: { type: "object", properties: {} }, handler: async () => "asked", allowedInPlanMode: true, requiresUserInteraction: true },
      ];
      const plugin = createMockPluginBase("plan_gate_test", "Plan Gate Test", tools);
      await pluginManager.registerPlugin(plugin);

      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);
      return session;
    }

    it("非计划态：写类工具照常执行（门零开销跳过）", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(false);

      const result = await orchestrator.executeTool("write_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("wrote");
    });

    it("计划态：readOnly 工具放行", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);

      const result = await orchestrator.executeTool("ro_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("ro");
    });

    it("计划态：未标注工具硬拒（isError 且不改执行）", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);

      const result = await orchestrator.executeTool("write_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(true);
      expect(result.content).toContain("write_tool");
      expect(result.content).toContain("Plan mode is active");
    });

    it("计划态：allowedInPlanMode 逃生舱放行", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);

      const result = await orchestrator.executeTool("escape_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("escaped");
    });

    it("计划态 + 子会话：需要人类应答的逃生舱被拒（否则审批卡挂到子会话、卡死父回合）", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);
      (session as any).sessionType = "sub_agent";

      const result = await orchestrator.executeTool("approval_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(true);
      expect(result.content).toContain("sub-agent");
    });

    it("计划态 + 子会话：不需要人类应答的逃生舱仍放行（保住子代理的只读调研）", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);
      (session as any).sessionType = "sub_agent";

      const result = await orchestrator.executeTool("escape_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
      expect(result.content).toBe("escaped");
    });

    it("计划态 + 子会话：readOnly 工具照常放行", async () => {
      const session = await setupPlanTools();
      (session.getPlanEnabled as jest.Mock).mockReturnValue(true);
      (session as any).sessionType = "sub_agent";

      const result = await orchestrator.executeTool("ro_tool", {}, "r1", session, undefined);
      expect(result.isError).toBe(false);
    });
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
            display: { text: { executing: "打招呼", completed: "打招呼" }, icon: "chat" },
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

  // ── lazy 工具包执行门禁 ──

  describe("lazy toolkit execution gate", () => {
    class LazyKitPlugin extends PluginBase {
      manifest = { id: "lazy_gate", name: "Lazy Gate", description: "test", version: "1.0.0", category: "core" as const };
      async onLoad(api: PluginApi) {
        const tk = api.registerToolKit({
          id: "lazy_kit",
          name: "lazy_kit",
          loadMode: "lazy",
          activator: "test",
        });
        tk.registerTool({
          name: "lazy_echo",
          description: "回声",
          inputSchema: z.object({ text: z.string() }),
          execute: async (args: { text: string }) => `echo:${args.text}`,
        });
      }
    }

    /** 注册 lazy 工具包插件并让 session 返回决议结果 */
    async function setupLazySession(): Promise<ISessionContext> {
      await pluginManager.registerPlugin(new LazyKitPlugin());
      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);
      return session;
    }

    it("拒绝 LLM 直接调用 lazy 工具，并提示改用 tool_use", async () => {
      const session = await setupLazySession();
      await expect(
        orchestrator.executeTool("lazy_echo", { text: "hi" }, "c1", session, undefined),
      ).rejects.toThrow(/lazy-loaded tool[\s\S]*tool_use/);
    });

    it("经 tool_use 通道（allowLazy）可执行 lazy 工具", async () => {
      const session = await setupLazySession();
      const result = await orchestrator.executeTool(
        "lazy_echo",
        { text: "hi" },
        "c2",
        session,
        undefined,
        { allowLazy: true },
      );
      expect(result.isError).toBe(false);
      expect(result.content).toBe("echo:hi");
    });

    it("eager 工具在两条路径下均可执行（门禁不误伤）", async () => {
      const tools: ToolHandlerDef[] = [
        {
          name: "eager_echo",
          description: "Eager",
          parameters: { type: "object", properties: {} },
          handler: async () => "eager ok",
        },
      ];
      await pluginManager.registerPlugin(createMockPluginBase("eager_gate", "Eager Gate", tools));

      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);

      const direct = await orchestrator.executeTool("eager_echo", {}, "c3", session, undefined);
      expect(direct.isError).toBe(false);
      expect(direct.content).toBe("eager ok");

      const viaToolUse = await orchestrator.executeTool(
        "eager_echo",
        {},
        "c4",
        session,
        undefined,
        { allowLazy: true },
      );
      expect(viaToolUse.isError).toBe(false);
      expect(viaToolUse.content).toBe("eager ok");
    });
  });

  // ── loadMode=none 是真门禁 ──
  //
  // none 表示"压根不加载"：既不广告，也不可经 tool_use 触达、不可被 tool_learn 学出。

  describe("loadMode=none 是真门禁", () => {
    class NoneKitPlugin extends PluginBase {
      manifest = { id: "none_kit_owner", name: "None Kit Owner", description: "test", version: "1.0.0", category: "core" as const };
      async onLoad(api: PluginApi) {
        const tk = api.registerToolKit({
          id: "none_kit",
          name: "none_kit",
          loadMode: "none",
        });
        tk.registerTool({
          name: "none_echo",
          description: "不应可达",
          inputSchema: z.object({ text: z.string().optional() }),
          execute: async () => "SHOULD NOT REACH",
        });
      }
    }

    async function setupNoneSession(): Promise<ISessionContext> {
      await pluginManager.registerPlugin(new NoneKitPlugin());
      const session = createMockSessionContext();
      const resolved = await pluginManager.resolvePlugins(session);
      (session.getResolvedPlugins as jest.Mock).mockReturnValue(resolved);
      return session;
    }

    it("不进 tools 数组，也不可经 tool_use 调用", async () => {
      const session = await setupNoneSession();
      const resolved = session.getResolvedPlugins();

      expect(
        ToolExecutor.toFlatToolDefs(resolved).map((t) => t.name),
      ).not.toContain("none_echo");
      expect(
        ToolExecutor.findTool(resolved, "none_echo", true),
      ).toBeUndefined();

      await expect(
        orchestrator.executeTool(
          "none_echo",
          {},
          "c1",
          session,
          undefined,
          { allowLazy: true },
        ),
      ).rejects.toThrow(/not available or disabled/);
    });

    it("tool_learn 学不出来", async () => {
      const session = await setupNoneSession();

      const ut = new UniversalToolsPlugin(orchestrator, pluginManager, {
        collectLazyPrompts: async () => [],
      } as any);
      await pluginManager.registerPlugin(ut);

      const lazyKit = PluginRegistry.getToolKits("universal_tools").find(
        (k) => k.def.id === "lazy_tools",
      )!;
      const learn = lazyKit.tools.find((t) => t.name === "tool_learn")!;
      const out = await learn.handler(
        { name: "none_kit" },
        { session, toolCallId: "t1" } as any,
      );

      expect(String(out)).toMatch(/unknown toolkit/);
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
