/**
 * 消息伴随注入的「基准消息」解析（模式叙事 / 远程绑定变更共用）。
 *
 * 基准 = 最后一条仍在可见历史里的真实用户消息：
 * - 注入的 hidden 消息（kind='model'，如图片注入）metadata 为空，参与比对会把基准错误回退为默认值；
 * - 被删除的回合（重答 turn/delete、手工删轮次）不再提供基准，于是变更会被重新判定、
 *   注入块重新生成 —— 这正是「重答后绑定提醒丢失」的修复点：基准随消息删除而消失，
 *   不需要任何会话级记账回退。
 */
import type { Message } from '../../common/types/conversation.types';

/** 取注入判定基准消息（最后一条真实用户消息）；无则 undefined */
export function pickBaselineUserMessage(
  history: readonly Message[],
  replaceTurnId?: string,
): Message | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user' || m.kind === 'model' || m.id === replaceTurnId) continue;
    return m;
  }
  return undefined;
}

/**
 * 绑定变更判定基准：优先取基准消息记录的绑定 id；
 * 缺失（冷启动 / 旧会话消息无该字段）回退系统提示词冻结快照——模型对绑定的认知只剩系统提示词。
 */
export function resolveBindingBaseline(
  recordedIds: unknown,
  snapshotIds: string[],
): string[] {
  return Array.isArray(recordedIds) ? (recordedIds as string[]) : snapshotIds;
}
