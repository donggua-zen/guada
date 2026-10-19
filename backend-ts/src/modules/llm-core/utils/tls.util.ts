import { Agent, fetch as undiciFetch } from "undici";

let insecureAgent: Agent | undefined;

/**
 * 连接建立超时（DNS + TCP + TLS 握手）。
 *
 * undici 的默认值只有 10 秒。对跨境 / Cloudflare 中转的 LLM 端点来说过短：
 * 一旦握手偶发超过 10 秒，SDK 会在应用层配置的 idle timeout（默认 120s）
 * 和 request timeout（默认 600s）之前先抛出 "Request timed out."，
 * 表现为“对话进行到一半突然超时”。
 */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * 空闲连接保持时间。
 *
 * undici 默认只有 4 秒；工具执行通常超过 4 秒，下一轮 LLM 调用就要重新
 * 建连。延长复用窗口可以减少握手次数，从而降低连接阶段超时的概率。
 */
const KEEP_ALIVE_TIMEOUT_MS = 60_000;

/**
 * Returns a cached undici Agent with TLS certificate verification disabled.
 * Used for self-signed / internal API endpoints.
 */
function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({
      connect: { rejectUnauthorized: false },
      connectTimeout: CONNECT_TIMEOUT_MS,
      keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    });
  }
  return insecureAgent;
}

/**
 * Custom fetch that skips TLS certificate validation.
 * Pass to OpenAI / Anthropic SDK as the `fetch` option.
 */
export function insecureFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return undiciFetch(input as any, {
    ...(init as any),
    dispatcher: getInsecureAgent(),
  }) as any;
}
