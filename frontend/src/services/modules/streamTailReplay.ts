/**
 * 强制重拉的"在飞尾部"重放（整页刷新等价）。
 *
 * 背景：事件页（domain events）只包含已落盘内容。流式进行中重拉时，fold 会用事件页
 * 全量重建树，把尚未落盘的在飞块（只有 delta，不进 eventLog）抹掉；整页刷新之所以没
 * 这个问题，是因为无缓存路径会把流式事件暂存（stash）并在 fold 后重放。
 * 强制重拉发生在已有缓存树的会话上（stash 为空），因此需要从 StreamEventHub 邮箱
 * 取"最后一个 checkpoint（finish/turn_end）之后的尾部"重放——两端语义完全一致。
 *
 * 过滤口径与 stash 消费完全相同：`prevSeq < pageEndSeq` 的 chunk 必已包含在事件页内
 * （prevSeq 是发布时刻的入库游标），整体跳过。对 delta 同样适用：若它落后于页尾，
 * 说明发布后又有事件落盘、页内已含该消息的最终内容，重复应用会让文本翻倍；
 * 代价是极少数"跨事件的在飞 delta"要等 block_end 恢复——与整页刷新表现一致。
 */
import {
  applyLiveChunk,
  type ProjectorChunk,
  type ProjectorSessionStore,
} from "./streamProjector";

export function replayStreamTailAfterReload(
  sessionStore: ProjectorSessionStore,
  sessionId: string,
  tail: readonly ProjectorChunk[],
  pageEndSeq: number,
): number {
  let applied = 0;
  for (const chunk of tail) {
    const prevSeq = (chunk as { prevSeq?: number }).prevSeq;
    if (
      typeof prevSeq === "number" &&
      Number.isFinite(pageEndSeq) &&
      prevSeq < pageEndSeq
    ) {
      continue;
    }
    applyLiveChunk(sessionStore, sessionId, chunk);
    applied += 1;
  }
  return applied;
}
