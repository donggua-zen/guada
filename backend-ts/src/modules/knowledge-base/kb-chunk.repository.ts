import { Inject, Injectable, Logger } from "@nestjs/common";
import type Database from "better-sqlite3";
import { KbDatabaseService } from "./kb-database.service";
import { KbDbAccess } from "./kb-file.repository";
import { tokenizeForSearch } from "./kb-tokenizer";
import {
  insertVector,
  prepareVecTableForWrite,
  vecTableExists,
} from "./kb-vector-index";

/**
 * 分块写入行（字段名与原 KbChunkFileRow 对齐，调用方零改动）
 */
export interface KbChunkFileRow {
  id: string;
  vectorId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding?: number[] | null;
  embeddingDimensions: number | null;
  metadata: {
    fileId: string;
    knowledgeBaseId: string;
    fileName: string;
    overlapLength?: number;
    strategy?: string;
  } | null;
  createdAt: string;
}

/**
 * 对外视图：与原 KBChunk 仓储返回结构一致，保证 API 形状不变
 */
export interface KbChunkRow {
  id: string;
  fileId: string;
  knowledgeBaseId: string;
  content: string;
  chunkIndex: number;
  vectorId: string;
  embeddingDimensions: number | null;
  tokenCount: number;
  metadata: any;
  createdAt: Date;
}

/** DB 形状的 chunk 行 */
interface ChunkDbRow {
  id: string;
  item_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  embedding: Buffer | null;
  embedding_dimensions: number | null;
  metadata_json: string | null;
  created_at: string;
}

/**
 * 知识库分块仓储（每库一个 SQLite）
 *
 * 分层：原件（`raw/<itemId>/`）→ `chunk` 行（正文正本）→ `chunk.embedding`（派生，可重建）。
 *
 * 放在同一个库的理由：删除条目/文件夹是**一个事务**。旧实现是「向量库删一次 +
 * JSONL 删一次 + 元信息删一次」，跨三个存储无事务，崩在中间即不一致且无自愈路径。
 *
 * FTS 同步：`chunk_fts` 存 jieba 分词后的文本，必须显式维护 rowid（不能用
 * external-content，原因见 kb-schema.ts 顶部注释）。
 */
@Injectable()
export class KBChunkRepository {
  private readonly logger = new Logger(KBChunkRepository.name);

  constructor(
    // 显式 token：形参类型是接口（KbDbAccess），运行期被擦除，Nest 会解析成 Object 而失败。
    // 生产装配注入 KbDatabaseService；迁移导入器自行构造时传 staging 实现。
    @Inject(KbDatabaseService) private readonly databases: KbDbAccess,
  ) {}

  // ============ 读取 ============

  /**
   * 读取分块（分页）。
   * 旧实现要流式扫整个 JSONL 才能 skip；这里直接 LIMIT/OFFSET。
   */
  async findByItemId(
    kbId: string,
    itemId: string,
    skip: number = 0,
    limit: number = 10,
  ): Promise<KbChunkRow[]> {
    const db = await this.databases.getDb(kbId);
    const rows = db
      .prepare(
        `SELECT * FROM chunk WHERE item_id = ? ORDER BY chunk_index LIMIT ? OFFSET ?`,
      )
      .all(itemId, limit, skip) as ChunkDbRow[];
    return rows.map((r) => this.toRow(r, kbId));
  }

  /** 兼容旧方法名（历史调用方使用 findByFileId） */
  async findByFileId(
    kbId: string,
    itemId: string,
    skip: number = 0,
    limit: number = 10,
  ): Promise<KbChunkRow[]> {
    return this.findByItemId(kbId, itemId, skip, limit);
  }

  async countByItemId(kbId: string, itemId: string): Promise<number> {
    const db = await this.databases.getDb(kbId);
    return (
      db.prepare(`SELECT COUNT(*) c FROM chunk WHERE item_id = ?`).get(itemId) as {
        c: number;
      }
    ).c;
  }

  async findById(kbId: string, chunkId: string): Promise<KbChunkRow | null> {
    const db = await this.databases.getDb(kbId);
    const row = db
      .prepare(`SELECT * FROM chunk WHERE id = ?`)
      .get(chunkId) as ChunkDbRow | undefined;
    return row ? this.toRow(row, kbId) : null;
  }

  /**
   * 取某条目分块使用的**分块策略标记**（形如 `md-heading-v2` / `token`）。
   *
   * 返回值语义（调用方靠它区分三种情况，别把 null 与 "" 混为一谈）：
   * - `null`：该条目**没有分块**（未处理完 / 处理失败 / 空文件）→ 不提示"方案过时"
   * - `""`：有分块但 metadata 里没有 strategy 键（极老的数据）→ 视为旧方案
   * - 其他：实际策略标记
   *
   * 同一个文件的所有分块由同一次处理产出，策略必然相同，所以只读一行即可——
   * 不需要遍历全部分块解析 JSON（那在大文件上是 O(分块数) 的 JSON 解析）。
   *
   * 用途：前端据此提示"该文件用旧分块方案，建议重新处理"（见 chunking-kind.util
   * 的 isLegacyChunkStrategy）。重处理会重新调用嵌入模型（有成本），所以只提示不自动做。
   */
  async findStrategyForItem(
    kbId: string,
    itemId: string,
  ): Promise<string | null> {
    const db = await this.databases.getDb(kbId);
    const row = db
      .prepare(
        `SELECT metadata_json FROM chunk WHERE item_id = ? ORDER BY chunk_index LIMIT 1`,
      )
      .get(itemId) as { metadata_json: string | null } | undefined;
    if (!row) return null;
    return this.readStrategy(row.metadata_json);
  }

  /** 批量取策略（列表页用；一次查询取回所有条目的首个分块） */
  async findStrategiesForItems(
    kbId: string,
    itemIds: string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (itemIds.length === 0) return out;
    // 先全部按"无分块"兜底
    for (const id of itemIds) out.set(id, null);

    const db = await this.databases.getDb(kbId);
    const placeholders = itemIds.map(() => "?").join(",");
    // 每个条目取 chunk_index 最小的那一行
    const rows = db
      .prepare(
        `SELECT c.item_id AS item_id, c.metadata_json AS metadata_json
           FROM chunk c
           JOIN (
             SELECT item_id, MIN(chunk_index) AS min_idx
               FROM chunk
              WHERE item_id IN (${placeholders})
              GROUP BY item_id
           ) m ON m.item_id = c.item_id AND m.min_idx = c.chunk_index`,
      )
      .all(...itemIds) as Array<{ item_id: string; metadata_json: string | null }>;

    for (const row of rows) {
      out.set(row.item_id, this.readStrategy(row.metadata_json));
    }
    return out;
  }

  /** metadata_json → 策略标记（`""` 表示有分块但没记策略） */
  private readStrategy(metadataJson: string | null): string {
    if (!metadataJson) return "";
    try {
      const meta = JSON.parse(metadataJson);
      return typeof meta?.strategy === "string" ? meta.strategy : "";
    } catch {
      return "";
    }
  }

  // ============ 写入 ============

  /**
   * 整体替换某条目的分块（删旧 + 插新 + FTS/向量同步，**单事务**）。
   *
   * 重新处理同一文件时靠它保证「要么全新、要么全旧」，不会留下半套分块。
   *
   * ## 向量索引的双写
   *
   * `chunk_vec`（sqlite-vec vec0）是派生索引，必须在同一事务里跟着 chunk 走，
   * 否则索引会与分块脱节（`KbVectorIndexService.isReady` 的计数比对会判为未就绪，
   * 于是检索退回全表扫描——不会出错，但白丢性能）。
   *
   * 写路径**只做保守判定**：能写就写，维度不符或表不存在时按需建表；
   * 结构性重建（drop）只由 `KbVectorIndexService` 负责。
   */
  async replaceChunks(
    kbId: string,
    itemId: string,
    rows: KbChunkFileRow[],
  ): Promise<number> {
    const db = await this.databases.getDb(kbId);
    const insert = db.prepare(
      `INSERT INTO chunk (
         id, item_id, chunk_index, content, token_count,
         embedding, embedding_dimensions, metadata_json, created_at
       ) VALUES (
         @id, @item_id, @chunk_index, @content, @token_count,
         @embedding, @embedding_dimensions, @metadata_json, @created_at
       )`,
    );
    const ftsInsert = db.prepare(
      `INSERT INTO chunk_fts (rowid, content) VALUES (?, ?)`,
    );
    const getRowid = db.prepare(`SELECT rowid FROM chunk WHERE id = ?`);

    // 本批向量的维度：取第一个非空向量。同一次处理产出的分块维度必然一致。
    const batchDim =
      rows.find((r) => r.embedding && r.embedding.length > 0)?.embedding
        ?.length ?? 0;
    // 维度不符 / 表不存在时 prepareVecTableForWrite 会按需建表并返回 false，
    // 此时本批只写 chunk 与 FTS，向量索引留给 KbVectorIndexService 重建。
    const vecWritable = batchDim > 0 && prepareVecTableForWrite(db, batchDim);

    const run = db.transaction(() => {
      // 事务内再查一次：本批可能刚由 prepareVecTableForWrite 建出表。
      // 注意 better-sqlite3 在 prepare 阶段就校验表存在，所以不能无条件 prepare vec 语句。
      const vecAvailable = vecTableExists(db);

      // 旧行 id 集合用 Set：原实现对每个新行做 staleIds.includes()，千块文件重处理
      // 是 10^6 级比较（O(n²)）。
      const staleIds = new Set<string>(
        (
          db.prepare(`SELECT id FROM chunk WHERE item_id = ?`).all(itemId) as Array<{
            id: string;
          }>
        ).map((r) => r.id),
      );
      for (const row of rows) staleIds.add(row.id);

      const dropFts = db.prepare(
        `DELETE FROM chunk_fts WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
      );
      const dropVec = vecAvailable
        ? db.prepare(
            `DELETE FROM chunk_vec WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
          )
        : null;
      for (const id of staleIds) {
        dropFts.run(id);
        // 必须在 chunk 行删除之前执行，子查询才能取到 rowid
        dropVec?.run(id);
      }
      db.prepare(`DELETE FROM chunk WHERE item_id = ?`).run(itemId);

      for (const row of rows) {
        insert.run(this.toDbRow(row, itemId));
        const rowid = getRowid.get(row.id) as { rowid: number } | undefined;
        if (!rowid) continue;
        ftsInsert.run(rowid.rowid, tokenizeForSearch(row.content));
        if (vecWritable && row.embedding && row.embedding.length === batchDim) {
          insertVector(
            db,
            rowid.rowid,
            Buffer.from(new Float32Array(row.embedding).buffer),
          );
        }
      }
    });
    run();
    return rows.length;
  }

  /**
   * 只更新某条目分块的向量（重新嵌入用；不动正文与 FTS）。
   *
   * 向量索引同步：vec0 的 rowid 是主键且不支持 `INSERT OR REPLACE`（实测报 UNIQUE 冲突），
   * 所以**必须先删后插**，不能直接覆盖。
   */
  async updateEmbeddings(
    kbId: string,
    ids: string[],
    embeddings: number[][],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const db = await this.databases.getDb(kbId);
    const stmt = db.prepare(
      `UPDATE chunk SET embedding = ?, embedding_dimensions = ? WHERE id = ?`,
    );
    const getRowid = db.prepare(`SELECT rowid FROM chunk WHERE id = ?`);
    const batchDim = embeddings.find((v) => v && v.length > 0)?.length ?? 0;
    const vecWritable = batchDim > 0 && prepareVecTableForWrite(db, batchDim);
    const dropVecStmt = db.prepare(`DELETE FROM chunk_vec WHERE rowid = ?`);

    const run = db.transaction(() => {
      // 事务内查存在性：本批可能刚由 prepareVecTableForWrite 建出表，
      // 且 better-sqlite3 在 prepare 阶段就会校验表存在。
      const vecAvailable = vecTableExists(db);
      let changed = 0;
      for (let i = 0; i < ids.length; i++) {
        const vector = embeddings[i];
        if (!vector || vector.length === 0) continue;
        changed += stmt.run(
          Buffer.from(new Float32Array(vector).buffer),
          vector.length,
          ids[i],
        ).changes;

        if (!vecWritable || !vecAvailable || vector.length !== batchDim) continue;
        const rowid = getRowid.get(ids[i]) as { rowid: number } | undefined;
        if (!rowid) continue;
        // vec0 的 rowid 是主键且不支持 INSERT OR REPLACE，必须先删后插
        dropVecStmt.run(BigInt(rowid.rowid));
        insertVector(
          db,
          rowid.rowid,
          Buffer.from(new Float32Array(vector).buffer),
        );
      }
      return changed;
    });
    return run();
  }

  // ============ 删除 ============

  /** 删除某条目的全部分块（含 FTS） */
  async deleteByItemId(kbId: string, itemId: string): Promise<number> {
    return this.deleteManyInternal(kbId, [itemId]);
  }

  /** 兼容旧方法名（文件版为 deleteChunks） */
  async deleteChunks(kbId: string, itemId: string): Promise<number> {
    return this.deleteByItemId(kbId, itemId);
  }

  /**
   * 批量删除多个条目的分块（文件夹递归删除用）——单事务。
   * 旧实现要按目录层级递归、逐个子项删 chunks.jsonl。
   */
  async deleteMany(kbId: string, itemIds: string[]): Promise<number> {
    return this.deleteManyInternal(kbId, itemIds);
  }

  /** 删除整个库的所有分块、FTS 与向量索引行 */
  async deleteAll(kbId: string): Promise<void> {
    const db = await this.databases.getDb(kbId);
    const hasVec = vecTableExists(db);
    db.transaction(() => {
      db.prepare(`DELETE FROM chunk`).run();
      db.prepare(`DELETE FROM chunk_fts`).run();
      if (hasVec) db.prepare(`DELETE FROM chunk_vec`).run();
    })();
  }

  private async deleteManyInternal(
    kbId: string,
    itemIds: string[],
  ): Promise<number> {
    if (itemIds.length === 0) return 0;
    const db = await this.databases.getDb(kbId);
    return db.transaction(() => this.deleteManyWithin(db, itemIds))();
  }

  /**
   * 在**调用方开启的事务内**删除多个条目的分块 / FTS / 向量（同步）。
   *
   * 供"条目行 + 分块"必须原子删除的场景（文件夹递归删除、单文件删除）使用。
   * 原来分块删除是一个事务、条目行删除是逐条各自事务，崩在中间会留下
   * **"条目行还在、分块已经没了"**的半程状态：文件显示 completed 却搜不到任何内容，
   * 而且启动期对账查不出来（原件目录也还在，`cleanupOrphanFiles` 只查原件是否存在）。
   *
   * 注意：本方法**不自己开事务**，必须由调用方用 `db.transaction(...)` 包裹。
   */
  deleteManyWithin(db: Database.Database, itemIds: string[]): number {
    if (itemIds.length === 0) return 0;

    const ids: string[] = [];
    const collect = db.prepare(`SELECT id FROM chunk WHERE item_id = ?`);
    for (const itemId of itemIds) {
      for (const row of collect.all(itemId) as Array<{ id: string }>) {
        ids.push(row.id);
      }
    }
    if (ids.length === 0) return 0;

    const hasVec = vecTableExists(db);
    const dropFts = db.prepare(
      `DELETE FROM chunk_fts WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
    );
    // better-sqlite3 在 prepare 阶段就校验表存在，表不存在时不能 prepare vec 语句
    const dropVec = hasVec
      ? db.prepare(
          `DELETE FROM chunk_vec WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
        )
      : null;
    const dropChunks = db.prepare(`DELETE FROM chunk WHERE item_id = ?`);

    for (const id of ids) {
      dropFts.run(id);
      // 必须在 chunk 行删除之前
      dropVec?.run(id);
    }
    let changed = 0;
    for (const itemId of itemIds) changed += dropChunks.run(itemId).changes;
    return changed;
  }

  // ============ 行转换 ============

  private toDbRow(row: KbChunkFileRow, itemId: string): Record<string, any> {
    const embedding = row.embedding?.length
      ? Buffer.from(new Float32Array(row.embedding).buffer)
      : null;
    return {
      id: row.id,
      item_id: itemId,
      chunk_index: row.chunkIndex ?? 0,
      content: row.content ?? "",
      token_count: row.tokenCount ?? 0,
      embedding,
      embedding_dimensions:
        row.embeddingDimensions ?? row.embedding?.length ?? null,
      metadata_json: row.metadata ? JSON.stringify(row.metadata) : null,
      created_at: this.toISO(row.createdAt) ?? new Date().toISOString(),
    };
  }

  private toRow(row: ChunkDbRow, kbId: string): KbChunkRow {
    return {
      id: row.id,
      fileId: row.item_id,
      knowledgeBaseId: kbId,
      content: row.content,
      chunkIndex: row.chunk_index,
      vectorId: row.id,
      embeddingDimensions: row.embedding_dimensions,
      tokenCount: row.token_count,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: new Date(row.created_at),
    };
  }

  private toISO(value: any): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}

/** BLOB → number[]（检索层用） */
export function bufferToEmbedding(buf: Buffer | null): number[] | null {
  if (!buf || buf.length === 0) return null;
  const floats = new Float32Array(
    buf.buffer,
    buf.byteOffset,
    Math.floor(buf.byteLength / 4),
  );
  return Array.from(floats);
}
