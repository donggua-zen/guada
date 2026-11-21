/**
 * Unified upstream error types.
 *
 * Adapters throw these when an upstream LLM provider call fails, so that
 * AgentEngine's `classifyError()` can use reliable `instanceof` checks instead
 * of fragile string matching.
 *
 * Naming: `Upstream*` prefix = error returned by the upstream provider/adapter,
 * distinct from internal application errors.
 *
 * Categories:
 * - `UpstreamTimeoutError`: idle timeout / SDK timeout / connection timeout — retryable
 * - `UpstreamRateLimitError`: HTTP 429 / TPM/RPM limit — retryable (respect Retry-After)
 * - `UpstreamNetworkError`: ECONNRESET / ECONNREFUSED / 5xx — retryable
 * - `UpstreamRequestError`: 400/401/403/404/422 — NOT retryable (same request always fails)
 */

/**
 * Base class for all upstream errors. Carries HTTP status + original SDK error.
 */
export class UpstreamError extends Error {
  /** HTTP status from upstream (undefined for pure network errors like ECONNREFUSED) */
  readonly status?: number;
  /** Original SDK/provider error, for upstream inspection / logging */
  readonly cause: any;

  constructor(message: string, cause?: any, status?: number) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    if (status !== undefined) {
      this.status = status;
    }
  }
}

/**
 * Timeout — stream idle timeout, SDK hard timeout, or connection timeout.
 * Retryable.
 */
export class UpstreamTimeoutError extends UpstreamError {
  constructor(message: string, cause?: any) {
    super(message, cause);
    this.name = "UpstreamTimeoutError";
  }
}

/**
 * Rate limit — HTTP 429, TPM/RPM limit exceeded.
 * Retryable. Carries `retryAfterMs` from Retry-After header when available.
 */
export class UpstreamRateLimitError extends UpstreamError {
  readonly retryAfterMs?: number;

  constructor(message: string, cause?: any, retryAfterMs?: number) {
    super(message, cause, 429);
    this.name = "UpstreamRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Network / transient server error — ECONNRESET, ECONNREFUSED, DNS failure,
 * or 5xx server errors. Retryable.
 */
export class UpstreamNetworkError extends UpstreamError {
  constructor(message: string, cause?: any, status?: number) {
    super(message, cause, status);
    this.name = "UpstreamNetworkError";
  }
}

/**
 * Request error — non-retryable client errors (400/401/403/404/422).
 * The request itself is malformed or unauthorized; retrying the same request
 * will always fail.
 */
export class UpstreamRequestError extends UpstreamError {
  constructor(message: string, cause?: any, status?: number) {
    super(message, cause, status);
    this.name = "UpstreamRequestError";
  }
}

/**
 * Stream truncated — upstream SSE ended without any terminal event
 * (`response.completed` / `response.incomplete` / `response.failed` / `[DONE]`).
 *
 * 与 UpstreamNetworkError 分开：本错误代表"流被截断但连接本身可能正常"，
 * 上层据此决定丢弃半截内容并重试。**故意不继承 UpstreamNetworkError**——
 * classifyError 会先命中父类的 network_error 分支，从而遮蔽用户中止判定。
 */
export class UpstreamStreamTruncatedError extends UpstreamError {
  /** 该错误的半截内容可以被丢弃后重试（上层据此走 discard+retry 分支） */
  readonly discardable = true;
  /** 最后一个内容事件类型（诊断 / 恢复判定） */
  readonly lastEventType?: string;
  /** 协议原始 finish reason（如 max_tokens / model_context_window_exceeded） */
  readonly rawFinishReason?: string;
  /** 已收齐参数的工具调用 id */
  readonly completeToolCallIds?: string[];
  /** 参数未收齐的工具调用 id */
  readonly incompleteToolCallIds?: string[];

  constructor(
    message: string,
    details: {
      cause?: any;
      status?: number;
      lastEventType?: string;
      rawFinishReason?: string;
      completeToolCallIds?: string[];
      incompleteToolCallIds?: string[];
    } = {},
  ) {
    super(message, details.cause, details.status);
    this.name = "UpstreamStreamTruncatedError";
    this.lastEventType = details.lastEventType;
    this.rawFinishReason = details.rawFinishReason;
    this.completeToolCallIds = details.completeToolCallIds;
    this.incompleteToolCallIds = details.incompleteToolCallIds;
  }
}

/**
 * Upstream explicitly failed the response mid-stream (Responses `response.failed`
 * 或等价的协议错误事件)。
 *
 * 与 `UpstreamRequestError` 的区别：这是**流中**失败，可能已经产出了半截正文/
 * 完整工具调用；Core Stream Recovery 需要拿到结构化 `code/param/retryable`
 * 来决定“丢弃正文后重试”还是“直接报错”。
 */
export class UpstreamResponseFailedError extends UpstreamError {
  readonly code?: string;
  readonly param?: string;
  readonly type?: string;
  readonly requestId?: string;
  /** 是否允许传输层/恢复层重试（由适配器按 code/param/message 结构化判定） */
  readonly retryable: boolean;

  constructor(
    message: string,
    details: {
      code?: string;
      param?: string;
      type?: string;
      requestId?: string;
      retryable?: boolean;
      status?: number;
      cause?: any;
    } = {},
  ) {
    super(message, details.cause, details.status);
    this.name = "UpstreamResponseFailedError";
    this.code = details.code;
    this.param = details.param;
    this.type = details.type;
    this.requestId = details.requestId;
    this.retryable = details.retryable === true;
  }
}