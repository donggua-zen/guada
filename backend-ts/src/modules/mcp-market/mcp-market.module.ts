import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { McpServersModule } from "../mcp-servers/mcp-servers.module";
import { PluginsModule } from "../plugins/plugins.module";
import { McpMarketController } from "./mcp-market.controller";
import { McpMarketService } from "./mcp-market.service";
import { McpMarketImportService } from "./mcp-market-import.service";

/**
 * MCP 市场模块。
 *
 * 依赖说明：
 * - `McpServersModule` 导出 `McpFileStore`（导入要直接写 YAML，不经过 McpServerService
 *   以免触发子进程启动）；
 * - `PluginsModule` 提供 `PluginManager`，导入后重载 `mcp` 插件让工具包索引跟上。
 */
@Module({
  imports: [AuthModule, McpServersModule, PluginsModule],
  controllers: [McpMarketController],
  providers: [McpMarketService, McpMarketImportService],
  exports: [McpMarketService],
})
export class McpMarketModule {}
