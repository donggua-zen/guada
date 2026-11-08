import { Module } from "@nestjs/common";
import { PluginMarketService } from "./market.service";
import { PluginMarketController } from "./market.controller";

/**
 * 插件市场模块：官网索引透传 + 一键安装。
 * ExternalPluginLoader 由全局 PluginsModule exports 提供，无需重复 import。
 */
@Module({
  controllers: [PluginMarketController],
  providers: [PluginMarketService],
  exports: [PluginMarketService],
})
export class PluginMarketModule {}
