import { Module, OnModuleInit } from "@nestjs/common";
import { McpServersController } from "./mcp-servers.controller";
import { McpServerService } from "./mcp-server.service";
import { McpServerRepository } from "../../common/database/mcp-server.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { MCPToolProvider } from "./tools/mcp-tool.provider";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [McpServersController],
  providers: [McpServerService, McpServerRepository, PrismaService, MCPToolProvider],
})
export class McpServersModule implements OnModuleInit {
  constructor(
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly mcpToolProvider: MCPToolProvider,
  ) {}

  onModuleInit() {
    this.toolOrchestrator.addProvider(this.mcpToolProvider);
  }
}
