/**
 * Token 用量统计服务。
 *
 * 职责：
 * - 采集：LLMService 每次调用结束后写入一条 `model_usage`（失败只告警，不影响对话）
 * - 聚合：把 SQL 行组装成前端快照（summary / daily / heatmap / models / sources / sessions）
 *
 * 统计口径：
 * - inputTokens = provider prompt tokens（adapter 已把 cache read/write 加回，见 anthropic.adapter）
 * - totalTokens = provider total，缺失时 input + output
 * - cacheHitRate = cacheRead / inputTokens（分母不再叠加 cache，避免命中率被压低）
 */

import { Injectable, Logger } from "@nestjs/common";

import type { UsageSource } from "../llm-core/types/llm.types";
import { UsageStore, DAY_MS } from "./usage.store";
import type {
  ModelUsageRecordInput,
  UsageDailyPoint,
  UsageHeatmapCell,
  UsageHeatmapWeek,
  UsageModelStat,
  UsageMonthlyPoint,
  UsageQueryInput,
  UsageQueryRows,
  UsageSnapshot,
  UsageSourceStat,
} from "./usage.types";

const PURPOSE_SOURCE: Record<string, UsageSource> = {
  compaction: "compaction",
  session_title: "session_title",
  commit_message: "commit_message",
  memory_sync: "memory_sync",
  image_recognition: "image_recognition",
};

/** 图表最多展示的天数：all 范围也只看近一年趋势，汇总仍为全量 */
const MAX_CHART_DAYS = 366;
/** 热力图固定窗口：近一年（53 周，按周日对齐），与所选 range 解耦 */
const HEATMAP_WEEKS = 53;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly store: UsageStore) {}

  /** 用途 → 统计来源；显式 source 优先 */
  resolveSource(input: {
    source?: UsageSource;
    purpose?: string | null;
    sessionId?: string | null;
  }): UsageSource {
    if (input.source) return input.source;
    if (input.purpose && PURPOSE_SOURCE[input.purpose]) {
      return PURPOSE_SOURCE[input.purpose];
    }
    return input.sessionId ? "main_turn" : "other";
  }

  /** 写入明细；异常只告警（观测失败绝不能改变 Agent 业务语义） */
  recordSafely(input: ModelUsageRecordInput): void {
    try {
      this.store.record(input);
    } catch (error: any) {
      this.logger.warn(
        `用量明细写入失败（session=${input.sessionId ?? "-"}, source=${
          input.source
        }）：${error?.message ?? error}`,
      );
    }
  }

  /** 回填专用：已存在的同名记录保留线上真值 */
  recordBackfill(input: ModelUsageRecordInput): boolean {
    try {
      return this.store.record(input, { ignoreExisting: true });
    } catch (error: any) {
      this.logger.warn(
        `用量回填写入失败（session=${input.sessionId ?? "-"}）：${
          error?.message ?? error
        }`,
      );
      return false;
    }
  }

  deleteBySession(sessionId: string): number {
    try {
      return this.store.deleteBySession(sessionId);
    } catch (error: any) {
      this.logger.warn(`删除会话用量失败（session=${sessionId}）：${error?.message ?? error}`);
      return 0;
    }
  }

  /** 清空全部用量明细（所有会话、全部时间） */
  clearAll(): number {
    try {
      return this.store.clearAll();
    } catch (error: any) {
      this.logger.warn(`清空用量失败：${error?.message ?? error}`);
      return 0;
    }
  }

  pruneOrphans(): number {
    return this.store.pruneOrphans();
  }

  getSnapshot(input: UsageQueryInput): UsageSnapshot {
    const rows = this.store.query(input);
    const offsetMs = clampOffsetMinutes(input.tzOffsetMinutes) * 60_000;
    const endDayIndex = Math.floor((rows.until + offsetMs) / DAY_MS);

    const dailyMap = new Map(rows.daily.map((row) => [row.dayIndex, row]));
    const heatmapDailyMap = new Map(
      rows.heatmapDaily.map((row) => [row.dayIndex, row]),
    );
    const modelsByDay = new Map<
      number,
      Array<{ providerId: string; modelId: string; totalTokens: number }>
    >();
    for (const row of rows.dayModels) {
      const list = modelsByDay.get(row.dayIndex) ?? [];
      list.push({
        providerId: row.providerId,
        modelId: row.modelId,
        totalTokens: Number(row.totalTokens),
      });
      modelsByDay.set(row.dayIndex, list);
    }

    const dataStartDayIndex = dailyMap.size
      ? Math.min(...dailyMap.keys())
      : endDayIndex;
    const rangeStartDayIndex =
      input.range === "all"
        ? dataStartDayIndex
        : Math.floor((rows.since + offsetMs) / DAY_MS);
    const rangeEndDayIndex = Math.max(rangeStartDayIndex, endDayIndex);

    // 图表窗口按 MAX_CHART_DAYS 截断，避免多年数据把热力图/柱状图撑爆。
    // all 固定展示最近一年（即使没有数据也铺满热力图卡片）；
    // 7d/30d 跟随所选范围。
    const chartStartDayIndex =
      input.range === "all"
        ? Math.max(0, rangeEndDayIndex - (MAX_CHART_DAYS - 1))
        : rangeStartDayIndex;

    const daily: UsageDailyPoint[] = [];
    let peakDayTokens = 0;
    for (let dayIndex = chartStartDayIndex; dayIndex <= rangeEndDayIndex; dayIndex++) {
      const row = dailyMap.get(dayIndex);
      const totalTokens = Number(row?.totalTokens ?? 0);
      daily.push({
        date: dayIndexToDate(dayIndex),
        totalTokens,
        inputTokens: Number(row?.inputTokens ?? 0),
        outputTokens: Number(row?.outputTokens ?? 0),
        requestCount: Number(row?.requestCount ?? 0),
        models: modelsByDay.get(dayIndex) ?? [],
      });
    }

    // all 范围按“月”展示趋势（最多 12 个月）；7d/30d 仍按天。
    // 必须基于 rows.daily（全量历史），不能用上面已截断到 366 天的 daily 数组。
    const monthly =
      input.range === "all"
        ? buildMonthlyTrend(rows, endDayIndex)
        : [];

    // 热力图固定近一年：与 range 解耦，并按周日对齐成 53 个整周
    let heatmapStartDayIndex = Math.max(
      0,
      endDayIndex - (HEATMAP_DAYS - 1),
    );
    // 1970-01-01 是周四：+4 后取模 7 即为到最近周日的偏移
    heatmapStartDayIndex -= (heatmapStartDayIndex + 4) % 7;
    const heatmapPoints: UsageDailyPoint[] = [];
    for (let dayIndex = heatmapStartDayIndex; dayIndex <= endDayIndex; dayIndex++) {
      const row = heatmapDailyMap.get(dayIndex);
      heatmapPoints.push({
        date: dayIndexToDate(dayIndex),
        totalTokens: Number(row?.totalTokens ?? 0),
        inputTokens: Number(row?.inputTokens ?? 0),
        outputTokens: Number(row?.outputTokens ?? 0),
        requestCount: Number(row?.requestCount ?? 0),
        models: [],
      });
    }

    // 活跃天数/连续天数用完整范围（含图表窗口之外的历史）
    let activeDays = 0;
    let runningStreak = 0;
    let longestStreakDays = 0;
    let currentStreakDays = 0;
    let currentStreakBroken = false;
    for (let dayIndex = rangeStartDayIndex; dayIndex <= rangeEndDayIndex; dayIndex++) {
      const totalTokens = Number(dailyMap.get(dayIndex)?.totalTokens ?? 0);
      peakDayTokens = Math.max(peakDayTokens, totalTokens);
      if (totalTokens > 0) {
        activeDays++;
        runningStreak++;
        longestStreakDays = Math.max(longestStreakDays, runningStreak);
      } else {
        runningStreak = 0;
      }
    }
    for (let dayIndex = rangeEndDayIndex; dayIndex >= rangeStartDayIndex; dayIndex--) {
      const totalTokens = Number(dailyMap.get(dayIndex)?.totalTokens ?? 0);
      if (totalTokens > 0 && !currentStreakBroken) {
        currentStreakDays++;
      } else if (!currentStreakBroken) {
        currentStreakBroken = true;
      }
    }

    const totalModelTokens = rows.models.reduce(
      (sum, row) => sum + Number(row.totalTokens),
      0,
    );
    const models: UsageModelStat[] = rows.models.map((row) => ({
      providerId: row.providerId || "",
      providerName: row.providerId || "",
      modelId: row.modelId || "",
      modelName: row.modelId || "",
      totalTokens: Number(row.totalTokens),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      cacheReadTokens: Number(row.cacheReadTokens),
      requestCount: Number(row.requestCount),
      share: totalModelTokens > 0 ? Number(row.totalTokens) / totalModelTokens : 0,
    }));

    const totalSourceTokens = rows.sources.reduce(
      (sum, row) => sum + Number(row.totalTokens),
      0,
    );
    const sources: UsageSourceStat[] = rows.sources.map((row) => ({
      source: row.source,
      totalTokens: Number(row.totalTokens),
      requestCount: Number(row.requestCount),
      share: totalSourceTokens > 0 ? Number(row.totalTokens) / totalSourceTokens : 0,
    }));

    const totals = rows.totals;
    const requestCount = Number(totals.requestCount ?? 0);
    const inputTokens = Number(totals.inputTokens ?? 0);
    const cacheReadTokens = Number(totals.cacheReadTokens ?? 0);
    const errorCount = Number(totals.errorCount ?? 0);

    return {
      range: input.range,
      generatedAt: Date.now(),
      timeZone: input.timeZone || "UTC",
      source: "local-usage-db",
      summary: {
        totalTokens: Number(totals.totalTokens ?? 0),
        inputTokens,
        outputTokens: Number(totals.outputTokens ?? 0),
        reasoningTokens: Number(totals.reasoningTokens ?? 0),
        cacheReadTokens,
        cacheWriteTokens: Number(totals.cacheWriteTokens ?? 0),
        cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
        requestCount,
        errorCount,
        errorRate: requestCount > 0 ? errorCount / requestCount : 0,
        usageMissingCount: Number(totals.usageMissingCount ?? 0),
        sessionCount: Number(totals.sessionCount ?? 0),
        turnCount: Number(totals.turnCount ?? 0),
        activeDays,
        currentStreakDays,
        longestStreakDays,
        peakDayTokens,
        avgTimeToFirstTokenMs: roundNullable(totals.avgTimeToFirstTokenMs),
        avgDurationMs: roundNullable(totals.avgDurationMs),
        favoriteModel:
          models.length > 0
            ? {
                providerId: models[0].providerId,
                modelId: models[0].modelId,
                totalTokens: models[0].totalTokens,
                share: models[0].share,
              }
            : null,
      },
      daily,
      monthly,
      heatmap: buildHeatmap(heatmapPoints, heatmapStartDayIndex, endDayIndex),
      models,
      sources,
      sessions: rows.sessions.map((row) => ({
        sessionId: row.sessionId,
        title: row.title ?? null,
        sessionType: row.sessionType ?? null,
        totalTokens: Number(row.totalTokens),
        requestCount: Number(row.requestCount),
        lastUsedAt: Number(row.lastUsedAt),
      })),
    };
  }
}

/**
 * 把全量日聚合折叠成月度趋势。
 *
 * - 月份 key 直接取本地日期前 7 位（dayIndex 已含 tzOffset）
 * - 固定返回当前月及前 11 个月（共 12 个点），当前月永远在最右侧
 * - 中间无数据的月份补 0，保证柱子位置与时间轴稳定
 */
function buildMonthlyTrend(
  rows: UsageQueryRows,
  endDayIndex: number,
): UsageMonthlyPoint[] {
  const currentMonthIndex = monthKeyToIndex(
    dayIndexToDate(endDayIndex).slice(0, 7),
  );

  interface MonthBucket {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    requestCount: number;
    models: Map<
      string,
      { providerId: string; modelId: string; totalTokens: number }
    >;
  }

  const buckets = new Map<string, MonthBucket>();
  const bucketFor = (key: string): MonthBucket => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        models: new Map(),
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const row of rows.daily) {
    const key = dayIndexToDate(row.dayIndex).slice(0, 7);
    const bucket = bucketFor(key);
    bucket.totalTokens += Number(row.totalTokens);
    bucket.inputTokens += Number(row.inputTokens);
    bucket.outputTokens += Number(row.outputTokens);
    bucket.requestCount += Number(row.requestCount);
  }

  for (const row of rows.dayModels) {
    const key = dayIndexToDate(row.dayIndex).slice(0, 7);
    const bucket = bucketFor(key);
    const modelKey = `${row.providerId}:${row.modelId}`;
    const model = bucket.models.get(modelKey) ?? {
      providerId: row.providerId,
      modelId: row.modelId,
      totalTokens: 0,
    };
    model.totalTokens += Number(row.totalTokens);
    bucket.models.set(modelKey, model);
  }

  // 固定 12 个月：当前月永远在最右侧，避免只有少量数据时柱子被居中
  const startMonthIndex = currentMonthIndex - 11;

  const points: UsageMonthlyPoint[] = [];
  for (
    let monthIndex = startMonthIndex;
    monthIndex <= currentMonthIndex;
    monthIndex++
  ) {
    const key = monthIndexToKey(monthIndex);
    const bucket = buckets.get(key);
    points.push({
      date: key,
      totalTokens: bucket?.totalTokens ?? 0,
      inputTokens: bucket?.inputTokens ?? 0,
      outputTokens: bucket?.outputTokens ?? 0,
      requestCount: bucket?.requestCount ?? 0,
      models: bucket
        ? Array.from(bucket.models.values()).sort(
            (a, b) => b.totalTokens - a.totalTokens,
          )
        : [],
    });
  }
  return points;
}

/** YYYY-MM → 连续月序号（用于跨年加减） */
function monthKeyToIndex(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + (month - 1);
}

function monthIndexToKey(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildHeatmap(
  daily: UsageDailyPoint[],
  startDayIndex: number,
  endDayIndex: number,
): UsageSnapshot["heatmap"] {
  const maxTokens = daily.reduce((max, day) => Math.max(max, day.totalTokens), 0);
  const weeks: UsageHeatmapWeek[] = [];
  let week: Array<UsageHeatmapCell | null> = [];

  for (const day of daily) {
    week.push({
      date: day.date,
      level: levelFor(day.totalTokens, maxTokens),
      totalTokens: day.totalTokens,
      requestCount: day.requestCount,
    });
    if (week.length === 7) {
      weeks.push({ weekIndex: weeks.length, days: week });
      week = [];
    }
  }
  if (week.length > 0) {
    // 当前周不满 7 天：用未来日期补成浅色占位格，避免最右列只显示 1 个格子
    const lastDate = daily[daily.length - 1]?.date ?? dayIndexToDate(endDayIndex);
    let cursor = Date.parse(`${lastDate}T00:00:00Z`);
    if (!Number.isFinite(cursor)) cursor = Date.UTC(1970, 0, 1);
    while (week.length < 7) {
      cursor += DAY_MS;
      week.push({
        date: new Date(cursor).toISOString().slice(0, 10),
        level: 0,
        totalTokens: 0,
        requestCount: 0,
        future: true,
      });
    }
    weeks.push({ weekIndex: weeks.length, days: week });
  }

  return {
    startDate: dayIndexToDate(startDayIndex),
    endDate: dayIndexToDate(endDayIndex),
    maxTokens,
    weeks,
  };
}

function levelFor(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function dayIndexToDate(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

function roundNullable(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value));
}

function clampOffsetMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(value)));
}
