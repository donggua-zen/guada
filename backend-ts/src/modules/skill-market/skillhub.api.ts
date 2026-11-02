/**
 * SkillHub 市场数据归一化（纯函数）。
 *
 * 上游有两套响应格式：
 * - /api/skills、/api/skills/top：带 { code, message, data } 信封；
 * - /api/v1/*：直接返回业务对象。
 *
 * 所有字段都可能缺失或改名，因此这里逐项做类型收窄 + 兜底，
 * 解析层不依赖网络、可单独单测。
 */

export type MarketLang = "zh" | "en";

export const SKILLHUB_API_BASE = "https://api.skillhub.cn";
export const SKILLHUB_SITE_BASE = "https://skillhub.cn/skills";

/** SkillHub 一级分类（key 供筛选，nameI18n 供展示） */
export interface SkillHubCategory {
  id: string;
  name: string;
  nameI18n: Record<string, string>;
}

export interface SkillHubMarketItem {
  source: "skillhub";
  /** slug */
  id: string;
  name: string;
  description: string;
  icon: string | null;
  version?: string;
  category?: { key: string };
  subCategories: Array<{ key: string; name: string }>;
  labels?: Record<string, string>;
  stats: { downloads: number; stars: number; installs: number };
  verified?: boolean;
  /** community / official / ... */
  sourceType?: string;
  updatedAt?: number;
  detailUrl: string;
}

export interface SkillHubPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SkillHubListResult {
  items: SkillHubMarketItem[];
  pagination: SkillHubPagination;
}

export interface SkillHubSecurityReport {
  provider: string;
  status: string;
  statusText: string;
  reportUrl?: string;
}

export interface SkillHubEvaluationDimension {
  key: string;
  score: number | null;
  userReason: string | null;
}

export interface SkillHubEvaluation {
  totalScore: number | null;
  userSummary: string | null;
  dimensions: SkillHubEvaluationDimension[];
  updatedAt?: number;
}

export interface SkillHubDetail {
  item: SkillHubMarketItem;
  owner?: {
    handle: string;
    displayName: string;
    image: string | null;
  };
  latestVersion?: {
    version: string;
    createdAt?: number;
    changelog?: string;
  };
  securityReports: SkillHubSecurityReport[];
  evaluation: SkillHubEvaluation | null;
}

/** TRACE 五维（官方总分的计算口径） */
export const SKILLHUB_EVALUATION_DIMENSIONS = [
  "trust",
  "reliability",
  "adaptability",
  "convention",
  "effectiveness",
] as const;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function finiteNumber(value: unknown): number | undefined {
  // Number(null) === 0、Number("") === 0：评测里 score:null 表示「未评估」，
  // 不能当成 0 分参与均值，否则会把缺项算成真实低分。
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return undefined;
  }
  const valueNum = typeof value === "number" ? value : Number(value);
  return Number.isFinite(valueNum) ? valueNum : undefined;
}

function nonNegative(value: unknown): number {
  const valueNum = finiteNumber(value);
  return valueNum !== undefined && valueNum > 0 ? valueNum : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** slug 合法性：只允许字母数字与 ._-，长度 ≤96，防止拼出路径/查询注入 */
export function normalizeSlug(raw: unknown): string | null {
  const slug = text(raw, 96);
  if (!slug) return null;
  return /^[a-z0-9][a-z0-9._-]{0,95}$/i.test(slug) ? slug : null;
}

/** 中英描述选择：中文优先取 *_zh，英文优先取英文，缺失时互相回退 */
function pickDescription(record: Record<string, unknown>, lang: MarketLang): string {
  const zh = text(record.description_zh ?? record.summary_zh, 2000);
  const en = text(record.description ?? record.summary, 2000);
  return lang === "zh" ? zh || en : en || zh;
}

function pickIcon(record: Record<string, unknown>): string | null {
  const raw = text(record.iconUrl, 500);
  return raw.startsWith("https://") ? raw : null;
}

function pickVersion(record: Record<string, unknown>): string | undefined {
  const direct = text(record.version, 64);
  if (direct) return direct;
  const tags = record.tags;
  if (isRecord(tags)) {
    const latest = text(tags.latest, 64);
    if (latest) return latest;
  }
  return undefined;
}

function pickStats(record: Record<string, unknown>): SkillHubMarketItem["stats"] {
  const nested = isRecord(record.stats) ? record.stats : undefined;
  const read = (key: "downloads" | "stars" | "installs"): number =>
    nonNegative(nested ? nested[key] : record[key]);
  return {
    downloads: read("downloads"),
    stars: read("stars"),
    installs: read("installs"),
  };
}

function pickSubCategories(record: Record<string, unknown>): Array<{ key: string; name: string }> {
  const raw = record.subCategories;
  if (!Array.isArray(raw)) return [];

  const out: Array<{ key: string; name: string }> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const key = text(entry.key, 64);
    if (!key) continue;
    out.push({ key, name: text(entry.name, 64) || key });
    if (out.length >= 12) break;
  }
  return out;
}

function pickLabels(record: Record<string, unknown>): Record<string, string> | undefined {
  if (!isRecord(record.labels)) return undefined;

  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(record.labels)) {
    const labelKey = text(key, 48);
    if (!labelKey) continue;
    out[labelKey] = text(value, 64);
    count += 1;
    if (count >= 20) break;
  }
  return count > 0 ? out : undefined;
}

function normalizeListItem(raw: unknown, lang: MarketLang): SkillHubMarketItem | null {
  if (!isRecord(raw)) return null;

  // 详情响应把业务字段包在 skill 里；列表项是扁平结构
  const record = isRecord(raw.skill) ? raw.skill : raw;
  const slug = normalizeSlug(record.slug ?? raw.slug);
  if (!slug) return null;

  const name =
    text(record.name, 120) ||
    text(record.displayName, 120) ||
    text(raw.name, 120) ||
    text(raw.displayName, 120) ||
    slug;

  const categoryKey = text(record.category, 64);
  const updatedAt = finiteNumber(record.updatedAt ?? record.updated_at);
  const version = pickVersion(record);
  const labels = pickLabels(record);

  return {
    source: "skillhub",
    id: slug,
    name,
    description: pickDescription(record, lang),
    icon: pickIcon(record),
    ...(version ? { version } : {}),
    ...(categoryKey ? { category: { key: categoryKey } } : {}),
    subCategories: pickSubCategories(record),
    ...(labels ? { labels } : {}),
    stats: pickStats(record),
    ...(typeof record.verified === "boolean" ? { verified: record.verified } : {}),
    ...(text(record.source, 32) ? { sourceType: text(record.source, 32) } : {}),
    ...(updatedAt !== undefined && updatedAt > 0 ? { updatedAt } : {}),
    detailUrl: `${SKILLHUB_SITE_BASE}/${encodeURIComponent(slug)}`,
  };
}

/** 从 /api/skills 的信封里取 skills 与 total */
function extractSkillsPayload(body: unknown): { total: number; skills: unknown[] } {
  if (!isRecord(body)) {
    throw new Error("SkillHub 返回格式异常");
  }

  const code = finiteNumber(body.code);
  if (code !== undefined && code !== 0) {
    throw new Error(text(body.message, 200) || "SkillHub 返回异常");
  }

  const data = isRecord(body.data) ? body.data : undefined;
  const skills = Array.isArray(data?.skills) ? data.skills : [];
  const total = nonNegative(data?.total) || skills.length;

  return { total, skills };
}

/**
 * 按 slug 去重。
 *
 * SkillHub 的列表/Top 接口会返回同一个 slug 的重复条目（不同 owner 的重复上架，
 * 实测 50 条里只有 37 个唯一 slug）。不去重会直接表现为列表里同名条目重复，
 * 且每次随机取一批时重复数量还会变化。slug 是技能唯一身份，保留首次出现即可。
 */
export function dedupeSkills(items: SkillHubMarketItem[]): SkillHubMarketItem[] {
  const seen = new Set<string>();
  const out: SkillHubMarketItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

// ---------------------------------------------------------------------------
// URL 构造
// ---------------------------------------------------------------------------

export interface SkillListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  category?: string;
  sortBy?: string;
  order?: "asc" | "desc";
}

export function buildSkillListUrl(params: SkillListParams): string {
  const url = new URL("/api/skills", SKILLHUB_API_BASE);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("pageSize", String(params.pageSize));
  if (params.keyword) url.searchParams.set("keyword", params.keyword);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);
  if (params.order) url.searchParams.set("order", params.order);
  return url.toString();
}

export function buildSkillTopUrl(): string {
  return new URL("/api/skills/top", SKILLHUB_API_BASE).toString();
}

export function buildCategoriesUrl(): string {
  return new URL("/api/v1/categories", SKILLHUB_API_BASE).toString();
}

export function buildSkillDetailUrl(slug: string): string {
  return new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, SKILLHUB_API_BASE).toString();
}

export function buildSkillEvaluationUrl(slug: string): string {
  return new URL(
    `/api/v1/skills/${encodeURIComponent(slug)}/evaluation`,
    SKILLHUB_API_BASE,
  ).toString();
}

export function buildSkillDownloadUrl(slug: string, version?: string): string {
  const url = new URL("/api/v1/download", SKILLHUB_API_BASE);
  url.searchParams.set("slug", slug);
  if (version) url.searchParams.set("version", version);
  return url.toString();
}

// ---------------------------------------------------------------------------
// 响应解析
// ---------------------------------------------------------------------------

export function parseSkillListResponse(
  body: unknown,
  params: { lang: MarketLang; page: number; pageSize: number },
): SkillHubListResult {
  const { total, skills } = extractSkillsPayload(body);
  const items = dedupeSkills(
    skills
      .map((raw) => normalizeListItem(raw, params.lang))
      .filter((item): item is SkillHubMarketItem => item !== null),
  );

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, params.pageSize)));

  return {
    items,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages,
    },
  };
}

export function parseSkillTopResponse(body: unknown, lang: MarketLang): SkillHubMarketItem[] {
  const { skills } = extractSkillsPayload(body);
  return dedupeSkills(
    skills
      .map((raw) => normalizeListItem(raw, lang))
      .filter((item): item is SkillHubMarketItem => item !== null),
  );
}

/** 推荐位从池子里随机取 N 条（不重复）；random 可注入便于测试 */
export function pickRandom<T>(items: T[], limit: number, random: () => number = Math.random): T[] {
  const pool = items.slice();
  const take = Math.max(0, Math.min(Math.floor(limit), pool.length));

  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, take);
}

export function parseCategoriesResponse(body: unknown, lang: MarketLang): SkillHubCategory[] {
  const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];

  const parsed: Array<SkillHubCategory & { sortOrder: number }> = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    if (raw.active === false) continue;

    const key = text(raw.key, 64);
    // pay-skill 是支付专用分类，不作为内容分类展示
    if (!key || key === "pay-skill") continue;

    const zh = text(raw.name, 64);
    const en = text(raw.nameEn, 64);
    const sortOrder = finiteNumber(raw.sortOrder) ?? 0;

    parsed.push({
      id: key,
      name: lang === "en" ? en || zh || key : zh || en || key,
      nameI18n: { zh: zh || key, en: en || zh || key },
      sortOrder,
    });
  }

  parsed.sort((a, b) => a.sortOrder - b.sortOrder);
  return parsed.map(({ sortOrder: _sortOrder, ...rest }) => rest);
}

export function parseSkillDetailResponse(body: unknown, lang: MarketLang): SkillHubDetail {
  if (!isRecord(body)) {
    throw new Error("SkillHub 详情格式异常");
  }

  const skill = isRecord(body.skill) ? body.skill : {};
  const item = normalizeListItem({ ...skill, slug: skill.slug ?? body.slug }, lang);
  if (!item) {
    throw new Error("SkillHub 详情缺少 slug");
  }

  const ownerRecord = isRecord(body.owner) ? body.owner : undefined;
  const owner = ownerRecord
    ? {
        handle: text(ownerRecord.handle, 96) || text(ownerRecord.displayName, 96) || item.id,
        displayName:
          text(ownerRecord.displayName, 96) || text(ownerRecord.handle, 96) || item.id,
        image:
          typeof ownerRecord.image === "string" && ownerRecord.image.startsWith("https://")
            ? ownerRecord.image
            : null,
      }
    : undefined;

  const versionRecord = isRecord(body.latestVersion) ? body.latestVersion : undefined;
  const latestVersion = versionRecord
    ? {
        version: text(versionRecord.version, 64) || item.version || "—",
        ...(finiteNumber(versionRecord.createdAt) !== undefined
          ? { createdAt: finiteNumber(versionRecord.createdAt) }
          : {}),
        ...(text(versionRecord.changelog, 1000)
          ? { changelog: text(versionRecord.changelog, 1000) }
          : {}),
      }
    : undefined;

  return {
    item,
    ...(owner ? { owner } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    securityReports: parseSecurityReports(body.securityReports),
    evaluation: null,
  };
}

/**
 * 安全报告是详情接口的附加字段（官方文档未列出，线上存在）。
 * 结构：{ keen: { status, statusText, reportUrl }, sanbu: {...} }
 */
export function parseSecurityReports(raw: unknown): SkillHubSecurityReport[] {
  if (!isRecord(raw)) return [];

  const out: SkillHubSecurityReport[] = [];
  for (const [provider, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const status = text(value.status, 32);
    if (!status) continue;

    const reportUrl = text(value.reportUrl, 1000);
    out.push({
      provider: text(provider, 32) || "unknown",
      status,
      statusText: text(value.statusText, 120) || status,
      ...(reportUrl.startsWith("https://") ? { reportUrl } : {}),
    });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * 质量评测归一化。
 *
 * 官方不直接返回总分：先算每个维度的子项均分，再对五个维度取平均。
 * 子项集合会演进，所以只动态遍历 items，不硬编码子项 key。
 */
export function parseEvaluationResponse(raw: unknown): SkillHubEvaluation | null {
  if (!isRecord(raw) || !isRecord(raw.dimensions)) return null;

  const dimensionsRecord = raw.dimensions;
  const dimensionKeys = [
    ...SKILLHUB_EVALUATION_DIMENSIONS,
    ...Object.keys(dimensionsRecord).filter(
      (key) => !(SKILLHUB_EVALUATION_DIMENSIONS as readonly string[]).includes(key),
    ),
  ];

  const dimensions: SkillHubEvaluationDimension[] = dimensionKeys.map((key) => {
    const dimension = isRecord(dimensionsRecord[key]) ? (dimensionsRecord[key] as Record<string, unknown>) : {};
    const items = isRecord(dimension.items) ? dimension.items : {};

    const scores: number[] = [];
    for (const item of Object.values(items)) {
      if (!isRecord(item)) continue;
      const score = finiteNumber(item.score);
      if (score !== undefined) scores.push(score);
    }

    const score = scores.length
      ? round1(scores.reduce((sum, value) => sum + value, 0) / scores.length)
      : null;

    return {
      key,
      score,
      userReason: text(dimension.userReason, 300) || null,
    };
  });

  const knownScores = SKILLHUB_EVALUATION_DIMENSIONS.map(
    (key) => dimensions.find((dimension) => dimension.key === key)?.score,
  ).filter((score): score is number => typeof score === "number");

  const totalScore = knownScores.length
    ? round1(
        SKILLHUB_EVALUATION_DIMENSIONS.reduce((sum, key) => {
          const score = dimensions.find((dimension) => dimension.key === key)?.score;
          return sum + (typeof score === "number" ? score : 0);
        }, 0) / SKILLHUB_EVALUATION_DIMENSIONS.length,
      )
    : null;

  const updatedAt = finiteNumber(raw.updatedAt);

  return {
    totalScore,
    userSummary: text(raw.userSummary, 500) || null,
    dimensions,
    ...(updatedAt !== undefined && updatedAt > 0 ? { updatedAt } : {}),
  };
}
