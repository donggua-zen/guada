/**
 * Core Stream Recovery —— 已越过“可见输出边界”后的唯一恢复层。
 *
 * 与 ZCode 的 streaming-recovery 对齐：
 * - 每回合一个 streamRecoveryRetryCount，默认最多 10 次；llmIncompleteOutputAction=error 时为 0。
 * - 没有完整工具：丢弃半截正文/思考，从上一个消息 anchor 重开。
 * - 有完整工具：只提交完整工具调用，执行并落结果，从最后一个工具结果 anchor 重开；
 *   残缺工具直接丢弃（不生成 skipped 结果）。
 * - 重试判定沿 cause 链读取结构化 retryable/code/reason/name，最后才用 message 兜底。
 *
 * 本模块只做纯决策/分类；真正落库、执行工具、发事件仍在 agent-engine。
 */
import type { ContentBlock, Message } from "../../common/types/conversation.types";
import {
  UpstreamError,
  UpstreamNetworkError,
  UpstreamRateLimitError,
  UpstreamRequestError,
  UpstreamResponseFailedError,
  UpstreamStreamTruncatedError,
  UpstreamTimeoutError,
} from "../llm-core/utils/upstream-errors";
import { isUserAbort } from "../llm-core/utils/retry-on-error.util";

/** 每回合流恢复预算（对齐 ZCode 的 STREAM_RECOVERY_MAX_RETRIES=10） */
export const STREAM_RECOVERY_MAX_RETRIES = 10;

/** 被丢弃的 assistant 尝试的审计标记（落库 metadata.error.name） */
export const STREAM_RECOVERY_DISCARDED_ERROR_NAME = "StreamRecoveryDiscarded";
/** 被丢弃的 assistant 尝试的 finish 标记 */
export const STREAM_RECOVERY_DISCARDED_FINISH = "stream_recovery_discarded";

const TRANSIENT_ERROR_CODES = new Set([
  "model_request_timeout",
  "model_rate_limited",
  "model_server_error",
  "model_network_error",
  "MODEL_REQUEST_TIMEOUT",
  "MODEL_RATE_LIMITED",
  "MODEL_SERVER_ERROR",
  "MODEL_NETWORK_ERROR",
  "upstream_stream_truncated",
  "upstream_response_failed",
]);

const TRANSIENT_ERROR_REASONS = new Set([
  "stream_idle_timeout",
  "rate_limited",
  "server_error",
  "network_error",
  "timeout",
]);

const TRANSIENT_MESSAGE_RE =
  /\b(stream idle|stream stalled|timeout|timed out|overloaded|rate limit|server error|temporarily unavailable|ECONNRESET|EPIPE|ETIMEDOUT)\b/i;

export interface StreamRecoveryState {
  retryCount: number;
  maxRetries: number;
}

export interface StreamRecoveryAttempt {
  retryNumber: number;
  maxRetries: number;
}

export interface AssistantPartialSummary {
  /** 正文可见字符数（text 块） */
  textChars: number;
  /** 思考可见字符数（reasoning 块） */
  reasoningChars: number;
  /** 正文 + 思考，恢复层“是否有半截输出”的唯一依据 */
  visibleChars: number;
  completeToolCalls: Extract<ContentBlock, { type: "tool-call" }>[];
  incompleteToolCalls: Extract<ContentBlock, { type: "tool-call" }>[];
}

export function createStreamRecoveryState(
  action: "retry" | "error",
): StreamRecoveryState {
  return {
    retryCount: 0,
    maxRetries: action === "error" ? 0 : STREAM_RECOVERY_MAX_RETRIES,
  };
}

export function hasStreamRecoveryBudget(state: StreamRecoveryState): boolean {
  return state.retryCount < state.maxRetries;
}

export function beginStreamRecoveryAttempt(
  state: StreamRecoveryState,
): StreamRecoveryAttempt {
  state.retryCount += 1;
  return {
    retryNumber: state.retryCount,
    maxRetries: state.maxRetries,
  };
}

export function buildStreamRecoveryMessage(
  attempt: number,
  maxAttempts: number,
): string {
  return `上游流中断，正在恢复 ${attempt}/${maxAttempts}...`;
}

export function createPreviousMessageAnchorId(messageId: string): string {
  return `${messageId}:previous-message-anchor`;
}

export function createToolResultAnchorId(
  messageId: string,
  toolCallId: string,
): string {
  return `${messageId}:${toolCallId}:tool-result`;
}

/**
 * 把一条组装完成的 assistant 消息拆成恢复层需要的统计。
 * 注意：只有 `argumentsComplete === true` 才算完整工具；undefined 视为不完整——
 * 当前 live 流的所有 adapter 都会显式标记，历史消息不会走这里。
 */
export function summarizeAssistantPartial(
  message: Message | null | undefined,
): AssistantPartialSummary {
  const summary: AssistantPartialSummary = {
    textChars: 0,
    reasoningChars: 0,
    visibleChars: 0,
    completeToolCalls: [],
    incompleteToolCalls: [],
  };
  if (!message) return summary;

  for (const block of message.content) {
    if (block.type === "text") {
      summary.textChars += block.text.length;
    } else if (block.type === "reasoning") {
      summary.reasoningChars += block.summary.length;
    } else if (block.type === "tool-call") {
      if (block.argumentsComplete === true) {
        summary.completeToolCalls.push(block);
      } else {
        summary.incompleteToolCalls.push(block);
      }
    }
  }
  summary.visibleChars = summary.textChars + summary.reasoningChars;
  return summary;
}

/** 流恢复是否可重试：用户中止永远 false。 */
export function isRetryableStreamRecoveryFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (isUserAbort(error)) return false;

  // 结构化错误优先：adapter 已经给出可重试结论，不再用 message 猜。
  if (error instanceof UpstreamResponseFailedError) {
    return error.retryable;
  }
  if (error instanceof UpstreamStreamTruncatedError) {
    return error.discardable;
  }
  if (error instanceof UpstreamRequestError) {
    return false;
  }
  if (
    error instanceof UpstreamTimeoutError ||
    error instanceof UpstreamRateLimitError ||
    error instanceof UpstreamNetworkError
  ) {
    return true;
  }

  let sawExplicitNonRetryable = false;
  for (const record of walkErrorRecords(error)) {
    if (record.retryable === false) sawExplicitNonRetryable = true;
    if (record.retryable === true) return true;
    const context = asRecord(record.context);
    if (context?.retryable === false) sawExplicitNonRetryable = true;
    if (context?.retryable === true) return true;

    const code = stringValue(record.code) ?? stringValue(context?.code);
    if (code && TRANSIENT_ERROR_CODES.has(code)) return true;
    const reason = stringValue(record.reason) ?? stringValue(context?.reason);
    if (reason && TRANSIENT_ERROR_REASONS.has(reason)) return true;
    const name = stringValue(record.name);
    if (
      name === "ModelStreamIdleTimeoutError" ||
      name === "UpstreamTimeoutError" ||
      name === "UpstreamRateLimitError" ||
      name === "UpstreamNetworkError"
    ) {
      return true;
    }
    const message = stringValue(record.message);
    if (message && TRANSIENT_MESSAGE_RE.test(message)) return true;
  }
  // 显式 retryable=false 但没有命中任何可重试信号 → 保守不重试。
  void sawExplicitNonRetryable;
  return false;
}

export type StreamRecoveryFailureKind =
  | "provider_timeout"
  | "provider_network_error"
  | "provider_stream_error"
  | "provider_response_failed"
  | "unknown";

export function classifyStreamRecoveryFailure(
  error: unknown,
): StreamRecoveryFailureKind {
  if (error instanceof UpstreamResponseFailedError) {
    return "provider_response_failed";
  }
  if (error instanceof UpstreamTimeoutError) return "provider_timeout";
  if (error instanceof UpstreamRateLimitError) return "provider_network_error";
  if (error instanceof UpstreamNetworkError) return "provider_network_error";
  if (error instanceof UpstreamStreamTruncatedError) {
    return "provider_stream_error";
  }

  for (const record of walkErrorRecords(error)) {
    const context = asRecord(record.context);
    const reason = stringValue(record.reason) ?? stringValue(context?.reason);
    const code = stringValue(record.code) ?? stringValue(context?.code);
    const name = stringValue(record.name);
    const message = stringValue(record.message);

    if (
      reason === "stream_idle_timeout" ||
      code === "model_request_timeout" ||
      code === "MODEL_REQUEST_TIMEOUT" ||
      name === "ModelStreamIdleTimeoutError" ||
      name === "UpstreamTimeoutError" ||
      (message !== undefined && /\btimeout|timed out|stalled\b/i.test(message))
    ) {
      return "provider_timeout";
    }
    if (
      reason === "network_error" ||
      code === "model_network_error" ||
      code === "MODEL_NETWORK_ERROR" ||
      name === "UpstreamNetworkError" ||
      (message !== undefined && /\bECONNRESET|EPIPE|ETIMEDOUT\b/i.test(message))
    ) {
      return "provider_network_error";
    }
  }
  return error instanceof Error ? "provider_stream_error" : "unknown";
}

function* walkErrorRecords(error: unknown): Generator<Record<string, unknown>> {
  let current = error;
  const seen = new WeakSet<object>();
  for (let depth = 0; depth <= 6; depth += 1) {
    const record = asRecord(current);
    if (!record) return;
    if (seen.has(record)) return;
    seen.add(record);
    yield record;
    current = record.cause;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 从错误 cause 链里提取上游请求 id（response.failed / 网络状态事件）。 */
export function extractFailedRequestId(error: unknown): string | undefined {
  if (error instanceof UpstreamResponseFailedError && error.requestId) {
    return error.requestId;
  }
  for (const record of walkErrorRecords(error)) {
    const context = asRecord(record.context);
    const id =
      stringValue(record.requestId) ??
      stringValue(record.requestID) ??
      stringValue(record.request_id) ??
      stringValue(context?.requestId) ??
      stringValue(context?.requestID) ??
      stringValue(context?.request_id);
    if (id) return id;
  }
  return undefined;
}

/** 供日志/审计使用的稳定错误名。 */
export function streamFailureName(error: unknown): string {
  if (error instanceof UpstreamError) return error.name;
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
}
