import type { PolicyRulesService } from "../../src/common/services/policy-rules.service";

/**
 * PolicyRulesService 的测试替身：默认空规则。
 * 需要规则的用例可在 setup 里覆写 `getEffectiveSync` / `getWriteAllowPathsSync`。
 */
export function policyRulesStub(overrides: Partial<PolicyRulesService> = {}): any {
  return {
    getEffectiveSync: () => ({ allow: [], ask: [], deny: [] }),
    getWriteAllowPathsSync: () => [],
    getPaths: () => ({ global: "", project: null }),
    loadEffective: async () => ({
      rules: { allow: [], ask: [], deny: [] },
      writeAllowPaths: [],
      sources: { global: {}, project: {} },
      paths: { global: "", project: null },
      warnings: [],
    }),
    saveScope: async () => ({}) as any,
    appendAllowRule: async () => {},
    validate: () => ({ errors: [], warnings: [] }),
    clearCache: () => {},
    globalFilePath: () => "",
    projectFilePath: () => null,
    ...overrides,
  };
}
