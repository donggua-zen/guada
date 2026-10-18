/**
 * 用量账本存储（`sessions/_meta.db` 的 `model_usage` 表）。
 *
 * 与 SessionMetaStore 共用同一个 SQLite 文件：会话标题/类型可直接 JOIN，
 * 删除会话也能在同一连接里清理用量。写路径是单行 INSERT，WAL + busy_timeout
 * 已由 openMetaDb 配好；任何异常由调用方（LLMService）捕获，不影响对话。
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";

import { resolveSessionsBasePath } from "../../common/utils/session-path.util";
import { openMetaDb } from "../chat/session-meta.store";
import type {
  ModelUsageRecordInput,
  UsageDailyRow,
  UsageDayModelRow,
  UsageModelRow,
  UsageQueryInput,
  UsageQueryRows,
  UsageSessionRow,
  UsageSourceRow,
  UsageTotalsRow,
} from "./usage.types";

const DAY_MS = 86_400_000;
const MAX_SESSION_ROWS = 50;
const MAX_ERROR_MESSAGE_CHARS = 500;

@Injectable()
export class UsageStore implements OnModuleDestroy {
  private readonly logger = new Logger(UsageStore.name);
  private db: Database.Database | null = null;

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  /** 懒开库：避免在启动期迁移门控之前创建/迁移 `_meta.db` */
  private ensureDb(): Database.Database {
    this.db ??= openMetaDb(resolveSessionsBasePath());
    return this.db;
  }

  /**
   * 写入一条模型调用明细。
   *
   * @param options.ignoreExisting 回填场景使用：已存在（同一 assistant message/attempt）
   *        时保留线上记录，避免回填覆盖实时真值。
   */
  record(
    input: ModelUsageRecordInput,
    options: { ignoreExisting?: boolean } = {},
  ): boolean {
    const db = this.ensureDb();
    const usage = input.usage ?? null;
    const inputTokens = nonNegativeInt(usage?.promptTokens);
    const outputTokens = nonNegativeInt(usage?.completionTokens);
    const providerTotal = usage?.totalTokens;
    const computedTotal = usage
      ? nonNegativeInt(
          providerTotal && providerTotal > 0
            ? providerTotal
            : inputTokens + outputTokens,
        )
      : 0;
    const attemptIndex = nonNegativeInt(input.attemptIndex);
    const id =
      input.id ??
      `usage_${input.sessionId ?? "global"}_${
        input.logicalRequestId ?? randomUUID()
      }_${attemptIndex}`;

    const sql = options.ignoreExisting
      ? `INSERT OR IGNORE INTO model_usage`
      : `INSERT OR REPLACE INTO model_usage`;

    const result = db.prepare(
      `${sql} (
        id, logical_request_id, attempt_index, session_id, turn_id,
        assistant_message_id, source, provider_id, model_id, status,
        started_at, first_token_at, completed_at, duration_ms,
        time_to_first_token_ms, finish_reason,
        input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, cache_miss_tokens,
        provider_total_tokens, computed_total_tokens, usage_missing,
        error_type, error_message, raw_usage_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )`,
    ).run(
      id,
      input.logicalRequestId ?? null,
      attemptIndex,
      input.sessionId ?? null,
      input.turnId ?? null,
      input.assistantMessageId ?? null,
      input.source,
      input.providerId ?? "",
      input.modelId,
      input.status,
      input.startedAt,
      input.firstTokenAt ?? null,
      input.completedAt,
      Math.max(0, input.completedAt - input.startedAt),
      input.firstTokenAt == null
        ? null
        : Math.max(0, input.firstTokenAt - input.startedAt),
      input.finishReason ?? null,
      inputTokens,
      outputTokens,
      0,
      nonNegativeInt(usage?.cachedTokens?.read),
      nonNegativeInt(usage?.cachedTokens?.written),
      nonNegativeInt(usage?.cachedTokens?.missed),
      providerTotal && providerTotal > 0 ? nonNegativeInt(providerTotal) : null,
      computedTotal,
      usage ? 0 : 1,
      input.errorType ?? null,
      truncateError(input.errorMessage),
      usage ? safeJson(usage) : null,
      Date.now(),
    );
    return result.changes > 0;
  }

  deleteBySession(sessionId: string): number {
    const db = this.ensureDb();
    return db
      .prepare(`DELETE FROM model_usage WHERE session_id = ?`)
      .run(sessionId).changes;
  }

  /** 清空全部用量明细（所有会话、全部时间） */
  clearAll(): number {
    const db = this.ensureDb();
    return db.prepare(`DELETE FROM model_usage`).run().changes;
  }

  /** 启动收敛：删除会话已不存在（被绕过本存储手删）的用量行 */
  pruneOrphans(): number {
    const db = this.ensureDb();
    try {
      return db
        .prepare(
          `DELETE FROM model_usage
           WHERE session_id IS NOT NULL
             AND session_id NOT IN (SELECT id FROM sessions)`,
        )
        .run().changes;
    } catch (error: any) {
      this.logger.warn(`用量孤儿行清理失败：${error?.message ?? error}`);
      return 0;
    }
  }

  query(input: UsageQueryInput): UsageQueryRows {
    const db = this.ensureDb();
    const now = input.now ?? Date.now();
    const offsetMs = clampOffsetMinutes(input.tzOffsetMinutes) * 60_000;
    const until = now;
    const dayCount = input.range === "7d" ? 7 : input.range === "30d" ? 30 : 0;
    const todayStart = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
    const since =
      dayCount > 0 ? todayStart - (dayCount - 1) * DAY_MS : 0;

    const totals = db
      .prepare(
        `SELECT
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
           COUNT(*) AS requestCount,
           COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errorCount,
           COALESCE(SUM(usage_missing), 0) AS usageMissingCount,
           AVG(CASE WHEN status = 'completed' THEN time_to_first_token_ms END) AS avgTimeToFirstTokenMs,
           AVG(CASE WHEN status = 'completed' THEN duration_ms END) AS avgDurationMs,
           COUNT(DISTINCT session_id) AS sessionCount,
           COUNT(DISTINCT CASE WHEN turn_id IS NOT NULL THEN session_id || ':' || turn_id END) AS turnCount
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?`,
      )
      .get(since, until) as UsageTotalsRow;

    const daily = db
      .prepare(
        `SELECT
           CAST((started_at + ?) / ${DAY_MS} AS INTEGER) AS dayIndex,
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COUNT(*) AS requestCount
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?
         GROUP BY dayIndex
         ORDER BY dayIndex`,
      )
      .all(offsetMs, since, until) as UsageDailyRow[];

    // 热力图固定近一年（53 周，按周日对齐），多取一周余量覆盖对齐偏移
    const heatmapSince = todayStart - 378 * DAY_MS;
    const heatmapDaily = db
      .prepare(
        `SELECT
           CAST((started_at + ?) / ${DAY_MS} AS INTEGER) AS dayIndex,
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COUNT(*) AS requestCount
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?
         GROUP BY dayIndex
         ORDER BY dayIndex`,
      )
      .all(offsetMs, heatmapSince, until) as UsageDailyRow[];

    const dayModels = db
      .prepare(
        `SELECT
           CAST((started_at + ?) / ${DAY_MS} AS INTEGER) AS dayIndex,
           provider_id AS providerId,
           model_id AS modelId,
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?
         GROUP BY dayIndex, provider_id, model_id
         ORDER BY dayIndex`,
      )
      .all(offsetMs, since, until) as UsageDayModelRow[];

    const models = db
      .prepare(
        `SELECT
           provider_id AS providerId,
           model_id AS modelId,
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
           COUNT(*) AS requestCount
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?
         GROUP BY provider_id, model_id
         ORDER BY totalTokens DESC`,
      )
      .all(since, until) as UsageModelRow[];

    const sources = db
      .prepare(
        `SELECT
           source,
           COALESCE(SUM(computed_total_tokens), 0) AS totalTokens,
           COUNT(*) AS requestCount
         FROM model_usage
         WHERE started_at >= ? AND started_at <= ?
         GROUP BY source
         ORDER BY totalTokens DESC`,
      )
      .all(since, until) as UsageSourceRow[];

    const sessions = db
      .prepare(
        `SELECT
           u.session_id AS sessionId,
           s.title AS title,
           s.session_type AS sessionType,
           COALESCE(SUM(u.computed_total_tokens), 0) AS totalTokens,
           COUNT(*) AS requestCount,
           MAX(u.started_at) AS lastUsedAt
         FROM model_usage u
         LEFT JOIN sessions s ON s.id = u.session_id
         WHERE u.started_at >= ? AND u.started_at <= ?
           AND u.session_id IS NOT NULL
         GROUP BY u.session_id
         ORDER BY totalTokens DESC
         LIMIT ?`,
      )
      .all(since, until, MAX_SESSION_ROWS) as UsageSessionRow[];

    return {
      since,
      until,
      totals,
      daily,
      heatmapDaily,
      dayModels,
      models,
      sources,
      sessions,
    };
  }
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function truncateError(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > MAX_ERROR_MESSAGE_CHARS
    ? `${value.slice(0, MAX_ERROR_MESSAGE_CHARS)}…`
    : value;
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function clampOffsetMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(value)));
}

export { DAY_MS };
