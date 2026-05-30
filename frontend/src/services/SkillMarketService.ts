/**
 * 技能市场服务
 * 直接调用官网 API 获取推荐技能列表
 */

import axios from "axios";

const MARKET_BASE_URL = "https://ai.dingd.cn";

const marketClient = axios.create({
  baseURL: MARKET_BASE_URL,
  timeout: 15000,
});

/** 安装地址 */
export interface InstallUrl {
  type: "zip" | "git";
  url: string;
}

/** 市场技能项 */
export interface MarketSkill {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  labels: string[];
  installUrls: InstallUrl[];
  detailUrl?: string;
}

/** 本地状态 */
export type LocalStatus = "not_installed" | "installed" | "updatable";

/** 带本地状态的市场技能 */
export interface MarketSkillWithStatus extends MarketSkill {
  localStatus: LocalStatus;
  localVersion?: string;
}

const CACHE_KEY = "skill_market_cache";
const CACHE_DURATION = 60 * 60 * 1000; // 1小时

interface CacheData {
  data: MarketSkill[];
  timestamp: number;
}

function getCachedSkills(): MarketSkill[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CacheData = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedSkills(data: MarketSkill[]): void {
  try {
    const cache: CacheData = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 缓存失败静默处理
  }
}

export const SkillMarketService = {
  /**
   * 获取市场技能列表（带缓存）
   */
  async fetchMarketSkills(useCache: boolean = true): Promise<MarketSkill[]> {
    if (useCache) {
      const cached = getCachedSkills();
      if (cached) {
        return cached;
      }
    }

    const { data } =
      await marketClient.get<MarketSkill[]>("/api/market/skills");
    setCachedSkills(data);
    return data;
  },

  /**
   * 下载技能 ZIP 包
   */
  async downloadSkillZip(skillId: string): Promise<Blob> {
    const { data } = await marketClient.get(`/skills/${skillId}.zip`, {
      responseType: "blob",
    });
    return data;
  },
};
