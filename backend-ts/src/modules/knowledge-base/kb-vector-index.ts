import type Database from "better-sqlite3";

/**
 * 知识库向量索引层（sqlite-vec `vec0`）——纯 SQL/DDL 辅助，无 Nest 依赖。
 *
 * ## 为什么是独立的一层，而不是 schema 版本迁移
 *
 * `chunk_vec` 与 `chunk.embedding` 同性质：**派生数据，可随时重建**。所以它不进
 * `kb-schema.ts` 的版本门（`user_version`），而是幂等创建、按需重建。这样做有两个好处：
 *
 * 1. **降级兼容**：`migrateKbDatabase` 对"库版本高于程序"是硬拒绝（`kb-schema.ts`），
 *    若把 vec0 做成 v2，用户一旦降级安装就再也打不开知识库。而索引层不参与版本判定，
 *    旧程序看到多余的表会忽略。
 * 2. **不阻塞启动**：建表 + 回填若塞进 `migrateKbDatabase` 的单事务，十万级分块的库会在
 *    首次打开时把事件循环卡死数秒。索引层走分批 + 让出事件循环。
 *
 * ## 实测约束（sqlite-vec 0.1.9，详见 docs/design/kb-architecture-review.md 附录 A）
 *
 * - **rowid 必须绑 BigInt**：`run(101, buf)` 会报
 *   `Only integers are allows for primary key values`；`run(101n, buf)` 才行。
 *   这条错误信息完全不提 BigInt，是最容易踩的坑。
 * - **`LIMIT` 不能与 `k = ?` 同时用**：`Only LIMIT or 'k =?' can be provided, not both`。
 * - KNN 默认按距离升序，不需要写 `ORDER BY distance`。
 * - `distance_metric=cosine` 的距离与标量 `vec_distance_cosine` **位级相同**（已实测），
 *   所以 `score = 1 - distance` 的语义与改造前完全一致。
 * - 零向量（全 0）的余弦未定义，`distance` 返回 **null**。调用方必须过滤掉 null，
 *   否则 `1 - null === 1` 会造出"假满分"（这是改造前就存在的隐患，见下面 `knnSearch`）。
 */

/** 向量索引虚拟表名 */
export const VEC_TABLE = "chunk_vec";

/** 索引层元信息表（键值对）。与 schema 版本无关，仅记录索引自身的水位。 */
export const KB_META_TABLE = "kb_meta";

/** meta 键：当前索引声明的向量维度 */
export const META_VEC_DIM = "vec_dim";
/** meta 键：回填已处理到的 chunk.rowid 水位 */
export const META_VEC_CURSOR = "vec_cursor";

/** 回填批大小。太大则单次占用事件循环久，太小则事务开销占比高。 */
export const VEC_BATCH_SIZE = 1000;

/** 距离度量的 SQL 片段（集中一处，便于将来换 L2） */
const DISTANCE_METRIC = "cosine";

// ============================================================================
// meta 表
// ============================================================================

/** 幂等创建 meta 表。所有索引入口都应先调它。 */
export function ensureMetaTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${KB_META_TABLE} (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     ) WITHOUT ROWID`,
  );
}

export function readMeta(db: Database.Database, key: string): string | null {
  try {
    const row = db
      .prepare(`SELECT value FROM ${KB_META_TABLE} WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    // meta 表还不存在（未初始化的库）
    return null;
  }
}

export function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ${KB_META_TABLE} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function deleteMeta(db: Database.Database, key: string): void {
  try {
    db.prepare(`DELETE FROM ${KB_META_TABLE} WHERE key = ?`).run(key);
  } catch {
    /* meta 表不存在时无事可做 */
  }
}

// ============================================================================
// 虚拟表 DDL
// ============================================================================

/**
 * 生成 vec0 建表语句。
 *
 * 维度必须内插进 DDL（vec0 不支持参数化维度），所以这里**强制校验是正整数**，
 * 不能把外部字符串直接拼进来。
 */
export function vecTableDdl(dim: number): string {
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`非法的向量维度：${dim}`);
  }
  return `CREATE VIRTUAL TABLE ${VEC_TABLE} USING vec0(embedding float[${dim}] distance_metric=${DISTANCE_METRIC})`;
}

/** 虚拟表是否已存在（虚表在 sqlite_master 里同样是 type='table'） */
export function vecTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(VEC_TABLE) as { name: string } | undefined;
  return !!row;
}

/**
 * 读出已建虚拟表声明的维度（从 DDL 里解析）。
 *
 * 用于识别「换了嵌入模型、维度变了」——此时旧索引无法再插入新向量
 * （vec0 会在插入时报 `Dimension mismatch`），必须 drop 重建。
 */
export function declaredVecDim(db: Database.Database): number | null {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(VEC_TABLE) as { sql: string | null } | undefined;
  if (!row?.sql) return null;
  const m = /float\s*\[\s*(\d+)\s*\]/i.exec(row.sql);
  return m ? Number(m[1]) : null;
}

export function createVecTable(db: Database.Database, dim: number): void {
  db.exec(vecTableDdl(dim));
}

export function dropVecTable(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`);
}

// ============================================================================
// 维度探测与计数
// ============================================================================

export type EmbeddingDimensionProbe =
  | { kind: "none" }
  | { kind: "ok"; dim: number }
  | { kind: "inconsistent"; dims: number[] };

/**
 * 探测库内嵌入向量的维度。
 *
 * 维度以 **BLOB 字节长度** 为准（`LENGTH(embedding)/4`），不信任 `embedding_dimensions`
 * 这个冗余列——它可能与实际字节数不一致（历史数据、手工修库）。
 *
 * 单库混合维度是异常态：换嵌入模型会走 `clearAndReprocessKnowledgeBase` 把分块全删，
 * 所以正常路径下不可能出现。出现即说明上次重处理被中断或有人手改了库——此时**拒绝建索引**
 * 并告警，让检索回退到全表扫描（慢但正确），而不是静默漏检一部分分块。
 */
export function probeEmbeddingDimension(
  db: Database.Database,
): EmbeddingDimensionProbe {
  const rows = db
    .prepare(
      `SELECT LENGTH(embedding) / 4 AS dim, COUNT(*) AS n
         FROM chunk
        WHERE embedding IS NOT NULL AND LENGTH(embedding) > 0
        GROUP BY dim
        ORDER BY n DESC`,
    )
    .all() as Array<{ dim: number; n: number }>;

  const dims = rows
    .map((r) => Number(r.dim))
    .filter((d) => Number.isInteger(d) && d > 0);

  if (dims.length === 0) return { kind: "none" };
  if (dims.length === 1) return { kind: "ok", dim: dims[0] };
  return { kind: "inconsistent", dims };
}

/** 有向量的分块数（索引应达到的行数） */
export function countEmbeddedChunks(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM chunk WHERE embedding IS NOT NULL AND LENGTH(embedding) > 0`,
    )
    .get() as { c: number };
  return Number(row.c);
}

/** 索引内实际行数（表不存在时返回 0） */
export function countIndexedVectors(db: Database.Database): number {
  if (!vecTableExists(db)) return 0;
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${VEC_TABLE}`).get() as {
    c: number;
  };
  return Number(row.c);
}

// ============================================================================
// 写入 / 删除
// ============================================================================

/**
 * 写入前判定：本批向量能否写进索引。
 *
 * 返回 `true` 表示索引可用（必要时会**就地建表**）；`false` 表示本批应跳过。
 *
 * ## 为什么这里只建表、从不 drop
 *
 * vec0 的 rowid 是主键且**不支持 `INSERT OR REPLACE` / `OR IGNORE`**（实测都报
 * `UNIQUE constraint failed`），所以并发/重复插入必须靠调用方避免。同时，结构性变更
 * （维度不匹配时 drop 重建）**只由 `KbVectorIndexService.ensureIndex` 负责**，
 * 写路径保持保守：
 *
 * - 表不存在 → 就地建表（维度即本批向量长度），这是"首次入库"的正常路径
 * - 表存在且维度一致 → 可写
 * - 表存在但维度不一致 → **跳过并返回 false**，交给 `ensureIndex` 重建。
 *   写路径若自行 drop，会在"混合维度"这种异常态下反复 drop/建，把索引搅成抖动状态。
 */
export function prepareVecTableForWrite(
  db: Database.Database,
  embeddingLength: number,
): boolean {
  if (!Number.isInteger(embeddingLength) || embeddingLength <= 0) return false;

  if (!vecTableExists(db)) {
    ensureMetaTable(db);
    createVecTable(db, embeddingLength);
    writeMeta(db, META_VEC_DIM, String(embeddingLength));
    return true;
  }

  const declared = declaredVecDim(db);
  const recorded = readMeta(db, META_VEC_DIM);
  const recordedDim = recorded === null ? null : Number(recorded);

  // DDL 是物理事实；meta 是记账。两者任一与目标维度不符都视为不可写。
  if (declared !== embeddingLength) return false;
  if (recordedDim !== null && recordedDim !== embeddingLength) return false;
  return true;
}

/**
 * 插入一行向量。**rowid 必须是 BigInt**（见文件头实测约束）。
 *
 * 调用方需先用 `prepareVecTableForWrite` 确认可写；维度不匹配时 vec0 会抛
 * `Dimension mismatch for inserted vector`，那是期望的护栏而非可忽略的错误。
 */
export function insertVector(
  db: Database.Database,
  rowid: number,
  embedding: Buffer,
): void {
  db.prepare(
    `INSERT INTO ${VEC_TABLE} (rowid, embedding) VALUES (?, ?)`,
  ).run(BigInt(rowid), embedding);
}

/** 按 rowid 删除向量（rowid 需 BigInt，同插入） */
export function deleteVectorByRowid(db: Database.Database, rowid: number): void {
  db.prepare(`DELETE FROM ${VEC_TABLE} WHERE rowid = ?`).run(BigInt(rowid));
}

/** 删除某条目下的全部向量（chunk 行删除前调用，靠子查询取 rowid） */
export function deleteVectorsByItemId(db: Database.Database, itemId: string): void {
  if (!vecTableExists(db)) return;
  db.prepare(
    `DELETE FROM ${VEC_TABLE} WHERE rowid IN (SELECT rowid FROM chunk WHERE item_id = ?)`,
  ).run(itemId);
}

/** 清空整个索引（重建前调用） */
export function clearVectors(db: Database.Database): void {
  if (!vecTableExists(db)) return;
  db.exec(`DELETE FROM ${VEC_TABLE}`);
}

// ============================================================================
// 回填扫描
// ============================================================================

export interface MissingVectorRow {
  rowid: number;
  embedding: Buffer;
}

/**
 * 取「有向量但尚未进索引」的分块，按 rowid 升序，供分批回填。
 *
 * ## 为什么用 `NOT EXISTS` 而不是「清空后全量重插」
 *
 * 回填期间**并发的双写是真实存在的**：启动期 `KbFileService.resumePendingFileTasks`
 * 会立刻恢复未完成的处理任务，那些任务在写 `chunk` 的同时也写 `chunk_vec`。
 * 又因为 vec0 的 rowid 是主键且不支持 `INSERT OR REPLACE`（实测报 UNIQUE 冲突），
 * 全量重插一定会撞上并发写入的那几行而失败。
 *
 * 加 `NOT EXISTS` 守卫后：批次之间被并发插入的行会被这一批自动跳过，不会冲突；
 * 批次内部（单个事务、better-sqlite3 同步 API）不会有交错。
 *
 * `afterRowid` 是断点续跑水位。若某次回填被中断，下次从水位继续，不重复劳动。
 */
export function selectMissingVectors(
  db: Database.Database,
  afterRowid: number,
  limit: number,
): MissingVectorRow[] {
  if (!vecTableExists(db)) return [];
  const rows = db
    .prepare(
      `SELECT c.rowid AS rowid, c.embedding AS embedding
         FROM chunk c
        WHERE c.rowid > ?
          AND c.embedding IS NOT NULL
          AND LENGTH(c.embedding) > 0
          AND NOT EXISTS (SELECT 1 FROM ${VEC_TABLE} v WHERE v.rowid = c.rowid)
        ORDER BY c.rowid
        LIMIT ?`,
    )
    .all(afterRowid, limit) as Array<{ rowid: number | bigint; embedding: Buffer }>;
  return rows.map((r) => ({ rowid: Number(r.rowid), embedding: r.embedding }));
}

/** 库内最大 chunk rowid（用于判断回填是否已扫到尾） */
export function maxChunkRowid(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM chunk`).get() as {
    m: number | bigint;
  };
  return Number(row.m);
}

// ============================================================================
// KNN 检索
// ============================================================================

export interface KnnRow {
  rowid: number;
  distance: number | null;
}

/**
 * KNN 检索。
 *
 * - 用 `k = ?` 表达返回条数，**不能同时加 `LIMIT`**（vec0 明确拒绝两者并用）
 * - 不加 `ORDER BY`：KNN 默认按距离升序返回
 * - 返回行里 `distance` 可能是 **null**（零向量，余弦未定义），调用方必须过滤
 */
export function knnSearch(
  db: Database.Database,
  queryVector: Buffer,
  k: number,
): KnnRow[] {
  if (!Number.isInteger(k) || k <= 0) return [];
  const rows = db
    .prepare(`SELECT rowid, distance FROM ${VEC_TABLE} WHERE embedding MATCH ? AND k = ?`)
    .all(queryVector, k) as Array<{ rowid: number | bigint; distance: number | null }>;
  // 读回来的 rowid 是 JS number（实测），但防御性转换一下
  return rows.map((r) => ({ rowid: Number(r.rowid), distance: r.distance }));
}
