import { SkillOrchestrator } from "./skill-orchestrator.service";
import { SkillRegistry } from "./skill-registry.service";

/**
 * 管理页可见性口径
 *
 * 全局技能管理页只展示「全局共享」技能；注册时声明了 visibleTo 的
 * 智能体专属技能（如插件 `visibleTo: ['self']`）不在此列。
 *
 * 约束的是**管理面**（列表/详情/文档/卸载/更新/启用状态），
 * 会话内清单与 skill_learn 仍走 isSkillVisibleInSession + isVisibleToAgent。
 */
describe("SkillOrchestrator 管理页可见性", () => {
  function makeSkill(id: string, extra: Record<string, any> = {}) {
    return {
      id,
      baseDir: "",
      basePath: "",
      manifest: { name: id, description: "" },
      content: "body",
      source: "system",
      enabled: true,
      ...extra,
    } as any;
  }

  function makeOrchestrator(skills: any[]) {
    const registry = new SkillRegistry(undefined as any);
    for (const skill of skills) registry.register(skill);

    const sourceManager = { getSourceSkills: () => [] } as any;
    const orchestrator = new SkillOrchestrator(
      sourceManager,
      registry,
      {} as any,
      {} as any,
      { isPluginEnabled: () => true } as any,
      {} as any,
      { getProjectDisabledIds: () => new Set(), isProjectDisabled: () => false, getGlobalDisabledIds: () => new Set(), isGlobalDisabled: () => false } as any,
    );
    return { registry, orchestrator };
  }

  it("isAgentScopedSkill：声明了 visibleTo 才算专属", () => {
    const { orchestrator } = makeOrchestrator([]);
    expect(orchestrator.isAgentScopedSkill(makeSkill("a", { visibleTo: ["self"] }))).toBe(true);
    expect(orchestrator.isAgentScopedSkill(makeSkill("b", { visibleTo: ["plugin-x-main"] }))).toBe(true);
    expect(orchestrator.isAgentScopedSkill(makeSkill("c", { visibleTo: [] }))).toBe(false);
    expect(orchestrator.isAgentScopedSkill(makeSkill("d"))).toBe(false);
  });

  it("listManageableSkills 排除智能体专属技能，保留全局技能", () => {
    const { orchestrator } = makeOrchestrator([
      makeSkill("global-skill"),
      makeSkill("scoped-skill", {
        provider: "plugin:demo",
        toolkitId: "kit",
        visibleTo: ["self"],
      }),
    ]);

    const ids = orchestrator.listManageableSkills(false).map((s) => s.id);
    expect(ids).toContain("global-skill");
    expect(ids).not.toContain("scoped-skill");
  });

  it("getManageableSkillDetail 对专属技能返回 null（详情/文档/卸载/更新一致）", () => {
    const { orchestrator } = makeOrchestrator([
      makeSkill("global-skill"),
      makeSkill("scoped-skill", { visibleTo: ["self"] }),
    ]);

    expect(orchestrator.getManageableSkillDetail("global-skill")?.id).toBe("global-skill");
    expect(orchestrator.getManageableSkillDetail("scoped-skill")).toBeNull();
    expect(orchestrator.getManageableSkillDetail("not-exists")).toBeNull();
  });

  it("底层 getSkillDetail 不受管理面过滤（会话内链路的入口）", () => {
    const { orchestrator } = makeOrchestrator([
      makeSkill("scoped-skill", { visibleTo: ["self"] }),
    ]);
    expect(orchestrator.getSkillDetail("scoped-skill")?.id).toBe("scoped-skill");
  });

  it("listSkillsForAgent：全局技能恒在，专属技能按 agentId 放行", () => {
    const { orchestrator } = makeOrchestrator([
      makeSkill("global-skill"),
      makeSkill("scoped-skill", { provider: "plugin:demo", visibleTo: ["self"] }),
      makeSkill("other-skill", { provider: "plugin:demo", visibleTo: ["plugin-other-main"] }),
    ]);

    // 本插件的智能体：能看到 self 专属技能
    const own = orchestrator
      .listSkillsForAgent("plugin-demo-main", false)
      .map((s) => s.id)
      .sort();
    expect(own).toEqual(["global-skill", "scoped-skill"]);

    // 别的智能体：专属技能都看不到
    const other = orchestrator
      .listSkillsForAgent("assistant-agent", false)
      .map((s) => s.id);
    expect(other).toEqual(["global-skill"]);

    // 无 agentId：退化为管理页口径
    const none = orchestrator
      .listSkillsForAgent(undefined, false)
      .map((s) => s.id);
    expect(none).toEqual(["global-skill"]);
  });
});
