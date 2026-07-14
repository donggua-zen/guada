import { Injectable, Logger } from "@nestjs/common";
import {
  SearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResult,
  ParseResponse,
  SearchCapabilities,
} from "./search-provider.interface";

const METASO_SEARCH_URL = "https://metaso.cn/api/v1/search";
const METASO_READER_URL = "https://metaso.cn/api/v1/reader";

@Injectable()
export class MetasoProvider implements SearchProvider {
  readonly name = "metaso";
  readonly displayName = "秘塔搜索";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: true, values: ["webpage", "paper", "document"] },
    searchReturnsContent: true,
    supportsWebpageExtract: true,
    scoreType: "string",
  };
  private readonly logger = new Logger(MetasoProvider.name);

  async search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse> {
    const { size = 10 } = options;

    const response = await fetch(METASO_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q,
        scope: "webpage",
        size,
        includeSummary: true,
        includeRawContent: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Metaso search API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json();

    // 检查业务错误码（API 返回 200 但 body 中可能带错误）
    if (data.errCode) {
      throw new Error(
        `Metaso search API error (${data.errCode}): ${data.errMsg || "Unknown error"}`,
      );
    }

    const webpages = data.webpages || [];

    const results: SearchResult[] = webpages.map(
      (page: any, index: number) => {
        const item: SearchResult = {
          index: index + 1,
          title: page.title || "",
          link: page.link || "",
          score: page.score || "unknown",
        };
        if (page.date) item.date = page.date;
        if (page.summary) item.summary = page.summary;
        if (page.content) {
          item.content =
            page.content.length > 5000
              ? page.content.substring(0, 5000)
              : page.content;
        }
        return item;
      },
    );

    return { total: data.total || 0, results };
  }

  async readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string> {
    const accept = format === "markdown" ? "text/plain" : "application/json";

    const response = await fetch(METASO_READER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: accept,
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Metaso reader API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    if (format === "markdown") {
      return await response.text();
    }

    // JSON format — check for error in response body
    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — treat as plain text content
      return JSON.stringify({ url, content: text }, null, 2);
    }

    if (parsed?.errCode) {
      throw new Error(
        `Metaso reader API error (${parsed.errCode}): ${parsed.errMsg || "Unknown error"}`,
      );
    }

    return JSON.stringify({ url, content: text }, null, 2);
  }
}
