import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * MCP 工具调用结果接口
 */
export interface McpToolCallResult {
  success: boolean;
  result?: any;
  content?: string;
  error?: string;
}

/**
 * MCP 服务器配置接口
 */
export interface McpServerConfig {
  url: string;
  headers?: Record<string, any>;
}

/**
 * JSON-RPC 2.0 请求接口
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: number | string;
}

/**
 * JSON-RPC 2.0 响应接口
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number | string;
}

/**
 * MCP 客户端服务
 *
 * 提供与 MCP 服务器通信的标准化接口，支持：
 * - 获取工具列表 (listTools)
 * - 调用远程工具 (callTool)
 * - 连接管理与资源释放
 *
 * 使用官方的 StreamableHTTPClientTransport 进行通信，
 * 兼容支持 Streamable HTTP 协议的 MCP 服务器。
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  /**
   * 创建临时的 MCP 客户端并执行操作
   *
   * @param config MCP 服务器配置
   * @param operation 要执行的操作（接收已连接的客户端）
   * @returns 操作结果
   */
  private async withClient<T>(
    config: McpServerConfig,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    let client: Client | null = null;
    try {
      // 准备请求头
      const requestHeaders = { ...(config.headers || {}) };
      if (!requestHeaders["Content-Type"]) {
        requestHeaders["Content-Type"] = "application/json";
      }

      // 使用 StreamableHTTPClientTransport（官方推荐）
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: requestHeaders,
        },
      });

      client = new Client({ name: "ts-backend", version: "1.0.0" });
      await client.connect(transport);

      this.logger.debug(`Connected to MCP server: ${config.url}`);

      // 执行操作
      const result = await operation(client);
      return result;
    } catch (error: any) {
      this.logger.error(
        `MCP client operation failed: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // 确保连接被关闭
      if (client) {
        try {
          await client.close();
          this.logger.debug(`Closed connection to MCP server: ${config.url}`);
        } catch (closeError: any) {
          this.logger.warn(
            `Failed to close MCP connection: ${closeError.message}`,
          );
        }
      }
    }
  }

  /**
   * 从 MCP 服务器获取工具列表
   *
   * @param config MCP 服务器配置
   * @returns 工具列表字典（以工具名为键）
   */
  async listTools(config: McpServerConfig): Promise<Record<string, any>> {
    return this.withClient(config, async (client) => {
      const result = await client.listTools();
      const tools = result.tools || [];

      // 转换为以工具名为键的字典格式
      const toolsDict: Record<string, any> = {};
      for (const tool of tools) {
        if (tool && typeof tool === "object" && tool.name) {
          toolsDict[tool.name] = tool;
        }
      }

      this.logger.log(
        `Fetched ${Object.keys(toolsDict).length} tools from ${config.url}`,
      );
      return toolsDict;
    });
  }

  /**
   * 调用 MCP 工具
   *
   * @param config MCP 服务器配置
   * @param toolName 工具名称
   * @param toolArgs 工具参数
   * @param requestId 请求 ID（用于追踪）
   * @returns 工具调用结果
   */
  async callTool(
    config: McpServerConfig,
    toolName: string,
    toolArgs: Record<string, any>,
    requestId?: string | number,
  ): Promise<McpToolCallResult> {
    try {
      return await this.withClient(config, async (client) => {
        console.log(`   Arguments: `, toolArgs);

        const result = await client.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        // 格式化响应内容
        // MCP SDK 返回的结果可能是 { content: [...] } 格式
        let content: string;
        if (result && typeof result === "object") {
          // 如果结果包含 content 数组（MCP 标准格式）
          if ("content" in result && Array.isArray(result.content)) {
            content = result.content
              .map((item: any) => item.text || JSON.stringify(item))
              .join("\n");
          } else {
            content = JSON.stringify(result);
          }
        } else {
          content = String(result);
        }

        this.logger.log(`Successfully called MCP tool: ${toolName}`);

        return {
          success: true,
          result,
          content,
        };
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to call MCP tool '${toolName}': ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
        content: `Error: ${error.message}`,
      };
    }
  }

  /**
   * 健康检查 - 验证 MCP 服务器是否可用
   *
   * @param config MCP 服务器配置
   * @returns 服务器是否健康
   */
  async healthCheck(config: McpServerConfig): Promise<boolean> {
    try {
      await this.withClient(config, async (client) => {
        // 尝试获取工具列表作为健康检查
        await client.listTools();
      });
      return true;
    } catch (error: any) {
      this.logger.warn(
        `Health check failed for ${config.url}: ${error.message}`,
      );
      return false;
    }
  }
}
