/**
 * SQLite 向量数据库实现（基于 better-sqlite3 + sqlite-vec）
 * 
 * 特性：
 * - 独立存储：使用独立的 vector_db.sqlite 文件，避免与主业务库锁竞争。
 * - 向量搜索：集成 sqlite-vec 扩展，支持高效的向量相似度计算。
 * - 关键词搜索：利用 SQLite FTS5 虚拟表实现全文检索。
 * - 混合搜索：语义与关键词加权融合。
 */

import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Jieba } from '@node-rs/jieba';
import {
  VectorDatabase,
  SearchResult,
  VectorDocument,
  CollectionStats,
} from '../interfaces/vector-database.interface';

// 引入 sqlite-vec 扩展加载器
const sqliteVec = require('sqlite-vec');

@Injectable()
export class SqliteVectorDB implements VectorDatabase {
  private readonly logger = new Logger(SqliteVectorDB.name);
  private db: Database.Database | null = null;
  private jieba: Jieba | null = null;
  private persistPath: string;

  constructor() {
    this.persistPath = path.join(process.cwd(), 'data', 'vector_db.sqlite');
    // 确保目录存在
    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 初始化数据库连接并加载扩展
   */
  async initialize(): Promise<void> {
    if (this.db) return;

    try {
      this.db = new Database(this.persistPath);
      
      // 加载 sqlite-vec 扩展
      sqliteVec.load(this.db);
      this.logger.log('sqlite-vec 扩展加载成功');

      // 初始化中文分词器
      try {
        this.jieba = new Jieba();
        this.logger.log('中文分词器初始化成功');
      } catch (error: any) {
        this.logger.warn(`中文分词器初始化失败：${error.message}`);
      }

      // 启用 WAL 模式以提高并发性能
      this.db.pragma('journal_mode = WAL');
      this.logger.log(`SQLite 向量数据库初始化完成：${this.persistPath}`);
    } catch (error: any) {
      this.logger.error(`SQLite 向量数据库初始化失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 创建集合（在 SQLite 中对应创建表和 FTS 虚拟表）
   */
  async createCollection(
    collectionName: string,
    vectorSize: number,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.ensureInitialized();
    
    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;

    // 检查表是否已存在
    const exists = this.db!.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    if (exists) return;

    const transaction = this.db!.transaction(() => {
      // 1. 创建主表
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS "${tableName}" (
          id TEXT PRIMARY KEY,
          document_id TEXT,
          content TEXT,
          embedding BLOB,
          metadata_json TEXT
        )
      `);

      // 2. 创建 FTS5 虚拟表
      this.db!.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTableName}" USING fts5(
          content,
          content_rowid='rowid'
        )
      `);

      this.logger.log(`创建集合：${collectionName}（维度：${vectorSize}）`);
    });

    transaction();
  }

  /**
   * 删除集合
   */
  async deleteCollection(collectionName: string): Promise<boolean> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;

    try {
      const transaction = this.db!.transaction(() => {
        this.db!.exec(`DROP TABLE IF EXISTS "${tableName}"`);
        this.db!.exec(`DROP TABLE IF EXISTS "${ftsTableName}"`);
      });
      transaction();
      this.logger.log(`删除集合：${collectionName}`);
      return true;
    } catch (error: any) {
      this.logger.error(`删除集合失败：${error.message}`);
      return false;
    }
  }

  /**
   * 检查集合是否存在
   */
  async collectionExists(collectionName: string): Promise<boolean> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const row = this.db!.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
    return !!row;
  }

  /**
   * 添加文档到集合
   */
  async addDocuments(
    collectionName: string,
    documents: VectorDocument[],
  ): Promise<string[]> {
    await this.ensureInitialized();
    if (documents.length === 0) return [];

    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;

    // 自动检测并创建表
    if (!(await this.collectionExists(collectionName))) {
      await this.createCollection(collectionName, documents[0].embedding.length);
    }

    const insertMain = this.db!.prepare(
      `INSERT OR REPLACE INTO "${tableName}" (id, document_id, content, embedding, metadata_json) VALUES (?, ?, ?, ?, ?)`
    );
    // FTS5 虚拟表插入：rowid 必须对应主表的 rowid
    const insertFts = this.db!.prepare(
      `INSERT INTO "${ftsTableName}" (rowid, content) VALUES (?, ?)`
    );
    const deleteFts = this.db!.prepare(
      `DELETE FROM "${ftsTableName}" WHERE rowid = ?`
    );

    const transaction = this.db!.transaction((docs) => {
      for (const doc of docs) {
        // 1. 如果已存在，先删除旧的 FTS 记录
        const existing = this.db!.prepare(`SELECT rowid FROM "${tableName}" WHERE id = ?`).get(doc.id);
        if (existing) {
          deleteFts.run((existing as any).rowid);
        }

        // 2. 插入或更新主表
        const embeddingBuffer = Buffer.from(new Float32Array(doc.embedding).buffer);
        const metadataJson = JSON.stringify(doc.metadata || {});
        const docId = doc.documentId || ''; // 使用顶层字段
        
        insertMain.run(doc.id, docId, doc.content, embeddingBuffer, metadataJson);
        
        // 3. 获取最新的 rowid 并插入 FTS
        const newRowid = this.db!.prepare(`SELECT last_insert_rowid() as rid`).get() as any;
        const ftsContent = this.tokenizeForSearch(doc.content);
        insertFts.run(newRowid.rid, ftsContent);
      }
    });

    transaction(documents);
    this.logger.log(`添加 ${documents.length} 个文档到集合 ${collectionName}`);
    return documents.map(d => d.id);
  }

  /**
   * 删除文档
   */
  async deleteDocuments(
    collectionName: string,
    options?: { ids?: string[]; documentId?: string },
  ): Promise<number> {
    await this.ensureInitialized();
    if (!options || (!options.ids && !options.documentId)) {
      throw new Error('必须提供 ids 或 documentId 至少一个参数');
    }

    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;
    let condition = '';
    const params: any[] = [];

    if (options.ids && options.ids.length > 0) {
      condition = `id IN (${options.ids.map(() => '?').join(',')})`;
      params.push(...options.ids);
    } else if (options.documentId) {
      condition = `document_id = ?`;
      params.push(options.documentId);
    } else {
      return 0;
    }

    // 先获取要删除的行 ID 以同步删除 FTS
    const rows = this.db!.prepare(`SELECT rowid FROM "${tableName}" WHERE ${condition}`).all(...params);
    if (rows.length === 0) return 0;

    const rowIds = rows.map((r: any) => r.rowid);
    
    const transaction = this.db!.transaction(() => {
      this.db!.prepare(`DELETE FROM "${tableName}" WHERE ${condition}`).run(...params);
      this.db!.prepare(`DELETE FROM "${ftsTableName}" WHERE rowid IN (${rowIds.map(() => '?').join(',')})`).run(...rowIds);
    });

    transaction();
    this.logger.log(`从集合 ${collectionName} 删除 ${rows.length} 个文档`);
    return rows.length;
  }

  /**
   * 语义搜索
   */
  async semanticSearch(
    collectionName: string,
    queryEmbedding: number[],
    topK: number = 5,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const queryVector = Buffer.from(new Float32Array(queryEmbedding).buffer);

    let sql = `
      SELECT id, content, metadata_json, 
             vec_distance_cosine(embedding, ?) as distance
      FROM "${tableName}"
    `;
    const params: any[] = [queryVector];

    if (filterOptions?.documentId) {
      sql += ` WHERE document_id = ?`;
      params.push(filterOptions.documentId);
    }

    sql += ` ORDER BY distance ASC LIMIT ?`;
    params.push(topK);

    const rows = this.db!.prepare(sql).all(...params);
    return rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata_json || '{}'),
      score: 1 - row.distance,
      semanticScore: 1 - row.distance,
    }));
  }

  /**
   * 关键词搜索 (FTS5)
   */
  async keywordSearch(
    collectionName: string,
    queryText: string,
    topK: number = 5,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;
    
    // 对查询文本进行分词和转义处理
    const processedQuery = this.escapeFtsQuery(queryText);
    this.logger.debug(`FTS 查询词：'${queryText}' -> '${processedQuery}'`);

    // FTS5 查询
    // 注意：FTS5 在 JOIN 时对别名支持有限，建议在 MATCH 和 bm25 中直接使用原始表名
    let sql = `
      SELECT main.id, main.content, main.metadata_json, bm25("${ftsTableName}") as score
      FROM "${ftsTableName}"
      JOIN "${tableName}" AS main ON "${ftsTableName}".rowid = main.rowid
      WHERE "${ftsTableName}" MATCH ?
    `;
    const params: any[] = [processedQuery];

    if (filterOptions?.documentId) {
      sql += ` AND main.document_id = ?`;
      params.push(filterOptions.documentId);
    }

    sql += ` ORDER BY score DESC LIMIT ?`;
    params.push(topK);

    try {
      const rows = this.db!.prepare(sql).all(...params) as any[];
      this.logger.debug(`FTS 原始查询结果数量: ${rows.length}`);
      if (rows.length > 0) {
        this.logger.debug(`FTS 第一条结果 ID: ${rows[0].id}, Score: ${rows[0].score}`);
      }
      return rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        metadata: JSON.parse(row.metadata_json || '{}'),
        score: Math.abs(row.score || 0), // bm25 返回负值，取绝对值
        bm25Score: Math.abs(row.score || 0),
      }));
    } catch (error: any) {
      this.logger.warn(`FTS 搜索失败：${error.message}`);
      return [];
    }
  }

  /**
   * 混合搜索
   */
  async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    topK: number = 5,
    semanticWeight: number = 0.6,
    keywordWeight: number = 0.4,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]> {
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(collectionName, queryEmbedding, topK * 2, filterOptions),
      this.keywordSearch(collectionName, queryText, topK * 2, filterOptions),
    ]);

    return this.fuseAndRerank(semanticResults, keywordResults, semanticWeight, keywordWeight, topK);
  }

  /**
   * 获取统计信息
   */
  async getCollectionStats(collectionName: string): Promise<CollectionStats> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const row = this.db!.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get();
    return { total_count: (row as any).count };
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.jieba = null;
      this.logger.log('SQLite 向量数据库连接已关闭');
    }
  }

  // ==================== 私有辅助方法 ====================

  private async ensureInitialized(): Promise<void> {
    if (!this.db) await this.initialize();
  }

  private sanitizeTableName(name: string): string {
    // 简单的安全处理，防止 SQL 注入
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private hasChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  private tokenizeForSearch(text: string): string {
    if (!this.hasChinese(text)) return text;
    if (!this.jieba) return text;
    try {
      return this.jieba.cut(text, true).join(' ');
    } catch {
      return text;
    }
  }

  /**
   * 转义 FTS5 查询字符串
   */
  private escapeFtsQuery(text: string): string {
    // 1. 先进行分词（如果是中文）
    let tokens = this.hasChinese(text) && this.jieba 
      ? this.jieba.cut(text, true) 
      : [text];

    // 2. 对每个 token 进行转义处理
    const escapedTokens = tokens.map(token => {
      token = token.trim();
      if (!token) return '';

      // 如果包含连字符，拆分为多个词并分别加引号
      if (/-/.test(token)) {
        const parts = token.split('-').filter(p => p);
        return parts.map(p => `"${p.replace(/"/g, '""')}"`).join(' ');
      }
      
      // 如果是纯英文/数字词，添加通配符 * 以支持前缀匹配
      // 例如：搜索 DV430FBM 可以匹配到 DV430FBM-N20
      if (/^[a-zA-Z0-9]+$/.test(token)) {
        return `"${token}"*`;
      }

      // 其他情况用双引号包裹
      return `"${token.replace(/"/g, '""')}"`;
    }).filter(t => t);

    return escapedTokens.join(' ');
  }

  private fuseAndRerank(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
    topK: number,
  ): SearchResult[] {
    const docMap = new Map<string, SearchResult>();
    
    // 1. 先放入所有语义搜索结果
    semanticResults.forEach(r => {
      docMap.set(r.id, { 
        ...r, 
        semanticScore: r.semanticScore || 0, 
        bm25Score: 0 // 初始化为 0
      });
    });

    // 2. 合并关键词搜索结果
    keywordResults.forEach(r => {
      if (docMap.has(r.id)) {
        // 如果语义搜索也搜到了这个 ID，更新其 bm25Score
        const existing = docMap.get(r.id)!;
        existing.bm25Score = Math.abs(r.bm25Score || 0);
      } else {
        // 如果语义搜索没搜到，但关键词搜到了，也加入地图
        docMap.set(r.id, { 
          ...r, 
          semanticScore: 0, 
          bm25Score: Math.abs(r.bm25Score || 0) 
        });
      }
    });

    // 3. 计算归一化所需的最大最小值
    const allSemScores = Array.from(docMap.values()).map(d => d.semanticScore || 0);
    const allBm25Scores = Array.from(docMap.values()).map(d => d.bm25Score || 0);

    const sMin = Math.min(...allSemScores, 0);
    const sMax = Math.max(...allSemScores, 1);
    const kMin = Math.min(...allBm25Scores, 0);
    const kMax = Math.max(...allBm25Scores, 1);

    // 4. 计算最终融合分数
    const fused = Array.from(docMap.values()).map(doc => {
      const sNorm = sMax !== sMin ? (doc.semanticScore - sMin) / (sMax - sMin) : 0;
      const kNorm = kMax !== kMin ? (doc.bm25Score - kMin) / (kMax - kMin) : 0;
      
      const finalScore = semanticWeight * sNorm + keywordWeight * kNorm;
      return { 
        ...doc, 
        score: finalScore, 
        semanticScore: doc.semanticScore, 
        bm25Score: doc.bm25Score 
      };
    });

    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, topK);
  }
}
