import type { ApiContext } from "./api-context";

export type UsageRange = "7d" | "30d" | "all";

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
  models: Array<{
    providerId: string;
    modelId: string;
    totalTokens: number;
  }>;
}

/** 月度趋势点（仅 range=all 使用，date 为 YYYY-MM） */
export interface UsageMonthlyPoint {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  models: Array<{
    providerId: string;
    modelId: string;
    totalTokens: number;
  }>;
}

export interface UsageHeatmapCell {
  date: string;
  level: 0 | 1 | 2 | 3 | 4;
  totalTokens: number;
  requestCount: number;
  /** 未来日期占位：仅用于补齐当前周，不参与统计 */
  future?: boolean;
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
  source: "local-usage-db";
  summary: UsageSummary;
  daily: UsageDailyPoint[];
  /** 月度趋势：仅 range=all 有值，最多 12 个月 */
  monthly: UsageMonthlyPoint[];
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

export interface FetchUsageStatsOptions {
  range: UsageRange;
  /** 东八区 = 480（-new Date().getTimezoneOffset()） */
  tzOffsetMinutes?: number;
  timeZone?: string;
}

export interface UsageApi {
  fetchUsageStats(options: FetchUsageStatsOptions): Promise<UsageSnapshot>;
  /** 清空全部本地用量统计（不影响会话消息） */
  clearUsageStats(): Promise<{ success: boolean; deleted: number }>;
}

export const usageApi: UsageApi = {
  async fetchUsageStats(this: ApiContext, options: FetchUsageStatsOptions) {
    const tzOffsetMinutes =
      options.tzOffsetMinutes ?? -new Date().getTimezoneOffset();
    const timeZone =
      options.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC";
    const params = new URLSearchParams({
      range: options.range,
      tzOffsetMinutes: String(tzOffsetMinutes),
      timeZone,
    });
    return await this._request<UsageSnapshot>(
      `/usage/stats?${params.toString()}`,
    );
  },

  async clearUsageStats(this: ApiContext) {
    return await this._request<{ success: boolean; deleted: number }>(
      "/usage/stats",
      { method: "DELETE" },
    );
  },
};
