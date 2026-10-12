import type { ApiContext } from "./api-context";

/** policy.yaml 的三张表 + 工作区外可写路径 */
export interface PolicyRulesFile {
  allow: string[];
  ask: string[];
  deny: string[];
  writeAllowPaths: string[];
}

/** 生效规则（两级合并后的结果 + 两级原文 + 文件路径 + 校验告警） */
export interface EffectivePolicyRules {
  rules: { allow: string[]; ask: string[]; deny: string[] };
  writeAllowPaths: string[];
  sources: { global: PolicyRulesFile; project: PolicyRulesFile };
  paths: { global: string; project: string | null };
  warnings: string[];
}

export interface PolicyApi {
  /** 读取生效规则（可选带上会话工作区以合并项目级文件） */
  fetchPolicyRules(workspacePath?: string): Promise<EffectivePolicyRules>;
  /** 写入某个作用域（global / project） */
  updatePolicyRules(payload: {
    scope: "global" | "project";
    rules: Partial<PolicyRulesFile>;
    workspacePath?: string | null;
  }): Promise<EffectivePolicyRules>;
}

export const policyApi: PolicyApi = {
  async fetchPolicyRules(this: ApiContext, workspacePath?: string) {
    const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : "";
    return await this._request<EffectivePolicyRules>(`/policy/rules${q}`);
  },

  async updatePolicyRules(this: ApiContext, payload) {
    return await this._request<EffectivePolicyRules>("/policy/rules", {
      method: "PUT",
      data: payload,
    });
  },
};
