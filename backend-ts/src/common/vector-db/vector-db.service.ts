/**
 * 向量数据库服务
 * 
 * 提供简化且规范化的向量数据库操作接口
 * 支持多种后端实现（LanceDB、Qdrant 等）
 */

import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  VectorDatabase,
  VectorChunk,
  SearchResult,
} from './interfaces/vector-database.interface';

@Injectable()
export class VectorDbService {
  private readonly logger = new Logger(VectorDbService.name);

  constructor(
    @Inject('VECTOR_DB') private readonly vectorDb: VectorDatabase,
  ) {}

  /**
   * 添加 chunks 到指定表
   * 
   * @param tableId 表 ID（集合名称）
   * @param chunks Chunk 列表（必须包含 documentId）
   * @param embeddings 对应的向量列表
   * @returns 添加的 chunk IDs
   */
  async addChunks(
    tableId: string,
    chunks: VectorChunk[],
    embeddings: number[][],
  ): Promise<string[]> {
    if (chunks.length === 0) {
      return [];
    }

    if (chunks.length !== embeddings.length) {
      throw new Error(
        `chunks 数量 (${chunks.length}) 与 embeddings 数量 (${embeddings.length}) 不匹配`,
      );
    }

    // 将 chunks 和 embeddings 组合为 VectorDocument
    const documents = chunks.map((chunk, index) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      embedding: embeddings[index],
      metadata: chunk.metadata || {},
    }));

    this.logger.log(`添加 ${documents.length} 个 chunks 到表 ${tableId}`);
    return await this.vectorDb.addDocuments(tableId, documents);
  }

  /**
   * 删除 chunks（支持 IDs 或 documentId 过滤）
   * 
   * @param tableId 表 ID
   * @param options 删除选项（ids 和 documentId 至少提供一个）
   * @returns 删除的数量
   */
  async deleteChunks(
    tableId: string,
    options?: {
      ids?: string[];
      documentId?: string;
    },
  ): Promise<number> {
    // 验证参数：至少提供一个
    if (!options || (!options.ids && !options.documentId)) {
      throw new Error('必须提供 ids 或 documentId 至少一个参数');
    }

    this.logger.log(`从表 ${tableId} 删除 chunks`);
    return await this.vectorDb.deleteDocuments(tableId, options);
  }

  /**
   * 删除整个表
   * 
   * @param tableId 表 ID
   * @returns 是否删除成功
   */
  async deleteTable(tableId: string): Promise<boolean> {
    this.logger.log(`删除表 ${tableId}`);
    return await this.vectorDb.deleteCollection(tableId);
  }

  /**
   * 混合搜索（语义 + 关键词）
   * 
   * @param tableId 表 ID（必选）
   * @param queryEmbedding 查询向量
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param semanticWeight 语义权重 (0-1)，默认 0.6
   * @param keywordWeight 关键词权重 (0-1)，默认 0.4
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @param enableBM25Rerank 是否启用 BM25 重排，默认 true
   * @returns 搜索结果列表
   */
  async searchChunksHybrid(
    tableId: string,
    queryEmbedding: number[],
    queryText: string,
    topK: number = 5,
    semanticWeight: number = 0.6,
    keywordWeight: number = 0.4,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
    enableBM25Rerank: boolean = true,  // ✅ 新增：是否启用 BM25 重排
  ): Promise<SearchResult[]> {
    this.logger.debug(
      `混合搜索表 ${tableId}，topK=${topK}，filter=${JSON.stringify(filterOptions)}，BM25重排=${enableBM25Rerank}`,
    );

    return await this.vectorDb.hybridSearch(
      tableId,
      queryEmbedding,
      queryText,
      topK,
      semanticWeight,
      keywordWeight,
      filterOptions,
      enableBM25Rerank,
    );
  }

  /**
   * 语义搜索
   * 
   * @param tableId 表 ID
   * @param queryEmbedding 查询向量
   * @param topK 返回结果数量
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @returns 搜索结果列表
   */
  async searchChunksSemantic(
    tableId: string,
    queryEmbedding: number[],
    topK: number = 5,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]> {
    return await this.vectorDb.semanticSearch(
      tableId,
      queryEmbedding,
      topK,
      filterOptions,
    );
  }

  /**
   * 关键词搜索
   * 
   * @param tableId 表 ID
   * @param queryText 查询文本
   * @param topK 返回结果数量
   * @param filterOptions 过滤选项（支持 documentId 或其他 metadata）
   * @returns 搜索结果列表
   */
  async searchChunksKeyword(
    tableId: string,
    queryText: string,
    topK: number = 5,
    filterOptions?: { documentId?: string; metadata?: Record<string, any> },
  ): Promise<SearchResult[]> {
    return await this.vectorDb.keywordSearch(
      tableId,
      queryText,
      topK,
      filterOptions,
    );
  }

  /**
   * 检查表是否存在
   * 
   * @param tableId 表 ID
   * @returns 是否存在
   */
  async tableExists(tableId: string): Promise<boolean> {
    return await this.vectorDb.collectionExists(tableId);
  }

  /**
   * 获取表的统计信息
   * 
   * @param tableId 表 ID
   * @returns 统计信息
   */
  async getTableStats(tableId: string): Promise<Record<string, any>> {
    return await this.vectorDb.getCollectionStats(tableId);
  }
}
