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
 * - 日志回绕/换代：`tailSeq < appliedSeq`（日志比本地水位短）或批尾越过日志尾
 *   （torn 尾截断后 seq 复用、清空记录后重建，都会让 seq 重新从 0/1 开始）；
 * - 接缝不连续：批首不是 `appliedSeq + 1`，或批内 seq 跳号——说明读路径漏了事件
 *   （陈旧锚点索引会静默跳过/截断），继续应用会得到与整页重拉不一致的树；
 * - 应用过程抛错（投影异常）。
 *
 * 空批语义（seq 是日志位置，必须区分三种"空"）：
 * - `tailSeq === appliedSeq`：确实追平；
 * - `tailSeq > appliedSeq`：readTail 与 tailSeq 读取之间有并发追加（或索引读不完整），
 *   重试一次；仍空则不推进水位（不能把未返回的事件当成已应用），回退整页重拉；
 * - `tailSeq < appliedSeq`：日志回绕，按上面的回绕处理。
 *
 * 水位推进规则：
 * - 批次应用后推进到 `endSeq`；若已追平日志尾（`endSeq >= tailSeq`）则推进到 `tailSeq`。
 * - 只增不减（store.setAppliedSeq 内部取 max）；回绕恢复后由整页重拉路径
 *   `resetAppliedSeq` 显式复位。
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

/**
 * 空批但日志尾超前时的最大请求次数。
 * 允许一次重试以吸收"readTail 返回后、tailSeq 读取前"的并发追加；
 * 仍空则说明读路径没覆盖缺口（如陈旧索引静默截断），整页重拉兜底。
 */
const TAIL_FETCH_ATTEMPTS = 2;

/** 本地未闭合回合（turn/start 已到但 turn/finish 未到） */
function openTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.state?.isWorking === true);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** tail 批 = 已落库领域事件，必须逐条带有限 seq（缺 seq 说明响应形状异常） */
function hasEventSeqs(events: ProjectorChunk[]): boolean {
  return events.every((e) => isFiniteNumber((e as { seq?: unknown }).seq));
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

  // 取批 + 结构校验。空批但日志尾超前时重试一次（并发追加/索引读不完整）。
  let batch: EventsTailBatch | undefined;
  for (let attempt = 0; attempt < TAIL_FETCH_ATTEMPTS; attempt += 1) {
    try {
      batch = await fetchTail({ afterSeq: appliedSeq, limit });
    } catch {
      return { status: "needs-full-reload", reason: "fetch-failed" };
    }

    // 拉取期间 connected 帧才把缺口标记立起来（onopen 先于补发首帧到达）→ 再查一次
    if (hasStreamGap?.(sessionId)) {
      return { status: "needs-full-reload", reason: "stream-gap" };
    }

    if (!Array.isArray(batch?.events)) {
      return { status: "needs-full-reload", reason: "bad-response" };
    }
    if (!isFiniteNumber(batch.endSeq) || !isFiniteNumber(batch.tailSeq)) {
      return { status: "needs-full-reload", reason: "bad-response" };
    }
    if (!hasEventSeqs(batch.events)) {
      return { status: "needs-full-reload", reason: "bad-response" };
    }

    // 日志回绕/换代：日志尾退到本地水位之前（截断修复后 seq 复用、清空后重建），
    // 或批尾越过日志尾（索引读到旧代次内容）。继续增量会永久盲区/重复错配。
    if (
      batch.tailSeq < appliedSeq ||
      (batch.events.length > 0 && batch.endSeq > batch.tailSeq)
    ) {
      return { status: "needs-full-reload", reason: "log-rewound" };
    }

    if (batch.hasMoreAfter) {
      // 缺口超过单批：整页重拉更可预测（也避免多轮追补期间的并发写入交错）
      return { status: "needs-full-reload", reason: "gap-too-large" };
    }

    if (batch.events.length > 0) break;

    // 空批：tailSeq === appliedSeq 才是真追平。tail 超前说明本次没读到缺口，
    // 先重试；仍空则说明读路径覆盖不到（如陈旧索引静默截断）→ 整页重拉。
    if (batch.tailSeq === appliedSeq) return { status: "applied", events: [] };
  }

  if (!batch || batch.events.length === 0) {
    return { status: "needs-full-reload", reason: "read-gap" };
  }

  const firstSeq = (batch.events[0] as { seq: number }).seq;
  // 接缝：批首必须紧接本地水位，否则中间有本地从未应用的事件
  if (firstSeq !== appliedSeq + 1) {
    return { status: "needs-full-reload", reason: "seq-gap" };
  }
  // 批内连续：持久层 seq 按日志位置连续（缺口在冷加载时即抛损坏），跳号说明读残缺
  for (let i = 1; i < batch.events.length; i += 1) {
    const prev = (batch.events[i - 1] as { seq: number }).seq;
    const curr = (batch.events[i] as { seq: number }).seq;
    if (curr !== prev + 1) {
      return { status: "needs-full-reload", reason: "seq-gap-in-batch" };
    }
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
