/**
 * 增量补拉（断点续传）：恢复时只取缺失尾部，就地应用到现有树。
 *
 * 背景：P1 之后恢复能正确触发，但修复手段是"整页重拉 + 全量 fold"——重拉最近 N 轮、
 * 重建整棵树、滚动深度塌回 N 轮。P2 让恢复优先走增量：
 *
 *   已应用水位 appliedSeq ──(seq > appliedSeq)──▶ 后端增量批 ──▶ 并入现有树
 *
 * 何时回退整页重拉（任一成立即放弃增量）：
 * - 本地没有水位（从未成功加载过内容）；
 * - 本地有多个未闭合回合（说明状态可疑，无法确定批次该从哪个回合接续）；
 * - 缺口超过单批上限（`hasMoreAfter`）——多轮追补的收益不值得，行为也更难预测；
 * - 应用过程抛错（投影异常）。
 *
 * 水位推进规则：
 * - 批次应用后推进到 `endSeq`；若已追平日志尾（`endSeq >= tailSeq`）则推进到 `tailSeq`。
 * - 只增不减（store.setAppliedSeq 内部取 max）。
 */
import { applyEventsIncremental } from "./streamProjector";
import type { ProjectorChunk, ProjectorSessionStore } from "./streamProjector";
import type { Turn } from "@/types/message";

/** 后端增量批（GET /sessions/:id/events/tail 响应） */
export interface EventsTailBatch {
  events: ProjectorChunk[];
  endSeq: number;
  tailSeq: number;
  hasMoreAfter: boolean;
}

export interface CatchUpStore extends ProjectorSessionStore {
  getAppliedSeq(sessionId: string): number | undefined;
  setAppliedSeq(sessionId: string, seq: number): void;
}

export interface CatchUpResult {
  status: "applied" | "needs-full-reload";
  /** status === "applied" 时本批应用的事件（供调用方刷上下文统计等） */
  events?: ProjectorChunk[];
  /** 回退原因（日志/诊断用） */
  reason?: string;
}

/** 单批上限：与后端 MAX_TAIL_EVENTS_DEFAULT 对齐 */
export const INCREMENTAL_TAIL_LIMIT = 500;

/** 本地未闭合回合（turn/start 已到但 turn/finish 未到） */
function openTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.state?.isWorking === true);
}

/**
 * 尝试增量补拉。
 *
 * @param fetchTail 由调用方注入（真实实现走 message.api.fetchSessionEventsTail）
 */
export async function catchUpIncrementally(args: {
  store: CatchUpStore;
  sessionId: string;
  fetchTail: (opts: { afterSeq: number; limit: number }) => Promise<EventsTailBatch>;
  limit?: number;
  /** 连接补发是否覆盖本地游标（hub 缺口标记）；缺省视为无缺口 */
  hasStreamGap?: (sessionId: string) => boolean;
}): Promise<CatchUpResult> {
  const { store, sessionId, fetchTail, hasStreamGap } = args;
  const limit = args.limit ?? INCREMENTAL_TAIL_LIMIT;

  // 补发起点越过了本地游标 → 水位不可信，只能整页重拉
  if (hasStreamGap?.(sessionId)) {
    return { status: "needs-full-reload", reason: "stream-gap" };
  }

  const appliedSeq = store.getAppliedSeq(sessionId);
  if (appliedSeq === undefined) {
    return { status: "needs-full-reload", reason: "no-watermark" };
  }

  const turns = store.getTurns(sessionId) ?? [];
  const open = openTurns(turns);
  if (open.length > 1) {
    return { status: "needs-full-reload", reason: "multiple-open-turns" };
  }

  let batch: EventsTailBatch;
  try {
    batch = await fetchTail({ afterSeq: appliedSeq, limit });
  } catch {
    return { status: "needs-full-reload", reason: "fetch-failed" };
  }

  if (!Array.isArray(batch?.events)) {
    return { status: "needs-full-reload", reason: "bad-response" };
  }
  // 拉取期间 connected 帧才把缺口标记立起来（onopen 先于补发首帧到达）→ 再查一次
  if (hasStreamGap?.(sessionId)) {
    return { status: "needs-full-reload", reason: "stream-gap" };
  }
  if (batch.hasMoreAfter) {
    // 缺口超过单批：整页重拉更可预测（也避免多轮追补期间的并发写入交错）
    return { status: "needs-full-reload", reason: "gap-too-large" };
  }
  if (batch.events.length === 0) {
    // 已追平：仅同步水位到日志尾
    store.setAppliedSeq(sessionId, batch.tailSeq);
    return { status: "applied", events: [] };
  }

  // 批次从回合中间开始（缺 turn/start）时，必须有唯一的未闭合回合来播种游标；
  // 否则 assistant/message 会被投影器丢弃（找不到当前回合）却仍报 applied —— 静默丢内容。
  // 批次首事件是 turn/start 时无需播种（它会自行设置游标）。
  const firstIsTurnStart = batch.events[0]?.type === "turn/start";
  if (!firstIsTurnStart && open.length !== 1) {
    return { status: "needs-full-reload", reason: "cant-seed-turn-cursor" };
  }
  const startTurnId = !firstIsTurnStart ? open[0].id : undefined;

  try {
    applyEventsIncremental(store, sessionId, batch.events, { startTurnId });
  } catch {
    return { status: "needs-full-reload", reason: "apply-failed" };
  }

  store.setAppliedSeq(
    sessionId,
    batch.endSeq >= batch.tailSeq ? batch.tailSeq : batch.endSeq,
  );
  return { status: "applied", events: batch.events };
}
