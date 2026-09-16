import { describe, it, expect } from "vitest";
import {
  buildPluginConfig,
  effectiveKitEnabled,
  parseAllAgentsDisabled,
  parseAllSkillsDisabled,
  parseMcpGate,
  parsePluginConfig,
  splitUnrendered,
  type BuildPluginConfigInput,
} from "./characterPluginConfig";

/**
 * 往返等价是这批逻辑的核心契约：
 * 面板打开一次再保存，`settings.plugins` 必须与保存前逐键等价——
 * 否则角色层的 MCP / Skills / 子代理门控会在用户没有察觉的情况下改变。
 */

/** 构造一份"已保存的"角色配置 */
const SAVED = {
  __strategy: "custom",
  file: { toolkits_deny: ["file"] },
  // stale_kit 已不在当前工具列表中 → 必须保住
  browser: { toolkits_deny: ["browser", "stale_kit"] },
  // 整个插件都不在了 → 整条原样保留
  deleted_plugin: { toolkits_deny: ["x"] },
  mcp: { toolkits_deny: ["mcp_srv1"] },
  skill: { toolkits_filter: "allow", toolkits_allow: ["skill"] },
  sub_agent: { toolkits_filter: "allow" },
};

/** 当前 /plugins/query 返回的可渲染工具包（system 插件已被后端过滤） */
const RENDERABLE = {
  file: [{ kitId: "file", enabled: false }],
  browser: [{ kitId: "browser", enabled: false }],
};

function buildFrom(saved: unknown, overrides: Partial<BuildPluginConfigInput> = {}) {
  const parsed = parsePluginConfig(saved);
  const kits = Object.fromEntries(
    Object.entries(RENDERABLE).map(([pluginId]) => [
      pluginId,
      (RENDERABLE as any)[pluginId].map((k: any) => ({
        kitId: k.kitId,
        enabled: effectiveKitEnabled(parsed, pluginId, k.kitId),
      })),
    ]),
  );
  const mcp = parseMcpGate(saved);
  return buildPluginConfig({
    allDisabled: parsed.allDisabled,
    allowlistMode: parsed.allowlistMode,
    renderableKits: kits,
    unrendered: splitUnrendered(
      parsed,
      Object.fromEntries(
        Object.entries(RENDERABLE).map(([p, ks]) => [p, ks.map((k) => k.kitId)]),
      ),
    ),
    mcp,
    allSkillsDisabled: parseAllSkillsDisabled(saved),
    allAgentsDisabled: parseAllAgentsDisabled(saved),
    ...overrides,
  });
}

describe("角色插件配置往返", () => {
  it("面板打开一次再保存 → 逐键等价（含失效引用与已删除插件）", () => {
    expect(buildFrom(SAVED)).toEqual(SAVED);
  });

  it("二次往返稳定（不会逐次漂移）", () => {
    const once = buildFrom(SAVED);
    const twice = buildFrom(once);
    expect(twice).toEqual(once);
  });

  it("完全渲染不到的插件整条保留（不能丢，否则等于静默改变门控）", () => {
    const out = buildFrom(SAVED) as any;
    expect(out.deleted_plugin).toEqual({ toolkits_deny: ["x"] });
    // 已删除插件的白名单条目同样保留
    const out2 = buildFrom({
      ...SAVED,
      ghost: { toolkits_filter: "allow", toolkits_allow: ["g1"] },
    }) as any;
    expect(out2.ghost).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["g1"],
    });
  });

  it("部分渲染不到的 id 合并进同类列表，不覆盖 UI 状态", () => {
    const out = buildFrom(SAVED) as any;
    // UI 显示 browser/browser 关闭 + 失效的 stale_kit → 两个都在 deny 列表
    expect(out.browser).toEqual({
      toolkits_deny: ["browser", "stale_kit"],
    });
  });

  it("反种类的失效 id 可安全丢弃（黑名单下「允许」等于模式默认）", () => {
    // browser 的条目是 deny 过滤，但含一个 allow 列表 → 黑名单下 allow 无意义
    const out = buildFrom({
      ...SAVED,
      browser: { toolkits_deny: ["browser"], toolkits_allow: ["stale_allow"] },
    }) as any;
    expect(out.browser).toEqual({ toolkits_deny: ["browser"] });
  });

  it("白名单模式：只存显式开启的，失效 id 也进 allow", () => {
    const saved = {
      __strategy: "custom",
      __default: false,
      file: { toolkits_filter: "allow", toolkits_allow: ["file", "gone"] },
      ghost: { toolkits_filter: "allow", toolkits_allow: ["g1"] },
    };
    const out = buildFrom(saved) as any;
    expect(out.__default).toBe(false);
    expect(out.file).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["file", "gone"],
    });
    expect(out.ghost).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["g1"],
    });
  });

  it("全部禁用：写 deny_nonsystem，且保留原条目供切回时恢复", () => {
    const out = buildFrom({ ...SAVED, __strategy: "deny_nonsystem" }) as any;
    expect(out.__strategy).toBe("deny_nonsystem");
    expect(out.file).toEqual({ toolkits_deny: ["file"] });
    expect(out.browser).toEqual({ toolkits_deny: ["browser", "stale_kit"] });
    expect(out.deleted_plugin).toEqual({ toolkits_deny: ["x"] });
  });

  it("空配置 → 只写姿态与两个固定能力包", () => {
    const out = buildFrom({}) as any;
    expect(out.__strategy).toBe("custom");
    expect(out.__default).toBeUndefined();
    expect(out.skill).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["skill"],
    });
    // 子代理未配置 → 视为全部禁用
    expect(out.sub_agent).toEqual({ toolkits_filter: "allow" });
  });
});

describe("MCP 三态落盘", () => {
  const mcpOf = (over: Record<string, unknown>) =>
    buildFrom(SAVED, { mcp: over as any }) as any;

  it("全部禁用压过列表，但列表原样保留（黑名单来源）", () => {
    const out = mcpOf({
      allDisabled: true,
      allowlistMode: false,
      deniedServers: ["srv1", "srv2"],
      allowlistServers: [],
    });
    expect(out.mcp).toEqual({
      toolkits_filter: "deny_all",
      toolkits_deny: ["mcp_srv1", "mcp_srv2"],
    });
  });

  it("全部禁用压过列表，但列表原样保留（白名单来源）", () => {
    const out = mcpOf({
      allDisabled: true,
      allowlistMode: true,
      deniedServers: [],
      allowlistServers: ["srv2", "srv3"],
    });
    expect(out.mcp).toEqual({
      toolkits_filter: "deny_all",
      toolkits_allow: ["mcp_srv2", "mcp_srv3"],
    });
  });

  it("白名单即使列表为空也显式写键（键的存在即模式标记）", () => {
    const out = mcpOf({
      allDisabled: false,
      allowlistMode: true,
      deniedServers: [],
      allowlistServers: [],
    });
    expect(out.mcp).toEqual({ toolkits_filter: "allow", toolkits_allow: [] });
  });

  it("黑名单：列出拒绝的服务器，且永远写条目", () => {
    const out = mcpOf({
      allDisabled: false,
      allowlistMode: false,
      deniedServers: [],
      allowlistServers: [],
    });
    expect(out.mcp).toEqual({ toolkits_deny: [] });
  });

  it("五种状态回读与落盘互逆", () => {
    const cases = [
      { allDisabled: false, allowlistMode: false, deniedServers: ["a"], allowlistServers: [] },
      { allDisabled: false, allowlistMode: true, deniedServers: [], allowlistServers: ["b"] },
      { allDisabled: false, allowlistMode: true, deniedServers: [], allowlistServers: [] },
      { allDisabled: true, allowlistMode: false, deniedServers: ["c"], allowlistServers: [] },
      { allDisabled: true, allowlistMode: true, deniedServers: [], allowlistServers: ["d"] },
    ];
    for (const mcp of cases) {
      const back = parseMcpGate(mcpOf(mcp));
      expect({
        allDisabled: back.allDisabled,
        allowlistMode: back.allowlistMode,
        deniedServers: back.deniedServers,
        allowlistServers: back.allowlistServers,
      }).toEqual(mcp);
    }
  });

  it("全部禁用 → 解除 → 原勾选原样回来（白名单）", () => {
    // 勾选 A/B 的状态
    const checked = { allDisabled: false, allowlistMode: true, deniedServers: [], allowlistServers: ["A", "B"] };
    // 打开"工具开关"关掉 → 保存
    const saved = mcpOf({ ...checked, allDisabled: true });
    expect(saved.mcp).toEqual({
      toolkits_filter: "deny_all",
      toolkits_allow: ["mcp_A", "mcp_B"],
    });
    // 重开面板：全禁生效且模式未漂移
    const reopened = parseMcpGate(saved);
    expect(reopened.allDisabled).toBe(true);
    expect(reopened.allowlistMode).toBe(true);
    expect(reopened.allowlistServers).toEqual(["A", "B"]);
    // 打开"工具开关"→ 原来的勾选还在
    expect(mcpOf({ ...reopened, allDisabled: false }).mcp).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["mcp_A", "mcp_B"],
    });
  });

  it("全部禁用 → 解除 → 原勾选原样回来（黑名单）", () => {
    const checked = { allDisabled: false, allowlistMode: false, deniedServers: ["A"], allowlistServers: [] };
    const saved = mcpOf({ ...checked, allDisabled: true });
    expect(saved.mcp).toEqual({
      toolkits_filter: "deny_all",
      toolkits_deny: ["mcp_A"],
    });
    const reopened = parseMcpGate(saved);
    expect(reopened.allDisabled).toBe(true);
    expect(reopened.allowlistMode).toBe(false);
    expect(mcpOf({ ...reopened, allDisabled: false }).mcp).toEqual({
      toolkits_deny: ["mcp_A"],
    });
  });

  it("兼容旧写法：allow 过滤 + 无 allow 键 → 按全部禁用解读", () => {
    const legacy = parseMcpGate({ mcp: { toolkits_filter: "allow" } });
    expect(legacy.allDisabled).toBe(true);
    expect(legacy.allowlistMode).toBe(true);
    // 再保存即归一化为新形状
    expect(mcpOf({ ...legacy }).mcp).toEqual({
      toolkits_filter: "deny_all",
      toolkits_allow: [],
    });
  });
});

describe("effectiveKitEnabled 镜像后端条目语义", () => {
  it("无条目 → 由 __default 决定", () => {
    expect(effectiveKitEnabled(parsePluginConfig({}), "p", "k")).toBe(true);
    expect(
      effectiveKitEnabled(parsePluginConfig({ __default: false }), "p", "k"),
    ).toBe(false);
  });

  it("黑名单 → 只拒绝列出的", () => {
    const parsed = parsePluginConfig({ p: { toolkits_deny: ["a"] } });
    expect(effectiveKitEnabled(parsed, "p", "a")).toBe(false);
    expect(effectiveKitEnabled(parsed, "p", "b")).toBe(true);
  });

  it("白名单 → 只放行列出的", () => {
    const parsed = parsePluginConfig({
      p: { toolkits_filter: "allow", toolkits_allow: ["a"] },
    });
    expect(effectiveKitEnabled(parsed, "p", "a")).toBe(true);
    expect(effectiveKitEnabled(parsed, "p", "b")).toBe(false);
  });

  it("解析忽略 __ 系统键与遗留裸值", () => {
    const parsed = parsePluginConfig({
      __strategy: "custom",
      __default: true,
      legacy: { enabled: false },
      boolval: true,
      real: { toolkits_deny: ["k"] },
    });
    expect(Object.keys(parsed.perPlugin)).toEqual(["real"]);
  });

  it("显式 filter 的空列表条目被保留（白名单模式下的显式豁免，不能当未配置）", () => {
    const parsed = parsePluginConfig({ p: { toolkits_filter: "deny" } });
    expect(parsed.perPlugin.p).toEqual({
      filter: "deny",
      deny: [],
      allow: [],
    });
    // 语义等价落盘（缺省 filter 即 deny）
    const out = buildFrom(
      { p: { toolkits_filter: "deny" }, __default: false },
      {
        renderableKits: {},
        unrendered: splitUnrendered(parsed, {}),
      },
    ) as any;
    expect(out.__default).toBe(false);
    expect(out.p).toEqual({ toolkits_deny: [] });
  });
});

describe("Skills / 子代理默认值不对称（保持既有产品语义）", () => {
  it("Skills：未配置 = 未禁用", () => {
    expect(parseAllSkillsDisabled({})).toBe(false);
    expect(
      parseAllSkillsDisabled({ skill: { toolkits_filter: "allow" } }),
    ).toBe(true);
    expect(
      parseAllSkillsDisabled({
        skill: { toolkits_filter: "allow", toolkits_allow: ["skill"] },
      }),
    ).toBe(false);
  });

  it("子代理：未配置 = 全部禁用（固定白名单语义）", () => {
    expect(parseAllAgentsDisabled({})).toBe(true);
    expect(
      parseAllAgentsDisabled({ sub_agent: { toolkits_filter: "allow" } }),
    ).toBe(true);
    expect(
      parseAllAgentsDisabled({
        sub_agent: { toolkits_filter: "allow", toolkits_allow: ["subagent"] },
      }),
    ).toBe(false);
  });
});
