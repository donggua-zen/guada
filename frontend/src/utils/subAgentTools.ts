/**
 * 子代理工具名常量（后端 sub-agent 插件注册；resolveToolName 已兼容 legacy tool_use 包装）
 *
 * 单一来源：会话关联解析（subAgentLink）与独立成行判定（toolDisplay）共用同一份名单，
 * 避免两处硬编码漂移。
 */

/** 派生新子代理 */
export const SUB_AGENT_SPAWN_TOOL = "subagent_spawn";

/** 管理已有子代理（wait / list / close / send_message） */
export const SUB_AGENT_MANAGER_TOOL = "subagent_manager";

/** 全部子代理工具（含派生与管理） */
export const SUB_AGENT_TOOLS: ReadonlySet<string> = new Set([
  SUB_AGENT_SPAWN_TOOL,
  SUB_AGENT_MANAGER_TOOL,
]);
