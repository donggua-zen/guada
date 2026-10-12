import {
  builtinReadOnlySet,
  factoryRules,
  loadFactoryPolicy,
  type EffectivePolicy,
} from "../../src/common/services/command-policy";
import type { PolicyRulesService } from "../../src/common/services/policy-rules.service";

/** 出厂策略（读真实出厂文件）——插件测试用它，行为与生产一致 */
export function defaultEffectivePolicy(): EffectivePolicy {
  const factory = loadFactoryPolicy();
  return {
    userRules: [],
    factoryRules: factoryRules(factory),
    readOnly: { factory: factory.readOnly, removed: [], builtin: builtinReadOnlySet() },
  };
}

/** 空策略（两档都不拦不放过；仅用于不关心策略的用例） */
export function emptyEffectivePolicy(): EffectivePolicy {
  return {
    userRules: [],
    factoryRules: [],
    readOnly: { factory: [], removed: [], builtin: builtinReadOnlySet() },
  };
}

/** 在出厂策略上追加用户规则 */
export function policyWith(rules: EffectivePolicy["userRules"]): EffectivePolicy {
  return { ...defaultEffectivePolicy(), userRules: rules };
}

/**
 * PolicyRulesService 的测试替身：默认给出出厂策略。
 * 需要定制的用例可在 setup 里覆写 `getEffectivePolicySync` 等。
 */
export function policyRulesStub(overrides: Partial<PolicyRulesService> = {}): any {
  const base: any = {
    getEffectivePolicySync: () => defaultEffectivePolicy(),
    isPathAllowedSync: () => false,
    matchPathRuleSync: () => null,
    getPaths: () => ({ global: "", project: null }),
    loadEffective: async () => ({
      userRules: [],
      factoryRules: factoryRules(),
      factory: loadFactoryPolicy(),
      readOnlyRemove: [],
      readOnlyEffective: loadFactoryPolicy().readOnly,
      paths: { global: "", project: null },
      warnings: [],
    }),
    saveUser: async () => ({}) as any,
    appendRule: async () => {},
    resetUser: async () => ({}) as any,
    validate: () => ({ errors: [], warnings: [] }),
    clearCache: () => {},
    globalFilePath: () => "",
    projectFilePath: () => null,
  };
  return { ...base, ...overrides };
}
