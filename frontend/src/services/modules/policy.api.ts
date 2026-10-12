import type { ApiContext } from "./api-context";

export type RuleAction = "allow" | "ask" | "deny";

/** 命令规则：命令前缀匹配 */
export interface CommandRule {
  action: RuleAction;
  match: string;
}
/** 路径规则：glob（allow = 可写根，ask = 敏感路径） */
export interface PathRule {
  action: RuleAction;
  path: string;
}
export type PolicyRule = CommandRule | PathRule;

/** 出厂清单（只读） */
export interface FactoryPolicy {
  readOnly: string[];
  ask: string[];
  sensitive: string[];
  writeRoots: string[];
}

/** 你的改动（用户文件只有这两个键） */
export interface PolicyUserFile {
  rules: PolicyRule[];
  readOnlyRemove: string[];
}

/** 生效配置 + 出厂清单 + 文件路径 + 校验告警 */
export interface EffectivePolicyView {
  userRules: PolicyRule[];
  factoryRules: PolicyRule[];
  factory: FactoryPolicy;
  readOnlyRemove: string[];
  readOnlyEffective: string[];
  paths: { global: string; project: string | null };
  warnings: string[];
}

export interface PolicyApi {
  /** 读取生效配置（可选带上会话工作区以合并项目级文件） */
  fetchPolicyRules(workspacePath?: string): Promise<EffectivePolicyView>;
  /** 写入你的改动（rules / readOnlyRemove） */
  updatePolicyRules(payload: {
    scope: "global" | "project";
    content: Partial<PolicyUserFile>;
    workspacePath?: string | null;
  }): Promise<EffectivePolicyView>;
  /** 清空你的改动（出厂规则不受影响） */
  resetPolicyRules(): Promise<EffectivePolicyView>;
}

export const policyApi: PolicyApi = {
  async fetchPolicyRules(this: ApiContext, workspacePath?: string) {
    const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : "";
    return await this._request<EffectivePolicyView>(`/policy/rules${q}`);
  },

  async updatePolicyRules(this: ApiContext, payload) {
    return await this._request<EffectivePolicyView>("/policy/rules", {
      method: "PUT",
      data: payload,
    });
  },

  async resetPolicyRules(this: ApiContext) {
    return await this._request<EffectivePolicyView>("/policy/reset", { method: "POST" });
  },
};
