/**
 * 强制重拉的"在飞尾部"重放（整页刷新等价）。
 *
 * 背景：事件页（domain events）只包含已落盘内容。流式进行中重拉时，fold 会用事件页
 * 全量重建树，把尚未落盘的在飞块（只有 delta，不进 eventLog）抹掉；整页刷新之所以没
 * 这个问题，是因为无缓存路径会把流式事件暂存（stash）并在 fold 后重放。
 * 强制重拉发生在已有缓存树的会话上（stash 为空），因此需要从 StreamEventHub 邮箱
 * 取"最后一个 checkpoint（finish/turn_end）之后的尾部"重放——两端语义完全一致。
 *
 * 过滤与幂等口径统一在 `applyInFlightChunks`（stash 消费共用同一实现），本函数只负责
 * 把邮箱尾部喂进去。
 */
import {
  applyInFlightChunks,
  type ProjectorChunk,
  type ProjectorSessionStore,
} from "./streamProjector";

export function replayStreamTailAfterReload(
  sessionStore: ProjectorSessionStore,
  sessionId: string,
  tail: readonly ProjectorChunk[],
  pageEndSeq: number,
): number {
  return applyInFlightChunks(sessionStore, sessionId, tail, pageEndSeq);
}
