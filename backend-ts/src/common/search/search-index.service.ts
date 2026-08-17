/**
 * 搜索索引服务
 *
 * 管理独立的 search_index.db，使用 SQLite FTS5 全文索引。
 * 与主业务库 (ai_chat.db) 完全隔离，互不影响读写性能。
 *
 * - FTS5 tokenize='unicode61'：按 Unicode 字符分词，对中文做字级切分
 * - 仅索引非空内容（AI 工具调用轮次的空 content 被过滤）
 * - 同步由 SearchSyncService 后台定时驱动，不影响写入热路径
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Jieba } from "@node-rs/jieba";
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

export interface SearchResult {
  messageId: string;
  sessionId: string;
  role: string;
  createdAt: string;
  snippet: string;
}

@Injectable()
export class SearchIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexService.name);
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private jieba: Jieba | null = null;

  /**
   * 索引策略版本：索引构建规则或表结构变化时递增，
   * 版本不一致会在启动时自动重建索引表并触发全量回填。
   * v3：索引内容过滤规则（排除 tool 输出/归档/空内容、jieba 分词）
   */
  private readonly INDEX_SCHEMA_VERSION = "3";

  // 预编译 statements（在 init 后创建）
  private stmtUpsert!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtDeleteBySession!: Database.Statement;
  private stmtSearch!: Database.Statement;
  private stmtGetMeta!: Database.Statement;
  private stmtSetMeta!: Database.Statement;
  private stmtCount!: Database.Statement;

  constructor(private configService: ConfigService) {
    const dataDir =
      process.env.USERDATA_DIR ||
      process.env.DATA_DIR ||
      path.join(process.cwd(), "data");

    const configuredPath = this.configService.get<string>("SEARCH_INDEX_PATH");
    this.dbPath = configuredPath
      ? (path.isAbsolute(configuredPath)
          ? configuredPath
          : path.join(process.cwd(), configuredPath))
      : path.join(dataDir, "search_index.db");

    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  onModuleInit() {
    this.initialize();
  }

  onModuleDestroy() {
    this.db?.close();
    this.db = null;
    this.jieba = null;
  }

  /**
   * 获取索引库路径（供 worker 进程使用）
   */
  getDbPath(): string {
    return this.dbPath;
  }

  private initialize() {
    // timeout = busy_timeout（毫秒）：多进程并发写同一索引库时，等待锁而不是立即失败
    this.db = new Database(this.dbPath, { timeout: 30000 });
    this.db.pragma("journal_mode = WAL");

    try {
      this.jieba = new Jieba();
    } catch (error: any) {
      this.logger.warn(`中文分词器初始化失败：${error.message}`);
    }

    // sync_meta 表 — 记录同步状态（需在版本检查前确保存在）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // ── 表结构版本检查与迁移 ──
    // v2 结构新增 content_raw 列（原始文本，用于 snippet 展示）。
    // 索引策略版本变化（如过滤规则/分词规则变更）时同样重建。
    // FTS5 不支持 ALTER TABLE，只能 DROP 重建。
    // 索引库为空或数据可重放，重建无损失；同时重置同步游标触发全量回填。
    const currentCols = this.db
      .prepare(`PRAGMA table_info(message_fts)`)
      .all() as Array<{ name: string }>;
    const versionRow = this.db
      .prepare(`SELECT value FROM sync_meta WHERE key = 'index_schema_version'`)
      .get() as { value: string } | undefined;
    const currentSchemaVersion = versionRow?.value ?? null;
    const needsRebuild =
      (currentCols.length > 0 &&
        !currentCols.some((c) => c.name === "content_raw")) ||
      (currentCols.length > 0 &&
        currentSchemaVersion !== this.INDEX_SCHEMA_VERSION);
    if (needsRebuild) {
      this.logger.warn(
        `检测到索引结构/策略版本变更（当前 ${currentSchemaVersion ?? "未知"}，目标 ${this.INDEX_SCHEMA_VERSION}），重建索引表...`,
      );
      this.db.exec(`DROP TABLE IF EXISTS message_fts`);
      this.db.exec(`DELETE FROM sync_meta WHERE key = 'last_synced_at'`);
      this.db.exec(`DELETE FROM sync_meta WHERE key = 'full_backfill_offset'`);
    }

    // 创建 FTS5 虚拟表
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        role       UNINDEXED,
        content,
        content_raw,
        created_at UNINDEXED,
        tokenize='unicode61'
      );
    `);

    // 预编译 statements
    this.stmtUpsert = this.db.prepare(
      `INSERT INTO message_fts (message_id, session_id, role, content, content_raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.stmtDelete = this.db.prepare(
      `DELETE FROM message_fts WHERE message_id = ?`,
    );
    this.stmtDeleteBySession = this.db.prepare(
      `DELETE FROM message_fts WHERE session_id = ?`,
    );
    this.stmtSearch = this.db.prepare(
      `SELECT message_id, session_id, role, created_at,
              snippet(message_fts, 4, '【', '】', '...', 20) AS snippet_text
       FROM message_fts
       WHERE message_fts MATCH ?
       ORDER BY created_at DESC
       LIMIT ?`,
    );
    this.stmtGetMeta = this.db.prepare(
      `SELECT value FROM sync_meta WHERE key = ?`,
    );
    this.stmtSetMeta = this.db.prepare(
      `INSERT INTO sync_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    this.stmtCount = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM message_fts`,
    );

    // 记录当前索引策略版本（供下次启动检测变更）
    this.db.exec(
      `INSERT INTO sync_meta (key, value) VALUES ('index_schema_version', '${this.INDEX_SCHEMA_VERSION}')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

    // ── 自愈检查 ──
    // 索引为空但同步游标已推进 → 说明索引曾因 bug 被清空或从未成功写入，
    // 重置游标触发全量回填。
    const cntRow = this.stmtCount.get() as { cnt: number };
    const hasCursor = this.getSyncMeta("last_synced_at") !== null;
    if (cntRow.cnt === 0 && hasCursor) {
      this.logger.warn(
        "检测到索引库为空但同步游标已推进，重置游标触发全量回填",
      );
      this.db.exec(`DELETE FROM sync_meta WHERE key = 'last_synced_at'`);
    }

    this.logger.log(`搜索索引初始化完成: ${this.dbPath}`);
  }

  /**
   * 搜索消息内容
   * 对 keyword 做 FTS5 MATCH 查询，返回匹配项 + 上下文片段
   */
  search(keyword: string, limit: number = 50): SearchResult[] {
    if (!this.db || !keyword.trim()) return [];

    // FTS5 查询：对中文按字分词，用 OR 连接各字
    // 例如 "用户问题" → "用 OR 户 OR 问 OR 题"
    // 这样任何包含这些字的行都能匹配到
    const ftsQuery = this.buildFtsQuery(keyword);
    if (!ftsQuery) return [];

    try {
      const rows = this.stmtSearch.all(ftsQuery, limit) as Array<{
        message_id: string;
        session_id: string;
        role: string;
        created_at: string;
        snippet_text: string;
      }>;

      return rows.map((row) => ({
        messageId: row.message_id,
        sessionId: row.session_id,
        role: row.role,
        createdAt: row.created_at,
        snippet: row.snippet_text,
      }));
    } catch (error: any) {
      this.logger.warn(`FTS5 搜索失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 构建 FTS5 查询表达式
   * 使用 jieba 分词，对中文按词切分而非按字切分，大幅提升搜索精度
   */
  private buildFtsQuery(keyword: string): string {
    const trimmed = keyword.trim();
    if (!trimmed) return "";

    const cleaned = trimmed.replace(/["*+\-:()]/g, " ").trim();
    if (!cleaned) return "";

    let tokens: string[];
    if (this.jieba && /[\u4e00-\u9fa5]/.test(cleaned)) {
      tokens = this.jieba.cut(cleaned, true).filter(
        (t) => t.trim() && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t),
      );
    } else {
      tokens = cleaned.split(/\s+/).filter((t) => t.trim());
    }

    if (tokens.length === 0) return "";

    return tokens.map((t) => `"${t}"`).join(" OR ");
  }

  /**
   * 索引端分词：将原始文本转为空格分隔的词序列
   *
   * FTS5 unicode61 分词器对无空格分隔的连续中文会将其视为单个 token
   * （例如 "今天天气不错" 是一个 term），导致按词/按字查询都无法命中。
   * 这里在写入索引前先用 jieba 分词并以空格连接，使每个词成为独立 token，
   * 与 buildFtsQuery 的查询粒度保持一致。
   */
  private tokenizeForIndex(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (this.jieba && /[\u4e00-\u9fa5]/.test(trimmed)) {
      return this.jieba
        .cut(trimmed, true)
        .filter((t) => t.trim() && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(t))
        .join(" ");
    }
    return trimmed;
  }

  /**
   * 批量写入/更新索引（FTS5 不支持 UPDATE，用 DELETE + INSERT）
   * content 列存分词后的文本（搜索用），content_raw 列存原始文本（snippet 展示用）
   */
  upsertBatch(
    entries: Array<{
      messageId: string;
      sessionId: string;
      role: string;
      content: string;
      createdAt: string;
    }>,
  ): number {
    if (!this.db || entries.length === 0) return 0;

    const tx = this.db.transaction((items: typeof entries) => {
      let count = 0;
      for (const item of items) {
        this.stmtDelete.run(item.messageId);
        this.stmtUpsert.run(
          item.messageId,
          item.sessionId,
          item.role,
          this.tokenizeForIndex(item.content),
          item.content,
          item.createdAt,
        );
        count++;
      }
      return count;
    });

    return tx(entries);
  }

  /**
   * 删除单条消息的索引
   */
  deleteByMessage(messageId: string): void {
    this.stmtDelete?.run(messageId);
  }

  /**
   * 删除某会话的所有索引
   */
  deleteBySession(sessionId: string): void {
    this.stmtDeleteBySession?.run(sessionId);
  }

  /**
   * 获取同步元数据
   */
  getSyncMeta(key: string): string | null {
    const row = this.stmtGetMeta?.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * 设置同步元数据
   */
  setSyncMeta(key: string, value: string): void {
    this.stmtSetMeta?.run(key, value);
  }

  /**
   * 尝试获取跨进程同步锁（防止多个后端实例同时同步同一索引库导致 database is locked）
   *
   * 锁记录在 sync_meta 中，带 TTL 自动过期；进程异常退出时残留的锁会在 TTL 后被抢占。
   *
   * @param ttlMs 锁有效期（默认 10 分钟）
   * @returns true 表示获取成功（可执行同步）
   */
  tryAcquireSyncLock(ttlMs: number = 10 * 60 * 1000): boolean {
    if (!this.db) return false;
    const now = Date.now();
    try {
      const acquired = this.db.transaction(() => {
        const existing = this.stmtGetMeta.get("sync_running") as
          | { value: string }
          | undefined;
        if (existing) {
          const startedAt = Number(existing.value);
          // 锁仍有效 → 拒绝；已过期 → 允许抢占
          if (Number.isFinite(startedAt) && now - startedAt < ttlMs) {
            return false;
          }
        }
        this.stmtSetMeta.run("sync_running", String(now));
        return true;
      })();
      return acquired ?? false;
    } catch (error: any) {
      this.logger.warn(`获取同步锁失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 释放跨进程同步锁
   */
  releaseSyncLock(): void {
    if (!this.db) return;
    try {
      this.db.prepare(`DELETE FROM sync_meta WHERE key = 'sync_running'`).run();
    } catch (error: any) {
      this.logger.warn(`释放同步锁失败: ${error.message}`);
    }
  }

  /**
   * 获取索引条目总数
   */
  getIndexCount(): number {
    const row = this.stmtCount?.get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * 获取所有已索引的 message_id 集合（用于孤儿清理）
   */
  getAllIndexedMessageIds(): Set<string> {
    if (!this.db) return new Set();
    const rows = this.db.prepare(
      `SELECT message_id FROM message_fts`,
    ).all() as Array<{ message_id: string }>;
    return new Set(rows.map((r) => r.message_id));
  }
}
