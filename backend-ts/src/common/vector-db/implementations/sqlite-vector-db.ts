/**
 * SQLite 向量数据库实现（基于 better-sqlite3 + sqlite-vec）
 *
 * 特性：
 * - 独立存储：使用独立的 vector_db.sqlite 文件，避免与主业务库锁竞争。
 * - 向量搜索：集成 sqlite-vec 扩展，支持高效的向量相似度计算。
 * - 关键词搜索：利用 SQLite FTS5 虚拟表实现全文检索。
 * - 混合搜索：语义与关键词加权融合。
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { Jieba } from "@node-rs/jieba";
import {
  VectorDatabase,
  SearchResult,
  VectorDocument,
  CollectionStats,
} from "../interfaces/vector-database.interface";

// 引入 sqlite-vec 扩展加载器
import sqliteVec from "sqlite-vec";

@Injectable()
export class SqliteVectorDB implements VectorDatabase {
  private readonly logger = new Logger(SqliteVectorDB.name);
  private db: Database.Database | null = null;
  private jieba: Jieba | null = null;
  private persistPath: string;

  constructor(private configService: ConfigService) {
    // 从环境变量读取向量数据库路径，默认值为 data/vector_db.sqlite
    const vectorDbPath =
      this.configService.get<string>("VECTOR_DB_PATH") ||
      path.join(process.cwd(), "data", "vector_db.sqlite");

    // 如果是相对路径，转换为绝对路径
    this.persistPath = path.isAbsolute(vectorDbPath)
      ? vectorDbPath
      : path.join(process.cwd(), vectorDbPath);

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
      this.logger.log("sqlite-vec 扩展加载成功");

      // 初始化中文分词器
      try {
        this.jieba = new Jieba();
        this.logger.log("中文分词器初始化成功");
      } catch (error: any) {
        this.logger.warn(`中文分词器初始化失败：${error.message}`);
      }

      // 启用 WAL 模式以提高并发性能
      this.db.pragma("journal_mode = WAL");
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
    const exists = this.db!.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(tableName);
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
    const row = this.db!.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(tableName);
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
      await this.createCollection(
        collectionName,
        documents[0].embedding.length,
      );
    }

    const insertMain = this.db!.prepare(
      `INSERT OR REPLACE INTO "${tableName}" (id, document_id, content, embedding, metadata_json) VALUES (?, ?, ?, ?, ?)`,
    );
    // FTS5 虚拟表插入：rowid 必须对应主表的 rowid
    const insertFts = this.db!.prepare(
      `INSERT INTO "${ftsTableName}" (rowid, content) VALUES (?, ?)`,
    );
    const deleteFts = this.db!.prepare(
      `DELETE FROM "${ftsTableName}" WHERE rowid = ?`,
    );
    // 获取指定记录的 rowid
    const getRowid = this.db!.prepare(
      `SELECT rowid FROM "${tableName}" WHERE id = ?`,
    );

    const transaction = this.db!.transaction((docs) => {
      for (const doc of docs) {
        // 1. 如果已存在，先删除旧的 FTS 记录
        const existing = getRowid.get(doc.id) as { rowid: number } | undefined;
        if (existing) {
          deleteFts.run(existing.rowid);
        }

        // 2. 插入或更新主表
        const embeddingBuffer = Buffer.from(
          new Float32Array(doc.embedding).buffer,
        );
        const metadataJson = JSON.stringify(doc.metadata || {});
        const docId = doc.documentId || ""; // 使用顶层字段

        insertMain.run(
          doc.id,
          docId,
          doc.content,
          embeddingBuffer,
          metadataJson,
        );

        // 3. 重新查询 rowid（INSERT OR REPLACE 可能改变 rowid）
        const currentRow = getRowid.get(doc.id) as
          | { rowid: number }
          | undefined;
        const ftsContent = this.tokenizeForSearch(doc.content);
        if (currentRow) {
          insertFts.run(currentRow.rowid, ftsContent);
        }
      }
    });

    transaction(documents);
    this.logger.log(`添加 ${documents.length} 个文档到集合 ${collectionName}`);
    return documents.map((d) => d.id);
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
      throw new Error("必须提供 ids 或 documentId 至少一个参数");
    }

    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;
    let condition = "";
    const params: any[] = [];

    if (options.ids && options.ids.length > 0) {
      condition = `id IN (${options.ids.map(() => "?").join(",")})`;
      params.push(...options.ids);
    } else if (options.documentId) {
      condition = `document_id = ?`;
      params.push(options.documentId);
    } else {
      return 0;
    }

    // 先获取要删除的行 ID 以同步删除 FTS
    const rows = this.db!.prepare(
      `SELECT rowid FROM "${tableName}" WHERE ${condition}`,
    ).all(...params);
    if (rows.length === 0) return 0;

    const rowIds = rows.map((r: any) => r.rowid);

    const transaction = this.db!.transaction(() => {
      this.db!.prepare(`DELETE FROM "${tableName}" WHERE ${condition}`).run(
        ...params,
      );
      this.db!.prepare(
        `DELETE FROM "${ftsTableName}" WHERE rowid IN (${rowIds.map(() => "?").join(",")})`,
      ).run(...rowIds);
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
      metadata: JSON.parse(row.metadata_json || "{}"),
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

    // 防御：空查询直接返回
    if (!queryText || !queryText.trim()) {
      this.logger.debug("关键词搜索：查询文本为空，返回空结果");
      return [];
    }

    const tableName = this.sanitizeTableName(collectionName);
    const ftsTableName = `${tableName}_fts`;

    // 对查询文本进行分词和转义处理
    const processedQuery = this.escapeFtsQuery(queryText);
    if (!processedQuery.trim()) {
      this.logger.debug("FTS 查询处理后为空，返回空结果");
      return [];
    }
    this.logger.debug(`FTS 查询词：'${queryText}' -> '${processedQuery}'`);

    // FTS5 查询
    // FTS5 bm25() 返回负值，less negative = more relevant
    // 使用 ORDER BY score ASC 排序（负值从大到小 = 从相关到不相关）
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

    sql += ` ORDER BY score ASC LIMIT ?`;
    params.push(topK);

    try {
      const rows = this.db!.prepare(sql).all(...params) as any[];
      this.logger.debug(`FTS 原始查询结果数量: ${rows.length}`);
      if (rows.length > 0) {
        this.logger.debug(
          `FTS 第一条结果 ID: ${rows[0].id}, Score: ${rows[0].score}`,
        );
      }
      return rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        metadata: JSON.parse(row.metadata_json || "{}"),
        // 取绝对值以便后续融合时语义直观（正值越高越相关）
        score: Math.abs(row.score || 0),
        bm25Score: Math.abs(row.score || 0),
      }));
    } catch (error: any) {
      this.logger.warn(`FTS 搜索失败：${error.message}`);
      return [];
    }
  }

  /**
   * 混合搜索
   *
   * 融合策略：
   * - 扩大召回：两个搜索引擎都召回 top_k * 4 个结果
   * - RRF（Reciprocal Rank Fusion）：只依赖排序位置，不受绝对分数大小影响
   * - 动态权重：检测 BM25 失效时自动降权
   *
   * @param collectionName 集合名称
   * @param queryEmbedding 查询向量
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param semanticWeight 语义权重 (0-1)，默认 0.6
   * @param keywordWeight 关键词权重 (0-1)，默认 0.4
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @param enableBM25Rerank 是否启用 BM25 重排，默认 true
   * @returns 搜索结果列表（按最终分数降序）
   */
  async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    topK: number = 5,
    semanticWeight: number = 0.6,
    keywordWeight: number = 0.4,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
    enableBM25Rerank: boolean = true,
  ): Promise<SearchResult[]> {
    // Step 1: 语义搜索（扩大召回）
    const semanticResults = await this.semanticSearch(
      collectionName,
      queryEmbedding,
      topK * 4,
      filterOptions,
    );

    // Step 2: 关键词搜索（扩大召回）
    let keywordResultsRaw = await this.keywordSearch(
      collectionName,
      queryText,
      topK * 4,
      filterOptions,
    );

    // Step 2.5: BM25 重排（可选）
    if (enableBM25Rerank) {
      keywordResultsRaw = await this.rerankWithBM25(
        keywordResultsRaw,
        queryText,
      );
      this.logger.debug(`BM25 重排完成：${keywordResultsRaw.length} 个结果`);
    }

    // Step 2.6: 动态权重调整
    const adjustedWeights = this.adjustWeights(
      semanticResults,
      keywordResultsRaw,
      semanticWeight,
      keywordWeight,
    );
    semanticWeight = adjustedWeights.semantic;
    keywordWeight = adjustedWeights.keyword;

    this.logger.debug(
      `混合搜索召回：语义=${semanticResults.length}, 关键词=${keywordResultsRaw.length}, 权重=${semanticWeight.toFixed(1)}/${keywordWeight.toFixed(1)}`,
    );

    // Step 3: RRF 融合与重排序
    return this.fuseWithRRF(
      semanticResults,
      keywordResultsRaw,
      semanticWeight,
      keywordWeight,
      topK,
    );
  }

  /**
   * 获取统计信息
   */
  async getCollectionStats(collectionName: string): Promise<CollectionStats> {
    await this.ensureInitialized();
    const tableName = this.sanitizeTableName(collectionName);
    const row = this.db!.prepare(
      `SELECT COUNT(*) as count FROM "${tableName}"`,
    ).get();
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
      this.logger.log("SQLite 向量数据库连接已关闭");
    }
  }

  // ==================== 私有辅助方法 ====================

  private async ensureInitialized(): Promise<void> {
    if (!this.db) await this.initialize();
  }

  private sanitizeTableName(name: string): string {
    // 简单的安全处理，防止 SQL 注入
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private hasChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  private tokenizeForSearch(text: string): string {
    if (!this.hasChinese(text)) return text;
    if (!this.jieba) return text;
    try {
      return this.jieba.cut(text, true).join(" ");
    } catch {
      return text;
    }
  }

  /**
   * 转义 FTS5 查询字符串
   */
  private escapeFtsQuery(text: string): string {
    // 1. 统一分词逻辑（与存储时保持一致）
    let tokens =
      this.hasChinese(text) && this.jieba
        ? this.jieba.cut(text, true)
        : text.split(/\s+/).filter((t) => t); // 英文按空格分词

    // 2. 对每个 token 进行转义处理
    const escapedTokens = tokens
      .map((token) => {
        token = token.trim();
        if (!token) return "";

        // 如果包含连字符，同时保留原始精确匹配 + 拆分匹配
        // 例如：DV430FBM-N20 -> "DV430FBM-N20" OR "DV430FBM" OR "N20"
        if (/-/.test(token)) {
          const parts = token.split("-").filter((p) => p);
          const escapedParts = parts.map((p) => `"${p.replace(/"/g, '""')}"`);
          const originalEscaped = `"${token.replace(/"/g, '""')}"`;
          return [originalEscaped, ...escapedParts].join(" OR ");
        }

        // 纯英文/数字词使用精确匹配（移除通配符以提高准确性）
        if (/^[a-zA-Z0-9]+$/.test(token)) {
          return `"${token}"`;
        }

        // 其他情况用双引号包裹
        return `"${token.replace(/"/g, '""')}"`;
      })
      .filter((t) => t);

    // 使用 OR 连接所有 token，提高召回率
    return escapedTokens.join(" OR ");
  }

  /**
   * BM25 重排（使用 Okapi BM25 算法）
   *
   * 使用标准的 Okapi BM25 公式重新计算分数，确保排序准确性
   *
   * @param results FTS5 召回的结果
   * @param queryText 查询文本
   * @returns 重排后的结果（按 BM25 分数降序）
   */
  private async rerankWithBM25(
    results: SearchResult[],
    queryText: string,
  ): Promise<SearchResult[]> {
    if (results.length === 0) {
      return [];
    }

    try {
      // 1. 统一分词逻辑：必须与存储到 FTS5 时的 tokenizeForSearch 一致
      // 关键：对含连字符的词做拆分（与 escapeFtsQuery 保持一致）
      const tokenize = (text: string): string[] => {
        const rawTokens =
          this.hasChinese(text) && this.jieba
            ? this.jieba.cut(text, true)
            : text.split(/\s+/).filter((t) => t);

        const tokens: string[] = [];
        for (const token of rawTokens) {
          if (/-/.test(token)) {
            // 连字符拆分为子词 + 原始词
            tokens.push(token.toLowerCase());
            const parts = token.split("-").filter((p) => p);
            for (const part of parts) {
              tokens.push(part.toLowerCase());
            }
          } else {
            tokens.push(token.toLowerCase());
          }
        }
        return tokens;
      };

      // 2. 构建语料库
      const corpus = results.map((r) => tokenize(r.content));
      const queryTokens = tokenize(queryText);

      if (queryTokens.length === 0) {
        this.logger.debug("BM25 重排：查询分词为空，保留原始排序");
        return results;
      }

      // 3. 使用 Okapi BM25 算法计算分数（带 IDF 平滑）
      const k1 = 1.5;
      const b = 0.75;
      const N = corpus.length;
      const avgDocLen = corpus.reduce((sum, doc) => sum + doc.length, 0) / N;

      // 计算每个词的 DF（文档频率）
      const dfMap = new Map<string, number>();
      for (const token of queryTokens) {
        if (dfMap.has(token)) continue;
        let count = 0;
        for (const doc of corpus) {
          if (doc.includes(token)) count++;
        }
        dfMap.set(token, count);
      }

      // 计算每个文档的 BM25 分数
      const scores = corpus.map((doc, docIdx) => {
        const docLen = doc.length;
        let score = 0;
        for (const token of queryTokens) {
          const df = dfMap.get(token) || 0;
          if (df === 0) continue;

          // IDF 平滑：当 df > N/2 时（术语出现在超过一半文档中），
          // 标准 BM25 的 IDF = ln((N-df+0.5)/(df+0.5)) 会为负值
          // 改用平滑公式 ln((N+1)/(df+0.5))，始终为正但随 df 增大递减
          let idf: number;
          if (df > N / 2) {
            idf = Math.log((N + 1) / (df + 0.5));
          } else {
            idf = Math.log((N - df + 0.5) / (df + 0.5));
          }

          // TF = 词在当前文档中的出现次数
          let tf = 0;
          for (const t of doc) {
            if (t === token) tf++;
          }

          // BM25 项得分 = IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen))
          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + (b * docLen) / avgDocLen);
          score += idf * (numerator / denominator);
        }
        return score;
      });

      // 4. 更新分数并排序
      const reranked = results.map((result, index) => ({
        ...result,
        bm25Score: scores[index] || 0,
        score: scores[index] || 0,
      }));

      reranked.sort((a, b) => b.bm25Score - a.bm25Score);

      this.logger.debug(
        `BM25 重排：Top-1 分数=${reranked[0]?.bm25Score?.toFixed(4)}, Top-3 分数=[${reranked
          .slice(0, 3)
          .map((r) => r.bm25Score?.toFixed(4))
          .join(", ")}]`,
      );

      return reranked;
    } catch (error: any) {
      this.logger.warn(`BM25 重排失败：${error.message}，使用原始 FTS5 分数`);
      return results;
    }
  }

  /**
   * 动态权重调整
   *
   * 当 BM25 分数分布极窄（所有文档都包含查询词，IDF 趋近 0）时，
   * 自动降低 keywordWeight，让语义搜索主导排序。
   */
  private adjustWeights(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
  ): { semantic: number; keyword: number } {
    if (keywordResults.length < 2) {
      return { semantic: semanticWeight, keyword: keywordWeight };
    }

    // 计算 BM25 分数的变异系数（标准差 / 均值）
    const scores = keywordResults.map((r) =>
      Math.abs(r.bm25Score || r.score || 0),
    );
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance =
      scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // 变异系数 < 0.1 说明分数差异极小，BM25 无法区分文档
    // 或者绝对均值 < 0.001 说明 IDF 接近 0
    const cv = mean > 0 ? stdDev / mean : 0;
    const isBm25Ineffective = cv < 0.1 || mean < 0.001;

    if (isBm25Ineffective) {
      this.logger.debug(
        `BM25 判别力不足：cv=${cv.toFixed(4)}, mean=${mean.toFixed(6)}，自动降低关键词权重`,
      );
      // 将 keywordWeight 降至原来的 1/3，最低 0.1
      const newKeyword = Math.max(0.1, keywordWeight / 3);
      const newSemantic = 1 - newKeyword;
      return { semantic: newSemantic, keyword: newKeyword };
    }

    return { semantic: semanticWeight, keyword: keywordWeight };
  }

  /**
   * 结果融合与重排序（RRF - Reciprocal Rank Fusion）
   *
   * RRF 公式：RRF(d) = sum(1 / (k + rank(d)))
   * - k = 60（经验值，Cormack et al. 2009）
   * - 只依赖排序位置，不受绝对分数大小影响
   * - 天然适合"某搜索引擎无结果时只加 0"的场景
   */
  private fuseWithRRF(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
    topK: number,
  ): SearchResult[] {
    const K = 60; // RRF 常数

    // Step 1: 构建文档映射
    const docMap = new Map<string, any>();

    semanticResults.forEach((res) => {
      docMap.set(res.id, {
        ...res,
        semanticScore: res.semanticScore || res.score || 0,
        bm25Score: 0,
        rrfScore: 0,
      });
    });

    keywordResults.forEach((res) => {
      const docId = res.id;
      if (docMap.has(docId)) {
        const existing = docMap.get(docId);
        existing.bm25Score = Math.abs(res.bm25Score || res.score || 0);
      } else {
        docMap.set(docId, {
          ...res,
          semanticScore: 0,
          bm25Score: Math.abs(res.bm25Score || res.score || 0),
          rrfScore: 0,
        });
      }
    });

    if (docMap.size === 0) return [];

    // Step 2: 计算 RRF 分数（带权重）
    // 语义排名
    const semanticRanked = [...semanticResults].sort(
      (a, b) => b.score - a.score,
    );
    // 关键词排名（已按 BM25 分数排序）
    const keywordRanked = [...keywordResults].sort(
      (a, b) => b.bm25Score - a.bm25Score,
    );

    for (const doc of docMap.values()) {
      const semRank = semanticRanked.findIndex((r) => r.id === doc.id);
      const kwRank = keywordRanked.findIndex((r) => r.id === doc.id);

      const semRRF = semRank >= 0 ? 1 / (K + semRank + 1) : 0;
      const kwRRF = kwRank >= 0 ? 1 / (K + kwRank + 1) : 0;

      doc.rrfScore = semanticWeight * semRRF + keywordWeight * kwRRF;
    }

    // Step 3: 按 RRF 分数排序
    const fused = Array.from(docMap.values());
    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    this.logger.debug(
      `RRF 融合 Top-5：[${fused
        .slice(0, 5)
        .map(
          (f: any) =>
            `id=${f.id} rrf=${f.rrfScore.toFixed(6)} sem=${f.semanticScore?.toFixed(4)} bm25=${f.bm25Score?.toFixed(6)}`,
        )
        .join(", ")}]`,
    );

    // Step 4: 将 RRF 分数映射到 0~1 可读范围（保持相对顺序）
    const rrfScores = fused.map((d: any) => d.rrfScore);
    const rrfMin = rrfScores.length > 0 ? Math.min(...rrfScores) : 0;
    const rrfMax = rrfScores.length > 0 ? Math.max(...rrfScores) : 1;
    const rrfRange = rrfMax - rrfMin;

    return fused.slice(0, topK).map((doc: any) => {
      // Min-Max 归一化 RRF 到 [0, 1]
      let displayScore =
        rrfRange > 0 ? (doc.rrfScore - rrfMin) / rrfRange : 0.5;

      return {
        ...doc,
        score: displayScore,
      };
    });
  }
}
