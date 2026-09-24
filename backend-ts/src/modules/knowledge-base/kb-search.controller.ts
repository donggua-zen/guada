import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { KbMetaStore, normalizeFusionWeights } from "./kb-meta.store";
import { KbSearchService, SearchResult } from "./kb-search.service";
import { EmbeddingService } from "./embedding.service";

@Controller("knowledge-bases/:kb_id/search")
@UseGuards(AuthGuard)
export class KbSearchController {
  constructor(
    private providerStore: ProviderFileStore,
    private kbMetaStore: KbMetaStore,
    private searchService: KbSearchService,
    private embeddingService: EmbeddingService,
  ) {}

  @Post()
  async searchKnowledgeBase(
    @Param("kb_id") kbId: string,
    @Body() searchRequest: any,
  ) {
    // 验证知识库存在
    const kb = await this.kbMetaStore.getKb(kbId);
    if (!kb) {
      throw new Error("知识库不存在");
    }

    // 获取向量模型配置
    const model = this.providerStore.findModel(kb.embeddingModelId);

    if (!model) {
      throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
    }

    // 按文件过滤的字段名兼容：
    // 前端 `knowledge-base.api.ts` 一直发 camelCase `filterFileId`，而这里历史实现读
    // snake_case `filter_file_id` —— 两边对不上，导致「按文件过滤」这个功能端到端失效
    // （静默不生效，不报错）。两个名字都认，且以 camelCase 为准。
    const filterFileId =
      searchRequest.filterFileId ?? searchRequest.filter_file_id;
    const filterOptions = filterFileId ? { itemId: filterFileId } : undefined;

    // 获取查询文本的向量
    const queryEmbedding = await this.embeddingService.getEmbedding(
      searchRequest.query,
      model.provider.apiUrl || "",
      model.provider.apiKey || "",
      model.modelName,
    );

    // 融合权重：**以知识库配置为默认**，请求体可覆盖。
    // 此前这里写死 0.3/0.7，而 Agent 工具写死 0.6/0.4，同一次检索走 UI 与走 Agent
    // 会得到不同排序。现在两处都读 kb.json，默认值来自 DEFAULT_*_WEIGHT。
    const weights = normalizeFusionWeights(
      searchRequest.semanticWeight ?? kb.semanticWeight,
      searchRequest.keywordWeight ?? kb.keywordWeight,
    );

    // 执行混合搜索
    const results = await this.searchService.hybridSearch(
      kbId,
      queryEmbedding,
      searchRequest.query,
      searchRequest.topK || 5,
      weights.semantic,
      weights.keyword,
      filterOptions,
      searchRequest.enableBM25Rerank ?? true, // 是否启用 BM25 重排，默认 true
    );

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

    return {
      query: searchRequest.query,
      results: formattedResults,
      total: formattedResults.length,
    };
  }

  @Get("test")
  async testSearch(
    @Param("kb_id") kbId: string,
    @Query("query") query: string,
  ) {
    // 验证知识库
    const kb = await this.kbMetaStore.getKb(kbId);
    if (!kb) {
      throw new Error("知识库不存在");
    }

    // 获取向量模型配置
    const model = this.providerStore.findModel(kb.embeddingModelId);

    if (!model) {
      throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
    }

    // 获取查询文本的向量
    const queryEmbedding = await this.embeddingService.getEmbedding(
      query,
      model.provider.apiUrl || "",
      model.provider.apiKey || "",
      model.modelName,
    );

    // 执行语义搜索
    const results = await this.searchService.semanticSearch(
      kbId,
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
