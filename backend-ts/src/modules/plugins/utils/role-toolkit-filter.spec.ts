import { isToolkitAllowedByRoleConfig } from "./role-toolkit-filter";

/**
 * 语义必须与 plugin.manager 的 applyRoleLayer 条目分支保持一致：
 * 自治理工具包把裁决权交给自己的 handler，因此这里是唯一的解释点。
 */
describe("isToolkitAllowedByRoleConfig", () => {
  it("无条目 / 遗留裸值 → 放行（等于没管过）", () => {
    expect(isToolkitAllowedByRoleConfig(undefined, "k")).toBe(true);
    expect(isToolkitAllowedByRoleConfig(null, "k")).toBe(true);
    expect(isToolkitAllowedByRoleConfig(true, "k")).toBe(true);
    expect(isToolkitAllowedByRoleConfig(false, "k")).toBe(true);
    expect(isToolkitAllowedByRoleConfig("legacy", "k")).toBe(true);
  });

  it("黑名单（默认）：只拒绝列出的", () => {
    expect(
      isToolkitAllowedByRoleConfig({ toolkits_deny: ["a"] }, "a"),
    ).toBe(false);
    expect(
      isToolkitAllowedByRoleConfig({ toolkits_deny: ["a"] }, "b"),
    ).toBe(true);
    expect(isToolkitAllowedByRoleConfig({}, "a")).toBe(true);
    expect(isToolkitAllowedByRoleConfig({ toolkits_deny: [] }, "a")).toBe(true);
  });

  it("白名单：先全拒，再放行显式允许的", () => {
    const entry = { toolkits_filter: "allow" as const, toolkits_allow: ["a"] };
    expect(isToolkitAllowedByRoleConfig(entry, "a")).toBe(true);
    expect(isToolkitAllowedByRoleConfig(entry, "b")).toBe(false);
  });

  it("白名单配空列表 → 全部拒绝", () => {
    expect(
      isToolkitAllowedByRoleConfig({ toolkits_filter: "allow" }, "a"),
    ).toBe(false);
    expect(
      isToolkitAllowedByRoleConfig(
        { toolkits_filter: "allow", toolkits_allow: [] },
        "a",
      ),
    ).toBe(false);
  });

  it("toolkits_filter 缺省按黑名单处理", () => {
    expect(
      isToolkitAllowedByRoleConfig({ toolkits_deny: ["a"] }, "a"),
    ).toBe(false);
  });

  it("deny_all：压过两个列表，全部拒绝（列表原样保留供解除时恢复）", () => {
    // 白名单来源：记住的允许列表被压过
    expect(
      isToolkitAllowedByRoleConfig(
        { toolkits_filter: "deny_all", toolkits_allow: ["a"] },
        "a",
      ),
    ).toBe(false);
    expect(
      isToolkitAllowedByRoleConfig(
        { toolkits_filter: "deny_all", toolkits_allow: ["a"] },
        "b",
      ),
    ).toBe(false);
    // 黑名单来源：记住的拒绝列表被压过（本来就会拒，但未列出的也一并拒）
    expect(
      isToolkitAllowedByRoleConfig(
        { toolkits_filter: "deny_all", toolkits_deny: ["a"] },
        "b",
      ),
    ).toBe(false);
    // 无列表
    expect(
      isToolkitAllowedByRoleConfig({ toolkits_filter: "deny_all" }, "a"),
    ).toBe(false);
  });

  it("两个批量开关不参与（__strategy / __default 不影响裁决）", () => {
    // 条目只看自身 filter/allow/deny；批量姿态由 applyRoleLayer 处理 generic 插件
    expect(
      isToolkitAllowedByRoleConfig(
        { toolkits_deny: ["a"] } as any,
        "b",
      ),
    ).toBe(true);
  });
});
