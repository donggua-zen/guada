import { PluginApiImpl } from "./plugin-api";
import { PluginRegistry } from "../registry/plugin-registry";
import { PLUGIN_API_VERSION } from "../types/plugin.types";

describe("PluginApi v2 contract", () => {
  const id = "contract-plugin";

  afterEach(() => {
    PluginRegistry.clearPlugin(id);
  });

  it("reports the host api version", () => {
    const api = new PluginApiImpl(id, "Contract");
    expect(api.getApiVersion()).toBe(PLUGIN_API_VERSION);
  });

  it("rejects reserved and duplicate prompt sections", () => {
    const api = new PluginApiImpl(id, "Contract");
    expect(() =>
      api.registerPromptSection({ name: "builtin.agent-system", text: "x" }),
    ).toThrow(/reserved/);

    api.registerPromptSection({ name: `${id}.persona`, text: "x" });
    expect(() =>
      api.registerPromptSection({ name: `${id}.persona`, text: "y" }),
    ).toThrow(/already registered/);
  });

  it("rejects invalid local command names", () => {
    const api = new PluginApiImpl(id, "Contract");
    expect(() =>
      api.registerLocalCommand({
        name: "Bad Name",
        description: "",
        handler: () => ({}),
      }),
    ).toThrow(/must match/);
  });

  it("rejects hook events outside the whitelist", () => {
    const api = new PluginApiImpl(id, "Contract");
    expect(() =>
      api.registerHook({ event: "tools/pre-execute" as any, handler: () => undefined }),
    ).toThrow(/not open/);
  });

  it("requires a configured data dir", () => {
    const api = new PluginApiImpl(id, "Contract");
    expect(() => api.getDataDir()).toThrow(/not configured/);
  });

  it("flushes sections and local commands to their registries", () => {
    const registered: any[] = [];
    const api = new PluginApiImpl(
      id,
      "Contract",
      undefined,
      undefined,
      "user",
      undefined,
      { pluginDir: "/tmp/plugin", dataDir: "/tmp/data" },
      {
        register: (name, handler, meta) => registered.push({ name, handler, meta }),
      },
      { register: () => undefined },
    );

    api.registerPromptSection({ name: `${id}.rules`, text: "RULES" });
    api.registerLocalCommand({
      name: "demo-status",
      description: "status",
      handler: () => ({ text: "ok" }),
    });
    api.flush();

    expect(PluginRegistry.getPromptSections(id).map((s) => s.name)).toContain(
      `${id}.rules`,
    );
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("demo-status");
    expect(registered[0].meta.pluginId).toBe(id);
  });
});
