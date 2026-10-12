import { Body, Controller, Get, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import {
  PolicyRulesService,
  type PolicyUserFile,
  type PolicyScope,
} from "../../common/services/policy-rules.service";

/**
 * 命令策略配置（出厂规则 + 你的改动）。
 *
 * - `GET  /policy/rules?workspacePath=…` → 生效规则 + 出厂清单 + 文件路径 + 校验告警
 * - `PUT  /policy/rules`                 → 写入你的改动（rules / readOnlyRemove；校验失败抛错）
 * - `POST /policy/reset`                 → 清空你的改动（覆盖前备份 .bak）
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
      content?: Partial<PolicyUserFile>;
      workspacePath?: string | null;
    },
  ) {
    const scope: PolicyScope = body.scope === "project" ? "project" : "global";
    return this.policyRules.saveUser(scope, body.content ?? {}, body.workspacePath ?? null);
  }

  @Post("reset")
  async reset(@Query("workspacePath") workspacePath?: string) {
    return this.policyRules.resetUser("global", workspacePath?.trim() || null);
  }
}
