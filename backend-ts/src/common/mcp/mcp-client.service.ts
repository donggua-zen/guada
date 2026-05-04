import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as process from "process";



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
 * Stdio 服务器参数接口
 */
export interface StdioServerParams {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * MCP 服务器配置接口
 */
export interface McpServerConfig {
  url?: string; // HTTP 协议的 URL
  headers?: Record<string, any>; // HTTP 请求头
  type?: "sse" | "streamableHttp" | "stdio"; // 协议类型
  command?: string; // stdio 协议的命令
  args?: string[]; // stdio 协议的参数
  env?: Record<string, string>; // stdio 协议的环境变量
  cwd?: string; // stdio 协议的工作目录
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

    // 根据 type 字段选择传输协议
    const specifiedType = config.type?.toLowerCase();

    if (specifiedType === "sse") {
      this.logger.debug(`Using SSE protocol for ${config.url}`);
    } else if (specifiedType === "streamableHttp") {
      this.logger.debug(`Using Streamable HTTP protocol for ${config.url}`);
    } else if (specifiedType === "stdio") {
      this.logger.debug(
        `Using Stdio protocol with command: ${config.command}`,
      );
    } else {
      this.logger.debug(
        `No protocol type specified for ${config.url}, defaulting to Streamable HTTP`,
      );
    }

    try {
      let transport: any;

      // 根据 type 字段创建对应的传输协议
      if (specifiedType === "stdio") {
        // 使用 Stdio 协议
        if (!config.command) {
          throw new Error(
            "Stdio protocol requires 'command' parameter in config",
          );
        }

        this.logger.debug(
          `Creating StdioClientTransport with command: ${config.command} ${config.args?.join(" ") || ""}`,
        );

        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
          cwd: config.cwd,
        });
      } else if (specifiedType === "sse") {
        // 使用 SSE 协议
        if (!config.url) {
          throw new Error("SSE protocol requires 'url' parameter in config");
        }

        // SSE 协议：SDK 会自动处理 Accept 和 Content-Type
        // 只传递用户自定义的 headers，不添加任何默认头
        const requestHeaders = config.headers ? { ...config.headers } : undefined;

        this.logger.debug(`Creating SSEClientTransport for ${config.url}`);
        transport = new SSEClientTransport(new URL(config.url), {
          requestInit: {
            headers: requestHeaders,
          },
        });
      } else {
        // 默认使用 Streamable HTTP 协议
        if (!config.url) {
          throw new Error(
            "Streamable HTTP protocol requires 'url' parameter in config",
          );
        }

        const requestHeaders = { ...(config.headers || {}) };
        if (!requestHeaders["Content-Type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }
        if (!requestHeaders["Accept"]) {
          requestHeaders["Accept"] = "application/json, text/event-stream";
        }

        this.logger.debug(
          `Creating StreamableHTTPClientTransport for ${config.url}`,
        );
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: requestHeaders,
          },
        });
      }

      client = new Client({ name: "ts-backend", version: "1.0.0" });

      // 添加连接超时保护
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Connection timeout after 10s")),
          10000,
        );
      });

      await Promise.race([connectPromise, timeoutPromise]);
      this.logger.debug(
        `Connected to MCP server via ${specifiedType || "StreamableHTTP"}: ${config.command || config.url}`,
      );

      // 连接成功，执行操作
      const result = await operation(client);
      return result;
    } catch (error: any) {
      // 提供更详细的错误信息
      let errorMessage = error.message;
      let errorDetails = "";

      if (error.response) {
        errorDetails = `Response status: ${error.response.status}, body: ${JSON.stringify(error.response.data)}`;
      } else if (error.cause) {
        errorDetails = `Cause: ${error.cause.message}`;
      }

      const fullErrorMessage = errorDetails
        ? `${errorMessage} (${errorDetails})`
        : errorMessage;

      this.logger.error(
        `MCP client operation failed for ${config.command || config.url}: ${fullErrorMessage}`,
        error.stack,
      );

      // 包装错误以便上层处理
      const wrappedError = new Error(
        `MCP connection failed: ${fullErrorMessage}`,
      );
      (wrappedError as any).originalError = error;
      throw wrappedError;
    } finally {
      // 确保连接被关闭
      if (client) {
        try {
          await client.close();
          this.logger.debug(
            `Closed connection to MCP server: ${config.command || config.url}`,
          );
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
