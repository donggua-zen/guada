/**
 * 向量数据库服务使用示例
 * 
 * 展示如何在 NestJS 服务中使用 VectorDbService
 */

import { Injectable } from '@nestjs/common';
import { VectorDbService } from './vector-db.service';

@Injectable()
export class ExampleKnowledgeService {
  constructor(private readonly vectorDb: VectorDbService) {}

  /**
   * 示例 1：添加知识库分块
   */
  async addKnowledgeChunks(
    knowledgeBaseId: string,
    chunks: Array<{ id: string; content: string; metadata?: Record<string, any> }>,
    embeddings: number[][],
  ): Promise<string[]> {
    const tableId = `kb_${knowledgeBaseId}`;

    // 直接调用简化的 API
    return await this.vectorDb.addChunks(tableId, chunks, embeddings);
  }

  /**
   * 示例 2：搜索知识库（带 document_id 过滤）
   */
  async searchKnowledge(
    knowledgeBaseId: string,
    queryEmbedding: number[],
    queryText: string,
    filterFileId?: string,
  ) {
    const tableId = `kb_${knowledgeBaseId}`;

    // 构建过滤条件
    const filterMetadata = filterFileId
      ? { document_id: filterFileId }
      : undefined;

    // 混合搜索
    const results = await this.vectorDb.searchChunksHybrid(
      tableId,
      queryEmbedding,
      queryText,
      5, // topK
      0.6, // 语义权重
      0.4, // 关键词权重
      filterMetadata, // 可选的过滤条件
    );

    return results.map((result) => ({
      id: result.id,
      content: result.content,
      metadata: result.metadata,
      score: result.score,
      semantic_score: result.semantic_score,
      bm25_score: result.bm25_score,
    }));
  }

  /**
   * 示例 3：删除特定文件的分块
   */
  async deleteFileChunks(
    knowledgeBaseId: string,
    fileId: string,
  ): Promise<number> {
    const tableId = `kb_${knowledgeBaseId}`;

    // 按 metadata 过滤删除
    return await this.vectorDb.deleteChunks(tableId, {
      filterMetadata: { document_id: fileId },
    });
  }

  /**
   * 示例 4：删除特定的 chunks
   */
  async deleteSpecificChunks(
    knowledgeBaseId: string,
    chunkIds: string[],
  ): Promise<number> {
    const tableId = `kb_${knowledgeBaseId}`;

    // 按 IDs 删除
    return await this.vectorDb.deleteChunks(tableId, {
      ids: chunkIds,
    });
  }

  /**
   * 示例 5：删除整个知识库
   */
  async deleteKnowledgeBase(knowledgeBaseId: string): Promise<boolean> {
    const tableId = `kb_${knowledgeBaseId}`;
    return await this.vectorDb.deleteTable(tableId);
  }

  /**
   * 示例 6：检查知识库是否存在
   */
  async knowledgeBaseExists(knowledgeBaseId: string): Promise<boolean> {
    const tableId = `kb_${knowledgeBaseId}`;
    return await this.vectorDb.tableExists(tableId);
  }

  /**
   * 示例 7：获取知识库统计信息
   */
  async getKnowledgeBaseStats(knowledgeBaseId: string) {
    const tableId = `kb_${knowledgeBaseId}`;
    return await this.vectorDb.getTableStats(tableId);
  }

  /**
   * 示例 8：纯语义搜索
   */
  async semanticSearch(
    knowledgeBaseId: string,
    queryEmbedding: number[],
    topK: number = 5,
    filterFileId?: string,
  ) {
    const tableId = `kb_${knowledgeBaseId}`;
    const filterMetadata = filterFileId
      ? { document_id: filterFileId }
      : undefined;

    return await this.vectorDb.searchChunksSemantic(
      tableId,
      queryEmbedding,
      topK,
      filterMetadata,
    );
  }

  /**
   * 示例 9：纯关键词搜索
   */
  async keywordSearch(
    knowledgeBaseId: string,
    queryText: string,
    topK: number = 5,
    filterFileId?: string,
  ) {
    const tableId = `kb_${knowledgeBaseId}`;
    const filterMetadata = filterFileId
      ? { document_id: filterFileId }
      : undefined;

    return await this.vectorDb.searchChunksKeyword(
      tableId,
      queryText,
      topK,
      filterMetadata,
    );
  }
}
