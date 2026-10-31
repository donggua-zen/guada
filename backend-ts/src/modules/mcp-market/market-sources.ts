/**
 * 市场来源适配：榜单列表 + 单条详情文本。
 *
 * 两个源的结构完全不同（SkillHub 是 REST 数组，MCPWorld 是嵌套 detail 数组），
 * 所以按源分文件，各自负责「怎么取」和「怎么解析」，service 只做编排。
 */
import { McpMarketItem } from "./mcp-config.extract";

export type MarketSourceId = "skillhub_mcp" | "mcpworld";

export interface MarketSource {
  id: MarketSourceId;
  label: string;
  /** 榜单 URL（固定，不接受外部传入 —— 避免把用户可控 URL 送进抓取器） */
  rankingUrl: string;
  /** 由条目 id 推导详情/readme URL */
  detailUrl(itemId: string): string;
  /** 解析榜单响应体 */
  parseRankings(body: unknown): McpMarketItem[];
}

/** 取字符串字段（去空白、限长） */
function text(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** 从 id 里取 slug（`source:slug` → `slug`） */
export function slugOf(itemId: string): string {
  const parts = itemId.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : itemId;
}

/** slug 合法性：只允许小写字母数字与 ._- ，防止拼出路径穿越或查询注入 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,95}$/i.test(slug);
}

// ---------------------------------------------------------------------------
// SkillHub MCP
// ---------------------------------------------------------------------------

export const skillhubSource: MarketSource = {
  id: "skillhub_mcp",
  label: "SkillHub MCP",
  rankingUrl:
    "https://api.skillhub.cn/api/v1/mcp/servers?page=1&pageSize=100&sortBy=updated_at&order=desc",

  detailUrl(itemId: string): string {
    const slug = slugOf(itemId);
    return `https://api.skillhub.cn/api/v1/mcp/servers/${encodeURIComponent(slug)}/readme`;
  },

  parseRankings(body: unknown): McpMarketItem[] {
    const root = body as any;
    const list = Array.isArray(root?.items) ? root.items : [];
    const out: McpMarketItem[] = [];

    for (const raw of list) {
      const slug = text(raw?.slug, 96);
      if (!slug || !isValidSlug(slug)) continue;

      const name = text(raw?.name, 96) || text(raw?.nameEn, 96) || slug;
      const description =
        text(raw?.summaryZh, 220) || text(raw?.summary, 220) || "SkillHub MCP server.";

      const tags: string[] = [];
      const category = text(raw?.category, 40);
      if (category) tags.push(category);
      if (Array.isArray(raw?.tags)) {
        for (const tag of raw.tags) {
          const value = text(tag, 40).toLowerCase();
          if (value && /^[a-z0-9_-]+$/.test(value) && !tags.includes(value)) tags.push(value);
        }
      }

      let stats: string | undefined;
      const downloads = Number(raw?.stats?.downloads);
      const installs = Number(raw?.stats?.installs);
      if (Number.isFinite(downloads) || Number.isFinite(installs)) {
        stats = `${Number.isFinite(downloads) ? downloads : 0} downloads / ${
          Number.isFinite(installs) ? installs : 0
        } installs`;
      }

      out.push({
        id: `skillhub_mcp:${slug}`,
        source: "skillhub_mcp",
        rank: 0,
        name,
        description,
        url: `https://skillhub.cn/mcp/${encodeURIComponent(slug)}`,
        tags: tags.slice(0, 12),
        ...(stats ? { stats } : {}),
      });
    }

    return out;
  },
};

// ---------------------------------------------------------------------------
// MCPWorld
// ---------------------------------------------------------------------------

export const mcpworldSource: MarketSource = {
  id: "mcpworld",
  label: "MCP World",
  rankingUrl:
    "https://www.mcpworld.com/api/mcp-market/servers?wd=most_popular&type=tag&pn=0&lg=zh&pl=100",

  detailUrl(itemId: string): string {
    const id = slugOf(itemId);
    return `https://www.mcpworld.com/api/mcp-market/server/detail?id=${encodeURIComponent(
      id,
    )}&lg=zh`;
  },

  parseRankings(body: unknown): McpMarketItem[] {
    const root = body as any;
    // 真实结构（2026-10 实测）：
    //   { data: { mcpList: [ { query, total, servers: [...] } ] } }
    // mcpList 是数组、servers 挂在第一个元素里 —— 不是直觉上的对象。
    // 因此下面按「可能的 servers 容器」逐个探测，命中数组即用，
    // 上游再微调层级也不至于整源失效。
    const probe = (value: unknown, depth = 0): any[] | undefined => {
      if (depth > 3 || !value) return undefined;
      if (Array.isArray(value)) {
        // 是数组：如果元素里有 servers 数组，继续下钻；否则它就是条目列表
        const first = value[0];
        if (first && typeof first === "object" && Array.isArray((first as any).servers)) {
          return (first as any).servers as any[];
        }
        if (first && typeof first === "object" && ("id" in (first as any) || "serverName" in (first as any))) {
          return value as any[];
        }
        return undefined;
      }
      if (typeof value !== "object") return undefined;
      for (const key of ["servers", "mcpList", "list", "items", "records"]) {
        const found = probe((value as any)[key], depth + 1);
        if (found) return found;
      }
      return undefined;
    };

    const list = probe(root?.data ?? root);
    if (!list) return [];

    const out: McpMarketItem[] = [];

    for (const raw of list) {
      const id = text(raw?.id, 96);
      if (!id || !/^[a-z0-9]{8,64}$/i.test(id)) continue;

      const name = text(raw?.serverName, 96) || text(raw?.name, 96) || text(raw?.title, 96) || id;
      const description =
        text(raw?.description, 220) || text(raw?.summary, 220) || text(raw?.abstract, 220) || "MCP server.";

      const tags: string[] = [];
      const collect = (value: unknown) => {
        if (!Array.isArray(value)) return;
        for (const tag of value) {
          const label =
            typeof tag === "string" ? text(tag, 40) : text((tag as any)?.name ?? (tag as any)?.label, 40);
          const normalized = label.toLowerCase();
          if (normalized && !tags.includes(normalized)) tags.push(normalized);
        }
      };
      collect(raw?.labels);
      collect(raw?.tags);
      collect(raw?.categories);

      const stars = Number(raw?.star ?? raw?.stars ?? raw?.starCount);
      const stats = Number.isFinite(stars) && stars > 0 ? `${stars} stars` : undefined;

      out.push({
        id: `mcpworld:${id}`,
        source: "mcpworld",
        rank: 0,
        name,
        description,
        url: `https://www.mcpworld.com/zh/detail/${encodeURIComponent(id)}`,
        tags: tags.slice(0, 12),
        ...(stats ? { stats } : {}),
      });
    }

    return out;
  },
};

export const MARKET_SOURCES: MarketSource[] = [skillhubSource, mcpworldSource];

/** 按 id 找源（找不到返回 undefined） */
export function findSource(source: string): MarketSource | undefined {
  return MARKET_SOURCES.find((s) => s.id === source);
}

/**
 * MCPWorld 的详情是 JSON，配置藏在 /data/detail/abstract[].value 里；
 * 拼成一段 markdown 后交给通用抽取器。
 */
export function mcpworldDetailToMarkdown(body: unknown): string {
  const root = body as any;
  const entries = root?.data?.detail?.abstract;
  if (!Array.isArray(entries)) {
    // 有些条目直接把 readme 放别处，兜底尝试几个常见位置
    const fallback =
      text(root?.data?.detail?.readme, 100_000) ||
      text(root?.data?.readme, 100_000) ||
      "";
    return fallback;
  }
  return entries
    .map((entry: any) => (typeof entry?.value === "string" ? entry.value : ""))
    .filter(Boolean)
    .join("\n\n");
}
