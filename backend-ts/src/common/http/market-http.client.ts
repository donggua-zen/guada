/**
 * 第三方市场（MCP 市场 / 技能市场）的白名单 HTTP 客户端。
 *
 * 为什么不用裸 fetch/axios：市场请求的目标 URL 有一部分来自第三方接口返回的数据
 * （readme 里的链接、重定向 Location），等价于「让远端决定我们请求哪里」。裸请求
 * 会把这变成一个 SSRF 跳板 —— 打到 127.0.0.1、内网段、云元数据 169.254.169.254
 * 都能成功返回。
 *
 * 因此这里做四件事，缺一不可：
 * 1. 只允许 https + 443 + 无 userinfo + host 命中给定策略（精确枚举 / 受限正则）；
 * 2. 关闭自动重定向（maxRedirects: 0），改为手动跟随并逐跳校验 —— 否则 axios 会
 *    在内部跟到非白名单 host 而我们看不到；
 * 3. 硬性超时与响应体上限（防慢速攻击与超大响应打爆内存）；
 * 4. 文本只接受 JSON/文本；二进制下载单独走 fetchMarketBinary，并校验 ZIP 魔数。
 *
 * 参考实现在 nomifun 的 market/client.rs：同样的白名单 + 每跳校验 + 跳数上限。
 */
import axios, { AxiosInstance, AxiosResponse } from "axios";

/** 允许访问的市场主机（精确匹配，不含子域通配） */
export const ALLOWED_MARKET_HOSTS = [
  "api.skillhub.cn",
  "skillhub.cn",
  "www.mcpworld.com",
  // SkillHub 的 readme 接口会 302 到自家 COS 桶；精确到这一个桶，
  // 而不是放开整个 myqcloud.com 域（那等于放开任意 COS 存储桶）。
  "skillhub-1388575217.cos.accelerate.myqcloud.com",
] as const;

/**
 * 主机策略：
 * - hosts：精确枚举（默认策略，保持既有行为不变）；
 * - hostPatterns：受限正则，仅给「下载跳转」这类主机不可预知的链路使用。
 */
export interface MarketHostPolicy {
  hosts?: readonly string[];
  hostPatterns?: readonly RegExp[];
}

export const DEFAULT_MARKET_HOST_POLICY: MarketHostPolicy = {
  hosts: ALLOWED_MARKET_HOSTS,
};

/**
 * SkillHub 技能 ZIP 的下载策略。
 *
 * `/api/v1/download` 返回 302，Location 指向对象存储。桶名/地域不保证固定，
 * 因此只放开「skillhub- 前缀的腾讯云 COS 桶」，不放开整个 myqcloud.com。
 */
export const SKILLHUB_DOWNLOAD_HOST_POLICY: MarketHostPolicy = {
  hosts: ["api.skillhub.cn"],
  hostPatterns: [/^skillhub-[a-z0-9-]+\.cos(\.[a-z0-9-]+)?\.myqcloud\.com$/i],
};

/** 单次文本请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 12_000;
/** 文本响应体上限：readme/detail 都是文本，8MB 足够且能挡住异常响应 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** 手动重定向的最大跳数 */
const MAX_REDIRECT_HOPS = 3;

/** 二进制下载默认超时（毫秒）—— 大包 + 慢网需要比文本接口宽松 */
export const DEFAULT_BINARY_TIMEOUT_MS = 120_000;
/** 二进制下载默认体积上限（50MB） */
export const DEFAULT_BINARY_MAX_BYTES = 50 * 1024 * 1024;

export class MarketFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "URL_NOT_ALLOWED"
      | "TOO_MANY_REDIRECTS"
      | "HTTP_STATUS"
      | "BODY_TOO_LARGE"
      | "NOT_ZIP"
      | "NETWORK",
    /** 上游 HTTP 状态码（有响应时） */
    readonly status?: number,
  ) {
    super(message);
    this.name = "MarketFetchError";
  }
}

/** 只保留 origin + pathname：错误信息里不带签名 query，避免把临时凭证写进日志 */
function safeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

/**
 * 校验一个 URL 是否可以由本模块发起请求。
 *
 * 严格到「协议 + 端口 + 凭据 + 主机」四项，因为放宽任何一项都能绕过主机白名单：
 * - http 允许降级到明文（可被中间人改写）
 * - 非 443 端口意味着可能是内网映射
 * - userinfo（`https://evil.com@allowed.host`）可造成主机判断歧义
 */
export function isAllowedMarketUrl(
  raw: string,
  policy: MarketHostPolicy = DEFAULT_MARKET_HOST_POLICY,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== "443") return false;
  const host = parsed.hostname.toLowerCase();
  const exact = policy.hosts ?? [];
  if (exact.includes(host)) return true;
  const patterns = policy.hostPatterns ?? [];
  return patterns.some((pattern) => pattern.test(host));
}

function buildClient(options: {
  responseType: "text" | "arraybuffer";
  timeoutMs: number;
  maxBytes: number;
  headers?: Record<string, string>;
}): AxiosInstance {
  return axios.create({
    timeout: options.timeoutMs,
    maxRedirects: 0,
    maxContentLength: options.maxBytes,
    maxBodyLength: options.maxBytes,
    responseType: options.responseType,
    // 文本接口保留原始字符串，交给调用方解析；二进制不转换
    transformResponse: options.responseType === "text" ? [(data) => data] : undefined,
    validateStatus: () => true, // 状态码自己判，便于把 3xx 当重定向处理
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "ai_chat-market/1.0",
      ...(options.headers ?? {}),
    },
  });
}

/** 从响应头取 Location（可能是数组） */
function readLocation(headers: Record<string, unknown>): string | undefined {
  const value = headers?.location;
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0]) return value[0];
  return undefined;
}

/**
 * 取一段市场文本（JSON 或 markdown），自动跟随最多 3 跳白名单内重定向。
 *
 * @throws MarketFetchError 任何一步不合规或失败
 */
export async function fetchMarketText(
  url: string,
  policy: MarketHostPolicy = DEFAULT_MARKET_HOST_POLICY,
  headers?: Record<string, string>,
): Promise<string> {
  return await requestText(url, policy, REQUEST_TIMEOUT_MS, MAX_BODY_BYTES, headers);
}

async function requestText(
  url: string,
  policy: MarketHostPolicy,
  timeoutMs: number,
  maxBytes: number,
  headers?: Record<string, string>,
): Promise<string> {
  let current = url;
  const client = buildClient({ responseType: "text", timeoutMs, maxBytes, headers });

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isAllowedMarketUrl(current, policy)) {
      throw new MarketFetchError(
        `拒绝访问非白名单地址：${safeUrl(current)}`,
        "URL_NOT_ALLOWED",
      );
    }

    let response: AxiosResponse<string>;
    try {
      response = await client.get<string>(current);
    } catch (error: any) {
      throw new MarketFetchError(
        `请求失败：${error?.message ?? String(error)}`,
        "NETWORK",
      );
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = readLocation(response.headers as Record<string, unknown>);
      if (!location) {
        throw new MarketFetchError(
          `重定向缺少 Location：${safeUrl(current)}`,
          "HTTP_STATUS",
        );
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new MarketFetchError(
        `上游返回 ${status}：${safeUrl(current)}`,
        "HTTP_STATUS",
        status,
      );
    }

    const body = typeof response.data === "string" ? response.data : "";
    if (body.length > maxBytes) {
      throw new MarketFetchError(
        `响应体超过上限（${body.length} bytes）：${safeUrl(current)}`,
        "BODY_TOO_LARGE",
      );
    }
    return body;
  }

  throw new MarketFetchError(
    `重定向超过 ${MAX_REDIRECT_HOPS} 跳：${safeUrl(url)}`,
    "TOO_MANY_REDIRECTS",
  );
}

/** 取 JSON 并解析（失败抛 MarketFetchError） */
export async function fetchMarketJson<T = unknown>(
  url: string,
  policy: MarketHostPolicy = DEFAULT_MARKET_HOST_POLICY,
  headers?: Record<string, string>,
): Promise<T> {
  const text = await fetchMarketText(url, policy, headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MarketFetchError(`上游返回的不是合法 JSON：${safeUrl(url)}`, "HTTP_STATUS");
  }
}

export interface MarketBinaryOptions {
  /** 主机策略；默认沿用文本接口的精确白名单 */
  policy?: MarketHostPolicy;
  timeoutMs?: number;
  maxBytes?: number;
  /** 是否要求响应体以 ZIP 魔数 PK 开头（下载技能包时开启） */
  requireZip?: boolean;
}

export interface MarketBinaryResult {
  buffer: Buffer;
  contentType: string;
  /** 最终响应地址（不含 query，避免签名泄漏）；仅用于日志/排障 */
  finalUrl: string;
}

/**
 * 取二进制（技能 ZIP 等），同样逐跳校验白名单。
 *
 * 与文本接口的差异：
 * - 超时更长（默认 120s）、体积上限更大（默认 50MB）；
 * - 返回 Buffer + content-type；
 * - 可选校验 ZIP 魔数，防止上游把错误页当文件返回。
 */
export async function fetchMarketBinary(
  url: string,
  options: MarketBinaryOptions = {},
): Promise<MarketBinaryResult> {
  const policy = options.policy ?? DEFAULT_MARKET_HOST_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BINARY_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_BINARY_MAX_BYTES;
  const client = buildClient({ responseType: "arraybuffer", timeoutMs, maxBytes });

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isAllowedMarketUrl(current, policy)) {
      throw new MarketFetchError(
        `拒绝访问非白名单地址：${safeUrl(current)}`,
        "URL_NOT_ALLOWED",
      );
    }

    let response: AxiosResponse<ArrayBuffer | Buffer>;
    try {
      response = await client.get(current);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (/maxContentLength|maxBodyLength|too large/i.test(message)) {
        throw new MarketFetchError(
          `下载内容超过上限（${maxBytes} bytes）：${safeUrl(current)}`,
          "BODY_TOO_LARGE",
        );
      }
      throw new MarketFetchError(`下载失败：${message}`, "NETWORK");
    }

    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = readLocation(response.headers as Record<string, unknown>);
      if (!location) {
        throw new MarketFetchError(
          `重定向缺少 Location：${safeUrl(current)}`,
          "HTTP_STATUS",
        );
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new MarketFetchError(
        `上游返回 ${status}：${safeUrl(current)}`,
        "HTTP_STATUS",
        status,
      );
    }

    const raw = response.data;
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (buffer.byteLength > maxBytes) {
      throw new MarketFetchError(
        `下载内容超过上限（${buffer.byteLength} bytes）：${safeUrl(current)}`,
        "BODY_TOO_LARGE",
      );
    }
    if (options.requireZip && buffer.subarray(0, 2).toString("latin1") !== "PK") {
      throw new MarketFetchError(
        `下载内容不是 ZIP：${safeUrl(current)}`,
        "NOT_ZIP",
      );
    }

    const contentTypeHeader = response.headers?.["content-type"];
    const contentType =
      typeof contentTypeHeader === "string" ? contentTypeHeader : "";

    return { buffer, contentType, finalUrl: safeUrl(current) };
  }

  throw new MarketFetchError(
    `重定向超过 ${MAX_REDIRECT_HOPS} 跳：${safeUrl(url)}`,
    "TOO_MANY_REDIRECTS",
  );
}
