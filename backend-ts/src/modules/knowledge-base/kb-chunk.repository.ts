import { Inject, Injectable, Logger } from "@nestjs/common";
import { KbDatabaseService } from "./kb-database.service";
import { KbDbAccess } from "./kb-file.repository";
import { tokenizeForSearch } from "./kb-tokenizer";

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

  /** 兼容旧方法名（Prisma 版为 findByFileId） */
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

  // ============ 写入 ============

  /**
   * 整体替换某条目的分块（删旧 + 插新 + FTS 同步，**单事务**）。
   *
   * 重新处理同一文件时靠它保证「要么全新、要么全旧」，不会留下半套分块。
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

    const run = db.transaction(() => {
      const staleIds = (
        db
          .prepare(`SELECT id FROM chunk WHERE item_id = ?`)
          .all(itemId) as Array<{ id: string }>
      ).map((r) => r.id);
      for (const row of rows) {
        if (!staleIds.includes(row.id)) staleIds.push(row.id);
      }
      const dropFts = db.prepare(
        `DELETE FROM chunk_fts WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
      );
      for (const id of staleIds) dropFts.run(id);
      db.prepare(`DELETE FROM chunk WHERE item_id = ?`).run(itemId);

      for (const row of rows) {
        insert.run(this.toDbRow(row, itemId));
        const rowid = getRowid.get(row.id) as { rowid: number } | undefined;
        if (rowid) ftsInsert.run(rowid.rowid, tokenizeForSearch(row.content));
      }
    });
    run();
    return rows.length;
  }

  /** 只更新某条目分块的向量（重新嵌入用；不动正文与 FTS） */
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
    const run = db.transaction(() => {
      let changed = 0;
      for (let i = 0; i < ids.length; i++) {
        const vector = embeddings[i];
        if (!vector || vector.length === 0) continue;
        changed += stmt.run(
          Buffer.from(new Float32Array(vector).buffer),
          vector.length,
          ids[i],
        ).changes;
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

  /** 删除整个库的所有分块与 FTS 行 */
  async deleteAll(kbId: string): Promise<void> {
    const db = await this.databases.getDb(kbId);
    db.transaction(() => {
      db.prepare(`DELETE FROM chunk`).run();
      db.prepare(`DELETE FROM chunk_fts`).run();
    })();
  }

  private async deleteManyInternal(
    kbId: string,
    itemIds: string[],
  ): Promise<number> {
    if (itemIds.length === 0) return 0;
    const db = await this.databases.getDb(kbId);
    const ids: string[] = [];
    const collect = db.prepare(`SELECT id FROM chunk WHERE item_id = ?`);
    for (const itemId of itemIds) {
      for (const row of collect.all(itemId) as Array<{ id: string }>) {
        ids.push(row.id);
      }
    }
    if (ids.length === 0) return 0;
    const dropFts = db.prepare(
      `DELETE FROM chunk_fts WHERE rowid = (SELECT rowid FROM chunk WHERE id = ?)`,
    );
    const dropChunks = db.prepare(`DELETE FROM chunk WHERE item_id = ?`);
    const run = db.transaction(() => {
      for (const id of ids) dropFts.run(id);
      let changed = 0;
      for (const itemId of itemIds) changed += dropChunks.run(itemId).changes;
      return changed;
    });
    return run();
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
