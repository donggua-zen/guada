/**
 * MCP 客户端侧的类型契约
 *
 * 独立成文件的原因：连接管理器与 McpClientService 互相引用，类型放任一侧都会形成
 * 循环依赖（CommonJS 下表现为运行期 undefined）。
 *
 * 注意与 `modules/mcp-servers/mcp-file.store.ts` 的 `McpServerConfig` 区分：
 * 那个是**持久化行**（含 id/name/enabled/createdAt），这里只是**建立连接所需的传输参数**。
 */

/** 传输协议类型（对外接受多种写法，由 resolveTransportKind 归一） */
export type McpTransportKind = "stdio" | "sse" | "streamableHttp";

/** 建立一次 MCP 连接所需的全部参数 */
export interface McpServerConfig {
  /** HTTP 协议的 URL */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, any>;
  /** 协议类型；缺省时按 command 是否存在推断，否则默认 streamableHttp */
  type?: "sse" | "streamableHttp" | "stdio" | string;
  /** stdio 协议的可执行文件 */
  command?: string;
  /** stdio 协议的参数 */
  args?: string[];
  /** stdio 协议的环境变量（与 process.env 合并） */
  env?: Record<string, string>;
  /** stdio 协议的工作目录 */
  cwd?: string;
}

/** 一次 MCP 工具调用/连接操作的结果 */
export interface McpToolCallResult {
  success: boolean;
  result?: any;
  content?: string;
  error?: string;
  /**
   * MCP 协议层的工具失败标记（CallToolResult.isError）。
   *
   * 上游必须透传给工具执行器，否则模型会把「错误文本」当成工具的正常输出使用
   * （见 docs/technical-debt.md 的 MCP callTool 不透传 isError 条目）。
   */
  isError?: boolean;
}

/** 调用方可传入的 MCP 操作选项 */
export interface McpCallOptions {
  /**
   * 服务端配置行 id，用于连接归属与显式失效。
   * 缺省时仅按传输参数哈希归类（创建服务器时尚未落盘、没有 id 的场景）。
   */
  serverId?: string;
  /** 取消信号；透传到 SDK 的 RequestOptions，使「停止生成」能真正中断在途请求 */
  signal?: AbortSignal;
  /** 单次请求超时（毫秒）；缺省 DEFAULT_MCP_REQUEST_TIMEOUT_MS */
  timeoutMs?: number;
}

/** 传输协议归一：把前端/文件里的多种写法折叠成三种真实协议 */
export function resolveTransportKind(config: McpServerConfig): McpTransportKind {
  const raw = typeof config.type === "string" ? config.type.toLowerCase() : "";
  // 下划线变体（streamable_http / streamablehttp）与驼峰写法等价
  const compact = raw.replace(/[-_]/g, "");
  if (compact === "sse") return "sse";
  if (compact === "stdio") return "stdio";
  if (compact === "streamablehttp") return "streamableHttp";
  // 未声明类型时按字段推断：有 command 即 stdio，否则 HTTP 系
  return config.command ? "stdio" : "streamableHttp";
}
