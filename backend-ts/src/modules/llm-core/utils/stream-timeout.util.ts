/**
 * Stream idle timeout utilities for LLM adapters.
 *
 * The OpenAI SDK's `timeout` option is a hard deadline covering the entire
 * request lifecycle (including streaming). This is too coarse for streaming:
 * a thinking model may legitimately stream for 10+ minutes as long as data
 * keeps flowing. What we actually need is an **idle timeout** — abort only
 * if no chunk is received within N seconds.
 */

/** Default idle timeout between stream chunks (2 minutes). */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000;

/** Default hard request timeout (10 minutes) — total deadline, includes streaming. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;

export interface StreamTimeoutController {
  /** Merged AbortSignal — pass to SDK's `create(..., { signal })`. */
  signal: AbortSignal;
  /** Start (or restart) the idle timer. Call before first chunk and after each chunk. */
  resetIdleTimer: () => void;
  /** Stop the idle timer. Call in `finally` after stream ends. */
  clearIdleTimer: () => void;
  /** Returns true if the idle timer (not the user) triggered the abort. */
  isIdleTimeout: () => boolean;
  /** The configured idle timeout in ms. */
  readonly idleTimeoutMs: number;
}

/**
 * Creates a combined AbortSignal that merges the user's abort signal with a
 * stream idle timeout. The idle timer is **not** started automatically —
 * call `resetIdleTimer()` when streaming begins and after each chunk received.
 *
 * For non-streaming requests, just pass `signal` to the SDK; the idle timer
 * is never started so it will never fire.
 */
export function createStreamTimeoutController(
  userSignal: AbortSignal | undefined,
  idleTimeoutMs: number = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
): StreamTimeoutController {
  const controller = new AbortController();
  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Forward user abort to the combined controller
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener(
        "abort",
        () => controller.abort(userSignal!.reason),
        { once: true },
      );
    }
  }

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort(
        new Error(`Stream idle timeout after ${idleTimeoutMs}ms`),
      );
    }, idleTimeoutMs);
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  return {
    signal: controller.signal,
    resetIdleTimer,
    clearIdleTimer,
    isIdleTimeout: () => idleTimedOut,
    idleTimeoutMs,
  };
}

/**
 * Wraps an async generator with idle timeout protection.
 *
 * Starts the idle timer before the first `next()`, resets it on each yielded
 * value, and clears it when the stream ends. If no value arrives within the
 * idle period the underlying abort signal fires, causing `stream.next()` to
 * throw — we catch that and rethrow with a descriptive message.
 */
export async function* withStreamIdleTimeout<T>(
  stream: AsyncGenerator<T>,
  tc: StreamTimeoutController,
): AsyncGenerator<T> {
  tc.resetIdleTimer();
  try {
    while (true) {
      const { value, done } = await stream.next();
      if (done) break;
      tc.resetIdleTimer();
      yield value;
    }
  } catch (error: any) {
    if (tc.isIdleTimeout()) {
      throw new Error(
        `Stream idle timeout: no data received for ${tc.idleTimeoutMs / 1000}s`,
      );
    }
    throw error;
  } finally {
    tc.clearIdleTimer();
  }
}
