import { Injectable, Logger } from "@nestjs/common";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { PrismaService } from "../../../common/database/prisma.service";
import { McpClientService } from "../../../common/mcp/mcp-client.service";
import { PluginApi } from "../../plugins/api/plugin-api";

@Injectable()
export class McpPlugin extends PluginBase {
  private readonly logger = new Logger(McpPlugin.name);

  manifest = {
    id: "mcp",
    name: "MCP 工具",
    description: "通过 Model Context Protocol 连接外部工具和服务",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private mcpClient: McpClientService,
    private prisma: PrismaService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    const servers = await this.prisma.mcpServer.findMany({
      where: { enabled: true },
    });

    for (const server of servers) {
      if (!server.tools) continue;
      const rawTools = server.tools as Record<string, any>;
      for (const [toolName, toolSchema] of Object.entries(rawTools)) {
        const mcpToolName = `mcp__${toolName}`;
        const schema = (toolSchema as any).inputSchema;
        api.registerRawTool({
          name: mcpToolName,
          description: (toolSchema as any).description || `Execute ${toolName}`,
          parameters: schema || { type: "object", properties: {} },
          handler: async (
            args: any,
            ctx?: PluginContext,
            abortSignal?: AbortSignal,
          ) => {
            const result = await this.mcpClient.callTool(
              {
                url: server.url || undefined,
                headers: (server.headers as Record<string, any>) || undefined,
                type:
                  (server.type as "sse" | "streamableHttp" | "stdio") ||
                  undefined,
                command: server.command || undefined,
                args: (server.args as string[]) || undefined,
                env: (server.env as Record<string, string>) || undefined,
                cwd: server.cwd || undefined,
              },
              toolName,
              args,
              mcpToolName,
            );
            return result.content || "";
          },
        });
      }
    }
  }
}
