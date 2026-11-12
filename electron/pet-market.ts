/**
 * 桌宠市场的**主进程部分**：只做渲染层做不到的两件事。
 *
 *   1. 安装：下载精灵图 + 写 pet.json（需要文件系统）
 *   2. 兜底抓详情：老索引没有 description/sprite 时，抓一次 petdex 页面补上
 *
 * 索引拉取、校验、缓存**不在主进程**——那些搬到 `frontend/src/utils/petMarket.ts`：
 * - 索引站已开 CORS，浏览器可直连
 * - HTTP 缓存（no-cache + ETag）天然处理重复请求，不用自己写 24h 缓存
 * - 改完 HMR 立即生效，不用重启应用（和技能市场同一套写法）
 */
import { net } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { parseImageSize } from "./image-size";

/** Petdex 站点根（详情页、精灵图都从这里来） */
const PETDEX_SITE = "https://petdex.dev";

/** 详情抓取超时（只在兜底路径用到，给宽松一点） */
const DETAIL_TIMEOUT_MS = 12_000;

/**
 * 宠物详情（渲染层只在索引缺详情时才会请求）。
 *
 * Petdex 的详情页带一段 JSON-LD，里面直接给了**真·精灵图**地址
 * （`assets.petdex.dev/.../sprite.webp`），比列表里的 OG 海报图清楚得多。
 */
export interface PetMarketDetail {
  slug: string;
  name: string;
  description: string;
  /** 精灵图直链（8 列 × 9 或 11 行） */
  spriteUrl: string;
  genre?: string;
  keywords?: string[];
  publishedAt?: string;
  page: string;
}

export interface PetMarketDetailResult {
  ok: boolean;
  detail?: PetMarketDetail;
  error?: string;
}

/** 内存缓存：同一只在一次会话里只抓一次 */
const detailCache = new Map<string, PetMarketDetail>();

/** 从详情页 HTML 里解析 JSON-LD 的 CreativeWork 条目 */
export function parsePetDetailHtml(slug: string, html: string): PetMarketDetail | null {
  const match = html.match(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : [data];
  const work = list.find(
    (item): item is Record<string, unknown> =>
      Boolean(item) &&
      typeof item === "object" &&
      (item as Record<string, unknown>)["@type"] === "CreativeWork",
  );
  if (!work) return null;

  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const image = str(work.image);
  // 只采信 https 的精灵图，避免把任意 URL 塞进 <img>
  if (!image.startsWith("https://")) return null;

  const keywords = str(work.keywords)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return {
    slug,
    name: str(work.name) || slug,
    description: str(work.description),
    spriteUrl: image,
    genre: str(work.genre) || undefined,
    keywords: keywords.length > 0 ? keywords : undefined,
    publishedAt: str(work.datePublished) || undefined,
    page: `${PETDEX_SITE}/pets/${slug}`,
  };
}

/** 抓取并解析单只宠物的详情（带内存缓存） */
export async function getPetMarketDetail(slug: string): Promise<PetMarketDetailResult> {
  const clean = slug.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(clean)) {
    return { ok: false, error: "非法的宠物标识" };
  }
  const cached = detailCache.get(clean);
  if (cached) return { ok: true, detail: cached };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
  try {
    const response = await net.fetch(`${PETDEX_SITE}/pets/${clean}`, {
      signal: controller.signal,
      headers: { accept: "text/html" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const detail = parsePetDetailHtml(clean, html);
    if (!detail) throw new Error("页面里没找到宠物信息（站点结构可能变了）");
    detailCache.set(clean, detail);
    return { ok: true, detail };
  } catch (error) {
    const message = (error as Error).message || "未知错误";
    log.warn("[pet-market] 取详情失败:", clean, message);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** 图集几何：8 列 × 9/11 行，单格 ≥128 且比例合理 */
function deriveCell(width: number, height: number): { w: number; h: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const cellW = width / 8;
  const rows = Math.round(height / (cellW * (208 / 192)));
  if (rows < 9 || rows > 11) return null;
  const cellH = height / rows;
  if (cellW < 128 || cellH < 128) return null;
  return { w: cellW, h: cellH };
}

/**
 * 安装：下载精灵图 → 生成 pet.json。
 *
 * `spriteUrl` 由渲染层从索引带过来（索引里已有），**避免主进程再去抓详情页**；
 * 缺失时才回退抓一次（老索引 / 手动输入 slug）。
 *
 * 为什么不用 `npx petdex install`：客户端机器大概率没装 Node，
 * 而且我们只需要那一个 sprite 文件。
 */
export async function installPetFromMarket(
  slug: string,
  destRoot: string,
  spriteUrl?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const clean = slug.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(clean)) {
    return { ok: false, error: "非法的宠物标识" };
  }

  let detail: PetMarketDetail | null = null;
  let url =
    typeof spriteUrl === "string" && spriteUrl.startsWith("https://") ? spriteUrl : "";
  if (!url) {
    const result = await getPetMarketDetail(clean);
    if (!result.ok || !result.detail) {
      return { ok: false, error: `取宠物信息失败：${result.error || "未知错误"}` };
    }
    detail = result.detail;
    url = detail.spriteUrl;
  }

  let buffer: Buffer;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { ok: false, error: `下载精灵图失败：${(error as Error).message || "未知错误"}` };
  } finally {
    clearTimeout(timer);
  }

  // 用图片头校验，避免把一张错误页当成宠物存下来
  const size = buffer.length >= 32 ? parseImageSize(buffer) : null;
  if (!size) return { ok: false, error: "下载到的不是有效图片" };
  if (!deriveCell(size.width, size.height)) {
    return {
      ok: false,
      error: `图集尺寸不合法：${size.width}×${size.height}（需要 8 列 × 9 或 11 行）`,
    };
  }

  const target = path.join(destRoot, clean);
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "spritesheet.webp"), buffer);
    const manifest = {
      id: clean,
      displayName: detail?.name || clean,
      description: detail?.description || "",
      spritesheetPath: "spritesheet.webp",
      ...(url.includes("sprite-v2") ? { spriteVersionNumber: 2 } : {}),
      // 来源留痕（Codex 契约允许多余字段）
      source: {
        kind: "petdex",
        page: detail?.page || `${PETDEX_SITE}/pets/${clean}`,
        installedAt: new Date().toISOString(),
      },
    };
    fs.writeFileSync(
      path.join(target, "pet.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  } catch (error) {
    return { ok: false, error: `写入失败：${(error as Error).message}` };
  }

  log.info(`[pet-market] 已安装 ${clean} ${size.width}×${size.height}`);
  return { ok: true, id: clean };
}
