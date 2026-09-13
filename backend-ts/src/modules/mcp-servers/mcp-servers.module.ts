import { Module, OnModuleInit } from "@nestjs/common";
import { McpServersController } from "./mcp-servers.controller";
import { McpServerService } from "./mcp-server.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { McpPlugin } from "./tools/mcp.plugin";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [McpServersController],
  providers: [McpServerService, McpPlugin],
})
export class McpServersModule implements OnModuleInit {
  constructor(
    private readonly pluginManager: PluginManager,
    private readonly mcpPlugin: McpPlugin,
  ) {}

  async onModuleInit() {
    await this.pluginManager.registerPlugin(this.mcpPlugin);
  }
}
