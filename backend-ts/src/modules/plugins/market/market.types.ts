/**
 * 插件市场索引类型（与官网 meta.json 序列化格式对应，
 * 见 docs/plugin-market/registry-guide.md §3 / ai_web backend/services/plugin-market.js）。
 */

export interface MarketPluginSource {
  type: "github" | "gitee" | "git" | string;
  ref?: string;
  /** 客户端可直接粘贴到安装框的分发源（github:owner/repo#main 等） */
  install: string;
}

export interface MarketPluginLatest {
  version?: string;
  apiVersion?: number;
  channel?: "stable" | "beta" | string;
  changelog?: string;
  publishedAt?: string;
}

export interface MarketPlugin {
  id: string;
  name: string;
  description: string;
  author?: string;
  tags: string[];
  icon?: string | null;
  source: MarketPluginSource;
  repository?: string;
  latest?: MarketPluginLatest | null;
  verified: boolean;
  featured: boolean;
  downloads: number;
}

export interface MarketPluginDetail extends MarketPlugin {
  screenshots: string[];
  homepage?: string;
}

export interface MarketListResponse {
  items: MarketPlugin[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface MarketTag {
  name: string;
  count: number;
}

/** 安装源字符串合法性：只放行受支持的四协议（防索引被注入任意 source） */
export function isSafeInstallSource(install: string): boolean {
  return /^(github|gitee):[a-zA-Z0-9_][a-zA-Z0-9._-]*\/[a-zA-Z0-9_][a-zA-Z0-9._-]*(#[a-zA-Z0-9._/-]+)?$/.test(
    install,
  ) || /^git:https:\/\/[^\s#]+(#[a-zA-Z0-9._/-]+)?$/.test(install);
}
