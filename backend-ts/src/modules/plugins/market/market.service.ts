/**
 * 插件市场服务：官网索引透传 + 一键安装 + 安装计数上报。
 *
 * 设计要点：
 * - 索引数据来自官网（默认 ai.dingd.cn/api/plugin-market），只做透传与缓存；
 *   官网不可达时 list/tags 返回空数据（不抛错），前端展示空态，
 *   本地插件功能不受任何影响；只有安装这类"必须拿到索引"的操作才报错；
 * - 安装不引入新分发协议：从索引取 source.install，直接走
 *   ExternalPluginLoader.installPluginJob（github:/gitee:/git: 浅克隆）；
 * - 安装源做协议白名单校验（isSafeInstallSource），索引被篡改也不会把
 *   任意 URL 送进 git clone；
 * - 安装成功后向官网上报计数，静默失败（市场统计，不阻塞用户）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { fetchMarketJson, MarketFetchError } from "../../../common/http/market-http.client";
import { ExternalPluginLoader } from "../external/external-plugin-loader";
import {
  marketListUrl,
  marketDetailUrl,
  marketTagsUrl,
  marketInstallReportUrl,
  marketHostPolicy,
} from "./market-source";
import {
  isSafeInstallSource,
  type MarketListResponse,
  type MarketPlugin,
  type MarketPluginDetail,
  type MarketTag,
} from "./market.types";

/** 列表缓存秒数：索引数据变化不频繁，避免每次打开市场都打官网 */
const LIST_CACHE_MS = 60_000;

interface ListCache {
  key: string;
  at: number;
  data: MarketListResponse;
}

@Injectable()
export class PluginMarketService {
  private readonly logger = new Logger(PluginMarketService.name);
  private listCache: ListCache | null = null;
  private inFlight: Promise<MarketListResponse> | null = null;

  constructor(private readonly externalLoader: ExternalPluginLoader) {}

  /**
   * 拉取市场列表（分页 + keyword + tag），60s 内存缓存。
   * 官网不可达 → 返回空分页（不抛错），前端空态可重试。
   */
  async list(params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    tag?: string;
  }): Promise<MarketListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(Math.max(1, params.pageSize ?? 12), 50);
    const keyword = (params.keyword ?? "").trim();
    const tag = (params.tag ?? "").trim();
    const key = JSON.stringify({ page, pageSize, keyword, tag });

    const now = Date.now();
    if (this.listCache && this.listCache.key === key && now - this.listCache.at < LIST_CACHE_MS) {
      return this.listCache.data;
    }
    if (this.inFlight) return this.inFlight;

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (keyword) query.set("keyword", keyword);
    if (tag) query.set("tag", tag);

    this.inFlight = this.fetchJson<MarketListResponse>(`${marketListUrl()}?${query.toString()}`)
      .then((data) => {
        this.listCache = { key, at: Date.now(), data };
        return data;
      })
      .catch((err: Error) => {
        this.logger.warn(`插件市场索引不可达，返回空列表: ${err.message}`);
        return {
          items: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 },
        } satisfies MarketListResponse;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** 拉取插件详情；官网不可达或 id 非法 → null */
  async detail(id: string): Promise<MarketPluginDetail | null> {
    if (!this.isValidMarketId(id)) return null;
    try {
      return await this.fetchJson<MarketPluginDetail>(marketDetailUrl(id));
    } catch {
      return null;
    }
  }

  /** 标签聚合；官网不可达 → 空数组（前端 chips 行直接隐藏） */
  async tags(): Promise<MarketTag[]> {
    try {
      const data = await this.fetchJson<{ tags: MarketTag[] }>(marketTagsUrl());
      return Array.isArray(data?.tags) ? data.tags : [];
    } catch {
      return [];
    }
  }

  /**
   * 从市场一键安装：按 id 查索引 → 校验安装源 → 复用既有安装任务。
   * 返回 jobId 供前端轮询 install-log（与手动安装一致）。
   */
  async installFromMarket(id: string): Promise<{ jobId: string; source: string }> {
    if (!this.isValidMarketId(id)) {
      throw new Error(`无效的插件 id: ${id}`);
    }
    const plugin = await this.detail(id);
    if (!plugin?.source?.install) {
      throw new Error(`市场索引中找不到插件或缺少安装源: ${id}`);
    }
    const install = plugin.source.install;
    if (!isSafeInstallSource(install)) {
      throw new Error(`插件 ${id} 的安装源不受支持: ${install}`);
    }
    const { jobId } = await this.externalLoader.installPluginJob(install);
    return { jobId, source: install };
  }

  /** 安装成功后上报计数（fire-and-forget，静默失败） */
  reportInstall(id: string): void {
    if (!this.isValidMarketId(id)) return;
    // fetchMarketJson 只支持 GET；计数接口是 POST，目标为白名单官网域名，
    // 用原生 fetch 短超时直发，失败静默（市场统计不阻塞用户）。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    void fetch(marketInstallReportUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      signal: controller.signal,
    })
      .catch(() => {
        /* 计数上报失败不影响用户 */
      })
      .finally(() => clearTimeout(timer));
  }

  /** 市场服务是否可达（轻探测：tags 接口最小） */
  async ping(): Promise<{ ok: boolean }> {
    try {
      const tags = await this.tags();
      return { ok: tags.length > 0 };
    } catch {
      return { ok: false };
    }
  }

  // ------------------------------------------------------------------

  /** 市场 id 合法性：与官网收录 id 同规则 */
  private isValidMarketId(id: string): boolean {
    return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    try {
      return await fetchMarketJson<T>(url, marketHostPolicy());
    } catch (err) {
      if (err instanceof MarketFetchError) {
        this.logger.warn(`插件市场请求失败 (${err.code}): ${err.message}`);
        throw new Error(`插件市场暂不可用（${err.code}）`);
      }
      throw err;
    }
  }
}

// re-export 便于 controller 引用
export type { MarketPlugin };
