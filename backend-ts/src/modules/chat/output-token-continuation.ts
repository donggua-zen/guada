/**
 * Output Token Continuation —— 输出长度截断的续写层（对齐 ZCode）。
 *
 * 与“流失败恢复”严格分开：
 * - finishReason=length 且没有工具调用 → 保留已输出正文，追加隐藏续写提示，继续生成；
 * - 最多 3 次，第 4 次仍被截断 → 以错误结束回合；
 * - 流失败才走丢弃/重开（stream-recovery），长度截断不丢弃已输出正文。
 */
import type { Message } from "../../common/types/conversation.types";

/** 隐藏续写提示（ZCode 原文；要求模型接着写，不要重述） */
export const OUTPUT_TOKEN_CONTINUE_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";

export const OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE =
  "The model's response exceeded the output token maximum.";

export const MAX_OUTPUT_TOKEN_CONTINUATIONS = 3;

const OUTPUT_LIMIT_RAW_REASONS = new Set([
  "max_tokens",
  "max_output_tokens",
  "model_context_window_exceeded",
]);

export type OutputTokenContinuationDecision =
  | "continue"
  | "exhausted"
  | "none";

export function classifyOutputTokenContinuation(input: {
  finishReason: string | undefined;
  rawFinishReason?: string;
  toolCallCount: number;
  continuationCount: number;
}): OutputTokenContinuationDecision {
  if (input.toolCallCount > 0) return "none";
  if (
    !isOutputTokenLimitFinishReason(
      input.finishReason,
      input.rawFinishReason,
    )
  ) {
    return "none";
  }
  return input.continuationCount < MAX_OUTPUT_TOKEN_CONTINUATIONS
    ? "continue"
    : "exhausted";
}

export function buildOutputContinuationMessage(
  attempt: number,
  maxAttempts: number,
): string {
  return `输出达到上限，正在继续生成 ${attempt}/${maxAttempts}...`;
}

export function isOutputTokenLimitFinishReason(
  finishReason: string | undefined,
  rawFinishReason?: string,
): boolean {
  return (
    finishReason === "length" ||
    (rawFinishReason !== undefined &&
      OUTPUT_LIMIT_RAW_REASONS.has(rawFinishReason))
  );
}

/**
 * 隐藏续写消息：落库成 user 消息，隔开前后两条 assistant（避免连续 assistant
 * 被部分 provider 拒绝）；前端按 metadata.hidden / queryScope 隐藏。
 */
export function createOutputContinuationMessage(
  messageId: string,
): Message {
  return {
    id: messageId,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "output-token-continuation" },
    metadata: {
      hidden: true,
      synthetic: true,
      queryScope: "output_token_continuation",
    },
    content: [{ type: "text", text: OUTPUT_TOKEN_CONTINUE_PROMPT }],
  };
}
