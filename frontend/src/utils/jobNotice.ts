/**
 * 后台作业完成通知的渲染契约（纯函数，便于单测）。
 *
 * 后端 JobNotifierService.buildSource 会把"作业完成"注入成一条 role='user' 的消息，
 * 唯一分流依据是 source.kind：
 * - process_monitor：shell / remote-shell / pty
 * - sub_agent：子代理
 *
 * 前端据此刻意**不占用户气泡**（TurnItem）并渲染成 EventCard 的 job-notice 折叠卡。
 * 词表写错（例如后端改成 job_notice）会让消息静默退化成"用户气泡里一段
 * <system_reminder> 原文"，所以判定收在一处并由单测兜住。
 */

/** 通知类消息的 source.kind 词表（与后端 buildSource 一一对应） */
export const JOB_NOTICE_SOURCE_KINDS = ["process_monitor", "sub_agent"] as const;

export type JobNoticeSourceKind = (typeof JOB_NOTICE_SOURCE_KINDS)[number];

/** 该 source.kind 是否属于"作业完成通知"（数据仍是 role='user'，只是渲染分流） */
export function isJobNoticeSource(kind: unknown): kind is JobNoticeSourceKind {
  return (
    typeof kind === "string" &&
    (JOB_NOTICE_SOURCE_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * 事件卡片类型：metadata.eventType 优先（event 外壳/束），
 * 通知类消息以 source.kind 兜底 → 'job-notice'，其余返回空串（不是事件卡）。
 */
export function resolveNoticeEventType(input: {
  declared?: unknown;
  sourceKind?: unknown;
}): string {
  if (input.declared) return String(input.declared);
  return isJobNoticeSource(input.sourceKind) ? "job-notice" : "";
}
