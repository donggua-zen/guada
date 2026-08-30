import { PluginManager } from "./plugin.manager";
import { PluginRegistry } from "./registry/plugin-registry";
import type { ResolvedPluginInfo } from "./types/plugin.types";

/**
 * resolvePlugins V3 决议逻辑测试
 *
 * 两层开关语义：
 * - 全局层：仅控制插件级启停
 * - 角色层：仅裁剪工具包（能力包），不消费 entry.enabled
 */

describe("PluginManager.resolvePlugins (V3 工具包粒度)", () => {
  let settingsStorage: { getSettings: jest.Mock; updateSettings: jest.Mock };
  let manager: PluginManager;
  const createdIds: string[] = [];

  beforeAll(() => {
    settingsStorage = {
      getSettings: jest.fn().mockResolvedValue({}),
      updateSettings: jest.fn().mockResolvedValue(undefined),
    };
    manager = new PluginManager(
      settingsStorage as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
    );
  });

  afterEach(() => {
    for (const id of createdIds.splice(0)) {
      PluginRegistry.clearPlugin(id);
      (manager as any).instances.delete(id);
    }
    settingsStorage.getSettings.mockResolvedValue({});
  });

  /** 注册一个测试插件（manifest + 工具包 + 实例） */
  function registerPlugin(
    id: string,
    category: "system" | "core" | "extended",
    kits: Array<{ id: string; loadMode?: "eager" | "lazy"; tool?: string }>,
    opts: { essential?: boolean } = {},
  ) {
    const manifest: any = {
      id,
      name: id,
      version: "1.0.0",
      description: "",
      category,
    };
    if (opts.essential) manifest.essential = true;
    PluginRegistry.registerManifest(manifest);
    for (const k of kits) {
      PluginRegistry.registerToolKit(id, {
        def: { id: k.id, name: k.id, loadMode: k.loadMode ?? "eager" },
        tools: [
          {
            name: k.tool ?? `${k.id}_tool`,
            description: "",
            parameters: { type: "object", properties: {} },
            handler: async () => ({ content: "" }),
            toolSet: k.id,
          },
        ],
        prompts: [],
      } as any);
    }
    (manager as any).instances.set(id, {
      plugin: { manifest },
      manifest,
      enabled: true,
    });
    createdIds.push(id);
  }

  function find(res: ResolvedPluginInfo[], id: string) {
    return res.find((r) => r.plugin.id === id)!;
  }

  it("默认状态：core 启用、extended 禁用，工具包完整列出", async () => {
    registerPlugin("t_core", "core", [{ id: "k1", tool: "k1_tool" }]);
    registerPlugin("t_ext", "extended", [{ id: "k2", tool: "k2_tool" }]);

    const res = await manager.resolvePlugins(undefined, {}, true);
    const core = find(res, "t_core");
    expect(core.enabled).toBe(true);
    expect(core.effective).toBe("default");
    expect(core.enabledTools.map((t) => t.name)).toContain("k1_tool");

    const ext = find(res, "t_ext");
    expect(ext.enabled).toBe(false);
    expect(ext.enabledTools).toHaveLength(0);
    // 工具包仍完整列出并标记禁用
    expect(ext.enabledToolKits).toHaveLength(1);
    expect(ext.enabledToolKits[0].enabled).toBe(false);
  });

  it("全局层禁用插件：enabled=false 且 effective=global", async () => {
    registerPlugin("t_g", "core", [{ id: "gk", tool: "g_tool" }]);
    settingsStorage.getSettings.mockResolvedValue({
      t_g: { enabled: false },
    });

    const res = await manager.resolvePlugins(undefined, {}, true);
    const p = find(res, "t_g");
    expect(p.enabled).toBe(false);
    expect(p.effective).toBe("global");
    expect(p.enabledToolKits.every((k) => !k.enabled)).toBe(true);
  });

  it("角色层黑名单：toolkits_deny 裁剪单个工具包，不影响插件启停", async () => {
    registerPlugin("t_deny", "core", [
      { id: "ka", tool: "a_tool" },
      { id: "kb", tool: "b_tool", loadMode: "lazy" },
    ]);

    const res = await manager.resolvePlugins(
      undefined,
      { t_deny: { toolkits_deny: ["ka"] } } as any,
      true,
    );
    const p = find(res, "t_deny");
    expect(p.enabled).toBe(true); // 插件本身不被角色层禁用
    const ka = p.enabledToolKits.find((k) => k.id === "ka")!;
    const kb = p.enabledToolKits.find((k) => k.id === "kb")!;
    expect(ka.enabled).toBe(false);
    expect(kb.enabled).toBe(true);
    // eager 工具包的工具被裁剪
    expect(p.enabledTools.map((t) => t.name)).not.toContain("a_tool");
  });

  it("角色层白名单：__default=false + filter=allow 仅放行列出的工具包", async () => {
    registerPlugin("t_allow", "core", [
      { id: "ka", tool: "a_tool" },
      { id: "kb", tool: "b_tool" },
    ]);
    registerPlugin("t_allow2", "core", [{ id: "kc", tool: "c_tool" }]);

    const res = await manager.resolvePlugins(
      undefined,
      {
        __default: false,
        t_allow: { toolkits_filter: "allow", toolkits_allow: ["kb"] },
        // t_allow2 未显式配置 → 白名单下全部拒绝
      } as any,
      true,
    );
    const p1 = find(res, "t_allow");
    expect(p1.enabledToolKits.find((k) => k.id === "ka")!.enabled).toBe(false);
    expect(p1.enabledToolKits.find((k) => k.id === "kb")!.enabled).toBe(true);

    const p2 = find(res, "t_allow2");
    expect(p2.enabledToolKits.every((k) => !k.enabled)).toBe(true);
  });

  it("__strategy=deny_nonsystem 拒绝所有非 essential 插件的能力包", async () => {
    registerPlugin("t_dn_core", "core", [{ id: "dk", tool: "d_tool" }]);
    registerPlugin("t_dn_sys", "system", [{ id: "sk", tool: "s_tool" }]);
    registerPlugin("t_dn_ess", "core", [{ id: "ek", tool: "e_tool" }], {
      essential: true,
    });

    const res = await manager.resolvePlugins(
      undefined,
      { __strategy: "deny_nonsystem" } as any,
      true,
    );
    // 非 essential 插件的工具包被拒绝（含 system 分类的 mcp/skill/sub_agent 场景）
    expect(find(res, "t_dn_core").enabledToolKits.every((k) => !k.enabled)).toBe(true);
    expect(find(res, "t_dn_sys").enabledToolKits.every((k) => !k.enabled)).toBe(true);
    // essential 插件的工具包不可裁剪
    expect(find(res, "t_dn_ess").enabledToolKits.every((k) => k.enabled)).toBe(true);
  });

  it("旧格式条目（仅含 enabled 字段）被忽略，不再影响任何行为", async () => {
    registerPlugin("t_legacy", "core", [{ id: "lk", tool: "l_tool" }]);

    const roleCfg = {
      __strategy: "custom",
      t_legacy: { enabled: false }, // 旧版插件级开关
    };
    const snapshot = JSON.parse(JSON.stringify(roleCfg));

    const res = await manager.resolvePlugins(undefined, roleCfg as any, true);
    const p = find(res, "t_legacy");
    expect(p.enabled).toBe(true);
    expect(p.enabledToolKits[0].enabled).toBe(true);
    expect(p.enabledTools.map((t) => t.name)).toContain("l_tool");
    // 输入对象未被变异
    expect(roleCfg).toEqual(snapshot);
  });

  it("角色层不能禁用插件，全局层不受角色 toolkit 配置影响", async () => {
    registerPlugin("t_sep", "core", [{ id: "sep_k", tool: "sep_tool" }]);

    const res = await manager.resolvePlugins(
      undefined,
      { t_sep: { toolkits_deny: ["sep_k"] } } as any,
      true,
    );
    expect(find(res, "t_sep").enabled).toBe(true);

    settingsStorage.getSettings.mockResolvedValue({
      t_sep: { enabled: true },
    });
    const res2 = await manager.resolvePlugins(
      undefined,
      { t_sep: { toolkits_deny: ["sep_k"] } } as any,
      true,
    );
    expect(find(res2, "t_sep").enabled).toBe(true);
    expect(
      find(res2, "t_sep").enabledToolKits.find((k) => k.id === "sep_k")!
        .enabled,
    ).toBe(false);
  });

  it("lazy 工具包被裁剪后不进入激活词列表", async () => {
    registerPlugin("t_lazy", "core", [
      { id: "lazy_a", loadMode: "lazy", tool: "lazy_a_tool" },
      { id: "lazy_b", loadMode: "lazy", tool: "lazy_b_tool" },
    ]);

    const res = await manager.resolvePlugins(
      undefined,
      { t_lazy: { toolkits_deny: ["lazy_a"] } } as any,
      true,
    );
    const activators = await manager.getToolActivators(res);
    const names = activators.map((a) => a.name);
    expect(names).toContain("lazy_b");
    expect(names).not.toContain("lazy_a");
  });
});
