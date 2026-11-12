/**
 * 宠物市场索引（渲染层直接拉取）。
 *
 * 为什么不在主进程做：
 * - 索引站 `ai.dingd.cn/petdex/` 已开 `Access-Control-Allow-Origin: *`，
 *   浏览器直连即可（与技能市场同一套写法，改完 HMR 立即生效，不用重启应用）
 * - 缓存交给 HTTP：服务端 `Cache-Control: no-cache` + ETag，未变时返回 304（几十字节）
 * - 主进程只保留真正需要它的两件事：下载精灵图写文件（装机）、兜底抓详情
 */

/** 索引地址（可用 VITE_PET_MARKET_URL 覆盖，便于本地联调） */
export const PET_MARKET_URL =
  import.meta.env.VITE_PET_MARKET_URL || 'https://ai.dingd.cn/petdex/index.json'

/** 索引站 origin（缩略图是相对路径，要拼上它） */
const MARKET_ORIGIN = (() => {
  try {
    return new URL(PET_MARKET_URL).origin
  } catch {
    return 'https://ai.dingd.cn'
  }
})()

export interface MarketPet {
  slug: string
  name: string
  author: string
  page: string
  /** OG 海报（1200×630），最老的条目兜底用 */
  preview: string
  /** 官网预裁的缩略图（idle 第一格，~8KB）——列表首选 */
  thumb?: string
  /** 真精灵图直链（详情弹窗播放动画、安装时下载） */
  sprite?: string
  /** 图集行数：9 或 11 */
  rows?: number
  /** 详情（官网预抓进索引，弹窗零请求） */
  description?: string
  genre?: string
  keywords?: string[]
  publishedAt?: string
}

export interface PetMarketIndex {
  version: number
  source: string
  sourceName: string
  homepage: string
  attribution: string
  generatedAt: string
  count: number
  /** 运营推荐位（slug 列表，由官网下发） */
  featured: string[]
  pets: MarketPet[]
}

/** 抓取超时 */
const FETCH_TIMEOUT_MS = 20_000
/** 体积上限：超了判定为异常响应（防止把整站 HTML 当索引） */
const MAX_INDEX_BYTES = 8 * 1024 * 1024

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function toHttpsUrl(value: unknown, fallback: string): string {
  const raw = str(value)
  return raw.startsWith('https://') ? raw : fallback
}

/**
 * 校验并归一化索引。
 *
 * 远端 JSON 是不可信输入：结构不对、slug 非法、链接不是 https 都要挡住——
 * 否则会把恶意 URL 塞进 `<img>`，或者让一份坏索引把市场页搞崩。
 */
export function normalizeMarketIndex(raw: unknown): PetMarketIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.pets)) return null

  const pets: MarketPet[] = []
  for (const item of obj.pets) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const slug = str(rec.slug)
    if (!slug || !/^[A-Za-z0-9_-]{1,64}$/.test(slug)) continue

    const rowsRaw = rec.rows
    const rows =
      typeof rowsRaw === 'number' && (rowsRaw === 9 || rowsRaw === 11) ? rowsRaw : undefined

    // 缩略图是相对路径（/petdex/thumbs/x.webp）→ 补成绝对 URL
    const thumbRaw = str(rec.thumb)
    const thumb = thumbRaw
      ? thumbRaw.startsWith('https://')
        ? thumbRaw
        : `${MARKET_ORIGIN}${thumbRaw.startsWith('/') ? '' : '/'}${thumbRaw}`
      : undefined

    const spriteRaw = str(rec.sprite)
    const keywords = Array.isArray(rec.keywords)
      ? rec.keywords.filter((k): k is string => typeof k === 'string').slice(0, 6)
      : undefined

    pets.push({
      slug,
      name: str(rec.name) || slug,
      author: str(rec.author),
      page: toHttpsUrl(rec.page, `https://petdex.dev/pets/${slug}`),
      preview: toHttpsUrl(rec.preview, `https://petdex.dev/pets/${slug}/opengraph-image`),
      ...(thumb ? { thumb } : {}),
      ...(spriteRaw.startsWith('https://') ? { sprite: spriteRaw } : {}),
      ...(rows ? { rows } : {}),
      ...(str(rec.description) ? { description: str(rec.description).slice(0, 300) } : {}),
      ...(str(rec.genre) ? { genre: str(rec.genre) } : {}),
      ...(keywords?.length ? { keywords } : {}),
      ...(str(rec.publishedAt) ? { publishedAt: str(rec.publishedAt) } : {}),
    })
  }
  if (pets.length === 0) return null

  const featured = Array.isArray(obj.featured)
    ? obj.featured.filter((s): s is string => typeof s === 'string' && pets.some((p) => p.slug === s))
    : []

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    source: str(obj.source) || 'petdex',
    sourceName: str(obj.sourceName) || 'Petdex',
    homepage: str(obj.homepage) || 'https://petdex.dev',
    attribution: str(obj.attribution) || '宠物为用户投稿的同人作品，版权归原作者所有。',
    generatedAt: str(obj.generatedAt),
    count: pets.length,
    featured,
    pets,
  }
}

export interface MarketFetchResult {
  ok: boolean
  index?: PetMarketIndex
  error?: string
}

/**
 * 拉索引。
 *
 * 不自己做缓存：服务端 `no-cache` + ETag 让浏览器每次校验，
 * 未变时只传几十字节（304），比自建缓存更简单也更不会看到旧数据。
 */
export async function fetchPetMarketIndex(): Promise<MarketFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(PET_MARKET_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > MAX_INDEX_BYTES) {
      throw new Error(`索引过大（${(text.length / 1024 / 1024).toFixed(1)}MB）`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('返回的不是 JSON（可能被重定向到网页）')
    }
    const index = normalizeMarketIndex(parsed)
    if (!index) throw new Error('索引结构不合法')
    return { ok: true, index }
  } catch (error) {
    const message = (error as Error)?.message || '未知错误'
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}
