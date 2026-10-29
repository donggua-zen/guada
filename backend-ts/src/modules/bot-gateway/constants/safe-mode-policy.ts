import type { ToolPolicy } from '../../../common/types/tool-policy';

/**
 * 非管理员「安全模式」允许的工具（模型可见名）。
 *
 * 维护原则：只读、无本地命令执行、无任意路径文件读写、无委派/调度/远程操作。
 * 这里按工具名而不是工具包放行，避免整包放行时带出写工具
 * （例如 knowledge_base 包里的 kb_add_document）。
 */
export const SAFE_MODE_ALLOWED_TOOLS = [
  // 网络搜索（需在插件设置中全局启用 web-search）
  'web_search',
  'web_parser',
  // 知识库只读
  'kb_search',
  'kb_list_files',
  'kb_get_chunks',
  // 无副作用
  'get_current_time',
  // 惰性工具通道：allTools 会同步过滤，只能调出上面的白名单工具
  'tool_use',
  'tool_learn',
] as const;

/** MCP 工具统一前缀（见 mcp-tool-name.ts）：按前缀放行智能体已绑定的全部 MCP */
export const SAFE_MODE_ALLOWED_TOOL_PREFIXES = ['mcp__'] as const;

/**
 * 构造非管理员回合的工具策略。
 *
 * MCP 不做额外筛选：只放行 mcp__ 前缀，实际可见的 server 仍由智能体绑定与
 * 全局 MCP 配置决定（安全模式不额外收窄，也不额外放开）。
 */
export function buildSafeModeToolPolicy(): ToolPolicy {
  return {
    allowedTools: [...SAFE_MODE_ALLOWED_TOOLS],
    allowedToolPrefixes: [...SAFE_MODE_ALLOWED_TOOL_PREFIXES],
  };
}
