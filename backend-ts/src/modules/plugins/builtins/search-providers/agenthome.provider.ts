import { Injectable, Logger } from "@nestjs/common";
import {
  SearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResult,
  ParseResponse,
  SearchCapabilities,
} from "./search-provider.interface";
import { McpClientService } from "../../../../common/mcp/mcp-client.service";
import { McpServerConfig } from "../../../../common/mcp/mcp.types";

/** AgentHome 的 MCP 端点（Streamable HTTP） */
const AGENTHOME_MCP_URL = "https://token.agenthome.cc/mcp/web-search";
/** 连接池归属 id：与 MCP 服务器配置的 id 空间隔离，避免被 MCP 管理页的失效逻辑误伤 */
const AGENTHOME_SERVER_ID = "builtin-search:agenthome";

/** 上游固定暴露的两个工具 */
const SEARCH_TOOL = "web_search";
const FETCH_TOOL = "web_fetch";

/** web_search 的 max_results 上限（上游 schema 限制 1～10） */
const MAX_RESULTS = 10;
/** web_fetch 单页最大字符数，取上游默认值 */
const FETCH_MAX_LENGTH = 50000;

/**
 * AgentHome 搜索供应商
 *
 * 上游是一个 MCP 服务器（Streamable HTTP），固定暴露两个工具：
 * - `web_search(query, max_results, realm, freshness, allowed_domains, blocked_domains)`
 * - `web_fetch(url, realm, prompt, max_length)`
 *
 * 这里把它包装成与 Bocha / Tavily / Metaso / DeepSeek 一致的 SearchProvider，
 * 模型侧仍然只看到统一的 `web_search` / `web_parser`，不经过 MCP 服务器配置。
 */
@Injectable()
export class AgentHomeProvider implements SearchProvider {
  readonly name = "agenthome";
  readonly displayName = "AgentHome";
  readonly capabilities: SearchCapabilities = {
    scope: { supported: false },
    // web_search 只返回标题 + 摘要，完整正文需要 web_fetch
    searchReturnsContent: false,
    supportsWebpageExtract: true,
    scoreType: "string",
  };
  private readonly logger = new Logger(AgentHomeProvider.name);

  constructor(private readonly mcpClient: McpClientService) {}

  async search(
    q: string,
    options: SearchOptions,
    apiKey: string,
  ): Promise<SearchResponse> {
    const { size = 10 } = options;
    const result = await this.callTool(
      SEARCH_TOOL,
      {
        query: q,
        max_results: Math.min(Math.max(size, 1), MAX_RESULTS),
      },
      apiKey,
      "search",
    );

    return parseSearchText(result.content || "");
  }

  async readWebpage(
    url: string,
    format: string,
    apiKey: string,
  ): Promise<ParseResponse | string> {
    const result = await this.callTool(
      FETCH_TOOL,
      { url, max_length: FETCH_MAX_LENGTH },
      apiKey,
      "fetch",
    );

    const text = (result.content || "").trim();
    if (!text) {
      return "No content found for the given URL";
    }

    // 上游返回的已经是带标题与来源的 Markdown，直接透传
    if (format === "markdown") {
      return text;
    }

    return parseFetchText(text, url);
  }

  private async callTool(
    toolName: string,
    args: Record<string, any>,
    apiKey: string,
    label: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    const token = normalizeToken(apiKey);
    if (!token) {
      throw new Error("AgentHome API Key is not configured");
    }

    const config: McpServerConfig = {
      type: "streamableHttp",
      url: AGENTHOME_MCP_URL,
      headers: { Authorization: `Bearer ${token}` },
    };

    const result = await this.mcpClient.callTool(config, toolName, args, {
      serverId: AGENTHOME_SERVER_ID,
    });

    if (!result.success) {
      const message = result.error || result.content || "unknown error";
      this.logger.error(`AgentHome ${label} failed: ${message}`);
      throw new Error(`AgentHome ${label} failed: ${message}`);
    }

    return result;
  }
}

/** 用户可能把整段 "Bearer sk-..." 粘进来，统一只保留 token 本体 */
function normalizeToken(apiKey: string): string {
  return (apiKey || "").trim().replace(/^Bearer\s+/i, "").trim();
}

/**
 * 解析 web_search 的纯文本结果：
 *
 *   Found 3 result(s) · provider 1 · 914ms
 *
 *   1. [Title](https://example.com)
 *      snippet...
 *   2. [Title](https://example.com)
 *      snippet...
 *
 * 摘要可能跨多行，因此按「下一条编号」切分，而不是依赖缩进。
 */
function parseSearchText(text: string): SearchResponse {
  const lines = text.split(/\r?\n/);
  const results: SearchResult[] = [];
  let total = 0;
  let current: SearchResult | null = null;
  let snippetLines: string[] = [];

  const flush = () => {
    if (!current) return;
    const summary = snippetLines.join("\n").trim();
    if (summary) current.summary = summary;
    results.push(current);
    current = null;
    snippetLines = [];
  };

  for (const line of lines) {
    const header = /^Found\s+(\d+)\s+result/i.exec(line);
    if (header) {
      total = Number(header[1]);
      continue;
    }

    const match = /^\s*\d+\.\s+\[(.+)\]\((\S+)\)\s*$/.exec(line);
    if (match) {
      flush();
      current = {
        index: results.length + 1,
        title: match[1].trim(),
        link: match[2].trim(),
        score: "unknown",
      };
      continue;
    }

    if (current) {
      snippetLines.push(line);
    }
  }
  flush();

  return { total: total || results.length, results };
}

/**
 * 解析 web_fetch 的返回（上游格式）：
 *
 *   # Example Domain
 *   URL: https://example.com
 *   Content-Type: text/markdown · 1370 chars
 *
 *   正文...
 */
function parseFetchText(text: string, fallbackUrl: string): ParseResponse {
  const lines = text.split(/\r?\n/);
  let title = "";
  let url = fallbackUrl;
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const line = lines[i];
    if (!title && line.startsWith("# ")) {
      title = line.slice(2).trim();
    }
    const urlMatch = /^URL:\s*(\S+)/i.exec(line);
    if (urlMatch) {
      url = urlMatch[1];
    }
    if (/^Content-Type:/i.test(line)) {
      bodyStart = i + 1;
      break;
    }
  }

  return {
    title: title || undefined,
    url,
    content: lines.slice(bodyStart).join("\n").trim(),
  };
}
