import { PluginApiImpl } from "./api/plugin-api";
import { PluginRegistry } from "./registry/plugin-registry";
import { PromptCollector } from "./prompt-collector.service";
import { PromptAssembler } from "./prompt-assembler.service";

const PLUGIN_ID = "test-plugin";

function resolved(pluginId = PLUGIN_ID): any {
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
      enabledToolKits: [],
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
    assembler = new PromptAssembler(new PromptCollector());
    api = new PluginApiImpl(PLUGIN_ID, "Test");
  });

  afterEach(() => {
    PluginRegistry.clearPlugin(PLUGIN_ID);
  });

  it("orders builtin, named and legacy sections", async () => {
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
      "test-plugin.legacy-prompt.0",
    ]);
    expect(out.systemText).toBe("PERSONA\n\nBASE\n\nLEGACY");
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
