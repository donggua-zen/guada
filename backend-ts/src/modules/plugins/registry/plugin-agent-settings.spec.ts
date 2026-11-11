import {
  mergePluginAgentOverrides,
  normalizeAgentRefs,
  normalizeKitRefs,
} from "./plugin-agent-settings";
import { PluginAgentRegistration } from "./plugin-agent.registry";

function makeRegistration(
  overrides: Partial<PluginAgentRegistration["def"]> = {},
): PluginAgentRegistration {
  return {
    agentId: "plugin-demo-main",
    pluginId: "demo",
    defId: "main",
    def: {
      id: "main",
      name: "演示智能体",
      description: "插件提供",
      systemPrompt: "插件提示词",
      toolkits: ["demo_kit"],
      skills: ["demo_skill"],
      ...overrides,
    },
  };
}

describe("normalizeKitRefs", () => {
  it("插件内引用归 owner 插件，跨插件引用保留", () => {
    const refs = normalizeKitRefs({
      agentId: "plugin-demo-main",
      pluginId: "demo",
      defId: "main",
      def: { id: "main", name: "x", toolkits: ["kit_a", "other:kit_b"] },
    });
    expect(refs).toEqual([
      { pluginId: "demo", kitId: "kit_a" },
      { pluginId: "other", kitId: "kit_b" },
    ]);
  });

  it("去重并跳过空引用", () => {
    const refs = normalizeKitRefs({
      agentId: "plugin-demo-main",
      pluginId: "demo",
      defId: "main",
      def: { id: "main", name: "x", toolkits: ["kit_a", "", "kit_a", ":"] },
    });
    expect(refs).toEqual([{ pluginId: "demo", kitId: "kit_a" }]);
  });
});

describe("mergePluginAgentOverrides", () => {
  it("无 override：与 composePluginAgentSettings 等价 + 锁定视图", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), null);
    expect(merged.name).toBe("演示智能体");
    expect(merged.settings.plugins.demo).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["demo_kit"],
    });
    expect(merged.settings.skills).toEqual({
      __default: false,
      demo_skill: true,
    });
  });

  it("override 覆盖 name/description/modelId 与普通 settings 键", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      name: "改名",
      description: "用户描述",
      modelId: "p:m",
      settings: { temperature: 0.5, assistantName: "别名" },
    });
    expect(merged.name).toBe("改名");
    expect(merged.description).toBe("用户描述");
    expect(merged.modelId).toBe("p:m");
    expect(merged.settings.temperature).toBe(0.5);
    expect(merged.settings.assistantName).toBe("别名");
  });

  it("systemPrompt/__pluginAgent 不可覆盖", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      settings: { systemPrompt: "hacked", __pluginAgent: "forged" },
    });
    expect(merged.settings.systemPrompt).toBe("插件提示词");
    expect(merged.settings.__pluginAgent).toBe("plugin-demo-main");
  });

  it("用户 deny_nonsystem/黑名单压不过锁定包（owner 条目 allow 并集）", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      settings: {
        plugins: { demo: { toolkits_filter: "deny_all" } },
      },
    });
    expect(merged.settings.plugins.demo.toolkits_filter).toBe("allow");
    expect(merged.settings.plugins.demo.toolkits_allow).toContain("demo_kit");
  });

  it("用户可自由追加其他插件工具包（不进锁定面）", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      settings: {
        plugins: {
          web: { toolkits_filter: "allow", toolkits_allow: ["websearch"] },
        },
      },
    });
    expect(merged.settings.plugins.web.toolkits_allow).toEqual(["websearch"]);
    expect(merged.settings.plugins.demo.toolkits_allow).toContain("demo_kit");
  });

  it("锁定技能强制 true + plugins.skill 门控从 deny_all 救回", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      settings: {
        skills: { demo_skill: false },
        plugins: { skill: { toolkits_filter: "deny_all" } },
      },
    });
    expect(merged.settings.skills.demo_skill).toBe(true);
    expect(merged.settings.plugins.skill.toolkits_filter).toBe("allow");
  });

  it("跨插件锁定包：其插件条目被重申为 allow 含锁定包", () => {
    const merged = mergePluginAgentOverrides(
      makeRegistration({ toolkits: ["other:kit_b"] }),
      { settings: { plugins: { other: { toolkits_filter: "deny_all" } } } },
    );
    expect(merged.settings.plugins.other.toolkits_filter).toBe("allow");
    expect(merged.settings.plugins.other.toolkits_allow).toContain("kit_b");
  });

  it("mcp/sub_agent 门控由用户 override 自由调整（非锁定面）", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), {
      settings: {
        plugins: {
          mcp: { toolkits_filter: "allow", toolkits_allow: ["mcp_s1"] },
        },
      },
    });
    expect(merged.settings.plugins.mcp).toEqual({
      toolkits_filter: "allow",
      toolkits_allow: ["mcp_s1"],
    });
  });
});

describe("normalizeAgentRefs（执行角色白名单）", () => {
  const reg = (agents?: string[]) =>
    makeRegistration({ agents } as any);

  it("本插件角色解析为 plugin-<pluginId>-<roleId>", () => {
    expect(normalizeAgentRefs(reg(["recon", "exploit"]))).toEqual([
      "plugin-demo-recon",
      "plugin-demo-exploit",
    ]);
  });

  it("跨插件引用与 generic 原样处理", () => {
    expect(normalizeAgentRefs(reg(["other:critic", "generic"]))).toEqual([
      "plugin-other-critic",
      "generic",
    ]);
  });

  it("去重并跳过空串", () => {
    expect(normalizeAgentRefs(reg(["recon", "", "recon"]))).toEqual([
      "plugin-demo-recon",
    ]);
  });

  it("未声明时为空数组", () => {
    expect(normalizeAgentRefs(reg(undefined))).toEqual([]);
  });
});

describe("settings.agents 合成与锁定", () => {
  it("未声明角色 → 仍是 {__default:false}（不能派子代理）", () => {
    const merged = mergePluginAgentOverrides(makeRegistration(), null);
    expect(merged.settings.agents).toEqual({ __default: false });
  });

  it("声明角色 → 合成白名单逐项 true", () => {
    const merged = mergePluginAgentOverrides(
      makeRegistration({ agents: ["recon", "assess"] } as any),
      null,
    );
    expect(merged.settings.agents).toEqual({
      __default: false,
      "plugin-demo-recon": true,
      "plugin-demo-assess": true,
    });
  });

  it("引用不存在的角色也保留（插件启用顺序无关）", () => {
    const merged = mergePluginAgentOverrides(
      makeRegistration({ agents: ["ghost"] } as any),
      null,
    );
    expect(merged.settings.agents["plugin-demo-ghost"]).toBe(true);
  });

  it("用户 override 关不掉声明角色", () => {
    const merged = mergePluginAgentOverrides(
      makeRegistration({ agents: ["recon"] } as any),
      { settings: { agents: { __default: false, "plugin-demo-recon": false } } },
    );
    expect(merged.settings.agents["plugin-demo-recon"]).toBe(true);
  });

  it("用户可以追加未声明的白名单项", () => {
    const merged = mergePluginAgentOverrides(
      makeRegistration({ agents: ["recon"] } as any),
      { settings: { agents: { "plugin-other-critic": true } } },
    );
    expect(merged.settings.agents).toEqual({
      "plugin-other-critic": true,
      "plugin-demo-recon": true,
    });
  });
});
