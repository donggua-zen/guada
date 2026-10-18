import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";
import { UsageStore } from "./usage.store";

/**
 * 用量统计模块（全局）
 *
 * - `UsageService` 被 LlmCoreModule 的 LLMService 注入（全局导出，免模块环）
 * - `UsageStore` 懒开 `_meta.db`，不参与启动期元数据迁移顺序
 * - `ProviderFileStore` 来自全局 LlmCoreModule，仅控制器用于补显示名
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [UsageController],
  providers: [UsageStore, UsageService],
  exports: [UsageService],
})
export class UsageModule {}
