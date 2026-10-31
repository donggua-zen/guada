import type { ApiContext } from "./api-context";
import type { McpServer } from "@/types/api";

/**
 * MCP 市场 API。
 *
 * 与技能市场不同：技能市场前端直连官网（独立 axios 实例），而 MCP 市场的榜单
 * 由本机后端抓取并归一（白名单 + 缓存），所以这里走统一 `apiService`，
 * 后端地址、鉴权、错误处理全部复用既有链路。
 */

/** 市场来源 */
export type McpMarketSourceId = "skillhub_mcp" | "mcpworld";

/** 榜单条目（后端归一后的形态） */
export interface McpMarketItem {
  /** 稳定 id，形如 `mcpworld:be0640...` / `skillhub_mcp:slug` */
  id: string;
  source: string;
  rank: number;
  name: string;
  description: string;
  url: string;
  tags: string[];
  stats?: string;
}

/** 可导入的服务器（后端从 readme 里抽出来的） */
export interface ImportableMcpServer {
  name: string;
  type: "stdio" | "sse" | "streamableHttp";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** 含占位符，需要用户补全后才能启用 */
  needsConfiguration: boolean;
  /** 待补全字段，如 `env.PROM_URL` */
  configurationFields: string[];
}

export interface McpMarketRankings {
  fetchedAt: number;
  items: McpMarketItem[];
  /** 逐源失败原因（部分来源不可用时仍会返回其余条目） */
  errors: string[];
}

export interface McpMarketResolveResult {
  configJson: unknown;
  servers: ImportableMcpServer[];
  score: number;
}

export interface McpMarketImportResult {
  imported: McpServer[];
  updated: McpServer[];
  errors: Array<{ name: string; message: string }>;
}

export interface McpMarketApi {
  fetchMcpMarketRankings(source?: string, refresh?: boolean): Promise<McpMarketRankings>;
  resolveMcpMarketItem(source: string, id: string): Promise<McpMarketResolveResult>;
  importMcpMarketItem(
    source: string,
    itemId: string,
    servers: ImportableMcpServer[],
  ): Promise<McpMarketImportResult>;
}

export const mcpMarketApi: McpMarketApi = {
  async fetchMcpMarketRankings(this: ApiContext, source = "all", refresh = false) {
    const params = new URLSearchParams({ source });
    if (refresh) params.set("refresh", "1");
    return await this._request<McpMarketRankings>(`/mcp-market/rankings?${params.toString()}`);
  },

  async resolveMcpMarketItem(this: ApiContext, source: string, id: string) {
    return await this._request<McpMarketResolveResult>("/mcp-market/resolve", {
      method: "POST",
      data: { source, id },
    });
  },

  async importMcpMarketItem(
    this: ApiContext,
    source: string,
    itemId: string,
    servers: ImportableMcpServer[],
  ) {
    return await this._request<McpMarketImportResult>("/mcp-market/import", {
      method: "POST",
      data: { source, itemId, servers },
    });
  },
};
