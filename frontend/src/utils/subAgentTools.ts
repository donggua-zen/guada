/**
 * 子代理工具名常量（后端 sub-agent 插件注册；resolveToolName 已兼容 legacy tool_use 包装）
 *
 * 单一来源：会话关联解析（subAgentLink）与独立成行判定（toolDisplay）共用同一份名单，
 * 避免两处硬编码漂移。
 *
 * 注：subagent_manager 工具已随工具收敛删除（后台子代理统一走 job_read/job_send/job_stop）；
 * 历史会话回放里 manager 的结果行没有专属跳转（走 meta.link 兜底），不再解析它的 args。
 */

/** 派生新子代理 */
export const SUB_AGENT_SPAWN_TOOL = "subagent_spawn";

/** 全部子代理工具 */
export const SUB_AGENT_TOOLS: ReadonlySet<string> = new Set([
  SUB_AGENT_SPAWN_TOOL,
]);
