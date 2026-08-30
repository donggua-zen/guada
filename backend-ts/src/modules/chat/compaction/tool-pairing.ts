/**
 * 压缩边界 tool-pairing 平衡（对齐 deepseek-harness toolPairingBalancedBefore）
 *
 * 消息级：保证压缩边界不会切断未配对的 tool-call/result。
 * - 切点前最后一条消息若是"含 tool-call 但无 tool-result 的 assistant"（其 result 落在切点后），
 *   则把切点前移，使该配对整体移入保留区（宁多留不少切）。
 * - 若切点落在 tool-result 消息之后（call+result 都在遮蔽区），配对完整，无需前移。
 *
 * 本项目请求消息（context.history）中 tool 结果已与调用同回合折叠，正常情况下配对完整，
 * 此检查为防御性兜底（历史数据/异常落库导致配对跨消息）。
 */
import type { Message } from '../../../common/types/conversation.types';

/**
 * 计算平衡后的遮蔽边界（messages[0..boundaryIndex-1] 为遮蔽区）。
 *
 * @param messages      按请求顺序的消息列表（head-anchored 遮蔽前缀）
 * @param boundaryIndex 初始遮蔽边界（遮蔽区结束索引，不含）
 * @returns 平衡后的边界索引（只可能 <= 初始值）
 */
export function toolPairingBalancedBefore(
  messages: Message[],
  boundaryIndex: number,
): number {
  let idx = boundaryIndex;
  while (idx > 0) {
    if (!hasUnpairedToolCall(messages[idx - 1])) break;
    idx--; // 前移：把未闭合调用整体移入保留区
  }
  return idx;
}

/** 该消息是否以未配对的 tool-call 结尾（assistant 含 tool-call 块但本消息无 tool-result） */
function hasUnpairedToolCall(msg: Message): boolean {
  if (msg.role !== 'assistant') return false;
  const hasCall = msg.content.some((b) => b.type === 'tool-call');
  if (!hasCall) return false;
  const hasResult = msg.content.some((b) => b.type === 'tool-result');
  return !hasResult;
}
