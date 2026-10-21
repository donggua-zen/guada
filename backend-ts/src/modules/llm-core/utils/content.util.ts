/**
 * 内容检查工具 — adapter 序列化边界的 fail-loud 最终防线。
 *
 * 对齐 DSH 原则（docs/message-pipeline-normalization-plan.md §3.3）：
 * 「投影是优化（L1 管线），断言是正确性（adapter 出口）」。
 * L1 管线已在不支持图片的模型上把 image 块投影为占位文本；若此处仍发现
 * image 块，说明有调用方绕过了管线（插件 / 子代理 / bot-gateway 直调），
 * 必须显式报错，而不是把图片发给必然拒绝它的 API。
 */

import type { Message } from '../../../common/types/conversation.types';

/** 消息数组中是否存在图片内容（image 块或工具结果内嵌图片） */
export function hasImageBlock(messages: Message[]): boolean {
  return messages.some((m) =>
    m.content.some(
      (b) =>
        b.type === 'image' ||
        (b.type === 'tool-result' && (b.images?.length ?? 0) > 0),
    ),
  );
}

/**
 * fail-loud 断言：模型明确声明不支持图片输入时，历史中不得残留 image 块。
 * @param supportsImageInput 模型能力；undefined（未知/未声明）时跳过断言（向后兼容旧调用方）
 * @throws Error 含 protocol + model 定位信息
 */
export function assertNoImageContent(
  messages: Message[],
  supportsImageInput: boolean | undefined,
  protocol: string,
  model: string,
): void {
  if (supportsImageInput !== false) return;
  if (!hasImageBlock(messages)) return;
  throw new Error(
    `UNSUPPORTED_CONTENT: model "${model}" (${protocol}) does not support image input, ` +
      `but message history still contains image blocks. ` +
      `This means the L1 message-transform pipeline was bypassed — ` +
      `images must be projected to text placeholders before reaching the adapter.`,
  );
}
