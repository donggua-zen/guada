import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  McpConnectionManager,
} from "./mcp-connection-manager.service";
import {
  McpCallOptions,
  McpServerConfig,
  McpToolCallResult,
} from "./mcp.types";

// 历史类型在本文件导出，保持既有引用可用（传输配置 + 调用结果）
export type { McpServerConfig, McpToolCallResult } from "./mcp.types";

/**
 * MCP 客户端服务
 *
 * 提供与 MCP 服务器通信的标准化接口：
 * - 获取工具列表 (listTools)
 * - 调用远程工具 (callTool)
 * - 连通性探测 (healthCheck)
 *
 * 连接本身由 `McpConnectionManager` 负责（复用 / 续活 / 回收）——本服务只保留协议层的
 * 请求构造与结果塑形，不再自己建连。这样既让运行期调用摆脱「每次调用重连」，也让
 * 传输细节（stdio/sse/streamableHttp 选择、进程回收、超时）只有一处实现。
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);

  constructor(private readonly connections: McpConnectionManager) {}

  /**
   * 从 MCP 服务器获取工具列表
   *
   * 走短连接：这是配置期操作，且可能面向正在编辑或有故障的服务器，
   * 池化会让这类连接白占空闲 TTL。
   *
   * @returns 工具列表字典（以工具名为键）
   */
  async listTools(
    config: McpServerConfig,
    options: McpCallOptions = {},
  ): Promise<Record<string, any>> {
    const toolsDict = await this.connections.withEphemeralConnection(
      config,
      options.serverId,
      async (client: Client) => {
        const result = await client.listTools(undefined, {
          signal: options.signal,
          timeout: options.timeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
        });
        const tools = result.tools || [];

        // 转换为以工具名为键的字典格式
        const dict: Record<string, any> = {};
        for (const tool of tools) {
          if (tool && typeof tool === "object" && tool.name) {
            dict[tool.name] = tool;
          }
        }
        return dict;
      },
      options,
    );

    this.logger.log(
      `Fetched ${Object.keys(toolsDict).length} tools from ${describeTarget(config)}`,
    );
    return toolsDict;
  }

  /**
   * 调用 MCP 工具
   *
   * 走池化连接：连接跨调用复用，保留协议会话与服务器内存状态。
   *
   * @param config 服务器传输配置
   * @param toolName 工具名称（原始名，不含 mcp__ 前缀）
   * @param toolArgs 工具参数
   * @param options serverId / 取消信号 / 超时
   */
  async callTool(
    config: McpServerConfig,
    toolName: string,
    toolArgs: Record<string, any>,
    options: McpCallOptions = {},
  ): Promise<McpToolCallResult> {
    try {
      return await this.connections.withPooledConnection(
        config,
        options.serverId,
        async (client: Client) => {
          // 注意参数位置：SDK 的签名是 callTool(params, resultSchema?, options?)，
          // options 在第三位——传错位置会让取消与超时静默失效。
          const result = await client.callTool(
            { name: toolName, arguments: toolArgs },
            undefined,
            {
              signal: options.signal,
              // 显式设超时：SDK 缺省是 60s，挂死的服务器会拖住整轮对话
              timeout: options.timeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS,
            },
          );

          const content = flattenToolResult(result);

          // CallToolResult.isError 是协议级失败标记（工具自身报错，而非链路故障）。
          // 必须透传给工具执行器：否则模型会把错误文本当成工具的正常输出使用。
          const isError = (result as any)?.isError === true;
          if (isError) {
            this.logger.warn(`MCP tool returned error: ${toolName}`);
          } else {
            this.logger.log(`Successfully called MCP tool: ${toolName}`);
          }

          return { success: !isError, result, content, isError };
        },
      );
    } catch (error: any) {
      const message = describeError(error);
      this.logger.error(`Failed to call MCP tool '${toolName}': ${message}`);
      return {
        success: false,
        error: message,
        content: `Error: ${message}`,
        // 链路级失败同样是失败：不透传的话模型会把错误当数据用
        isError: true,
      };
    }
  }

  /**
   * 健康检查 - 验证 MCP 服务器是否可用
   *
   * 语义见 McpConnectionManager.checkHealth：以「能建连并完成 tools/list」为准，
   * 而不是只看可选的 ping——否则会出现「刷新工具成功、测试连接失败」的矛盾结论。
   */
  async healthCheck(
    config: McpServerConfig,
    options: McpCallOptions = {},
  ): Promise<boolean> {
    return await this.connections.checkHealth(config, options.serverId, options);
  }
}

/** 把 CallToolResult 的 content 数组拍平成文本 */
function flattenToolResult(result: unknown): string {
  if (result && typeof result === "object") {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      return content
        .map((item: any) => item?.text ?? JSON.stringify(item))
        .join("\n");
    }
    // 结构化输出（outputSchema）场景下 content 可能为空，退回整体序列化
    return JSON.stringify(result);
  }
  return String(result);
}

/**
 * 组装可读的失败原因。
 *
 * 保留改造前对 `cause` / `response` 的提取：MCP 的失败常常只有这两处带真实原因
 * （前者是 undici 的网络错误，后者是 HTTP 状态与响应体），丢了就只剩一句无用的
 * "fetch failed"。
 */
function describeError(error: any): string {
  const base = error?.message || String(error);
  if (error?.response) {
    return `${base} (Response status: ${error.response.status}, body: ${JSON.stringify(error.response.data)})`;
  }
  if (error?.cause?.message) {
    return `${base} (Cause: ${error.cause.message})`;
  }
  return base;
}

function describeTarget(config: McpServerConfig): string {
  return config.url || config.command || "unknown target";
}
