/**
 * 工作流工具名常量（后端 workflow 插件注册；resolveToolName 已兼容 legacy tool_use 包装）
 *
 * 单一来源：独立成行判定（toolDisplay 的 STANDALONE_TOOL_NAMES）与专用行组件
 * （WorkflowRunInlineCard）共用同一份名单，避免两处硬编码漂移（同 subAgentTools 范式）。
 */

/** 执行工作流编排脚本（前台阻塞到整段 finish） */
export const WORKFLOW_RUN_TOOL = "workflow_run";
