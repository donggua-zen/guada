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