import { Injectable, Logger } from "@nestjs/common";
import {
  SearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResult,
  ParseResponse,
  SearchCapabilities,
} from "./search-provider.interface";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

@Injectable()
export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  readonly displayName = "Tavily";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: false },
    searchReturnsContent: true,
    supportsWebpageExtract: true,
    scoreType: "number",
  };
  private readonly logger = new Logger(TavilyProvider.name);

  async search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse> {
    const { size = 10 } = options;

    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        search_depth: "basic",
        max_results: size,
        include_answer: false,
        include_raw_content: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Tavily search API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json();
    const rawResults = data.results || [];

    const results: SearchResult[] = rawResults.map(
      (item: any, index: number) => {
        const result: SearchResult = {
          index: index + 1,
          title: item.title || "",
          link: item.url || "",
          score: item.score != null ? String(item.score) : "unknown",
        };
        if (item.content) result.summary = item.content;
        if (item.raw_content) {
          result.content =
            item.raw_content.length > 5000
              ? item.raw_content.substring(0, 5000)
              : item.raw_content;
        }
        return result;
      },
    );

    return { total: results.length, results };
  }

  async readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string> {
    const response = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [url],
        extract_depth: "basic",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Tavily extract API failed (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    const data = await response.json();
    const results = data.results || [];

    if (results.length === 0) {
      return "No content found for the given URL";
    }

    const page = results[0];
    const parsed: ParseResponse = {
      title: page.title,
      url: page.url || url,
      content: page.raw_content || page.content,
    };

    if (format === "markdown") {
      return [
        `# ${page.title || "Untitled"}`,
        "",
        `> Source: ${page.url || url}`,
        "",
        page.raw_content || page.content || "No content",
      ].join("\n");
    }

    return parsed;
  }
}
