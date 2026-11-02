import type { ApiContext } from "./api-context";

/**
 * SkillHub 技能市场 API。
 *
 * 与官网市场（SkillMarketService 前端直连）不同：SkillHub 的列表、详情、
 * 分类与安装全部由本机后端代理（白名单 + 缓存 + 下载 302 跟随），
 * 所以这里走统一 `apiService`，鉴权/错误处理/后端端口复用既有链路。
 */

export type SkillHubLang = "zh" | "en";

export interface SkillHubMarketItem {
  source: "skillhub";
  /** 市场内稳定 id（slug） */
  id: string;
  name: string;
  /** 已按请求语言归一 */
  description: string;
  icon: string | null;
  version?: string;
  category?: { key: string };
  subCategories: Array<{ key: string; name: string }>;
  labels?: Record<string, string>;
  stats: { downloads: number; stars: number; installs: number };
  verified?: boolean;
  /** community / official / ... */
  sourceType?: string;
  updatedAt?: number;
  detailUrl: string;
}

export interface SkillHubPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SkillHubListResult {
  items: SkillHubMarketItem[];
  pagination: SkillHubPagination;
}

export interface SkillHubCategory {
  id: string;
  name: string;
  nameI18n: Record<string, string>;
}

export interface SkillHubSecurityReport {
  provider: string;
  status: string;
  statusText: string;
  reportUrl?: string;
}

export interface SkillHubEvaluationDimension {
  key: string;
  score: number | null;
  userReason: string | null;
}

export interface SkillHubEvaluation {
  totalScore: number | null;
  userSummary: string | null;
  dimensions: SkillHubEvaluationDimension[];
  updatedAt?: number;
}

export interface SkillHubDetail {
  item: SkillHubMarketItem;
  owner?: {
    handle: string;
    displayName: string;
    image: string | null;
  };
  latestVersion?: {
    version: string;
    createdAt?: number;
    changelog?: string;
  };
  securityReports: SkillHubSecurityReport[];
  evaluation: SkillHubEvaluation | null;
}

export interface SkillHubRecommendedResult {
  items: SkillHubMarketItem[];
  fetchedAt: number;
}

export interface SkillHubInstallOrigin {
  source: string;
  itemId: string;
  version?: string;
  installedAt?: string;
}

export interface SkillHubInstallResult {
  success: boolean;
  skillIds?: string[];
  message: string;
  origin?: SkillHubInstallOrigin;
}

export interface SkillHubMarketApi {
  fetchSkillHubList(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    category?: string;
    sortBy?: string;
    order?: "asc" | "desc";
    lang: SkillHubLang;
  }): Promise<SkillHubListResult>;

  fetchSkillHubRecommended(
    limit: number,
    refresh: boolean,
    lang: SkillHubLang,
  ): Promise<SkillHubRecommendedResult>;

  fetchSkillHubCategories(lang: SkillHubLang): Promise<{ items: SkillHubCategory[] }>;

  fetchSkillHubDetail(slug: string, lang: SkillHubLang): Promise<SkillHubDetail>;

  installSkillHubSkill(params: {
    slug: string;
    version?: string;
    force?: boolean;
  }): Promise<SkillHubInstallResult>;
}

export const skillHubMarketApi: SkillHubMarketApi = {
  async fetchSkillHubList(
    this: ApiContext,
    params: {
      page: number;
      pageSize: number;
      keyword?: string;
      category?: string;
      sortBy?: string;
      order?: "asc" | "desc";
      lang: SkillHubLang;
    },
  ) {
    const query = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
      lang: params.lang,
    });
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.category) query.set("category", params.category);
    if (params.sortBy) query.set("sortBy", params.sortBy);
    if (params.order) query.set("order", params.order);

    return await this._request<SkillHubListResult>(
      `/skill-market/skillhub/list?${query.toString()}`,
    );
  },

  async fetchSkillHubRecommended(
    this: ApiContext,
    limit: number,
    refresh: boolean,
    lang: SkillHubLang,
  ) {
    const query = new URLSearchParams({ limit: String(limit), lang });
    if (refresh) query.set("refresh", "1");
    return await this._request<SkillHubRecommendedResult>(
      `/skill-market/skillhub/recommended?${query.toString()}`,
    );
  },

  async fetchSkillHubCategories(this: ApiContext, lang: SkillHubLang) {
    return await this._request<{ items: SkillHubCategory[] }>(
      `/skill-market/skillhub/categories?lang=${encodeURIComponent(lang)}`,
    );
  },

  async fetchSkillHubDetail(this: ApiContext, slug: string, lang: SkillHubLang) {
    return await this._request<SkillHubDetail>(
      `/skill-market/skillhub/skills/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`,
    );
  },

  async installSkillHubSkill(
    this: ApiContext,
    params: { slug: string; version?: string; force?: boolean },
  ) {
    return await this._request<SkillHubInstallResult>("/skill-market/skillhub/install", {
      method: "POST",
      data: params,
      // 技能包可能较大（上限 50MB），给下载 + 解压留足时间
      timeout: 180000,
    });
  },
};
