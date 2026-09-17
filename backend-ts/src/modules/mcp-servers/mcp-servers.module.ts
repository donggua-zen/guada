import { Module, OnModuleInit } from "@nestjs/common";
import { McpServersController } from "./mcp-servers.controller";
import { McpServerService } from "./mcp-server.service";
import { McpFileStore } from "./mcp-file.store";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { McpPlugin } from "./tools/mcp.plugin";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [McpServersController],
  providers: [McpServerService, McpPlugin, McpFileStore],
  exports: [McpFileStore],
})
export class McpServersModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly mcpPlugin: McpPlugin,
    private readonly mcpStore: McpFileStore,
  ) {}

  async onModuleInit() {
    // MCP store 索引预热（gate 已由 PersistenceModule 迁移脚手架放行）
    await this.mcpStore.initialize();
    await this.pluginManager.registerPlugin(this.mcpPlugin);
  }
}
