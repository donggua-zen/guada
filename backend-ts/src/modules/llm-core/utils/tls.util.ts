import { Agent, fetch as undiciFetch } from "undici";

let insecureAgent: Agent | undefined;

/**
 * Returns a cached undici Agent with TLS certificate verification disabled.
 * Used for self-signed / internal API endpoints.
 */
function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({
      connect: { rejectUnauthorized: false },
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
