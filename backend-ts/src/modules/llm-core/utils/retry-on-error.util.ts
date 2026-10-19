/**
 * Unified retry-on-error utilities for LLM calls.
 *
 * Replaces the adapter-level `retryOn429` with a higher-level retry mechanism
 * in AgentEngine that handles timeout, rate-limit, and network errors uniformly.
 * The key difference: this module provides classification + delay computation
 * so that the caller (AgentEngine) can yield SSE `retry` events to the frontend
 * between attempts.
 */

import { Logger } from "@nestjs/common";
import {
  UpstreamTimeoutError,
  UpstreamRateLimitError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "./upstream-errors";
import { getRetryAfterFromError } from "./retry.util";
import { createAbortError } from "./abort-error.util";

// 统一的中止错误工厂（复用，避免各层 new Error("AbortError") 导致 name 判断失效）
export { createAbortError };

// ==================== Types ====================

export type RetryableErrorType = "timeout" | "rate_limited" | "network_error";

export interface RetryInfo {
  attempt: number; // 1-based: this is the Nth retry (not the initial attempt)
  errorType: RetryableErrorType;
  delayMs: number;
  errorMessage: string;
}

export interface RetryConfig {
  maxRetries: number;
  abortSignal?: AbortSignal;
}

// ==================== Constants ====================

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 18000;
const MAX_RETRY_AFTER_MS = 60_000;

// HTTP status codes that should NOT be retried (request is fundamentally broken)
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

// 无 HTTP status 的超时错误码（undici）
const TIMEOUT_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

// 无 HTTP status 的网络错误码（undici / Node / SDK 都可能使用）
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

// 消息兜底：部分 SDK（如 OpenAI 的 APIConnectionTimeoutError）没有
// code/status，只能从 message 判断；adapter 未包装时也要能重试。
const TIMEOUT_MESSAGE_RE = /timed?\s*out|timeout/i;
const NETWORK_MESSAGE_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|connection (?:error|failed|refused|reset)/i;

// ==================== Shared utilities ====================

/**
 * Exponential backoff delay with ±20% jitter.
 */
export function computeBackoffDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * Compute retry delay: prefer Retry-After header, fall back to exponential backoff.
 * Capped at MAX_RETRY_AFTER_MS.
 */
export function computeRetryDelayMs(attempt: number, error: any): number {
  const headerDelay = getRetryAfterFromError(error);
  const computedDelay = computeBackoffDelay(attempt);
  return Math.min(headerDelay ?? computedDelay, MAX_RETRY_AFTER_MS);
}

/**
 * Cancelable sleep — rejects immediately if abortSignal fires during wait.
 */
export function retrySleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(createAbortError("LLM request aborted"));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError("LLM request aborted"));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ==================== Error classification ====================

/**
 * Classify an error into a retryable category, or return null if not retryable.
 *
 * - `timeout`: stream idle timeout, SDK timeout, or message contains "timeout"/"timed out"
 * - `rate_limited`: RateLimitError instance or HTTP 429
 * - `network_error`: fetch/connection failures, ECONNRESET, ECONNREFUSED, ETIMEDOUT, 5xx, etc.
 * - null: not retryable (user abort, 4xx client errors)
 *
 * @param error The error from adapter/SDK
 * @param streamTc Optional stream timeout controller to check for idle timeout
 */
export function classifyError(
  error: any,
  isIdleTimeout?: () => boolean,
): RetryableErrorType | null {
  if (!error) return null;

  // 1. Upstream typed exceptions — thrown by adapters
  if (error instanceof UpstreamTimeoutError) {
    return "timeout";
  }
  if (error instanceof UpstreamRateLimitError) {
    return "rate_limited";
  }
  if (error instanceof UpstreamNetworkError) {
    return "network_error";
  }
  if (error instanceof UpstreamRequestError) {
    return null; // Non-retryable client error
  }

  // 2. Idle timeout (when adapter didn't wrap it — safety net)
  if (isIdleTimeout?.()) {
    return "timeout";
  }

  // 3. User abort — never retry
  if (error.name === "AbortError") {
    return null;
  }

  // 4. Connection errors — by error.code (including the underlying cause)
  const code = error.code ?? error.cause?.code;
  if (typeof code === "string" && TIMEOUT_ERROR_CODES.has(code)) {
    return "timeout";
  }
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
    return "network_error";
  }

  // 5. HTTP status codes — 429 已在 step 2 处理，这里处理 5xx 和 4xx
  const status = error.status ?? error.statusCode;
  if (status && NON_RETRYABLE_STATUS.has(status)) {
    return null; // 4xx client errors — not retryable
  }
  if (status && status >= 500 && status < 600) {
    return "network_error"; // 5xx server errors — retryable
  }

  // 6. Message fallback — SDKs without typed connection errors, or adapters
  //    that rethrow the raw fetch error (e.g. "Request timed out.",
  //    "Connect Timeout Error", "fetch failed").
  const message = `${error.message ?? ""} ${error.cause?.message ?? ""}`;
  if (TIMEOUT_MESSAGE_RE.test(message)) {
    return "timeout";
  }
  if (NETWORK_MESSAGE_RE.test(message)) {
    return "network_error";
  }

  return null;
}

// ==================== Retry info formatting ====================

/**
 * Build a human-readable retry message for SSE event.
 */
export function buildRetryMessage(errorType: RetryableErrorType, attempt: number, maxRetries: number): string {
  const reasonText: Record<RetryableErrorType, string> = {
    timeout: "连接超时",
    rate_limited: "请求被限流",
    network_error: "网络错误",
  };
  return `${reasonText[errorType]}，正在重试 ${attempt}/${maxRetries} 次...`;
}

/**
 * 检测"上下文窗口溢出"错误（对齐 DSH CONTEXT_WINDOW_EXCEEDED_CODE）。
 *
 * 这类错误不可通过退避重试解决，正确动作是强制压缩上下文后重试请求
 * （见 agent-engine 溢出恢复路径）。各 provider 的错误形态不同，这里按
 * error.code / 错误消息关键词做启发式识别。
 */
export function isContextWindowExceeded(error: any): boolean {
  if (!error) return false;

  const code = error?.code ?? error?.error?.code ?? error?.error?.error?.code;
  if (typeof code === "string") {
    const c = code.toLowerCase();
    if (
      c.includes("context_length") ||
      c.includes("contextlength") ||
      c.includes("context_window") ||
      c.includes("contextwindow") ||
      c.includes("max_context")
    ) {
      return true;
    }
  }

  const rawMessages = [
    error?.message,
    error?.error?.message,
    error?.error?.error?.message,
    typeof error === "string" ? error : undefined,
  ].filter(Boolean);
  const msg = rawMessages.join(" ").toLowerCase();
  return (
    msg.includes("maximum context length") ||
    msg.includes("context length exceeded") ||
    msg.includes("context window") ||
    // 第三方网关文案（如 easyapi）："Input exceeds the context limit (1048568 tokens).
    // Please shorten the input."——不含上述任何关键词，必须单独覆盖，否则溢出恢复不会触发。
    msg.includes("context limit") ||
    msg.includes("prompt is too long") ||
    msg.includes("too many tokens") ||
    msg.includes("token limit") ||
    msg.includes("max context")
  );
}

/**
 * 检测「工具调用配对非法」错误（上游对 wire 形状的硬校验）。
 *
 * 触发条件：assistant 消息声明了 tool_calls，但后面没有回应其 tool_call_id 的
 * tool 消息（或数量不足）。成因是历史被写脏——assistant 与其工具结果分两批落盘，
 * 中间中断即留下悬空调用（见 agent-engine 的 closeToolPairing 收口）。
 *
 * 这类错误退避重试无用（重试发的是同一份历史），正确动作是修复历史里的悬空调用后
 * 重试一次（见 compaction-coordinator 的配对恢复路径）；请求侧还有 tool-pairing.guard
 * 兜底，正常情况下此错误不该再出现，命中即为诊断信号。
 */
export function isToolPairingInvalid(error: any): boolean {
  if (!error) return false;

  const rawMessages = [
    error?.message,
    error?.error?.message,
    error?.error?.error?.message,
    typeof error === "string" ? error : undefined,
  ].filter(Boolean);
  const msg = rawMessages.join(" ").toLowerCase();

  return (
    // OpenAI / DeepSeek / 三方网关（Console Go）实测文案
    msg.includes("insufficient tool messages") ||
    msg.includes("must be followed by tool messages") ||
    // 变体：tool 消息本身缺失或无法关联（Anthropic / Gemini 侧措辞）
    msg.includes("tool_calls") &&
      (msg.includes("tool_call_id") || msg.includes("tool_use")) &&
      (msg.includes("must be") || msg.includes("missing") || msg.includes("insufficient"))
  );
}

// ==================== Core retry loop ====================
/**
 * Execute an async function with retry on timeout/rate_limited/network_error.
 *
 * The caller provides `onRetry` callback to yield SSE events between attempts.
 * Unlike `retryOn429`, this function does NOT swallow the final error — it
 * throws after all retries are exhausted, letting the caller handle it.
 *
 * @param fn The function to execute (returns the value or throws)
 * @param options.logger Logger instance
 * @param options.maxRetries Max retry attempts (default 3)
 * @param options.abortSignal Cancel signal
 * @param options.onRetry Called before each retry with RetryInfo (for SSE event)
 * @param options.onBeforeAttempt Called before each attempt (for idle timer reset)
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: {
    logger: Logger;
    context: string;
    maxRetries?: number;
    abortSignal?: AbortSignal;
    onRetry?: (info: RetryInfo) => void;
    onBeforeAttempt?: () => void;
  },
): Promise<T> {
  const { logger, context, maxRetries = 3, abortSignal, onRetry, onBeforeAttempt } = options;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    onBeforeAttempt?.();
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // User abort — never retry, rethrow immediately
      if (error.name === "AbortError" && !options.onBeforeAttempt) {
        throw error;
      }

      const errorType = classifyError(error);

      if (!errorType) {
        throw error; // Not retryable
      }

      if (attempt >= maxRetries) {
        logger.warn(
          `[${context}] ${errorType} 重试已达上限 (${maxRetries}次)，放弃重试`,
        );
        throw error; // Rethrow — caller handles final error
      }

      const delayMs = computeRetryDelayMs(attempt, error);
      const retryInfo: RetryInfo = {
        attempt: attempt + 1,
        errorType,
        delayMs,
        errorMessage: error.message,
      };

      logger.warn(
        `[${context}] ${errorType} (attempt ${attempt + 1}/${maxRetries}), ` +
        `等待 ${Math.round(delayMs)}ms 后重试: ${error.message?.substring(0, 200)}`,
      );

      onRetry?.(retryInfo);

      await retrySleep(delayMs, abortSignal);
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}
