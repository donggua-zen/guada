import { Injectable, Logger } from "@nestjs/common";
import { KbDatabaseService } from "./kb-database.service";
import { cutChinese, hasChinese, tokenizeQuery } from "./kb-tokenizer";

/**
 * 搜索结果（形状与原 VectorDatabase 的 SearchResult 一致，调用方零改动）
 */
export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  score: number;
  bm25Score?: number;
  semanticScore?: number;
}

/**
 * 知识库检索服务（每库 SQLite 版）
 *
 * 查询口径、融合算法**逐行搬运自原 SQLite 向量库实现**（sqlite-vector-db.ts），
 * 不做算法改动——仓库根有 test/knowledge-base/fixtures/kb-search-golden.json
 * 作为回归基线（同一语料 + 同一查询必须复现同样的 id/分数）。
 *
 * SQL 侧与原实现的两点差异：
 * 1. 表从全局库的 `kb_<kbId>` 变成库内的 `chunk`（库即作用域，无需表名前缀）
 * 2. 向量存在 `chunk.embedding`，缺向量的行（重新嵌入前）在语义召回里被排除
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger(KbSearchService.name);

  constructor(private readonly databases: KbDatabaseService) {}

  // ============ 语义搜索 ============

  async semanticSearch(
    kbId: string,
    queryEmbedding: number[],
    topK: number = 5,
    filterOptions?: { itemId?: string },
  ): Promise<SearchResult[]> {
    if (!queryEmbedding || queryEmbedding.length === 0) return [];
    const db = await this.databases.getDb(kbId);
    const queryVector = Buffer.from(new Float32Array(queryEmbedding).buffer);

    let sql = `
      SELECT id, item_id, content, metadata_json,
             vec_distance_cosine(embedding, ?) as distance
      FROM chunk
      WHERE embedding IS NOT NULL
    `;
    const params: any[] = [queryVector];
    if (filterOptions?.itemId) {
      sql += ` AND item_id = ?`;
      params.push(filterOptions.itemId);
    }
    sql += ` ORDER BY distance ASC LIMIT ?`;
    params.push(topK);

    const rows = db.prepare(sql).all(...params) as any[];
    const items = await this.loadItems(kbId, db, rows);
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: this.mergeMetadata(row, items),
      score: 1 - row.distance,
      semanticScore: 1 - row.distance,
    }));
  }

  // ============ 关键词搜索（FTS5） ============

  async keywordSearch(
    kbId: string,
    queryText: string,
    topK: number = 5,
    filterOptions?: { itemId?: string },
  ): Promise<SearchResult[]> {
    if (!queryText || !queryText.trim()) {
      this.logger.debug("关键词搜索：查询文本为空，返回空结果");
      return [];
    }

    const processedQuery = this.escapeFtsQuery(queryText);
    if (!processedQuery.trim()) {
      this.logger.debug("FTS 查询处理后为空，返回空结果");
      return [];
    }

    const db = await this.databases.getDb(kbId);
    // bm25() 返回负值：值越小越相关，故 ORDER BY score ASC
    let sql = `
      SELECT main.id, main.item_id, main.content, main.metadata_json,
             bm25(chunk_fts) as score
      FROM chunk_fts
      JOIN chunk AS main ON chunk_fts.rowid = main.rowid
      WHERE chunk_fts MATCH ?
    `;
    const params: any[] = [processedQuery];
    if (filterOptions?.itemId) {
      sql += ` AND main.item_id = ?`;
      params.push(filterOptions.itemId);
    }
    sql += ` ORDER BY score ASC LIMIT ?`;
    params.push(topK);

    try {
      const rows = db.prepare(sql).all(...params) as any[];
      this.logger.debug(`FTS 原始查询结果数量: ${rows.length}`);
      const items = await this.loadItems(kbId, db, rows);
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        metadata: this.mergeMetadata(row, items),
        // 取绝对值以便后续融合时语义直观（正值越高越相关）
        score: Math.abs(row.score || 0),
        bm25Score: Math.abs(row.score || 0),
      }));
    } catch (error: any) {
      this.logger.warn(`FTS 搜索失败：${error.message}`);
      return [];
    }
  }

  // ============ 混合搜索 ============

  /**
   * 融合策略（与原实现一致）：
   * - 扩大召回：两个搜索引擎都召回 top_k * 4
   * - RRF（Reciprocal Rank Fusion）：只依赖排序位置，不受绝对分数影响
   * - 动态权重：检测 BM25 失效时自动降权
   */
  async hybridSearch(
    kbId: string,
    queryEmbedding: number[],
    queryText: string,
    topK: number = 5,
    semanticWeight: number = 0.6,
    keywordWeight: number = 0.4,
    filterOptions?: { itemId?: string },
    enableBM25Rerank: boolean = true,
  ): Promise<SearchResult[]> {
    const semanticResults = await this.semanticSearch(
      kbId,
      queryEmbedding,
      topK * 4,
      filterOptions,
    );
    let keywordResultsRaw = await this.keywordSearch(
      kbId,
      queryText,
      topK * 4,
      filterOptions,
    );

    if (enableBM25Rerank) {
      keywordResultsRaw = this.rerankWithBM25(keywordResultsRaw, queryText);
    }

    const adjusted = this.adjustWeights(
      semanticResults,
      keywordResultsRaw,
      semanticWeight,
      keywordWeight,
    );

    return this.fuseWithRRF(
      semanticResults,
      keywordResultsRaw,
      adjusted.semantic,
      adjusted.keyword,
      topK,
    );
  }

  // ============ 元信息补齐 ============

  /**
   * 批量取结果涉及的条目元信息（一次 IN 查询，不是逐行查）。
   *
   * 旧实现把 fileName 在处理时快照进向量 metadata，改名后结果里就是陈旧名字；
   * 这里改读 item 表的当前 display_name。
   */
  private async loadItems(
    kbId: string,
    db: any,
    rows: Array<{ item_id: string }>,
  ): Promise<Map<string, any>> {
    const ids = [...new Set(rows.map((r) => r.item_id).filter(Boolean))];
    const map = new Map<string, any>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => "?").join(",");
    const items = db
      .prepare(
        `SELECT id, display_name, file_extension, file_type, relative_path
           FROM item WHERE id IN (${placeholders})`,
      )
      .all(...ids) as any[];
    for (const item of items) {
      map.set(item.id, {
        fileName: item.display_name,
        fileExtension: item.file_extension,
        fileType: item.file_type,
        relativePath: item.relative_path,
      });
    }
    return map;
  }

  /** 处理时快照的 metadata + 条目的当前元信息（当前值优先） */
  private mergeMetadata(
    row: any,
    items: Map<string, any>,
  ): Record<string, any> {
    let meta: Record<string, any> = {};
    try {
      meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
    } catch {
      meta = {};
    }
    return { ...meta, ...(items.get(row.item_id) ?? {}) };
  }

  // ============ 私有：分词与查询构造 ============

  /**
   * 转义 FTS5 查询串（与写入侧共用 kb-tokenizer 的分词口径）。
   *
   * 用 OR 连接所有 token 以提高召回率；连字符词同时保留原词与拆分后的子词。
   */
  private escapeFtsQuery(text: string): string {
    const tokens = tokenizeQuery(text);
    const escaped = tokens
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .filter((t) => t !== '""');
    this.logger.debug(`FTS 查询词：'${text}' -> '${escaped.join(" OR ")}'`);
    return escaped.join(" OR ");
  }

  // ============ 私有：BM25 重排（逐行搬运） ============

  /**
   * BM25 语料/查询分词。
   *
   * ⚠️ 与 `escapeFtsQuery` 用的 tokenizeQuery **刻意不同**：这里不 trim、不过滤空串。
   * jieba 会吐出空格等标点 token，它们同样计入文档长度（docLen 影响 BM25 分母），
   * 过滤掉会让分数与旧实现不一致（黄金基线会失败）。原实现就是两套分词并存，
   * 搬运时保持原样，不要"顺手统一"。
   */
  private tokenizeForBm25(text: string): string[] {
    const rawTokens = hasChinese(text)
      ? cutChinese(text)
      : text.split(/\s+/).filter((t) => t);
    const tokens: string[] = [];
    for (const token of rawTokens) {
      if (/-/.test(token)) {
        tokens.push(token.toLowerCase());
        for (const part of token.split("-").filter((p) => p)) {
          tokens.push(part.toLowerCase());
        }
      } else {
        tokens.push(token.toLowerCase());
      }
    }
    return tokens;
  }

  private rerankWithBM25(
    results: SearchResult[],
    queryText: string,
  ): SearchResult[] {
    if (results.length === 0) return [];
    try {
      const corpus = results.map((r) => this.tokenizeForBm25(r.content));
      const queryTokens = this.tokenizeForBm25(queryText);
      if (queryTokens.length === 0) return results;

      const k1 = 1.5;
      const b = 0.75;
      const N = corpus.length;
      const avgDocLen =
        corpus.reduce((sum, doc) => sum + doc.length, 0) / N;

      const dfMap = new Map<string, number>();
      for (const token of queryTokens) {
        if (dfMap.has(token)) continue;
        let count = 0;
        for (const doc of corpus) if (doc.includes(token)) count++;
        dfMap.set(token, count);
      }

      const scores = corpus.map((doc) => {
        const docLen = doc.length;
        let score = 0;
        for (const token of queryTokens) {
          const df = dfMap.get(token) || 0;
          if (df === 0) continue;
          // IDF 平滑：df 超过半数文档时标准公式为负，改用 ln((N+1)/(df+0.5))
          const idf =
            df > N / 2
              ? Math.log((N + 1) / (df + 0.5))
              : Math.log((N - df + 0.5) / (df + 0.5));
          let tf = 0;
          for (const t of doc) if (t === token) tf++;
          const numerator = tf * (k1 + 1);
          const denominator =
            tf + k1 * (1 - b + (b * docLen) / avgDocLen);
          score += idf * (numerator / denominator);
        }
        return score;
      });

      const reranked = results.map((result, index) => ({
        ...result,
        bm25Score: scores[index] || 0,
        score: scores[index] || 0,
      }));
      reranked.sort((a, b) => b.bm25Score! - a.bm25Score!);
      return reranked;
    } catch (error: any) {
      this.logger.warn(`BM25 重排失败：${error.message}，使用原始 FTS5 分数`);
      return results;
    }
  }

  // ============ 私有：动态权重（逐行搬运） ============

  private adjustWeights(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
  ): { semantic: number; keyword: number } {
    if (keywordResults.length < 2) {
      return { semantic: semanticWeight, keyword: keywordWeight };
    }
    const scores = keywordResults.map((r) =>
      Math.abs(r.bm25Score || r.score || 0),
    );
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance =
      scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0;
    const isBm25Ineffective = cv < 0.1 || mean < 0.001;

    if (isBm25Ineffective) {
      const newKeyword = Math.max(0.1, keywordWeight / 3);
      return { semantic: 1 - newKeyword, keyword: newKeyword };
    }
    return { semantic: semanticWeight, keyword: keywordWeight };
  }

  // ============ 私有：RRF 融合（逐行搬运 + 排名表优化） ============

  private fuseWithRRF(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[],
    semanticWeight: number,
    keywordWeight: number,
    topK: number,
  ): SearchResult[] {
    const K = 60;

    const docMap = new Map<string, any>();
    semanticResults.forEach((res) => {
      docMap.set(res.id, {
        ...res,
        semanticScore: res.semanticScore || res.score || 0,
        bm25Score: 0,
      });
    });
    keywordResults.forEach((res) => {
      const existing = docMap.get(res.id);
      if (existing) {
        existing.bm25Score = Math.abs(res.bm25Score || res.score || 0);
      } else {
        docMap.set(res.id, {
          ...res,
          semanticScore: 0,
          bm25Score: Math.abs(res.bm25Score || res.score || 0),
        });
      }
    });
    if (docMap.size === 0) return [];

    // 排名表（原实现对每个文档做两次 findIndex，是 O(n²)；结果集大小不变，只换实现）
    const semanticRank = new Map<string, number>();
    [...semanticResults]
      .sort((a, b) => b.score - a.score)
      .forEach((r, i) => semanticRank.set(r.id, i));
    const keywordRank = new Map<string, number>();
    [...keywordResults]
      .sort((a, b) => b.bm25Score! - a.bm25Score!)
      .forEach((r, i) => keywordRank.set(r.id, i));

    const fused: any[] = [];
    for (const doc of docMap.values()) {
      const semRank = semanticRank.get(doc.id);
      const kwRank = keywordRank.get(doc.id);
      const semRRF = semRank !== undefined ? 1 / (K + semRank + 1) : 0;
      const kwRRF = kwRank !== undefined ? 1 / (K + kwRank + 1) : 0;
      doc.rrfScore = semanticWeight * semRRF + keywordWeight * kwRRF;
      fused.push(doc);
    }
    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    const rrfScores = fused.map((d) => d.rrfScore);
    const rrfMin = rrfScores.length > 0 ? Math.min(...rrfScores) : 0;
    const rrfMax = rrfScores.length > 0 ? Math.max(...rrfScores) : 1;
    const rrfRange = rrfMax - rrfMin;

    return fused.slice(0, topK).map((doc) => ({
      ...doc,
      score: rrfRange > 0 ? (doc.rrfScore - rrfMin) / rrfRange : 0.5,
    }));
  }
}
