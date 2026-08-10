import { Logger } from "@nestjs/common";
import {
  UpstreamRateLimitError,
  UpstreamTimeoutError,
  UpstreamNetworkError,
  UpstreamRequestError,
} from "./upstream-errors";

// Re-export for backward compatibility (consumers should migrate to Upstream* names)
export { UpstreamRateLimitError as RateLimitError } from "./upstream-errors";
export type { UpstreamRateLimitError } from "./upstream-errors";

const DEFAULT_MAX_RETRIES = 6;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 18000;
/** Retry-After header 兜底上限，防止服务器返回超大值导致无限等待 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * 解析 Retry-After 响应头，返回建议的等待毫秒数
 *
 * 优先读取 OpenAI 专有 retry-after-ms（毫秒），
 * 回退到标准 Retry-After（秒或 HTTP-date），
 * 最后使用指数退避计算的延迟值。
 *
 * @param headers 错误对象中的 headers map（SDK 可能已归一化为小写）
 * @param fallbackMs 指数退避计算的基准延迟
 */
function parseRetryAfterMs(
  headers?: Record<string, string>,
  fallbackMs?: number,
): number | undefined {
  if (!headers) return undefined;

  // 1. OpenAI 专有：retry-after-ms（毫秒，小写 key）
  const msHeader = headers["retry-after-ms"] || headers["retry-after-ms"] || headers["retry_after_ms"];
  if (msHeader) {
    const ms = parseInt(msHeader, 10);
    if (!isNaN(ms) && ms > 0) return ms;
  }

  // 2. 标准 Retry-After（秒，小写 key）
  const secondsHeader = headers["retry-after"] || headers["Retry-After"] || headers["retry_after"];
  if (secondsHeader) {
    const seconds = parseInt(secondsHeader, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  }

  return fallbackMs;
}

/**
 * 指数退避延迟计算（带 jitter，避免 thundering herd）
 */
function computeDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  // ±20% jitter
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

/**
 * sleep 辅助函数（可取消）
 *
 * 如果提供了 abortSignal，在等待期间 signal 触发 abort 时会立即 reject，
 * 确保用户按"终止"时不会卡在退避等待中。
 */
function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
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

/**
 * 判断错误是否为 429 Too Many Requests
 *
 * 兼容多种 SDK 的错误格式：
 * - openai SDK: APIError.status === 429
 * - anthropic SDK: error.status === 429
 * - Gemini SDK: error.code === 429
 * - 普通 HTTP Error: error.statusCode === 429 / error.status === 429
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? error.code;
  return status === 429;
}

/**
 * 从错误对象中提取 Retry-After header（兼容各 SDK）
 */
export function getRetryAfterFromError(error: any): number | undefined {
  // OpenAI SDK: APIError.headers (可能有大写 key)
  if (error.headers) {
    const ms = parseRetryAfterMs(error.headers);
    if (ms !== undefined) return ms;
  }

  // Anthropic SDK: 可能在 response_headers 中
  if (error.response_headers) {
    const ms = parseRetryAfterMs(error.response_headers);
    if (ms !== undefined) return ms;
  }

  return undefined;
}

/**
 * 对返回 Promise 的异步函数进行 429 指数退避重试
 *
 * @deprecated 重试逻辑已提升到 AgentEngine 层（executeWithRetry in retry-on-error.util.ts），
 * 支持 timeout/rate_limited/network_error 统一重试 + 前端可见 retry SSE 事件。
 * 此函数仅保留向后兼容，不应在新代码中使用。
 *
 * @param fn 要重试的异步函数
 * @param options.logger Logger 实例
 * @param options.context 日志上下文描述
 * @param options.maxRetries 最大重试次数（默认 5）
 * @param options.abortSignal 可选的 AbortSignal，用于在退避等待期间取消重试
 * @returns fn 的返回结果
 */
export async function retryOn429<T>(
  fn: () => Promise<T>,
  options: {
    logger: Logger;
    context: string;
    maxRetries?: number;
    abortSignal?: AbortSignal;
    /** Called before each attempt (including the first). Use to reset idle timers. */
    onBeforeAttempt?: () => void;
  },
): Promise<T> {
  const { logger, context, maxRetries = DEFAULT_MAX_RETRIES, abortSignal, onBeforeAttempt } = options;
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    onBeforeAttempt?.();
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (!isRateLimitError(error)) {
        throw error; // 非 429 错误，立即抛出
      }

      if (attempt >= maxRetries) {
        logger.warn(
          `[${context}] 429 重试已达上限 (${maxRetries}次)，放弃重试`,
        );
        break;
      }

      // 优先使用 Retry-After header（兜底 60s 上限），否则指数退避
      const headerDelay = getRetryAfterFromError(error);
      const computedDelay = computeDelay(attempt);
      const delayMs = Math.min(headerDelay ?? computedDelay, MAX_RETRY_AFTER_MS);

      logger.warn(
        `[${context}] 429 Too Many Requests (attempt ${attempt + 1}/${maxRetries}), ` +
        `等待 ${Math.round(delayMs)}ms 后重试` +
        (headerDelay ? ` (来自 Retry-After header)` : ` (指数退避)`),
      );

      // 可取消的 sleep：用户按终止 → abortSignal.aborted → reject 抛出
      await sleep(delayMs, abortSignal);
    }
  }

  // 所有重试耗尽，重新抛出 UpstreamRateLimitError，上层可通过 instanceof 精确判断
  throw new UpstreamRateLimitError(
    lastError?.message || "429 Too Many Requests (retries exhausted)",
    lastError,
  );
}

/**
 * 通用指数退避重试工具
 *
 * 与 retryOn429 的区别：允许调用方通过 shouldRetry 自定义"哪些错误值得重试"，
 * 适用于网络抖动、5xx、限流等多种可恢复场景（如 Embedding 向量化请求）。
 *
 * 设计要点：
 * - 指数退避 + jitter，避免重试风暴（thundering herd）
 * - 可取消：提供 abortSignal 时，退避等待期间可立即中止
 * - 重试耗尽后抛出最后一次错误（保留原始错误信息，便于排查）
 *
 * @param fn 要重试的异步函数
 * @param options.logger Logger 实例
 * @param options.context 日志上下文描述（用于日志前缀）
 * @param options.maxRetries 最大重试次数（默认 3）
 * @param options.baseDelayMs 指数退避基准延迟（默认 1000ms）
 * @param options.maxDelayMs 退避延迟上限（默认 10000ms）
 * @param options.abortSignal 可选的 AbortSignal，用于在退避等待期间取消重试
 * @param options.shouldRetry 判断错误是否可重试（默认仅 429）
 * @param options.onBeforeAttempt 每次尝试前回调（含首次），用于重置空闲计时器等
 * @returns fn 的返回结果；重试耗尽时抛出最后一次错误
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    logger: Logger;
    context: string;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    abortSignal?: AbortSignal;
    shouldRetry?: (error: any, attempt: number) => boolean;
    onBeforeAttempt?: () => void;
  },
): Promise<T> {
  const {
    logger,
    context,
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    abortSignal,
    shouldRetry = (error) => isRateLimitError(error),
    onBeforeAttempt,
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    onBeforeAttempt?.();
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (!shouldRetry(error, attempt)) {
        return Promise.reject(error); // 不可重试错误，立即抛出
      }

      if (attempt >= maxRetries) {
        logger.warn(
          `[${context}] 重试已达上限 (${maxRetries}次)，放弃重试: ${error?.message || error}`,
        );
        break;
      }

      // 优先使用 Retry-After header（兜底 MAX_RETRY_AFTER_MS 上限），否则指数退避
      const headerDelay = getRetryAfterFromError(error);
      const computedDelay = computeDelayWithBase(attempt, baseDelayMs, maxDelayMs);
      const delayMs = Math.min(headerDelay ?? computedDelay, MAX_RETRY_AFTER_MS);

      logger.warn(
        `[${context}] 请求失败 (attempt ${attempt + 1}/${maxRetries}): ${error?.message || error}, ` +
        `等待 ${Math.round(delayMs)}ms 后重试` +
        (headerDelay ? ` (来自 Retry-After header)` : ` (指数退避)`),
      );

      // 可取消的 sleep：abortSignal 触发 → reject 抛出
      await sleep(delayMs, abortSignal);
    }
  }

  // 所有重试耗尽，抛出最后一次错误
  return Promise.reject(lastError);
}

/** 基于自定义基准延迟的指数退避计算（带 jitter） */
function computeDelayWithBase(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // ±20% jitter
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}
