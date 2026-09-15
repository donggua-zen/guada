import type Database from "better-sqlite3";

/**
 * 知识库单库 schema（`<KB根>/<kbId>/kb.db`）
 *
 * 每个知识库一个自包含 SQLite 文件，随库目录一起增删：
 *   `<kbRoot>/<kbId>/kb.json`  ← KB 身份与配置
 *   `<kbRoot>/<kbId>/kb.db`    ← 本文件（条目元信息 + 分块正文 + 向量 + FTS）
 *   `<kbRoot>/<kbId>/raw/<itemId>/<文件名>` ← 原件副本
 *
 * ## 为什么 FTS 不能用 external-content
 *
 * `chunk_fts.content` 存的是 **jieba 分词后**的文本（中文按词切开，见 KbSearchService.
 * tokenizeForSearch），而 `chunk.content` 是原文。external-content 表会让 FTS 回读原文，
 * 存储时喂的是分词文本、查询时匹配的却是原文，中文检索直接失效。
 * 因此必须保持「独立表 + 显式 rowid 同步」，不要"优化"成 external-content 或 contentless。
 */

export const KB_DB_FILE = "kb.db";

/** 当前 schema 版本；每次结构调整 +1 并在 MIGRATIONS 里追加一步 */
export const KB_SCHEMA_VERSION = 1;

/** 建表语句（v1），幂等 */
const V1_DDL = `
CREATE TABLE IF NOT EXISTS item (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT '',
  file_extension TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  raw_name TEXT,
  source_path TEXT,
  relative_path TEXT,
  parent_folder_id TEXT,
  is_directory INTEGER NOT NULL DEFAULT 0,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  progress_percentage INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  error_message TEXT,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS item_parent ON item(parent_folder_id);
CREATE INDEX IF NOT EXISTS item_relpath ON item(relative_path);
CREATE INDEX IF NOT EXISTS item_status ON item(processing_status);

CREATE TABLE IF NOT EXISTS chunk (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,
  embedding_dimensions INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunk_item ON chunk(item_id, chunk_index);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  content,
  content_rowid='rowid'
);
`;

/**
 * 有序迁移：第 i 个函数把库从 user_version=i 升到 i+1。
 * v1 为初始建表，故为空表——结构与 V1_DDL 等价。
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v0 → v1：初始结构
  (db) => db.exec(V1_DDL),
];

/**
 * 把库升到当前版本。
 *
 * - 版本高于程序（用户降级安装）→ 抛错拒绝打开，绝不降级写入
 * - 整个升级过程在单个事务内，失败即回滚（user_version 也不会前进）
 */
export function migrateKbDatabase(db: Database.Database, kbId: string): void {
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > KB_SCHEMA_VERSION) {
    throw new Error(
      `知识库 ${kbId} 的数据库结构版本为 ${current}，高于本程序支持的 ${KB_SCHEMA_VERSION}。` +
        `请升级程序后再打开该知识库（可能是用更新版本创建或迁移过的数据）。`,
    );
  }
  if (current === KB_SCHEMA_VERSION) return;

  const run = db.transaction(() => {
    for (let v = current; v < KB_SCHEMA_VERSION; v++) {
      MIGRATIONS[v](db);
    }
    db.pragma(`user_version = ${KB_SCHEMA_VERSION}`);
  });
  run();
}
