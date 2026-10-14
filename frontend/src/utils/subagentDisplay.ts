/**
 * 子代理展示项构建（输入区运行时胶囊的「子代理」段与子代理列表面板共用）
 *
 * 从概览面板「子代理」区的展示层逻辑搬迁：活跃/冻结拆分、运行状态映射、
 * workflow 成员子代理过滤（它们的进度/跳转由工作流卡片与审阅标签承载，
 * 且为 persist 生命周期永不 close，不过滤会让列表无限增长）。
 */
import type { Session } from "@/types/session";

export type SubagentStatus = "running" | "completed" | "error";

export interface SubagentItem {
  id: string;
  title: string;
  avatarUrl?: string | null;
  /** 已冻结（close / one_shot 结束，后端 closedAt 标记）：仅供回放 */
  frozen: boolean;
  status: SubagentStatus;
}

/**
 * 构建子代理展示项。
 *
 * @param subSessions 会话的子会话列表（ChatPage 维护，含已冻结的）
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
      return {
        id: s.id,
        title: s.title || fallbackTitle,
        avatarUrl: s.avatarUrl || s.agent?.avatarUrl || null,
        frozen: !!s.closedAt,
        status:
          streamStatus === "running"
            ? ("running" as const)
            : streamStatus === "error"
              ? ("error" as const)
              : ("completed" as const),
      };
    });
}

/** 活跃在前、冻结在后（各自保持创建顺序） */
export function splitSubagents(items: readonly SubagentItem[]): {
  active: SubagentItem[];
  frozen: SubagentItem[];
} {
  return {
    active: items.filter((i) => !i.frozen),
    frozen: items.filter((i) => i.frozen),
  };
}

/** 运行中数量（仅统计未冻结项，与旧概览区口径一致） */
export function countRunningSubagents(items: readonly SubagentItem[]): number {
  return items.filter((i) => !i.frozen && i.status === "running").length;
}
