import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDefinition,
} from "../../tools/interfaces/tool-provider.interface";
import { PrismaService } from "../../../common/database/prisma.service";
import { McpClientService } from "../../../common/mcp/mcp-client.service";

@Injectable()
export class MCPToolProvider implements IToolProvider {
  private readonly logger = new Logger(MCPToolProvider.name);
  public readonly pluginId = "mcp";

  constructor(
    private mcpClient: McpClientService,
    private prisma: PrismaService,
  ) {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    const whereClause: any = { enabled: true };
    if (Array.isArray(enabled)) {
      whereClause.id = { in: enabled };
    }

    const servers = await this.prisma.mcpServer.findMany({
      where: whereClause,
    });
    const allTools: ToolDefinition[] = [];

    for (const server of servers) {
      if (!server.tools) continue;

      const tools = server.tools as Record<string, any>;
      for (const [toolName, toolSchema] of Object.entries(tools)) {
        allTools.push({
          name: `mcp__${toolName}`,
          description: (toolSchema as any).description || `Execute ${toolName}`,
          parameters: (toolSchema as any).inputSchema || {
            type: "object",
            properties: {},
          },
        });
      }
    }

    return allTools;
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    // 去除 mcp__ 前缀，还原原始工具名
    const toolName = request.name.startsWith('mcp__')
      ? request.name.slice(5)
      : request.name;

    try {
      const servers = await this.prisma.mcpServer.findMany({
        where: { enabled: true },
      });

      let targetServer: any = null;
      for (const server of servers) {
        if (server.tools) {
          const tools = server.tools as Record<string, any>;
          if (tools[toolName]) {
            targetServer = server;
            break;
          }
        }
      }

      if (!targetServer) {
        throw new Error(`MCP tool '${toolName}' not found or server disabled`);
      }

      const result = await this.mcpClient.callTool(
        {
          url: targetServer.url || undefined,
          headers: (targetServer.headers as Record<string, any>) || undefined,
          type:
            (targetServer.type as "sse" | "streamableHttp" | "stdio") ||
            undefined,
          command: targetServer.command || undefined,
          args: targetServer.args || undefined,
          env: targetServer.env || undefined,
          cwd: targetServer.cwd || undefined,
        },
        toolName,
        request.arguments,
        request.id,
      );

      // 只返回内容，由 ToolOrchestrator 封装响应
      return result.content || "";
    } catch (error: any) {
      this.logger.error(`Error executing MCP tool ${toolName}`, error);
      throw error; // 抛出异常，由 ToolOrchestrator 捕获
    }
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      pluginId: this.pluginId,
      displayName: "MCP 工具",
      description: "通过 Model Context Protocol 连接外部工具和服务",
      isMcp: true,
      promptFrequency: 'REGULAR',
    };
  }
}
