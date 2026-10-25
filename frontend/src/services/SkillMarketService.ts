/**
 * 技能市场服务
 * 调用官网市场 API v2 获取推荐技能列表（支持中英文，见 ai_web/backend/docs/api.md）
 */

import axios from "axios";

const MARKET_BASE_URL = import.meta.env.VITE_MARKET_BASE_URL || "https://ai.dingd.cn";

const marketClient = axios.create({
  baseURL: MARKET_BASE_URL,
  timeout: 15000,
});

/** 应用语言 → 市场语言参数（v2 支持 zh / en，en-US 归一化为 en） */
export type MarketLang = "zh" | "en";

export function localeToMarketLang(locale: string): MarketLang {
  return locale.toLowerCase().startsWith("en") ? "en" : "zh";
}

/** 安装地址 */
export interface InstallUrl {
  type: "zip" | "git";
  url: string;
}

/** 标签（v2 为对象数组，name 跟随请求语言） */
export interface MarketLabel {
  id: string;
  name: string;
  lang?: string;
}

/** 标签列表项（labels 端点，含多语言名） */
export interface MarketLabelInfo {
  id: string;
  name: string;
  nameI18n: Record<string, string>;
}

/** 单语言文案 */
export interface MarketI18nEntry {
  name: string;
  description: string;
  examples?: string[];
}

/** 市场技能项（v2 只做加法，未知字段忽略） */
export interface MarketSkill {
  id: string;
  name: string;
  description: string;
  lang: string;
  requestedLang: string;
  defaultLang?: string;
  availableLangs?: string[];
  i18n?: Record<string, MarketI18nEntry>;
  labels: MarketLabel[];
  icon: string | null;
  installUrls: InstallUrl[];
  detailUrl?: string;
  version?: string;
  recommended?: boolean;
  updatedAt?: string | null;
}

/** v2 列表响应信封 */
export interface SkillListResponse {
  lang: string;
  requestedLang: string;
  items: MarketSkill[];
}

/** v2 分页结构 */
export interface MarketPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** v2 搜索列表响应信封（/list 端点） */
export interface PagedSkillResponse extends SkillListResponse {
  pagination: MarketPagination;
}

/** 本地状态 */
export type LocalStatus = "not_installed" | "installed" | "updatable";

/** 带本地状态的市场技能 */
export interface MarketSkillWithStatus extends MarketSkill {
  localStatus: LocalStatus;
  localVersion?: string;
}

const CACHE_DURATION = 60 * 60 * 1000; // 1小时
const CACHE_KEY_PREFIX = "skill_market_cache";

// 缓存 key 必须带语言，否则切换语言后会命中旧语言缓存（skill-i18n-spec.md §9）
function cacheKey(lang: MarketLang): string {
  return `${CACHE_KEY_PREFIX}_${lang}`;
}

interface CacheData {
  data: MarketSkill[];
  timestamp: number;
}

function getCachedSkills(lang: MarketLang): MarketSkill[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(lang));
    if (!raw) return null;
    const parsed: CacheData = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_DURATION) {
      localStorage.removeItem(cacheKey(lang));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedSkills(lang: MarketLang, data: MarketSkill[]): void {
  try {
    const cache: CacheData = { data, timestamp: Date.now() };
    localStorage.setItem(cacheKey(lang), JSON.stringify(cache));
  } catch {
    // 缓存失败静默处理
  }
}

// 标签列表内存缓存（按语言；组件生命周期内有效，切语言重载由调用方负责）
const labelMemo = new Map<MarketLang, MarketLabelInfo[]>();

/**
 * 提取 v2 错误消息。v2 错误结构为 { error: { code, message } }，
 * 与本应用拦截器的扁平结构不同，需在此归一为普通 Error。
 */
function toMarketError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: { message?: unknown } | string; message?: unknown; detail?: unknown }
      | undefined;
    const nested =
      typeof data?.error === "object" && typeof data.error.message === "string"
        ? data.error.message
        : undefined;
    const server =
      nested ??
      (typeof data?.message === "string" && data.message ? data.message : undefined) ??
      (typeof data?.detail === "string" && data.detail ? data.detail : undefined);
    return new Error(server ?? error.message);
  }
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export const SkillMarketService = {
  /**
   * 获取市场推荐技能列表（带缓存，按语言隔离）
   */
  async fetchMarketSkills(lang: MarketLang, useCache: boolean = true): Promise<MarketSkill[]> {
    if (useCache) {
      const cached = getCachedSkills(lang);
      if (cached) {
        return cached;
      }
    }

    try {
      const { data } = await marketClient.get<SkillListResponse>("/api/v2/market/skills", {
        params: { limit: 12, lang },
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setCachedSkills(lang, items);
      return items;
    } catch (err) {
      throw toMarketError(err);
    }
  },

  /**
   * 获取市场标签列表（内存缓存按语言隔离；标签 id 不保证全局唯一，仅作展示用）
   */
  async fetchMarketLabels(lang: MarketLang): Promise<MarketLabelInfo[]> {
    const memo = labelMemo.get(lang);
    if (memo) {
      return memo;
    }

    try {
      const { data } = await marketClient.get<{ items?: MarketLabelInfo[] }>(
        "/api/v2/market/labels",
        { params: { lang } },
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      labelMemo.set(lang, items);
      return items;
    } catch (err) {
      throw toMarketError(err);
    }
  },

  /**
   * 搜索市场技能列表（分页 + 关键词 + 标签过滤，不缓存）
   */
  async fetchMarketList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    labelId?: string;
    lang: MarketLang;
  }): Promise<PagedSkillResponse> {
    try {
      const { data } = await marketClient.get<PagedSkillResponse>("/api/v2/market/list", {
        params,
      });
      return {
        ...data,
        items: Array.isArray(data?.items) ? data.items : [],
        pagination: data?.pagination ?? { page: 1, pageSize: 0, total: 0, totalPages: 1 },
      };
    } catch (err) {
      throw toMarketError(err);
    }
  },
};
