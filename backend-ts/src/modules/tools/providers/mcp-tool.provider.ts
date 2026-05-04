import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { PrismaService } from "../../../common/database/prisma.service";
import { McpClientService } from "../../../common/mcp/mcp-client.service";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";

@Injectable()
export class MCPToolProvider implements IToolProvider {
  private readonly logger = new Logger(MCPToolProvider.name);
  public readonly namespace = "mcp";

  constructor(
    private mcpClient: McpClientService,
    private prisma: PrismaService,
  ) {}

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    if (enabled === false) return [];

    const whereClause: any = { enabled: true };
    if (Array.isArray(enabled)) {
      whereClause.id = { in: enabled };
    }

    const servers = await this.prisma.mcpServer.findMany({
      where: whereClause,
    });
    const allTools: InternalToolDefinition[] = [];

    for (const server of servers) {
      if (!server.tools) continue;

      const tools = server.tools as Record<string, any>;
      for (const [toolName, toolSchema] of Object.entries(tools)) {
        allTools.push({
          name: toolName,
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

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    const toolName = request.name;

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
          type: (targetServer.type as "sse" | "streamableHttp" | "stdio") || undefined,
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

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const promptParts: string[] = [];

      promptParts.push("# MCP 工具使用说明");

      const toolInstructions = `
你拥有以下 MCP（Model Context Protocol）工具，可以主动调用它们来扩展功能：

### MCP 工具特点
- **动态加载**: MCP 工具来自外部服务器，可根据需要启用或禁用
- **标准化接口**: 所有 MCP 工具遵循统一的调用协议
- **灵活扩展**: 可通过添加新的 MCP 服务器来扩展 AI 能力

### 使用建议
1. **了解工具功能**: 在使用前，先查看工具的 description 字段了解其用途
2. **检查参数要求**: 仔细阅读工具的 parameters schema，确保提供正确的参数
3. **处理错误响应**: 如果工具执行失败，检查错误信息并调整参数
4. **权限验证**: 确保只调用已启用且有权限访问的 MCP 服务器上的工具

### 注意事项
- MCP 工具的名称格式为 \`mcp__<tool_name>\`
- 工具的具体功能取决于配置的 MCP 服务器
- 如果某个工具不可用，可能是对应的 MCP 服务器未启用或连接失败
`;
      promptParts.push(toolInstructions);

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取 MCP 提示词失败：${error.message}`);
      return "";
    }
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "MCP 工具",
      description: "通过 Model Context Protocol 连接外部工具和服务",
      isMcp: true,
    };
  }
}
