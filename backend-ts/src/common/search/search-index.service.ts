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
  }

  private initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");

    // 创建 FTS5 虚拟表
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        role       UNINDEXED,
        content,
        created_at UNINDEXED,
        tokenize='unicode61'
      );
    `);

    // sync_meta 表 — 记录同步状态
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 预编译 statements
    this.stmtUpsert = this.db.prepare(
      `INSERT INTO message_fts (message_id, session_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.stmtDelete = this.db.prepare(
      `DELETE FROM message_fts WHERE message_id = ?`,
    );
    this.stmtDeleteBySession = this.db.prepare(
      `DELETE FROM message_fts WHERE session_id = ?`,
    );
    this.stmtSearch = this.db.prepare(
      `SELECT message_id, session_id, role, created_at,
              snippet(message_fts, 3, '【', '】', '...', 20) AS snippet_text
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
   * unicode61 分词器对中文做字级切分，所以将关键词的每个字用 OR 连接
   */
  private buildFtsQuery(keyword: string): string {
    const trimmed = keyword.trim();
    if (!trimmed) return "";

    // 去除 FTS5 特殊字符，避免语法错误
    const cleaned = trimmed.replace(/["*+\-:()]/g, " ").trim();
    if (!cleaned) return "";

    // 按空格分词（英文单词）或按字拆分（中文）
    const chars = Array.from(cleaned);
    // 过滤空白和标点
    const tokens = chars.filter((c) => c.trim() && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(c));

    if (tokens.length === 0) return "";

    // 每个字/词用 OR 连接，用双引号包裹避免 FTS5 语法解析
    return tokens.map((t) => `"${t}"`).join(" OR ");
  }

  /**
   * 批量写入/更新索引（FTS5 不支持 UPDATE，用 DELETE + INSERT）
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
