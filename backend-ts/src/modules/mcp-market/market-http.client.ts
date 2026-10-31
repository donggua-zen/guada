/**
 * MCP 市场的白名单 HTTP 客户端。
 *
 * 为什么不用裸 fetch/axios：市场请求的目标 URL 有一部分来自第三方接口返回的数据
 * （readme 里的链接、重定向 Location），等价于「让远端决定我们请求哪里」。裸请求
 * 会把这变成一个 SSRF 跳板 —— 打到 127.0.0.1、内网段、云元数据 169.254.169.254
 * 都能成功返回。
 *
 * 因此这里做四件事，缺一不可：
 * 1. 只允许 https + 443 + 无 userinfo + host 在精确白名单内；
 * 2. 关闭自动重定向（maxRedirects: 0），改为手动跟随并逐跳校验 —— 否则 axios 会
 *    在内部跟到非白名单 host 而我们看不到；
 * 3. 硬性超时与响应体上限（防慢速攻击与超大响应打爆内存）；
 * 4. 只接受 JSON/文本，拒绝二进制。
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

/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 12_000;
/** 响应体上限：readme/detail 都是文本，8MB 足够且能挡住异常响应 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** 手动重定向的最大跳数 */
const MAX_REDIRECT_HOPS = 3;

export class MarketFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "URL_NOT_ALLOWED"
      | "TOO_MANY_REDIRECTS"
      | "HTTP_STATUS"
      | "BODY_TOO_LARGE"
      | "NETWORK",
  ) {
    super(message);
    this.name = "MarketFetchError";
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
export function isAllowedMarketUrl(raw: string): boolean {
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
  return (ALLOWED_MARKET_HOSTS as readonly string[]).includes(host);
}

/** 白名单实例：不跟随重定向、有超时、限制响应体 */
function buildClient(): AxiosInstance {
  return axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: MAX_BODY_BYTES,
    maxBodyLength: MAX_BODY_BYTES,
    responseType: "text",
    transformResponse: [(data) => data],
    validateStatus: () => true, // 状态码自己判，便于把 3xx 当重定向处理
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "ai_chat-mcp-market/1.0",
    },
  });
}

const client = buildClient();

/**
 * 取一段市场文本（JSON 或 markdown），自动跟随最多 3 跳白名单内重定向。
 *
 * @throws MarketFetchError 任何一步不合规或失败
 */
export async function fetchMarketText(url: string): Promise<string> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isAllowedMarketUrl(current)) {
      throw new MarketFetchError(
        `拒绝访问非白名单地址：${current}`,
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
      const location = response.headers?.location;
      if (typeof location !== "string" || !location) {
        throw new MarketFetchError(
          `重定向缺少 Location：${current}`,
          "HTTP_STATUS",
        );
      }
      // 相对 Location 按当前地址解析
      current = new URL(location, current).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new MarketFetchError(
        `上游返回 ${status}：${current}`,
        "HTTP_STATUS",
      );
    }

    const body = typeof response.data === "string" ? response.data : "";
    if (body.length > MAX_BODY_BYTES) {
      throw new MarketFetchError(
        `响应体超过上限（${body.length} bytes）：${current}`,
        "BODY_TOO_LARGE",
      );
    }
    return body;
  }

  throw new MarketFetchError(
    `重定向超过 ${MAX_REDIRECT_HOPS} 跳：${url}`,
    "TOO_MANY_REDIRECTS",
  );
}

/** 取 JSON 并解析（失败抛 MarketFetchError） */
export async function fetchMarketJson<T = unknown>(url: string): Promise<T> {
  const text = await fetchMarketText(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MarketFetchError(`上游返回的不是合法 JSON：${url}`, "HTTP_STATUS");
  }
}
