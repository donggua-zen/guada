import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SkillsModule } from "../skills/skills.module";
import { SkillMarketController } from "./skill-market.controller";
import { SkillHubMarketService } from "./skillhub-market.service";

/**
 * 技能市场模块（消费端）。
 *
 * 依赖说明：
 * - `AuthModule` 提供 `AuthGuard`（与 MCP 市场一致，市场接口需要登录）；
 * - `SkillsModule` 导出 `SkillOrchestrator`，安装成功后触发扫描注册；
 * - 安装/解压复用 `skills/core/skill-package.installer` 的纯函数，不额外导出 service。
 */
@Module({
  imports: [AuthModule, SkillsModule],
  controllers: [SkillMarketController],
  providers: [SkillHubMarketService],
  exports: [SkillHubMarketService],
})
export class SkillMarketModule {}
