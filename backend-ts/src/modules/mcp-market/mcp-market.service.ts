/**
 * MCP 市场编排：榜单聚合（带缓存）+ 条目配置解析。
 *
 * 榜单抓取遵循「单源失败不影响整体」：每个源独立 try/catch，失败只进 errors[]，
 * 其余源照常返回。这是刻意的 —— 第三方站点随时可能被墙、改版或临时 502，
 * 一个源挂了不该让整个市场页面白屏。
 */
import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  fetchMarketJson,
  fetchMarketText,
  MarketFetchError,
} from "../../common/http/market-http.client";
import {
  ExtractedMcpConfig,
  extractMcpConfig,
  McpMarketItem,
} from "./mcp-config.extract";
import {
  findSource,
  isValidSlug,
  MARKET_SOURCES,
  mcpworldDetailToMarkdown,
  slugOf,
} from "./market-sources";

/** 榜单内存缓存 TTL：10 分钟 */
const RANKINGS_TTL_MS = 10 * 60 * 1000;
/** 单源超时（fetchMarketText 内部 12s，这里再兜一层总量） */
const SOURCE_BUDGET_MS = 25_000;

export interface RankingsResponse {
  fetchedAt: number;
  items: McpMarketItem[];
  /** 逐源失败原因，前端据此提示「部分来源不可用」 */
  errors: string[];
}

export interface ResolveResponse {
  configJson: unknown;
  servers: ExtractedMcpConfig["servers"];
  score: number;
}

@Injectable()
export class McpMarketService {
  private readonly logger = new Logger(McpMarketService.name);

  /** 缓存按 source 分桶，便于局部刷新 */
  private cache = new Map<string, { at: number; items: McpMarketItem[] }>();

  /** 同一时刻只允许一个抓取，避免并发点击打爆上游 */
  private inflight: Promise<RankingsResponse> | null = null;

  /**
   * 取榜单。
   *
   * @param source 'all' 或具体源 id
   * @param forceRefresh 绕过缓存
   */
  async getRankings(source = "all", forceRefresh = false): Promise<RankingsResponse> {
    const selected = this.selectSources(source);

    if (!forceRefresh && selected.length === 1) {
      const cached = this.cache.get(selected[0].id);
      if (cached && Date.now() - cached.at < RANKINGS_TTL_MS) {
        return { fetchedAt: cached.at, items: cached.items, errors: [] };
      }
    }

    if (this.inflight) return this.inflight;

    this.inflight = this.fetchAll(selected).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private selectSources(source: string) {
    if (!source || source === "all") return MARKET_SOURCES;
    const found = findSource(source);
    if (!found) {
      throw new BadRequestException(`未知的市场来源：${source}`);
    }
    return [found];
  }

  private async fetchAll(
    sources: ReturnType<typeof MARKET_SOURCES.slice>,
  ): Promise<RankingsResponse> {
    const errors: string[] = [];
    const items: McpMarketItem[] = [];
    const now = Date.now();

    const results = await Promise.all(
      sources.map(async (src) => {
        try {
          const body = await withBudget(
            fetchMarketJson(src.rankingUrl),
            SOURCE_BUDGET_MS,
            src.id,
          );
          const parsed = src.parseRankings(body);
          if (parsed.length === 0) {
            throw new Error("榜单解析结果为空（上游结构可能已变更）");
          }
          this.cache.set(src.id, { at: now, items: parsed });
          return { id: src.id, items: parsed, error: null as string | null };
        } catch (error: any) {
          const message = describe(error);
          this.logger.warn(`市场来源 ${src.id} 抓取失败：${message}`);
          return { id: src.id, items: [] as McpMarketItem[], error: `${src.id}: ${message}` };
        }
      }),
    );

    for (const result of results) {
      if (result.error) errors.push(result.error);
      items.push(...result.items);
    }

    // 合并后按源内排名重编，保证前端展示稳定
    items.forEach((item, index) => {
      item.rank = index + 1;
    });

    if (items.length === 0 && errors.length > 0) {
      throw new BadGatewayException(`所有市场来源均不可用：${errors.join("；")}`);
    }

    return { fetchedAt: now, items, errors };
  }

  /**
   * 解析某个市场条目的可导入配置。
   *
   * @throws BadRequestException 条目 id 非法
   * @throws BadGatewayException  上游不可用或没有可导入的配置块
   */
  async resolveItem(source: string, itemId: string): Promise<ResolveResponse> {
    const src = findSource(source);
    if (!src) {
      throw new BadRequestException(`未知的市场来源：${source}`);
    }

    const slug = slugOf(itemId);
    if (!slug || !isValidSlug(slug)) {
      throw new BadRequestException(`非法的市场条目 id：${itemId}`);
    }

    const detailUrl = src.detailUrl(itemId);
    let markdown: string;

    try {
      if (src.id === "mcpworld") {
        const body = await withBudget(fetchMarketJson(detailUrl), SOURCE_BUDGET_MS, src.id);
        markdown = mcpworldDetailToMarkdown(body);
      } else {
        markdown = await withBudget(fetchMarketText(detailUrl), SOURCE_BUDGET_MS, src.id);
      }
    } catch (error: any) {
      throw new BadGatewayException(`获取市场条目配置失败：${describe(error)}`);
    }

    if (!markdown.trim()) {
      throw new BadGatewayException("市场条目没有可用的详情文本");
    }

    const extracted = extractMcpConfig(markdown, slugOf(itemId) || "mcp-server");
    if (!extracted) {
      // 注意区分两种「失败」：
      // - 上游不可用 → 502（BadGatewayException，可重试）
      // - 该条目本身只写了文档、没给配置 → 422（不可重试，但原因明确）
      // 统一报 502 会让用户以为是自己网络问题，反复重试。
      throw new UnprocessableEntityException(
        "该条目未提供可导入的 MCP 配置（readme 里没有 mcpServers 代码块）",
      );
    }

    return {
      configJson: extracted.configJson,
      servers: extracted.servers,
      score: extracted.score,
    };
  }
}

/** 给单源加一层总时长预算，避免某个源卡住整个 Promise.all */
function withBudget<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    // 不阻止进程退出：抓取结束后残留的计时器不该拖住 node
    timer.unref?.();
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function describe(error: unknown): string {
  if (error instanceof MarketFetchError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
