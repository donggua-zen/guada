import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../../common/database/prisma.service';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { VectorDbService } from '../../common/vector-db/vector-db.service';
import { EmbeddingService } from './embedding.service';
import { SearchResult } from '../../common/vector-db';

@Controller('knowledge-bases/:kb_id/search')
@UseGuards(AuthGuard)
export class KbSearchController {
  constructor(
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    private vectorDbService: VectorDbService,
    private embeddingService: EmbeddingService,
  ) {}

  @Post()
  async searchKnowledgeBase(
    @Param('kb_id') kbId: string,
    @Body() searchRequest: any,
    @CurrentUser() user: any,
  ) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new Error('知识库不存在');
    }
    if (kb.userId !== user.sub) {
      throw new Error('无权访问该知识库');
    }

    // 获取向量模型配置
    const model = await this.prisma.model.findUnique({
      where: { id: kb.embeddingModelId },
      include: { provider: true },
    });

    if (!model) {
      throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
    }

    // 构建过滤条件
    const filterOptions = searchRequest.filter_file_id
      ? { documentId: searchRequest.filter_file_id }
      : undefined;

    // 获取查询文本的向量
    const queryEmbedding = await this.embeddingService.getEmbedding(
      searchRequest.query,
      model.provider.apiUrl || '',
      model.provider.apiKey || '',
      model.modelName,
    );

    // 执行混合搜索
    const tableId = `kb_${kbId}`;
    const results = await this.vectorDbService.searchChunksHybrid(
      tableId,
      queryEmbedding,
      searchRequest.query,
      searchRequest.topK || 5,
      searchRequest.semanticWeight || 0.3,  // 默认语义权重 30%
      searchRequest.keywordWeight || 0.7,   // 默认关键词权重 70%
      filterOptions,
      searchRequest.enableBM25Rerank ?? true,  // 新增：是否启用 BM25 重排，默认 true
    );

    // 调试日志：检查底层返回的分数
    console.log('Raw Vector DB Results:', results.map(r => ({ id: r.id, score: r.score, sem: r.semanticScore, bm25: r.bm25Score })));

    // 格式化结果
    const formattedResults = results.map((result: SearchResult) => ({
      content: result.content,
      metadata: result.metadata,
      similarity: result.score || 0.0, // 最终融合分数
      fileName: result.metadata?.fileName,
      semanticScore: result.semanticScore || 0, // 语义分数
      keywordScore: result.bm25Score || 0, // 关键词分数
      finalScore: result.score || 0, // 最终分数
    }));

    const searchMode = searchRequest.use_hybrid_search !== false ? '混合搜索' : '纯语义搜索';
    console.log(`${searchMode}完成：query='${searchRequest.query}', results=${formattedResults.length}`);

    return {
      query: searchRequest.query,
      results: formattedResults,
      total: formattedResults.length,
    };
  }

  @Get('test')
  async testSearch(
    @Param('kb_id') kbId: string,
    @Query('query') query: string,
    @CurrentUser() user: any,
  ) {
    // 验证知识库
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new Error('知识库不存在');
    }
    if (kb.userId !== user.sub) {
      throw new Error('无权访问');
    }

    // 获取向量模型配置
    const model = await this.prisma.model.findUnique({
      where: { id: kb.embeddingModelId },
      include: { provider: true },
    });

    if (!model) {
      throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
    }

    // 获取查询文本的向量
    const queryEmbedding = await this.embeddingService.getEmbedding(
      query,
      model.provider.apiUrl || '',
      model.provider.apiKey || '',
      model.modelName,
    );

    // 执行语义搜索
    const tableId = `kb_${kbId}`;
    const results = await this.vectorDbService.searchChunksSemantic(
      tableId,
      queryEmbedding,
      5,
    );

    return {
      query,
      results_count: results.length,
      results,
    };
  }
}
