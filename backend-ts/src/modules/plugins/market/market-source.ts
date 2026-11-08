/**
 * 插件市场索引源配置。
 *
 * 官网只做索引（meta 信息），插件本体托管在 GitHub/Gitee/GitCode；
 * 客户端从索引浏览后走既有 git 协议安装（external-plugin-loader）。
 * 索引协议见 docs/plugin-market/registry-guide.md。
 */

/** 默认官方索引地址（与 remote-workspace 的官方默认地址同域） */
export const DEFAULT_MARKET_BASE = "https://ai.dingd.cn/api/plugin-market";

/**
 * 环境变量可覆盖（本地联调指向官网后端，如 http://127.0.0.1:3001）。
 *
 * 覆盖值放宽协议/端口限制（默认地址必须是生产域名 https + 443）：
 * 联调时官网后端就跑在 127.0.0.1:3001（Fastify），非白名单会被
 * isAllowedMarketUrl 拒掉；覆盖值是开发者显式写进 .env 的，不是远端可控。
 */
export function marketBaseUrl(): string {
  const raw = process.env.PLUGINS_MARKET_URL?.trim();
  if (!raw) return DEFAULT_MARKET_BASE;
  return raw.replace(/\/+$/, "");
}

export function marketListUrl(): string {
  return `${marketBaseUrl()}/list`;
}

export function marketDetailUrl(id: string): string {
  return `${marketBaseUrl()}/detail?id=${encodeURIComponent(id)}`;
}

export function marketTagsUrl(): string {
  return `${marketBaseUrl()}/tags`;
}

export function marketInstallReportUrl(): string {
  return `${marketBaseUrl()}/install`;
}

import type { MarketHostPolicy } from "../../../common/http/market-http.client";

/**
 * 索引请求的主机策略。
 *
 * PLUGINS_MARKET_URL 覆盖（本地联调指向 127.0.0.1:3001 官网后端）时，
 * 动态放宽到回环地址 + allowInsecure；默认生产地址保持严格白名单。
 */
export function marketHostPolicy(): MarketHostPolicy {
  const base = marketBaseUrl();
  if (base === DEFAULT_MARKET_BASE) {
    return { hosts: ["ai.dingd.cn"] };
  }
  try {
    const url = new URL(base);
    const host = url.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!url.username && !url.password && (isLoopback || url.protocol === "https:")) {
      return { hosts: [host], allowInsecure: isLoopback };
    }
  } catch {
    // 非法覆盖值回落默认白名单
  }
  return { hosts: ["ai.dingd.cn"] };
}
