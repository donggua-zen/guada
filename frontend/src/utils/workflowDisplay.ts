/**
 * 工作流展示的纯格式化/文案（对话流内联卡片与工作流审阅面板共用）
 *
 * 不含 vue-i18n 依赖：需要翻译的文案由调用方传入 tr（(key) => t(key)），
 * 避免 util 绑死 i18n 实例，也避免三处各写一份截断/时长口径。
 */
import type {
  WorkflowAgentState,
  WorkflowMemberStatus,
  WorkflowRunState,
} from "@/types/stream/workflow.types";

/** 翻译函数最小契约（组件传 tr = (key) => t(key)） */
export type Translate = (key: string) => string;

const STATUS_I18N_KEY: Record<WorkflowMemberStatus, string> = {
  running: "chat.workspace.wfRunning",
  completed: "chat.workspace.wfCompleted",
  failed: "chat.workspace.wfFailed",
  cancelled: "chat.workspace.wfCancelled",
};

/** 运行/成员状态文案（运行中 / 已完成 / 失败 / 已取消） */
export function workflowStatusText(tr: Translate, status: WorkflowMemberStatus): string {
  return tr(STATUS_I18N_KEY[status] ?? status);
}

/** 运行时长：<1s 毫秒精度，<60s 一位小数秒，≥60s m+s */
export function formatRunDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * run 行右侧元信息：运行中显示成员进度「完成数/总数」（尚无成员 → 启动中），
 * 结束后显示耗时，无耗时回落状态文案。
 */
export function workflowRunMetaText(tr: Translate, run: WorkflowRunState): string {
  if (run.status === "running") {
    if (run.agents.length === 0) return tr("chat.workspace.wfStarting");
    const active = run.agents.filter((a) => a.status === "running").length;
    return `${run.agents.length - active}/${run.agents.length}`;
  }
  if (run.durationMs !== undefined) return formatRunDuration(run.durationMs);
  return workflowStatusText(tr, run.status);
}

/** 成员行次行：输出摘要（截断 40 字）· 状态 */
export function workflowAgentSubText(tr: Translate, agent: WorkflowAgentState): string {
  const summary = (agent.outputSummary || "").replace(/\s+/g, " ").trim();
  const truncated = summary.length > 40 ? summary.slice(0, 40) + "…" : summary;
  return truncated
    ? `${truncated} · ${workflowStatusText(tr, agent.status)}`
    : workflowStatusText(tr, agent.status);
}

/** 脚本返回值展示（string 原样，其余 JSON pretty） */
export function formatWorkflowResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
