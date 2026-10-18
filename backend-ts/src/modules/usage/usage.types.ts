/**
 * Token 用量统计的领域类型（采集/存储/聚合共用）。
 *
 * 数据源是 `sessions/_meta.db` 的 `model_usage` 明细表：
 * 一行 = 一次 LLM 请求尝试（重试会产生多行），回合/会话/日维度全部由 SQL 聚合。
 */

import type { StreamUsage } from "../../common/types/stream-chunk.types";
import type { UsageSource } from "../llm-core/types/llm.types";

export type { UsageSource } from "../llm-core/types/llm.types";

export type UsageRange = "7d" | "30d" | "all";

export type UsageStatus = "completed" | "error" | "cancelled";

/** 写入一条模型调用明细（LLMService 观测结果 → 账本） */
export interface ModelUsageRecordInput {
  /** 幂等主键；缺省由 session/requestId/attempt 组合生成 */
  id?: string;
  /** 逻辑请求 id（主回合 = assistant messageId） */
  logicalRequestId?: string | null;
  attemptIndex?: number;
  sessionId?: string | null;
  turnId?: string | null;
  assistantMessageId?: string | null;
  source: UsageSource;
  providerId?: string | null;
  modelId: string;
  status: UsageStatus;
  startedAt: number;
  firstTokenAt?: number | null;
  completedAt: number;
  finishReason?: string | null;
  usage?: StreamUsage | null;
  errorType?: string | null;
  errorMessage?: string | null;
}

export interface UsageQueryInput {
  range: UsageRange;
  /** 调用端时区偏移：分钟，东八区 = 480 */
  tzOffsetMinutes: number;
  timeZone?: string;
  /** 测试注入；缺省 Date.now() */
  now?: number;
}

/** 聚合查询的原始行（UsageStore → UsageService 组装快照） */
export interface UsageTotalsRow {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  errorCount: number;
  usageMissingCount: number;
  avgTimeToFirstTokenMs: number | null;
  avgDurationMs: number | null;
  sessionCount: number;
  turnCount: number;
}

export interface UsageDailyRow {
  dayIndex: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
}

export interface UsageDayModelRow {
  dayIndex: number;
  providerId: string;
  modelId: string;
  totalTokens: number;
}

export interface UsageModelRow {
  providerId: string;
  modelId: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requestCount: number;
}

export interface UsageSourceRow {
  source: string;
  totalTokens: number;
  requestCount: number;
}

export interface UsageSessionRow {
  sessionId: string;
  title: string | null;
  sessionType: string | null;
  totalTokens: number;
  requestCount: number;
  lastUsedAt: number;
}

export interface UsageQueryRows {
  since: number;
  until: number;
  totals: UsageTotalsRow;
  daily: UsageDailyRow[];
  /** 热力图固定 30 天窗口的日聚合（与 range 无关） */
  heatmapDaily: UsageDailyRow[];
  dayModels: UsageDayModelRow[];
  models: UsageModelRow[];
  sources: UsageSourceRow[];
  sessions: UsageSessionRow[];
}

// ==================== API 快照 ====================

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  usageMissingCount: number;
  sessionCount: number;
  turnCount: number;
  activeDays: number;
  currentStreakDays: number;
  longestStreakDays: number;
  peakDayTokens: number;
  avgTimeToFirstTokenMs: number | null;
  avgDurationMs: number | null;
  favoriteModel: {
    providerId: string;
    modelId: string;
    totalTokens: number;
    share: number;
  } | null;
}

export interface UsageDailyPoint {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  models: Array<{ providerId: string; modelId: string; totalTokens: number }>;
}

export interface UsageHeatmapCell {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  totalTokens: number;
  requestCount: number;
}

export interface UsageHeatmapWeek {
  weekIndex: number;
  days: Array<UsageHeatmapCell | null>;
}

export interface UsageModelStat {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requestCount: number;
  share: number;
}

export interface UsageSourceStat {
  source: string;
  totalTokens: number;
  requestCount: number;
  share: number;
}

export interface UsageSessionStat {
  sessionId: string;
  title: string | null;
  sessionType: string | null;
  totalTokens: number;
  requestCount: number;
  lastUsedAt: number;
}

export interface UsageSnapshot {
  range: UsageRange;
  generatedAt: number;
  timeZone: string;
  /** 数据来源标识：本地账本（区别于 zcode 的 monitor 接口） */
  source: "local-usage-db";
  summary: UsageSummary;
  daily: UsageDailyPoint[];
  heatmap: {
    startDate: string;
    endDate: string;
    maxTokens: number;
    weeks: UsageHeatmapWeek[];
  };
  models: UsageModelStat[];
  sources: UsageSourceStat[];
  sessions: UsageSessionStat[];
}
