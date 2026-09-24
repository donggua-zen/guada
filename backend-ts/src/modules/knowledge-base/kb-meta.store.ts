import { Injectable, Logger } from "@nestjs/common";
import { ID_PREFIXES, mintId } from "../../common/utils/id.util";
import * as fsp from "fs/promises";
import * as path from "path";
import { KbDatabaseService, resolveDefaultKbRoot } from "./kb-database.service";

/** KB 配置文件（每个库目录一个，UTF-8 JSON） */
export const KB_CONFIG_FILE = "kb.json";

/**
 * 混合检索融合权重的默认值（**全项目唯一真相**）
 *
 * 为什么是 0.3 / 0.7：
 * - 黄金基线（`test/knowledge-base/fixtures/kb-search-golden.json`）锁的就是这一组，
 *   改它会让基线失败——而基线的价值正是"融合算法不许无声漂移"。
 * - REST / 前端路径此前用的就是这组，所以统一到它意味着改动只落在 Agent 工具一侧
 *   （工具此前硬编码 0.6/0.4，与 REST 分叉，同一次检索走 UI 和走 Agent 排序不同）。
 *
 * 注意：中文文档语料 + jieba FTS 下关键词权重给高是合理的；换成代码/英文语料时
 * 用户可在知识库设置里调，不要在这里改默认值。
 */
export const DEFAULT_SEMANTIC_WEIGHT = 0.3;
export const DEFAULT_KEYWORD_WEIGHT = 0.7;

/**
 * 归一化融合权重：非法值回退默认；两者同时为 0 时回退默认。
 *
 * 两者都为 0 会让 RRF 融合得分恒为 0（排序退化成 Map 插入顺序），是静默的错误结果，
 * 所以必须在这里挡掉，而不是让调用方各自判断。
 */
export function normalizeFusionWeights(
  semantic: unknown,
  keyword: unknown,
): { semantic: number; keyword: number } {
  const s = typeof semantic === "number" && Number.isFinite(semantic) && semantic >= 0
    ? semantic
    : DEFAULT_SEMANTIC_WEIGHT;
  const k = typeof keyword === "number" && Number.isFinite(keyword) && keyword >= 0
    ? keyword
    : DEFAULT_KEYWORD_WEIGHT;
  if (s === 0 && k === 0) {
    return { semantic: DEFAULT_SEMANTIC_WEIGHT, keyword: DEFAULT_KEYWORD_WEIGHT };
  }
  return { semantic: s, keyword: k };
}

/** 知识库配置（= 原 knowledge_base 表行） */
export interface KnowledgeBaseMeta {
  id: string;
  name: string;
  description: string | null;
  embeddingModelId: string;
  chunkMaxSize: number;
  chunkOverlapSize: number;
  chunkMinSize: number;
  /** 混合检索：语义召回权重 */
  semanticWeight: number;
  /** 混合检索：关键词（BM25）召回权重 */
  keywordWeight: number;
  createdAt: string;
  updatedAt: string;
}

function toKbRow(meta: KnowledgeBaseMeta): Record<string, any> {
  return {
    ...meta,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
  };
}

function toISO(value: any, fallback?: string): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? (fallback ?? null) : d.toISOString();
}

/**
 * 知识库配置存储（`<KB根>/<kbId>/kb.json`）
 *
 * 为什么配置留文件而不进 kb.db：
 * - 列知识库只需扫 kb.json，**不必打开任何 SQLite**（空库连 kb.db 都不用建）
 * - KB 的身份与配置是低频写的人可读数据，手改友好
 * - 条目/分块/向量才是高频写的数据，那些在 kb.db 里
 *
 * 采用「读时缓存 + 写时落盘」：目录里没有 kb.json 就不算知识库（见 KbDatabaseService.listKbIds）。
 */
@Injectable()
export class KbMetaStore {
  private readonly logger = new Logger(KbMetaStore.name);
  private readonly cache = new Map<string, KnowledgeBaseMeta>();

  constructor(private readonly databases: KbDatabaseService) {}

  /**
   * 打印实际生效的存储根，并在「新根为空、旧默认根有库」时告警。
   *
   * 由迁移编排器在设置注入**之后**调用（不能在 onModuleInit 里做：那时用户配置的
   * kbStorageRoot 可能还没注入，打印出来的根是错的）。
   */
  reportRoot(): void {
    this.logger.log(`知识库存储根：${this.databases.getRootDir()}`);
    this.warnIfRootLooksEmpty();
  }

  /**
   * 改根安全网：配置的根里一个知识库都没有，而旧默认根有 —— 大概率是改了设置
   * 但没搬数据。只告警不自动搬（自动搬会让人以为数据消失了）。
   */
  private warnIfRootLooksEmpty(): void {
    const current = this.databases.getRootDir();
    const fallback = resolveDefaultKbRoot();
    if (path.resolve(current) === path.resolve(fallback)) return;

    void (async () => {
      try {
        const currentIds = await this.databases.listKbIds();
        if (currentIds.length > 0) return;
        const entries = await fsp.readdir(fallback, { withFileTypes: true });
        const found: string[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          try {
            await fsp.access(path.join(fallback, entry.name, KB_CONFIG_FILE));
            found.push(entry.name);
          } catch {
            /* 不是知识库 */
          }
        }
        if (found.length > 0) {
          this.logger.warn(
            `当前知识库存储根（${current}）下没有知识库，但默认位置 ${fallback} 下有 ${found.length} 个。` +
              `知识库不会自动搬迁：请把 ${fallback} 下的库目录整体移入 ${current}，或清空 kbStorageRoot 设置回到默认位置。`,
          );
        }
      } catch {
        /* 默认根不存在就没什么可提示的 */
      }
    })();
  }

  getKbConfigPath(kbId: string): string {
    return path.join(this.databases.getKbDir(kbId), KB_CONFIG_FILE);
  }

  /** 取原始 meta（内部用，不做门控） */
  private async readMeta(kbId: string): Promise<KnowledgeBaseMeta | null> {
    const cached = this.cache.get(kbId);
    if (cached) return cached;
    try {
      const raw = await fsp.readFile(this.getKbConfigPath(kbId), "utf8");
      const meta = this.parseKb(raw, kbId);
      this.cache.set(kbId, meta);
      return meta;
    } catch {
      return null;
    }
  }

  // ============ 读取 API（对齐原 KbFileStore 的 KB 部分） ============

  async getKb(id: string): Promise<Record<string, any> | undefined> {
    await this.databases.ready();
    const meta = await this.readMeta(id);
    return meta ? toKbRow(meta) : undefined;
  }

  async getKbMeta(id: string): Promise<KnowledgeBaseMeta | null> {
    await this.databases.ready();
    return this.readMeta(id);
  }

  async listKbs(): Promise<Record<string, any>[]> {
    await this.databases.ready();
    const ids = await this.databases.listKbIds();
    const metas: KnowledgeBaseMeta[] = [];
    for (const id of ids) {
      const meta = await this.readMeta(id);
      if (meta) metas.push(meta);
    }
    return metas
      .sort((a, b) =>
        b.createdAt === a.createdAt
          ? a.id.localeCompare(b.id)
          : b.createdAt.localeCompare(a.createdAt),
      )
      .map(toKbRow);
  }

  async listKbMetas(): Promise<KnowledgeBaseMeta[]> {
    await this.databases.ready();
    const ids = await this.databases.listKbIds();
    const out: KnowledgeBaseMeta[] = [];
    for (const id of ids) {
      const meta = await this.readMeta(id);
      if (meta) out.push(meta);
    }
    return out;
  }

  // ============ 写入 API ============

  /**
   * 新建知识库。
   *
   * id 缺省时生成 `kb-<uuid v4>`——旧实现 `String(data.id)` 在缺 id 时得到字面量
   * `"undefined"`，第二个知识库会覆盖第一个（活跃路径上的真故障）。
   */
  async createKb(data: Record<string, any>): Promise<Record<string, any>> {
    await this.databases.ready();
    const id = this.resolveId(data.id);
    const now = new Date().toISOString();
    const meta: KnowledgeBaseMeta = {
      id,
      name: data.name ?? id,
      description: data.description ?? null,
      embeddingModelId: data.embeddingModelId ?? "",
      chunkMaxSize: data.chunkMaxSize ?? 1000,
      chunkOverlapSize: data.chunkOverlapSize ?? 100,
      chunkMinSize: data.chunkMinSize ?? 50,
      semanticWeight: this.num(data.semanticWeight, DEFAULT_SEMANTIC_WEIGHT),
      keywordWeight: this.num(data.keywordWeight, DEFAULT_KEYWORD_WEIGHT),
      createdAt: now,
      updatedAt: now,
    };
    await this.writeKbFile(meta);
    this.cache.set(id, meta);
    this.databases.invalidateKbList();
    return toKbRow(meta);
  }

  async updateKb(
    id: string,
    data: Record<string, any>,
  ): Promise<Record<string, any> | undefined> {
    await this.databases.ready();
    const current = await this.readMeta(id);
    if (!current) return undefined;

    const merged: KnowledgeBaseMeta = { ...current } as any;
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (key === "createdAt") merged.createdAt = toISO(value) ?? merged.createdAt;
      else if (key === "updatedAt") continue; // 由写入路径统一刷新
      else if (key in merged) (merged as any)[key] = value;
    }
    merged.updatedAt = new Date().toISOString();
    await this.writeKbFile(merged);
    this.cache.set(id, merged);
    return toKbRow(merged);
  }

  /** 由迁移导入直接写入 */
  async writeKbDirect(meta: KnowledgeBaseMeta): Promise<void> {
    await this.writeKbFile(meta);
    this.cache.set(meta.id, meta);
    this.databases.invalidateKbList();
  }

  /** 让缓存失效（整目录被删除后调用） */
  forget(kbId: string): void {
    this.cache.delete(kbId);
  }

  // ============ 内部 ============

  private resolveId(rawId: any): string {
    if (rawId === undefined || rawId === null || String(rawId) === "") {
      return mintId(ID_PREFIXES.kb);
    }
    const id = String(rawId);
    if (/[\\/:*?"<>|]/.test(id) || id.startsWith(".") || id === "undefined" || id === "null") {
      throw new Error(`非法的知识库 id："${id}"`);
    }
    return id;
  }

  private async writeKbFile(meta: KnowledgeBaseMeta): Promise<void> {
    const filePath = this.getKbConfigPath(meta.id);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, JSON.stringify(meta, null, 2), "utf8");
  }

  private parseKb(raw: string, fallbackId: string): KnowledgeBaseMeta {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("kb.json 必须是对象");
    }
    const r = doc as Record<string, any>;
    const now = new Date().toISOString();
    return {
      id: fallbackId,
      name: typeof r.name === "string" && r.name ? r.name : fallbackId,
      description: typeof r.description === "string" ? r.description : null,
      embeddingModelId:
        typeof r.embeddingModelId === "string" ? r.embeddingModelId : "",
      chunkMaxSize: this.num(r.chunkMaxSize, 1000),
      chunkOverlapSize: this.num(r.chunkOverlapSize, 100),
      chunkMinSize: this.num(r.chunkMinSize, 50),
      semanticWeight: this.num(r.semanticWeight, DEFAULT_SEMANTIC_WEIGHT),
      keywordWeight: this.num(r.keywordWeight, DEFAULT_KEYWORD_WEIGHT),
      createdAt: toISO(r.createdAt, now)!,
      updatedAt: toISO(r.updatedAt, now)!,
    };
  }

  private num(value: any, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
}
