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

const BOCHA_SEARCH_URL = "https://api.bocha.cn/v1/web-search";

@Injectable()
export class BochaProvider implements SearchProvider {
  readonly name = "bocha";
  readonly displayName = "博查";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: false },
    searchReturnsContent: true,
    supportsWebpageExtract: false,
    scoreType: "number",
  };
  private readonly logger = new Logger(BochaProvider.name);

  async search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse> {
    const { size = 10 } = options;

    const response = await fetch(BOCHA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        count: size,
        summary: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Bocha search API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json();

    // 检查业务错误码
    if (data.code && data.code !== 200) {
      throw new Error(
        `Bocha search API error (${data.code}): ${data.msg || data.message || "Unknown error"}`,
      );
    }

    const webPages = data?.data?.webPages?.value || [];
    const total = data?.data?.webPages?.totalEstimate || webPages.length;

    const results: SearchResult[] = webPages.map((page: any, index: number) => {
      const item: SearchResult = {
        index: index + 1,
        title: page.name || "",
        link: page.url || "",
        score: String(page.score || index + 1),
      };
      if (page.datePublished) item.date = page.datePublished;
      if (page.summary) {
        item.content =
          page.summary.length > 2000
            ? safeTruncate(page.summary, 2000)
            : page.summary;
      } else if (page.snippet) item.summary = page.snippet;

      return item;
    });

    return { total, results };
  }

  async readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string> {
    const response = await fetch(BOCHA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: url,
        count: 1,
        summary: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Bocha web read API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json();

    if (data.code && data.code !== 200) {
      throw new Error(
        `Bocha web read API error (${data.code}): ${data.msg || data.message || "Unknown error"}`,
      );
    }

    const webPages = data?.data?.webPages?.value || [];

    if (webPages.length === 0) {
      return "No content found for the given URL";
    }

    const page = webPages[0];
    const parsed: ParseResponse = {
      title: page.name,
      url: page.url || url,
      date: page.datePublished,
      summary: page.snippet,
      content: page.summary,
    };

    if (format === "markdown") {
      return [
        `# ${page.name || "Untitled"}`,
        "",
        `> Source: ${page.url || url}`,
        `> Published: ${page.datePublished || "Unknown"}`,
        "",
        page.summary || page.snippet || "No content",
      ].join("\n");
    }

    return parsed;
  }
}
