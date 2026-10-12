import { Body, Controller, Get, Put, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import {
  PolicyRulesService,
  type PolicyRulesFile,
  type PolicyScope,
} from "../../common/services/policy-rules.service";

/**
 * 命令策略规则（用户可配的 allow / ask / deny + 工作区外可写路径）。
 *
 * 读写的是磁盘上的 YAML 文件（全局 + 项目级），UI 与手编共用同一份事实源：
 * - `GET  /policy/rules?workspacePath=…` → 生效规则 + 两级原文 + 文件路径 + 校验告警
 * - `PUT  /policy/rules`                  → 写入指定作用域（校验失败返回 500 语义的错误信息）
 */
@Controller("policy")
@UseGuards(AuthGuard)
export class PolicyController {
  constructor(private readonly policyRules: PolicyRulesService) {}

  @Get("rules")
  async getRules(@Query("workspacePath") workspacePath?: string) {
    return this.policyRules.loadEffective(workspacePath?.trim() || null);
  }

  @Put("rules")
  async putRules(
    @Body()
    body: {
      scope?: PolicyScope;
      rules?: Partial<PolicyRulesFile>;
      workspacePath?: string | null;
    },
  ) {
    const scope: PolicyScope = body.scope === "project" ? "project" : "global";
    return this.policyRules.saveScope(scope, body.rules ?? {}, body.workspacePath ?? null);
  }
}
