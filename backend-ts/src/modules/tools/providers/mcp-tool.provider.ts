import { Injectable, Logger } from '@nestjs/common';
import { IToolProvider, ToolCallRequest, ToolCallResponse } from '../interfaces/tool-provider.interface';
import { PrismaService } from '../../../common/database/prisma.service';
import { McpClientService } from '../../../common/mcp/mcp-client.service';
import { InternalToolDefinition } from '../../chat/types/llm.types';

@Injectable()
export class MCPToolProvider implements IToolProvider {
    private readonly logger = new Logger(MCPToolProvider.name);
    public readonly namespace = 'mcp';

    constructor(
        private mcpClient: McpClientService,
        private prisma: PrismaService,
    ) { }

    async getToolsNamespaced(enabledTools: Record<string, any> | boolean, injectParams: Record<string, any>): Promise<any[]> {
        if (enabledTools === false) return [];

        const whereClause: any = { enabled: true };
        if (Array.isArray(enabledTools)) {
            whereClause.id = { in: enabledTools };
        }

        if (injectParams.userId) {
            whereClause.userId = injectParams.userId;
        }

        const servers = await this.prisma.mcpServer.findMany({ where: whereClause });
        const allTools: InternalToolDefinition[] = [];

        for (const server of servers) {
            if (!server.tools) continue;

            // 遍历服务器缓存的工具并转换为简化的定义格式
            const tools = server.tools as Record<string, any>;
            for (const [toolName, toolSchema] of Object.entries(tools)) {
                allTools.push({
                    name: `${this.namespace}__${toolName}`,
                    description: (toolSchema as any).description || `Execute ${toolName}`,
                    parameters: (toolSchema as any).inputSchema || { type: 'object', properties: {} },
                });
            }
        }

        // 直接返回扁平化的工具定义，由 adapter 进行转换
        return allTools;
    }

    async executeWithNamespace(request: ToolCallRequest, injectParams?: Record<string, any>): Promise<ToolCallResponse> {
        const toolName = request.name.replace(`${this.namespace}__`, '');

        try {
            // 查找包含该工具的服务器
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

            // 调用远程 MCP 服务（使用标准化的 MCP 客户端）
            const result = await this.mcpClient.callTool(
                {
                    url: targetServer.url,
                    headers: targetServer.headers || {},
                },
                toolName,
                request.arguments,
                request.id
            );

            return {
                toolCallId: request.id,
                role: 'tool',
                name: request.name,
                content: result.content || '',
                isError: !result.success,
            };
        } catch (error: any) {
            this.logger.error(`Error executing MCP tool ${toolName}`, error);
            return {
                toolCallId: request.id,
                role: 'tool',
                name: request.name,
                content: `Error: ${error.message}`,
                isError: true,
            };
        }
    }

    async getPrompt(injectParams?: Record<string, any>): Promise<string> {
        try {
            const promptParts: string[] = [];

            promptParts.push('【MCP 工具使用说明】');

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

            return promptParts.join('\n');
        } catch (error: any) {
            this.logger.error(`获取 MCP 提示词失败：${error.message}`);
            return ''; // 出错时返回空字符串，不影响对话
        }
    }
}
