/**
 * 历史会话用量回填（一次性/可重复执行）。
 *
 * 数据源：`sessions/<id>/seg-*.jsonl` 的 `assistant/message` 事件——
 * 每条 assistant 消息对应一次 LLM 调用，`metadata.usage` 是该次调用的 provider 真值，
 * 比 `turn/finish` 的"回合最后一次 usage"更适合逐调用回填。
 *
 * 幂等：id 固定为 `backfill:<sessionId>:<messageId>`，且
 * `(assistant_message_id, attempt_index)` 唯一索引保证不会与线上实时记录重复。
 *
 * 用法：
 *   pnpm usage:backfill          # 增量回填（已存在的记录跳过）
 *   pnpm usage:backfill --force  # 仍然幂等，仅用于显式重跑
 */

import { resolveSessionsBasePath } from "../common/utils/session-path.util";
import { JsonlBackend } from "../common/persistence/jsonl-backend";
import { openMetaDb } from "../modules/chat/session-meta.store";
import { UsageStore } from "../modules/usage/usage.store";
import type { ModelUsageRecordInput } from "../modules/usage/usage.types";
import type { BaseEvent } from "../common/persistence/types";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const sessionsBase = resolveSessionsBasePath();
  const metaDb = openMetaDb(sessionsBase);
  const backend = new JsonlBackend();
  const usageStore = new UsageStore();

  let inserted = 0;
  let scannedSessions = 0;
  let scannedMessages = 0;

  try {
    const sessionTypes = new Map<string, string>();
    for (const row of metaDb
      .prepare(`SELECT id, session_type FROM sessions`)
      .all() as Array<{ id: string; session_type: string | null }>) {
      sessionTypes.set(row.id, row.session_type ?? "web");
    }

    const sessionIds = await backend.listSessionIds();
    for (const sessionId of sessionIds) {
      scannedSessions++;
      const sessionType = sessionTypes.get(sessionId) ?? "web";
      const source = sessionType === "sub_agent" ? "subagent" : "main_turn";
      let currentTurnId: string | null = null;

      let events: BaseEvent[];
      try {
        events = await backend.getAllEvents(sessionId);
      } catch (error: any) {
        console.warn(
          `[usage:backfill] skip unreadable session ${sessionId}: ${
            error?.message ?? error
          }`,
        );
        continue;
      }

      for (const event of events) {
        if (event.type === "turn/start") {
          currentTurnId = asString((event.data as any)?.turnId) ?? null;
          continue;
        }
        if (event.type === "turn/finish") {
          currentTurnId = null;
          continue;
        }

        if (event.type === "assistant/message") {
          const data = event.data as any;
          const messageId = asString(data?.messageId);
          if (!messageId) continue;
          scannedMessages++;
          const metadata = (data?.metadata ?? {}) as Record<string, any>;
          const record = buildRecord({
            id: `backfill_${sessionId}_${messageId}`,
            assistantMessageId: messageId,
            sessionId,
            turnId: currentTurnId,
            source,
            modelId:
              asString(metadata.modelName) ??
              asString(metadata.model) ??
              "",
            usage: metadata.usage ?? null,
            startedAt: event.time,
          });
          if (usageStore.record(record, { ignoreExisting: true })) {
            inserted++;
          }
        }
      }
    }

    metaDb
      .prepare(
        `INSERT OR REPLACE INTO _bootstrap (key, value) VALUES (?, ?)`,
      )
      .run("usage_backfilled_at", new Date().toISOString());

    console.log(
      `[usage:backfill] done${force ? " (force)" : ""}: ` +
        `sessions=${scannedSessions}, assistantMessages=${scannedMessages}, inserted=${inserted}`,
    );
  } finally {
    metaDb.close();
  }
}

function buildRecord(input: {
  id: string;
  assistantMessageId: string | null;
  sessionId: string;
  turnId: string | null;
  source: "main_turn" | "subagent" | "compaction";
  modelId: string;
  usage: any;
  startedAt: number;
}): ModelUsageRecordInput {
  const usage = input.usage
    ? normalizeUsage(input.usage)
    : null;
  return {
    id: input.id,
    logicalRequestId: input.id,
    assistantMessageId: input.assistantMessageId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    source: input.source,
    providerId: "",
    modelId: input.modelId,
    status: "completed",
    startedAt: input.startedAt,
    completedAt: input.startedAt,
    usage,
  };
}

/** 把消息级/压缩级 usage 统一成 StreamUsage 形状（缺字段补 0） */
function normalizeUsage(raw: any): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: { read?: number; written?: number; missed?: number };
} | null {
  if (!raw || typeof raw !== "object") return null;
  const promptTokens = num(raw.promptTokens);
  const completionTokens = num(raw.completionTokens);
  const providerTotal = num(raw.totalTokens);
  const totalTokens =
    providerTotal > 0 ? providerTotal : promptTokens + completionTokens;
  const cached = raw.cachedTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cached && typeof cached === "object"
      ? {
          cachedTokens: {
            ...(cached.read == null ? {} : { read: num(cached.read) }),
            ...(cached.written == null ? {} : { written: num(cached.written) }),
            ...(cached.missed == null ? {} : { missed: num(cached.missed) }),
          },
        }
      : {}),
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

main().catch((error) => {
  console.error("[usage:backfill] failed:", error);
  process.exitCode = 1;
});
