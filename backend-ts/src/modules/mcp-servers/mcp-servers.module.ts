import { Module, OnModuleInit } from "@nestjs/common";
import { McpServersController } from "./mcp-servers.controller";
import { McpServerService } from "./mcp-server.service";
import { McpServerRepository } from "../../common/database/mcp-server.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { PluginManager } from "../plugins";
import { McpPlugin } from "./tools/mcp.plugin";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [McpServersController],
  providers: [McpServerService, McpServerRepository, PrismaService, McpPlugin],
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
