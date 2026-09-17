import { PluginManager } from "./plugin.manager";
import { PluginRegistry } from "./registry/plugin-registry";
import type { ResolvedPluginInfo } from "./types/plugin.types";

/**
 * resolvePlugins V3 决议逻辑测试
 *
 * 两层开关语义：
 * - 全局层：仅控制插件级启停
 * - 智能体层：仅裁剪工具包（能力包），不消费 entry.enabled
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
    kits: Array<{
      id: string;
      loadMode?: "eager" | "lazy";
      tool?: string;
      governance?: "self";
      handler?: (ctx: any) => any;
    }>,
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
        def: {
          id: k.id,
          name: k.id,
          loadMode: k.loadMode ?? "eager",
          ...(k.governance ? { governance: k.governance } : {}),
          ...(k.handler ? { handler: k.handler } : {}),
        },
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

  it("智能体层黑名单：toolkits_deny 裁剪单个工具包，不影响插件启停", async () => {
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
    expect(p.enabled).toBe(true); // 插件本身不被智能体层禁用
    const ka = p.enabledToolKits.find((k) => k.id === "ka")!;
    const kb = p.enabledToolKits.find((k) => k.id === "kb")!;
    expect(ka.enabled).toBe(false);
    expect(kb.enabled).toBe(true);
    // eager 工具包的工具被裁剪
    expect(p.enabledTools.map((t) => t.name)).not.toContain("a_tool");
  });

  it("智能体层白名单：__default=false + filter=allow 仅放行列出的工具包", async () => {
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

  it("智能体层不能禁用插件，全局层不受智能体 toolkit 配置影响", async () => {
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

  it("全局层启用插件：enabled=true 可启用默认禁用的 extended 插件（回归）", async () => {
    registerPlugin("t_on", "extended", [{ id: "ok", tool: "o_tool" }]);

    // 默认关闭
    const before = await manager.resolvePlugins(undefined, {}, true);
    expect(find(before, "t_on").enabled).toBe(false);

    // 全局显式启用 → 决议生效且标记为全局层决策
    settingsStorage.getSettings.mockResolvedValue({
      t_on: { enabled: true },
    });
    const after = await manager.resolvePlugins(undefined, {}, true);
    const p = find(after, "t_on");
    expect(p.enabled).toBe(true);
    expect(p.effective).toBe("global");
    expect(p.enabledTools.map((t) => t.name)).toContain("o_tool");
  });

  it("二级过滤：全局禁用插件的工具包在智能体层 allow 下仍不生效", async () => {
    registerPlugin("t_off", "extended", [{ id: "ck", tool: "c_tool" }]);

    settingsStorage.getSettings.mockResolvedValue({
      t_off: { enabled: false },
    });
    const res = await manager.resolvePlugins(
      undefined,
      { t_off: { toolkits_filter: "allow", toolkits_allow: ["ck"] } } as any,
      true,
    );
    const p = find(res, "t_off");
    expect(p.enabled).toBe(false);
    // 即使智能体层显式放行，全局关闭的插件工具包仍不可用
    expect(p.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    expect(p.enabledTools).toHaveLength(0);
  });

  it("智能体层条目中的遗留 enabled 字段被忽略，仅 toolkits_* 生效", async () => {
    registerPlugin("t_legacy2", "core", [
      { id: "la", tool: "a2_tool" },
      { id: "lb", tool: "b2_tool" },
    ]);

    // 旧智能体数据混入 enabled:false（应被忽略），同时显式 deny 一个工具包
    const res = await manager.resolvePlugins(
      undefined,
      { t_legacy2: { enabled: false, toolkits_deny: ["la"] } } as any,
      true,
    );
    const p = find(res, "t_legacy2");
    expect(p.enabled).toBe(true); // enabled 被忽略，插件不被禁用
    expect(p.enabledToolKits.find((k) => k.id === "la")!.enabled).toBe(false);
    expect(p.enabledToolKits.find((k) => k.id === "lb")!.enabled).toBe(true);
  });

  // ── toolkits_filter: "deny_all"（全部禁用）──
  //
  // "关掉整个能力包但不改配置"：压过两个列表，列表原样保留供解除时恢复。
  // 与 __strategy: "deny_nonsystem" 的区别：后者是跨插件的批量姿态，前者是单插件条目。

  it("deny_all：该插件的全部工具包被拒，且插件本身不被禁用", async () => {
    registerPlugin("t_deny_all", "core", [
      { id: "da1", tool: "da1_tool" },
      { id: "da2", tool: "da2_tool" },
    ]);

    const res = await manager.resolvePlugins(
      undefined,
      {
        t_deny_all: { toolkits_filter: "deny_all", toolkits_allow: ["da1"] },
      } as any,
      true,
    );
    const p = find(res, "t_deny_all");
    expect(p.enabled).toBe(true);
    // 记住的允许列表被压过：da1 也被拒
    expect(p.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    expect(p.enabledTools).toHaveLength(0);
  });

  it("deny_all 只作用于该插件，不影响其它插件的条目", async () => {
    registerPlugin("t_da_on", "core", [{ id: "on_k", tool: "on_tool" }]);
    registerPlugin("t_da_off", "core", [{ id: "off_k", tool: "off_tool" }]);

    const res = await manager.resolvePlugins(
      undefined,
      { t_da_off: { toolkits_filter: "deny_all" } } as any,
      true,
    );
    expect(find(res, "t_da_on").enabledToolKits[0].enabled).toBe(true);
    expect(find(res, "t_da_off").enabledToolKits[0].enabled).toBe(false);
  });

  // ── 自治理工具包（governance: "self"）──
  // 语义：不参与智能体层过滤（__strategy / __default / 显式 deny 均无效），
  // 由自己的 handler 依据 pluginsConfig 决定 loadMode。
  // handler 只在 !denied 时被调用，所以"永不被 denied"是自治理成立的前提。

  const fakeSession = {
    sessionId: "s1",
    sessionType: "web",
    getSettings: () => ({}),
  } as any;

  it("自治理工具包在 deny_nonsystem 下不被拒绝，且 handler 被调用并由其裁决", async () => {
    const handler = jest.fn(async () => ({ loadMode: "none" as const }));
    registerPlugin("t_self_dn", "system", [
      { id: "self_k", tool: "self_tool", governance: "self", handler },
    ]);
    // 同一插件再放一个普通工具包作为对照
    PluginRegistry.registerToolKit("t_self_dn", {
      def: { id: "plain_k", name: "plain_k", loadMode: "eager" },
      tools: [
        {
          name: "plain_tool",
          description: "",
          parameters: { type: "object", properties: {} },
          handler: async () => ({ content: "" }),
          toolSet: "plain_k",
        },
      ],
      prompts: [],
    } as any);

    const res = await manager.resolvePlugins(
      fakeSession,
      { __strategy: "deny_nonsystem" } as any,
      false,
    );
    const p = find(res, "t_self_dn");
    const selfKit = p.enabledToolKits.find((k) => k.id === "self_k")!;
    const plainKit = p.enabledToolKits.find((k) => k.id === "plain_k")!;

    // 自治理：不被批量开关扫，handler 执行，loadMode 由 handler 决定
    expect(selfKit.enabled).toBe(true);
    expect(handler).toHaveBeenCalled();
    expect(selfKit.loadMode).toBe("none");
    expect(p.enabledTools.map((t) => t.name)).not.toContain("self_tool");

    // 对照：普通工具包照旧被 deny_nonsystem 全拒
    expect(plainKit.enabled).toBe(false);
    expect(p.enabledTools.map((t) => t.name)).not.toContain("plain_tool");
  });

  it("自治理工具包不受 __default:false 与显式 deny 影响", async () => {
    const handler = jest.fn(async () => ({ loadMode: "eager" as const }));
    registerPlugin("t_self_wl", "core", [
      { id: "s2", tool: "s2_tool", governance: "self", handler },
    ]);

    const res = await manager.resolvePlugins(
      fakeSession,
      { __default: false, t_self_wl: { toolkits_deny: ["s2"] } } as any,
      false,
    );
    const kit = find(res, "t_self_wl").enabledToolKits.find(
      (k) => k.id === "s2",
    )!;
    expect(kit.enabled).toBe(true);
    expect(kit.loadMode).toBe("eager");
    expect(handler).toHaveBeenCalled();
    expect(find(res, "t_self_wl").enabledTools.map((t) => t.name)).toContain(
      "s2_tool",
    );
  });

  it("handler 收到 pluginsConfig（智能体配置透传）", async () => {
    const handler = jest.fn(async () => ({ loadMode: "eager" as const }));
    registerPlugin("t_self_cfg", "core", [
      { id: "s3", tool: "s3_tool", governance: "self", handler },
    ]);

    const roleCfg = { t_self_cfg: { toolkits_deny: ["nope"] } } as any;
    await manager.resolvePlugins(fakeSession, roleCfg, false);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ pluginsConfig: roleCfg }),
    );
  });

  it("未声明 self 的工具包行为不变：仍被 deny_nonsystem 裁剪", async () => {
    registerPlugin("t_plain_reg", "core", [
      { id: "plain_reg_k", tool: "plain_reg_tool" },
    ]);

    const res = await manager.resolvePlugins(
      fakeSession,
      { __strategy: "deny_nonsystem" } as any,
      true,
    );
    const p = find(res, "t_plain_reg");
    expect(p.enabledToolKits.every((k) => !k.enabled)).toBe(true);
    expect(p.enabledTools).toHaveLength(0);
  });
});
