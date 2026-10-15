/**
 * 工具调用配对：通用判定与合成文案（单一真相）
 *
 * 三层模型下 assistant 的 tool-call 块与工具结果是**两条独立消息**（跨消息配对）。
 * 上游（OpenAI/DeepSeek 系）对 wire 形状有硬要求：assistant 声明的每条 tool_calls
 * 之后必须有回应其 tool_call_id 的 tool 消息，否则整次请求被拒：
 *   "An assistant message with 'tool_calls' must be followed by tool messages
 *    responding to each 'tool_call_id'. (insufficient tool messages ...)"
 *
 * 本模块为「配对判定」与「缺失结果的合成文案」提供唯一实现，两个消费者必须同文案，
 * 避免同一处缺失在不同路径给出不同措辞：
 * - 冷加载修复（写回会话日志）：common/persistence/jsonl-message.service.ts
 * - 请求前兜底（只改本次 wire 视图）：modules/llm-core/tool-pairing.guard.ts
 */
import type {
  ContentBlock,
  Message,
  ToolCallBlock,
  ToolResultBlock,
} from '../types/conversation.types';

/**
 * 缺失工具结果的合成文案：明确「未执行」而非「失败」，并约束重试面
 * （只读/幂等），防止模型把补桩结果当成真实执行结果继续推进。
 */
export const SYNTHETIC_TOOL_INTERRUPTED_TEXT =
  'Error: tool call interrupted before dispatch. Retry only read-only/idempotent operations.';

export function isToolCallBlock(block: ContentBlock): block is ToolCallBlock {
  return block.type === 'tool-call';
}

export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool-result';
}

/**
 * 是否工具结果消息：role / source / 内容块任一标记即认定
 * （历史数据三种形态都存在：role='tool'、source.kind='tool'、仅含 tool-result 块）。
 */
export function isToolResultMessage(message: Message): boolean {
  return (
    message.role === 'tool' ||
    message.source.kind === 'tool' ||
    message.content.some(isToolResultBlock)
  );
}

/**
 * 消息回应的 toolCallId（优先级：内容块 > source）。
 * 非工具结果消息或 id 缺失（空串/缺字段）返回 null —— 调用方据此判定「无法配对」。
 */
export function toolResultCallIdOf(message: Message): string | null {
  for (const block of message.content) {
    if (isToolResultBlock(block) && block.toolCallId) return block.toolCallId;
  }
  if (message.source.kind === 'tool' && message.source.toolCallId) {
    return message.source.toolCallId;
  }
  return null;
}
