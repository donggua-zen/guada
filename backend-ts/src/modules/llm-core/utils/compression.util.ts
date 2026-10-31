/**
 * Request-body compression for LLM providers (transport-layer capability).
 *
 * Some gateways (e.g. our own relay) accept `Content-Encoding: gzip` request
 * bodies. Large multimodal bodies (base64 images, long histories) compress to
 * roughly half, which matters a lot on bandwidth-limited links. This module is
 * a **protocol-agnostic fetch decorator**: it sits below the adapters, so the
 * provider's wire serialization (images, tools, thinking fields) is untouched —
 * only the bytes on the wire change.
 *
 * Design notes (see also DEPLOY_NAS.md「已知坑 18」on the gateway side):
 * - Enabled per provider through the generic `requestCompression` boolean on
 *   the type card / instance YAML. No protocol-name branching anywhere.
 * - Only JSON string bodies ≥ COMPRESSION_THRESHOLD_BYTES are compressed.
 *   FormData / Buffer / URLSearchParams / ReadableStream bodies pass through.
 * - Fallback is fully contained here (below the agent retry loop): if a
 *   compressed request is rejected as an encoding error, the same request is
 *   re-sent once uncompressed and the origin is marked unsupported for the
 *   rest of the process. Callers never see the failed attempt.
 */

import * as zlib from "zlib";

/** Bodies smaller than this are sent as-is (matching the relay's own threshold). */
export const COMPRESSION_THRESHOLD_BYTES = 64 * 1024;

/** gzip level 1 (BestSpeed): near-identical ratio to level 6 on base64 media. */
const COMPRESSION_LEVEL = 1;

/** Above this size use async gzip so a single request can't stall the event loop. */
const SYNC_GZIP_MAX_BYTES = 1 << 20;

/** Origins observed to reject gzip request bodies (process lifetime). */
const unsupportedOrigins = new Set<string>();

/** @internal test hook */
export function resetCompressionStateForTests(): void {
  unsupportedOrigins.clear();
}

function originOf(input: string | URL | Request): string {
  try {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function hasHeader(headers: HeadersInit | undefined, name: string): boolean {
  if (!headers) return false;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) !== null;
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => String(k).toLowerCase() === name);
  }
  return Object.keys(headers as Record<string, string>).some(
    (k) => k.toLowerCase() === name,
  );
}

function setHeader(headers: HeadersInit | undefined, name: string, value: string): Headers {
  const next = new Headers(headers as any);
  next.set(name, value);
  return next;
}

function deleteHeader(headers: HeadersInit | undefined, name: string): Headers {
  const next = new Headers(headers as any);
  next.delete(name);
  return next;
}

/** True when the rejection looks like "I don't understand Content-Encoding: gzip". */
function looksLikeEncodingRejection(status: number, bodyText: string): boolean {
  if (status === 415) return true;
  if (status !== 400 && status !== 422) return false;
  const text = bodyText.toLowerCase();
  return (
    text.includes('content-encoding') ||
    text.includes('content encoding') ||
    text.includes('gzip') ||
    text.includes('encoding')
  );
}

async function compressBody(body: string): Promise<Buffer> {
  const buf = Buffer.from(body, 'utf8');
  if (buf.length <= SYNC_GZIP_MAX_BYTES) {
    return zlib.gzipSync(buf, { level: COMPRESSION_LEVEL });
  }
  return new Promise<Buffer>((resolve, reject) => {
    zlib.gzip(buf, { level: COMPRESSION_LEVEL }, (err: Error | null, out: Buffer) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

/**
 * Wrap a base fetch implementation so JSON string bodies ≥ threshold are
 * gzip-compressed. Everything else (dispatcher/Agent, signal, method, headers)
 * is forwarded untouched.
 */
export function withRequestBodyCompression(
  baseFetch: typeof fetch,
): typeof fetch {
  const compressedFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = init?.body;
    const origin = originOf(input);
    const candidate =
      typeof body === 'string' &&
      origin !== '' &&
      !unsupportedOrigins.has(origin) &&
      !hasHeader(init?.headers, 'content-encoding') &&
      Buffer.byteLength(body, 'utf8') >= COMPRESSION_THRESHOLD_BYTES;

    if (!candidate) {
      return baseFetch(input as any, init as any);
    }

    const compressed = await compressBody(body as string);
    const compressedInit: RequestInit = {
      ...(init as any),
      body: compressed as any,
      headers: setHeader(init?.headers, 'content-encoding', 'gzip'),
    };
    // The SDK/undici recompute Content-Length from the new body; a stale value
    // would make the wire transmit only the first N compressed bytes.
    compressedInit.headers = deleteHeader(compressedInit.headers, 'content-length');

    const res = await baseFetch(input as any, compressedInit as any);
    if (res.ok || origin === '') return res;

    // Fallback: re-send once as plaintext if the server seems to reject the
    // encoding. Response body inspection is limited to 4xx (clone first).
    let bodyText = '';
    if (res.status === 400 || res.status === 422) {
      try {
        bodyText = await res.clone().text();
      } catch {
        bodyText = '';
      }
    }
    if (!looksLikeEncodingRejection(res.status, bodyText)) return res;

    unsupportedOrigins.add(origin);
    const plainInit: RequestInit = { ...(init as any) };
    plainInit.headers = deleteHeader(init?.headers, 'content-encoding');
    return baseFetch(input as any, plainInit as any);
  };

  return compressedFetch as typeof fetch;
}
