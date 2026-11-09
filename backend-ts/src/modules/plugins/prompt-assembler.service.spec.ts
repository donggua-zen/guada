import { PluginApiImpl } from "./api/plugin-api";
import { PluginRegistry } from "./registry/plugin-registry";
import { PromptCollector } from "./prompt-collector.service";
import { PromptAssembler } from "./prompt-assembler.service";

const PLUGIN_ID = "test-plugin";

function resolved(
  pluginId = PLUGIN_ID,
  toolKits: Array<{ id: string; loadMode?: string; enabled?: boolean }> = [],
): any {
  return [
    {
      enabled: true,
      effective: "default",
      plugin: {
        id: pluginId,
        name: "Test",
        version: "1.0.0",
        description: "",
        category: "user",
      },
      enabledTools: [],
      allTools: [],
      enabledToolKits: toolKits.map((kit) => ({
        id: kit.id,
        name: kit.id,
        description: "",
        loadMode: kit.loadMode || "eager",
        enabled: kit.enabled !== false,
        toolCount: 0,
        promptCount: 0,
      })),
      workspaceProviders: [],
      attachmentTypes: [],
      uiPages: [],
    },
  ];
}

function context(): any {
  return { session: { agentId: "agent-1", sessionId: "session-1" } };
}

describe("PromptAssembler", () => {
  let assembler: PromptAssembler;
  let api: PluginApiImpl;

  beforeEach(() => {
    assembler = new PromptAssembler();
    api = new PluginApiImpl(PLUGIN_ID, "Test");
  });

  afterEach(() => {
    PluginRegistry.clearPlugin(PLUGIN_ID);
  });

  it("treats registerPrompt as a named section (v3 sugar)", async () => {
    api.registerPromptSection({
      name: "test-plugin.persona",
      order: -100,
      text: "PERSONA",
    });
    api.registerPrompt({ content: "LEGACY", frequency: "REGULAR" });
    api.flush();

    const out = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });

    expect(out.sections.map((s) => s.name)).toEqual([
      "test-plugin.persona",
      "builtin.agent-system",
      "test-plugin.prompt.0",
    ]);
    expect(out.systemText).toBe("PERSONA\n\nBASE\n\nLEGACY");
  });

  it("keeps STATIC → REGULAR → VOLATILE ordering for registerPrompt", async () => {
    api.registerPrompt({ content: "VOLATILE", frequency: "VOLATILE" });
    api.registerPrompt({ content: "STATIC", frequency: "STATIC" });
    api.registerPrompt({ content: "REGULAR", frequency: "REGULAR" });
    api.flush();

    const out = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });
    expect(out.sections.map((s) => s.text)).toEqual(["BASE", "STATIC", "REGULAR", "VOLATILE"]);
  });

  it("gives every registerPrompt call a distinct stable name", async () => {
    api.registerPrompt({ content: "A" });
    api.registerPrompt({ content: "B" });
    api.flush();

    const names = PluginRegistry.getPromptSections(PLUGIN_ID).map((s) => s.name);
    expect(names).toEqual(["test-plugin.prompt.0", "test-plugin.prompt.1"]);
  });

  it("turns toolkit prompts into sections and keeps lazy kits out of the system prompt", async () => {
    const tk = api.registerToolKit({ id: "demo-kit", name: "Demo" } as any);
    tk.registerPrompt({ content: "KIT-EAGER", frequency: "REGULAR" });
    api.flush();

    // eager 工具包：段进系统提示词
    const eager = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(PLUGIN_ID, [{ id: "demo-kit", loadMode: "eager" }]),
      context: context(),
    });
    expect(eager.sections.map((s) => s.name)).toContain("test-plugin.toolkit.demo-kit.0");
    expect(eager.systemText).toContain("KIT-EAGER");

    // lazy 工具包：同一条段被装配器跳过（运行时由 collectLazyPrompts 注入）
    const lazy = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(PLUGIN_ID, [{ id: "demo-kit", loadMode: "lazy" }]),
      context: context(),
    });
    expect(lazy.systemText).not.toContain("KIT-EAGER");

    // none（依赖缺失）：同样跳过
    const none = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(PLUGIN_ID, [{ id: "demo-kit", loadMode: "none" }]),
      context: context(),
    });
    expect(none.systemText).not.toContain("KIT-EAGER");
  });

  it("drops toolkit sections entirely when the plugin resolves no kits", async () => {
    const tk = api.registerToolKit({ id: "demo-kit", name: "Demo" } as any);
    tk.registerPrompt({ content: "KIT-EAGER" });
    api.flush();

    const out = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });
    expect(out.systemText).not.toContain("KIT-EAGER");
  });

  it("keeps lazy prompts reachable through the collector", async () => {
    const tk = api.registerToolKit({
      id: "demo-kit",
      name: "Demo",
      loadMode: "lazy",
    } as any);
    tk.registerPrompt({ content: "KIT-LAZY" });
    api.flush();

    const pieces = await new PromptCollector().collectLazyPrompts(
      resolved(PLUGIN_ID, [{ id: "demo-kit", loadMode: "lazy" }]),
      context(),
    );
    expect(pieces.map((p) => p.content)).toEqual(["KIT-LAZY"]);
  });

  it("skips empty dynamic sections", async () => {
    api.registerPromptSection({
      name: "test-plugin.dynamic",
      text: () => "",
    });
    api.flush();

    const out = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });
    expect(out.sections.map((s) => s.name)).toEqual(["builtin.agent-system"]);
  });

  it("runs transforms in order", async () => {
    api.registerPromptTransform({
      id: "append",
      order: 1,
      transform: (assembly) => ({
        sections: assembly.sections,
        systemText: `${assembly.systemText}\nTRANSFORMED`,
      }),
    });
    api.flush();

    const out = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });
    expect(out.systemText).toContain("TRANSFORMED");
  });

  it("ignores transforms that remove builtin sections unless allowed", async () => {
    api.registerPromptTransform({
      id: "drop-builtin",
      transform: (assembly) => ({
        sections: assembly.sections.filter((s) => !s.name.startsWith("builtin.")),
        systemText: "ONLY_PLUGIN",
      }),
    });
    api.flush();

    const blocked = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
    });
    expect(blocked.systemText).toContain("BASE");

    const allowed = await assembler.assemble({
      basePrompt: "BASE",
      resolvedPlugins: resolved(),
      context: context(),
      allowBuiltinRewrite: true,
    });
    expect(allowed.systemText).toBe("ONLY_PLUGIN");
  });
});
