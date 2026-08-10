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
import { RateLimitError, isRateLimitError, getRetryAfterFromError } from "./retry.util";

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
    return Promise.reject(new Error("LLM request aborted"));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("LLM request aborted"));
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
 * - `network_error`: fetch/connection failures, ECONNRESET, ECONNREFUSED, ETIMEDOUT, etc.
 * - null: not retryable (user abort, 4xx client errors, 5xx server errors)
 *
 * @param error The error from adapter/SDK
 * @param streamTc Optional stream timeout controller to check for idle timeout
 */
export function classifyError(
  error: any,
  isIdleTimeout?: () => boolean,
): RetryableErrorType | null {
  if (!error) return null;

  // User abort — never retry
  if (error.name === "AbortError" || error.message?.toLowerCase().includes("abort")) {
    // But idle timeout also triggers abort — check that first
    if (isIdleTimeout?.()) {
      return "timeout";
    }
    return null;
  }

  // Rate limit (429)
  if (error instanceof RateLimitError || isRateLimitError(error)) {
    return "rate_limited";
  }

  // Timeout
  if (
    error.message?.includes("timeout") ||
    error.message?.includes("timed out") ||
    error.message?.includes("idle timeout")
  ) {
    return "timeout";
  }

  // Network errors
  const code = error.code;
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE" ||
    error.message?.includes("fetch failed") ||
    error.message?.includes("network")
  ) {
    return "network_error";
  }

  // HTTP status codes — retry only on 429 (already handled above) and 5xx
  const status = error.status ?? error.statusCode;
  if (status && NON_RETRYABLE_STATUS.has(status)) {
    return null; // 4xx client errors — not retryable
  }
  if (status && status >= 500 && status < 600) {
    return "network_error"; // 5xx server errors — retryable as network error
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
