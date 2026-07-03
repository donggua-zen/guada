describe("SkillPlugin 技能过滤逻辑", () => {
  // 模拟 SkillPlugin.onLoad() 中 prompt.content 回调的过滤逻辑
  // listSkills(true) 已过滤掉全局禁用的技能（enabled === false）
  const enabledSkills = [
    { id: "skill-a", manifest: { name: "A" }, enabled: true },
    { id: "skill-b", manifest: { name: "B" }, enabled: true },
  ];

  function simulateFilter(charSkillCfg: any): typeof enabledSkills {
    if (charSkillCfg === false) return [];
    if (typeof charSkillCfg === "object" && charSkillCfg !== null) {
      if (charSkillCfg.__default === false) {
        // 白名单：只保留显式 true 的技能
        return enabledSkills.filter((s) => charSkillCfg[s.id] === true);
      }
      // 黑名单：排除显式 false 的技能
      return enabledSkills.filter((s) => charSkillCfg[s.id] !== false);
    }
    return enabledSkills;
  }

  // ==================== 无配置 ====================

  it("无配置时返回全部已启用技能", () => {
    expect(simulateFilter(undefined)).toEqual(enabledSkills);
  });

  // ==================== 黑名单 ====================

  it("黑名单：排除显式 false 的技能", () => {
    const result = simulateFilter({ "skill-a": false });
    expect(result.map((s) => s.id)).not.toContain("skill-a");
    expect(result.map((s) => s.id)).toContain("skill-b");
  });

  it("黑名单：无 false 条目时返回全部", () => {
    expect(simulateFilter({ "skill-a": true })).toHaveLength(2);
  });

  // ==================== 白名单 ====================

  it("白名单：只保留显式 true 的技能", () => {
    const result = simulateFilter({ __default: false, "skill-a": true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("skill-a");
  });

  it("白名单：空列表时返回空", () => {
    expect(simulateFilter({ __default: false })).toHaveLength(0);
  });

  // ==================== 全部禁用 ====================

  it("charSkillCfg === false 时返回空", () => {
    expect(simulateFilter(false)).toHaveLength(0);
  });

  // ==================== 层级收窄 ====================

  it("白名单：未在白名单中的技能被排除（层级收窄）", () => {
    const result = simulateFilter({ __default: false, "skill-a": true });
    expect(result.map((s) => s.id)).toEqual(["skill-a"]);
    expect(result.map((s) => s.id)).not.toContain("skill-b");
  });

  it("黑名单：显式排除的技能被过滤", () => {
    const result = simulateFilter({ "skill-a": false });
    expect(result.map((s) => s.id)).not.toContain("skill-a");
    expect(result.map((s) => s.id)).toContain("skill-b");
  });
});
