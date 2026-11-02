/**
 * SkillHub 技能市场编排。
 *
 * 设计取舍：
 * - 所有请求都走本机后端，而不是像官网市场那样由渲染进程直连。原因：
 *   1. 浏览器直连的 CORS 行为不受我们控制；
 *   2. 下载接口 302 到带签名的对象存储，渲染进程拿不到稳定的下载链路；
 *   3. 后端可以做白名单、体积上限、缓存与可选 X-API-Key（密钥不落到前端）。
 * - 推荐位用 /api/skills/top 的 Top 50 池随机取 12，和官网市场「换一批」的心智一致。
 * - 搜索/分类结果不缓存（用户输入驱动，缓存只会让人以为搜索没生效）；
 *   推荐池、分类、详情做短 TTL 缓存。
 */
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  fetchMarketBinary,
  fetchMarketJson,
  MarketFetchError,
  SKILLHUB_DOWNLOAD_HOST_POLICY,
} from "../../common/http/market-http.client";
import { SkillOrchestrator } from "../skills/core/skill-orchestrator.service";
import {
  extractZipSafely,
  installSkillsFromDirectory,
} from "../skills/core/skill-package.installer";
import { SkillOrigin } from "../skills/interfaces/skill-manifest.interface";
import {
  buildCategoriesUrl,
  buildSkillDetailUrl,
  buildSkillDownloadUrl,
  buildSkillEvaluationUrl,
  buildSkillListUrl,
  buildSkillTopUrl,
  MarketLang,
  normalizeSlug,
  parseCategoriesResponse,
  parseEvaluationResponse,
  parseSkillDetailResponse,
  parseSkillListResponse,
  parseSkillTopResponse,
  pickRandom,
  SkillHubCategory,
  SkillHubDetail,
  SkillHubListResult,
  SkillHubMarketItem,
} from "./skillhub.api";

/** 推荐池 TTL：10 分钟 */
const TOP_TTL_MS = 10 * 60 * 1000;
/** 分类字典 TTL：1 小时（官方明确说分类会变，但不需要每次请求都拉） */
const CATEGORIES_TTL_MS = 60 * 60 * 1000;
/** 详情 TTL：5 分钟 */
const DETAIL_TTL_MS = 5 * 60 * 1000;
/** 详情缓存条目上限，避免长时间运行后无限增长 */
const DETAIL_CACHE_MAX = 100;

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;
const DEFAULT_RECOMMEND_LIMIT = 12;
const MAX_RECOMMEND_LIMIT = 50;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

const SORT_FIELDS = new Set(["updated_at", "downloads", "stars", "installs", "score"]);

export interface SkillHubListQuery {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
  category?: string;
  sortBy?: string;
  order?: string;
  lang?: string;
}

export interface SkillHubRecommendedResult {
  items: SkillHubMarketItem[];
  fetchedAt: number;
}

export interface SkillHubCategoriesResult {
  items: SkillHubCategory[];
}

export interface SkillHubInstallResult {
  success: boolean;
  skillIds?: string[];
  message: string;
  origin?: SkillOrigin;
}

@Injectable()
export class SkillHubMarketService {
  private readonly logger = new Logger(SkillHubMarketService.name);
  private readonly skillsDir: string;

  private readonly topCache = new Map<MarketLang, { at: number; items: SkillHubMarketItem[] }>();
  private readonly categoriesCache = new Map<MarketLang, { at: number; items: SkillHubCategory[] }>();
  private readonly detailCache = new Map<string, { at: number; detail: SkillHubDetail }>();

  /** 同一语言的并发推荐/分类请求只打一次上游 */
  private readonly inflightTop = new Map<MarketLang, Promise<SkillHubMarketItem[]>>();
  private readonly inflightCategories = new Map<MarketLang, Promise<SkillHubCategory[]>>();

  constructor(
    private readonly config: ConfigService,
    private readonly orchestrator: SkillOrchestrator,
  ) {
    this.skillsDir =
      this.config.get<string>("SKILLS_DIR") || path.join(process.cwd(), "skills");
  }

  /** 列表/搜索：pageSize 上限 100，排序字段走白名单 */
  async list(query: SkillHubListQuery): Promise<SkillHubListResult> {
    const page = clampInt(query.page, 1, 1, 100_000);
    const pageSize = clampInt(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const lang = normalizeLang(query.lang);
    const keyword = trimText(query.keyword, 100);
    const category = sanitizeCategory(query.category);

    const requestedSort = trimText(query.sortBy, 32);
    const sortBy = SORT_FIELDS.has(requestedSort)
      ? requestedSort
      : keyword
        ? "score"
        : "downloads";
    const order = trimText(query.order, 8) === "asc" ? "asc" : "desc";

    const url = buildSkillListUrl({
      page,
      pageSize,
      ...(keyword ? { keyword } : {}),
      ...(category ? { category } : {}),
      sortBy,
      order,
    });

    try {
      const body = await fetchMarketJson<unknown>(url, undefined, this.headers());
      return parseSkillListResponse(body, { lang, page, pageSize });
    } catch (error) {
      throw this.toUpstreamError(error, "SkillHub 技能列表");
    }
  }

  /**
   * 推荐位：Top 50 池随机取 N。
   *
   * Top 接口失败时回退到「按下载量列表」；两者都失败才报错。
   * 已有缓存时，上游临时抖动继续用旧池，不让页面白屏。
   */
  async recommended(
    limit?: number | string,
    refresh?: boolean,
    lang?: string,
  ): Promise<SkillHubRecommendedResult> {
    const normalizedLang = normalizeLang(lang);
    const take = clampInt(limit, DEFAULT_RECOMMEND_LIMIT, 1, MAX_RECOMMEND_LIMIT);

    const cached = this.topCache.get(normalizedLang);
    if (!refresh && cached && Date.now() - cached.at < TOP_TTL_MS) {
      return { items: pickRandom(cached.items, take), fetchedAt: cached.at };
    }

    try {
      const pool = await this.fetchTopPool(normalizedLang);
      const at = this.topCache.get(normalizedLang)?.at ?? Date.now();
      return { items: pickRandom(pool, take), fetchedAt: at };
    } catch (error) {
      if (cached) {
        this.logger.warn(`SkillHub 推荐刷新失败，继续使用缓存：${describe(error)}`);
        return { items: pickRandom(cached.items, take), fetchedAt: cached.at };
      }
      throw this.toUpstreamError(error, "SkillHub 推荐列表");
    }
  }

  /** 一级分类：过滤未激活与 pay-skill，按 sortOrder 返回 */
  async categories(lang?: string): Promise<SkillHubCategoriesResult> {
    const normalizedLang = normalizeLang(lang);
    const cached = this.categoriesCache.get(normalizedLang);
    if (cached && Date.now() - cached.at < CATEGORIES_TTL_MS) {
      return { items: cached.items };
    }

    try {
      const items = await this.fetchCategories(normalizedLang);
      return { items };
    } catch (error) {
      if (cached) {
        this.logger.warn(`SkillHub 分类刷新失败，继续使用缓存：${describe(error)}`);
        return { items: cached.items };
      }
      throw this.toUpstreamError(error, "SkillHub 分类");
    }
  }

  /**
   * 详情 + 质量评测。
   *
   * 两个接口并行；评测 404（尚无评测）是正常状态，不当成失败。
   */
  async detail(slugRaw: string, lang?: string): Promise<SkillHubDetail> {
    const slug = normalizeSlug(slugRaw);
    if (!slug) {
      throw new BadRequestException("缺少或非法的技能 slug");
    }

    const normalizedLang = normalizeLang(lang);
    const cacheKey = `${normalizedLang}:${slug}`;
    const cached = this.detailCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DETAIL_TTL_MS) {
      return cached.detail;
    }

    const [detailResult, evaluationResult] = await Promise.allSettled([
      fetchMarketJson<unknown>(buildSkillDetailUrl(slug), undefined, this.headers()),
      fetchMarketJson<unknown>(buildSkillEvaluationUrl(slug), undefined, this.headers()),
    ]);

    if (detailResult.status === "rejected") {
      throw this.toUpstreamError(detailResult.reason, `SkillHub 技能 ${slug}`);
    }

    let detail: SkillHubDetail;
    try {
      detail = parseSkillDetailResponse(detailResult.value, normalizedLang);
    } catch (error) {
      throw new BadGatewayException(
        `SkillHub 详情解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (evaluationResult.status === "fulfilled") {
      detail.evaluation = parseEvaluationResponse(evaluationResult.value);
    } else {
      const reason = evaluationResult.reason;
      // 404 = 该技能暂无评测结果，正常状态，不记 warn
      if (!(reason instanceof MarketFetchError && reason.status === 404)) {
        this.logger.warn(`SkillHub 评测获取失败（忽略）：${describe(reason)}`);
      }
    }

    this.rememberDetail(cacheKey, detail);
    return detail;
  }

  /**
   * 下载并安装指定 slug（可固定版本）。
   *
   * 与 /skills/install-from-url 的区别：
   * - 只接受 slug，不接受前端任意 URL；
   * - 下载走受限主机策略（api.skillhub.cn + skillhub-* COS 桶）；
   * - 成功后写 .skill-origin.json，供已安装状态/升级判断使用。
   */
  async install(params: {
    slug?: string;
    version?: string;
    force?: boolean;
  }): Promise<SkillHubInstallResult> {
    const slug = normalizeSlug(params.slug);
    if (!slug) {
      throw new BadRequestException("缺少或非法的技能 slug");
    }

    const version = normalizeVersion(params.version);
    const force = params.force === true;
    const origin: SkillOrigin = {
      source: "skillhub",
      itemId: slug,
      ...(version ? { version } : {}),
    };

    const tempDir = path.join(os.tmpdir(), `skillhub-${slug}-${Date.now()}`);

    try {
      let buffer: Buffer;
      try {
        const downloaded = await fetchMarketBinary(buildSkillDownloadUrl(slug, version), {
          policy: SKILLHUB_DOWNLOAD_HOST_POLICY,
          requireZip: true,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxBytes: DOWNLOAD_MAX_BYTES,
        });
        buffer = downloaded.buffer;
      } catch (error) {
        this.logger.warn(`SkillHub 下载失败 ${slug}：${describe(error)}`);
        return { success: false, message: describeDownloadError(error), origin };
      }

      await fs.mkdir(tempDir, { recursive: true });
      const zipPath = path.join(tempDir, "package.zip");
      await fs.writeFile(zipPath, buffer);

      const extractedDir = path.join(tempDir, "extracted");
      await fs.mkdir(extractedDir, { recursive: true });

      try {
        extractZipSafely(zipPath, extractedDir);
      } catch (error) {
        return {
          success: false,
          message: `技能包解压失败：${error instanceof Error ? error.message : String(error)}`,
          origin,
        };
      }

      const result = await installSkillsFromDirectory(extractedDir, this.skillsDir, {
        force,
        origin,
      });

      if (result.installed.length > 0) {
        try {
          await this.orchestrator.triggerScan();
        } catch (error) {
          // 安装已成功；扫描失败只影响即时刷新，下一次手动扫描会补上
          this.logger.warn(`SkillHub 安装后扫描失败：${describe(error)}`);
        }
      }

      const parts: string[] = [];
      if (result.installed.length > 0) {
        parts.push(`Installed: ${result.installed.map((s) => `'${s.skillId}'`).join(", ")}`);
      }
      if (result.errors.length > 0) {
        parts.push(`Errors: ${result.errors.map((e) => e.error).join("; ")}`);
      }

      return {
        success: result.installed.length > 0,
        skillIds: result.installed.map((s) => s.skillId),
        message: parts.length > 0 ? parts.join(". ") : "No skills found in the ZIP archive",
        origin,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SkillHub 安装失败 ${slug}：${message}`);
      return { success: false, message: `安装失败：${message}`, origin };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private headers(): Record<string, string> | undefined {
    const apiKey = this.config.get<string>("SKILLHUB_API_KEY")?.trim();
    return apiKey ? { "X-API-Key": apiKey } : undefined;
  }

  private async fetchTopPool(lang: MarketLang): Promise<SkillHubMarketItem[]> {
    const existing = this.inflightTop.get(lang);
    if (existing) return existing;

    const task = (async () => {
      try {
        const body = await fetchMarketJson<unknown>(buildSkillTopUrl(), undefined, this.headers());
        const items = parseSkillTopResponse(body, lang);
        if (items.length === 0) {
          throw new Error("SkillHub Top 榜为空");
        }
        this.topCache.set(lang, { at: Date.now(), items });
        return items;
      } catch (topError) {
        // Top 榜是排序特化接口，失败时退到普通列表，保证推荐位仍有内容
        const fallbackUrl = buildSkillListUrl({
          page: 1,
          pageSize: MAX_RECOMMEND_LIMIT,
          sortBy: "downloads",
          order: "desc",
        });
        const body = await fetchMarketJson<unknown>(fallbackUrl, undefined, this.headers());
        const items = parseSkillListResponse(body, {
          lang,
          page: 1,
          pageSize: MAX_RECOMMEND_LIMIT,
        }).items;
        if (items.length === 0) throw topError;
        this.topCache.set(lang, { at: Date.now(), items });
        return items;
      }
    })().finally(() => {
      this.inflightTop.delete(lang);
    });

    this.inflightTop.set(lang, task);
    return task;
  }

  private async fetchCategories(lang: MarketLang): Promise<SkillHubCategory[]> {
    const existing = this.inflightCategories.get(lang);
    if (existing) return existing;

    const task = (async () => {
      const body = await fetchMarketJson<unknown>(buildCategoriesUrl(), undefined, this.headers());
      const items = parseCategoriesResponse(body, lang);
      if (items.length === 0) {
        throw new Error("SkillHub 分类为空");
      }
      this.categoriesCache.set(lang, { at: Date.now(), items });
      return items;
    })().finally(() => {
      this.inflightCategories.delete(lang);
    });

    this.inflightCategories.set(lang, task);
    return task;
  }

  private rememberDetail(key: string, detail: SkillHubDetail): void {
    if (this.detailCache.size >= DETAIL_CACHE_MAX) {
      const oldest = this.detailCache.keys().next().value;
      if (oldest) this.detailCache.delete(oldest);
    }
    this.detailCache.set(key, { at: Date.now(), detail });
  }

  /** 把上游异常映射成 Nest 异常，前端只看到可读文案 */
  private toUpstreamError(error: unknown, context: string): never {
    if (error instanceof MarketFetchError) {
      if (error.status === 404) {
        throw new NotFoundException(`${context}不存在或不可见`);
      }
      if (error.status === 429) {
        throw new ServiceUnavailableException("SkillHub 请求过于频繁，请稍后重试");
      }
      if (error.code === "URL_NOT_ALLOWED") {
        throw new BadGatewayException("SkillHub 地址不在白名单内，已拒绝访问");
      }
      if (error.code === "NETWORK") {
        throw new BadGatewayException("无法连接 SkillHub，请检查网络后重试");
      }
      throw new BadGatewayException(
        `${context}暂时不可用${error.status ? `（HTTP ${error.status}）` : ""}`,
      );
    }

    throw new BadGatewayException(
      `${context}失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function describe(error: unknown): string {
  if (error instanceof MarketFetchError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeLang(raw?: string): MarketLang {
  return String(raw ?? "").toLowerCase().startsWith("en") ? "en" : "zh";
}

function trimText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeCategory(raw: unknown): string {
  const value = trimText(raw, 64);
  return /^[a-z0-9-]{1,64}$/i.test(value) ? value : "";
}

function normalizeVersion(raw: unknown): string | undefined {
  const value = trimText(raw, 64).replace(/^v/i, "");
  if (!value) return undefined;
  if (!/^[0-9a-z][0-9a-z._+-]{0,63}$/i.test(value)) {
    throw new BadRequestException("非法的技能版本号");
  }
  return value;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function describeDownloadError(error: unknown): string {
  if (error instanceof MarketFetchError) {
    if (error.status === 404) return "技能或指定版本不存在（可能已下架）";
    if (error.status === 429) return "SkillHub 请求过于频繁，请稍后重试";
    if (error.code === "URL_NOT_ALLOWED") return "技能下载地址不在白名单内，已拒绝";
    if (error.code === "NOT_ZIP") return "SkillHub 返回的不是有效的 ZIP 包";
    if (error.code === "BODY_TOO_LARGE") return "技能包超过 50MB 上限";
    if (error.code === "NETWORK") return "下载技能包失败，请检查网络后重试";
    return `下载技能包失败${error.status ? `（HTTP ${error.status}）` : ""}`;
  }
  return `下载技能包失败：${error instanceof Error ? error.message : String(error)}`;
}
