import { Injectable, Logger } from "@nestjs/common";
import {
  SearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResult,
  ParseResponse,
  SearchCapabilities,
} from "./search-provider.interface";
import { safeTruncate } from "../../../../common/utils/string.utils";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_SEARCH_URL = `${DEEPSEEK_BASE_URL}/v1/tools/search`;
const DEEPSEEK_FETCH_URL = `${DEEPSEEK_BASE_URL}/v1/tools/fetch`;

/** DeepSeek 对 query 长度的硬限制（1～128 个 Unicode 字符） */
const MAX_QUERY_LENGTH = 128;
/** 单条正文最大保留长度，与 Tavily Provider 对齐，避免撑爆模型上下文 */
const MAX_CONTENT_LENGTH = 5000;
/** count 允许范围 */
const MIN_COUNT = 1;
const MAX_COUNT = 50;
/** 幂等只读请求可安全重试的状态码（官方建议：408/429/5xx 等待后重试，其它 4xx 不要重试） */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

/**
 * DeepSeek 官方搜索供应商
 *
 * - Search：POST /v1/tools/search（自研搜索引擎，按成功请求计费）
 * - Fetch： POST /v1/tools/fetch（抓取单页，返回 Markdown 正文）
 *
 * 与模型 API 共用 Key，无 scope 参数；站点/语言/时间筛选通过 query 语法（site:/lang:/after:）表达。
 */
@Injectable()
export class DeepSeekProvider implements SearchProvider {
  readonly name = "deepseek";
  readonly displayName = "DeepSeek";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: false },
    searchReturnsContent: true,
    supportsWebpageExtract: true,
    scoreType: "number",
  };
  private readonly logger = new Logger(DeepSeekProvider.name);

  async search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse> {
    const { size = 10 } = options;
    const query = safeTruncate(q, MAX_QUERY_LENGTH);
    if (query !== q) {
      this.logger.warn(
        `Query truncated to ${MAX_QUERY_LENGTH} chars (DeepSeek limit)`,
      );
    }

    const data = await this.postJson(
      DEEPSEEK_SEARCH_URL,
      {
        query,
        count: Math.min(Math.max(size, MIN_COUNT), MAX_COUNT),
        need_content: true,
      },
      apiKey,
      "DeepSeek search",
    );

    const rawResults: any[] = Array.isArray(data?.results) ? data.results : [];

    const results: SearchResult[] = rawResults.map((page: any, index: number) => {
      const item: SearchResult = {
        index: index + 1,
        title: page.title || "",
        link: page.url || "",
        score:
          page.rerank_score != null ? String(page.rerank_score) : "unknown",
      };
      if (page.date) item.date = page.date;
      // summary（约 600～800 字）本身就是给模型读的长摘要，优先于 snippet
      const summary = page.summary || page.snippet;
      if (summary) item.summary = summary;
      if (page.content) {
        item.content = safeTruncate(page.content, MAX_CONTENT_LENGTH);
      }
      return item;
    });

    return { total: results.length, results };
  }

  async readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string> {
    const data = await this.postJson(
      DEEPSEEK_FETCH_URL,
      { url },
      apiKey,
      "DeepSeek fetch",
    );

    const title = data?.title || "";
    const content = data?.content || "";

    if (!content) {
      return "No content found for the given URL";
    }

    if (format === "markdown") {
      return [
        `# ${title || "Untitled"}`,
        "",
        `> Source: ${url}`,
        "",
        content,
      ].join("\n");
    }

    return { title, url, content };
  }

  /**
   * 统一 POST：Bearer 鉴权 + 有限重试 + OpenAI 兼容错误体解析
   */
  private async postJson(
    url: string,
    body: unknown,
    apiKey: string,
    label: string,
  ): Promise<any> {
    const payload = JSON.stringify(body);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
      });

      if (response.ok) {
        return await response.json();
      }

      const raw = await response.text().catch(() => "");
      const message = this.describeError(response.status, raw);

      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
        throw new Error(`${label} failed (${response.status}): ${message}`);
      }

      lastError = new Error(message);
      const delay = this.resolveRetryDelay(response, attempt);
      this.logger.warn(
        `${label} failed (${response.status}): ${message}, retry in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw lastError ?? new Error(`${label} failed`);
  }

  /** Retry-After 优先（秒），否则指数退避 */
  private resolveRetryDelay(response: Response, attempt: number): number {
    const header = response.headers?.get?.("retry-after");
    const seconds = header ? Number(header) : NaN;
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    return BASE_RETRY_DELAY_MS * 2 ** attempt;
  }

  private describeError(status: number, raw: string): string {
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error?.message || raw;
    } catch {
      // 非 JSON，保留原文
    }

    switch (status) {
      case 400:
        return `invalid request (${message})`;
      case 401:
        return `invalid API key (${message})`;
      case 402:
        return `insufficient balance, please top up (${message})`;
      case 403:
        return `request rejected by safety policy (${message})`;
      case 404:
        return `no readable content at this URL (${message})`;
      case 429:
        return `rate limited, please retry later (${message})`;
      default:
        return message;
    }
  }
}
