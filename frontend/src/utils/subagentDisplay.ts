/**
 * 子代理展示项构建（输入区运行时胶囊的「子代理」段与子代理列表面板共用）
 *
 * 从概览面板「子代理」区搬迁：活跃/已结束拆分、运行状态映射、
 * workflow 成员子代理过滤（它们的进度/跳转由工作流卡片与审阅标签承载，
 * 数量随 run 增长，不过滤会让列表无限增长）。
 *
 * 关键语义：子代理会话没有「冻结/关闭」态。一次运行结束只是运行结束，
 * 会话随时可被 job_send 恢复。「活跃 vs 已结束」的唯一判据是**有没有活跃流**，
 * 后端 closedAt 仅作「最近一次运行结束时间」展示，不参与分组判断。
 */
import type { Session } from "@/types/session";

export type SubagentStatus = "running" | "completed" | "error";

export interface SubagentItem {
  id: string;
  title: string;
  avatarUrl?: string | null;
  /** 上一次运行已结束（没有再跑）：仍可点开回放，也随时可被 job_send 唤醒 */
  ended: boolean;
  status: SubagentStatus;
}

/**
 * 构建子代理展示项。
 *
 * @param subSessions 会话的子会话列表（ChatPage 维护，含已结束的）
 * @param peekStreamStatus 运行状态读取（渲染路径必须用 peek 版，避免写响应式 Map）
 */
export function buildSubagentItems(
  subSessions: readonly Session[] | undefined,
  peekStreamStatus: (id: string) => string | undefined,
  fallbackTitle: string,
): SubagentItem[] {
  return (subSessions ?? [])
    .filter((s) => {
      // workflow 成员的归属标记写在 settings 开放字典的 workflow 键上
      const settings = s.settings as { workflow?: { runId?: unknown } } | undefined;
      return !settings?.workflow?.runId;
    })
    .map((s) => {
      const streamStatus = peekStreamStatus(s.id);
      // 流状态表是主判据；基线拉取时它可能尚未写入，用会话自带的 isStreaming 兜底，
      // 避免刚 fetchSession 回来的运行中子代理被瞬间误判成「已结束」。
      const running = streamStatus === "running" || (streamStatus === undefined && s.isStreaming === true);
      // 刷新后流状态表为空，用后端记下的「上次运行结束原因」还原失败态
      const endedAsError = !running && streamStatus === undefined && !!s.closeReason && s.closeReason !== "completed";
      return {
        id: s.id,
        title: s.title || fallbackTitle,
        avatarUrl: s.avatarUrl || s.agent?.avatarUrl || null,
        // 判据只看活跃流：没有流就是上一次运行已结束（不是会话被关掉）
        ended: !running,
        status: running
          ? ("running" as const)
          : streamStatus === "error" || endedAsError
            ? ("error" as const)
            : ("completed" as const),
      };
    });
}

/** 运行中在前、已结束在后（各自保持创建顺序） */
export function splitSubagents(items: readonly SubagentItem[]): {
  active: SubagentItem[];
  ended: SubagentItem[];
} {
  return {
    active: items.filter((i) => !i.ended),
    ended: items.filter((i) => i.ended),
  };
}

/** 运行中数量 */
export function countRunningSubagents(items: readonly SubagentItem[]): number {
  return items.filter((i) => i.status === "running").length;
}
