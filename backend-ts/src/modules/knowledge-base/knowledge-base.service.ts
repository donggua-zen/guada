import {
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as fsp from "fs/promises";
import { KbMetaStore, normalizeFusionWeights } from "./kb-meta.store";
import { createPaginatedResponse } from "../../common/types/pagination";
import { KbFileService } from "./kb-file.service";
import { KbDatabaseService } from "./kb-database.service";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { assertResolvableModelRef } from "../llm-core/utils/model-reference.util";

/**
 * 知识库服务
 *
 * 一个知识库 = 一个自包含目录：`<KB根>/<kbId>/{kb.json, kb.db, raw/}`。
 * 配置（kb.json）由 KbMetaStore 管理；条目/分块/向量在 kb.db（KbDatabaseService）。
 *
 * 删除知识库 = 关连接 + 删整个目录 → kb.json、kb.db、raw/、-wal/-shm 一起走，
 * 不需要像旧实现那样分四路（向量集合、JSONL 目录、物理文件、元信息）各自清理。
 */
@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private kbMetaStore: KbMetaStore,
    private databases: KbDatabaseService,
    private kbFileService: KbFileService,
    private modelStore: ProviderFileStore,
  ) {}

  /**
   * 创建知识库
   */
  async create(data: any) {
    if (!data.name) {
      throw new Error("知识库名称不能为空");
    }
    if (!data.embeddingModelId) {
      throw new Error("向量模型 ID 不能为空");
    }
    assertResolvableModelRef(
      this.modelStore,
      data.embeddingModelId,
      "embeddingModelId",
    );

    try {
      const kb = await this.kbMetaStore.createKb({
        name: data.name,
        embeddingModelId: data.embeddingModelId,
        description: data.description || null,
        chunkMaxSize: data.chunkMaxSize || 1000,
        chunkOverlapSize: data.chunkOverlapSize || 100,
        chunkMinSize: data.chunkMinSize || 50,
        semanticWeight: data.semanticWeight,
        keywordWeight: data.keywordWeight,
      });

      this.logger.log(`创建知识库成功：${kb.id}`);
      return kb;
    } catch (error: any) {
      this.logger.error(`创建知识库失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 列出所有知识库（全局共享）
   */
  async list(skip: number = 0, limit: number = 20) {
    try {
      const allKbs = await this.kbMetaStore.listKbs();
      const items = allKbs.slice(skip, skip + limit);
      const total = allKbs.length;
      return createPaginatedResponse(items, total, { skip, limit });
    } catch (error: any) {
      this.logger.error(`获取知识库列表失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 获取知识库详情
   */
  async findOne(kbId: string) {
    const kb = await this.kbMetaStore.getKb(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    return kb;
  }

  /**
   * 批量获取知识库引用明细（供消息管线构造 KbRefBlock；引用数通常 1-3 个）
   * 不存在的 id 静默跳过（引用列表可能包含已删除的库）。
   */
  async findByIds(ids: string[]): Promise<
    Array<{ id: string; name: string; description?: string }>
  > {
    if (!ids || ids.length === 0) return [];
    const kbs: Record<string, any>[] = [];
    for (const id of ids) {
      const row = await this.kbMetaStore.getKb(id);
      if (row) kbs.push(row);
    }
    return kbs
      .filter((kb) => kb != null)
      .map((kb) => ({
        id: kb.id,
        name: kb.name,
        ...(kb.description ? { description: kb.description } : {}),
      }));
  }

  /**
   * 更新知识库
   * 如果修改了向量模型，自动清空分块和向量数据，重置文件状态并重新处理
   */
  async update(kbId: string, data: any) {
    const kb = await this.kbMetaStore.getKb(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    try {
      const newModelId =
        data.embeddingModelId !== undefined ? data.embeddingModelId : null;
      if (newModelId) {
        assertResolvableModelRef(this.modelStore, newModelId, "embeddingModelId");
      }
      const modelChanged =
        newModelId !== null && newModelId !== kb.embeddingModelId;

      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.embeddingModelId !== undefined)
        updateData.embeddingModelId = data.embeddingModelId;
      if (data.chunkMaxSize !== undefined)
        updateData.chunkMaxSize = data.chunkMaxSize;
      if (data.chunkOverlapSize !== undefined)
        updateData.chunkOverlapSize = data.chunkOverlapSize;
      if (data.chunkMinSize !== undefined)
        updateData.chunkMinSize = data.chunkMinSize;
      // 融合权重：非法值交给 normalizeFusionWeights 兜底（两者同为 0 会让 RRF 恒为 0）
      if (data.semanticWeight !== undefined || data.keywordWeight !== undefined) {
        const normalized = normalizeFusionWeights(
          data.semanticWeight ?? kb.semanticWeight,
          data.keywordWeight ?? kb.keywordWeight,
        );
        updateData.semanticWeight = normalized.semantic;
        updateData.keywordWeight = normalized.keyword;
      }

      const updatedKb = await this.kbMetaStore.updateKb(kbId, updateData);

      // 向量模型变更 → 维度不同，旧向量不可复用：清空后重处理
      if (modelChanged) {
        this.logger.log(
          `向量模型变更：${kb.embeddingModelId} → ${newModelId}，开始清理并重新处理知识库 ${kbId}`,
        );
        await this.kbFileService.clearAndReprocessKnowledgeBase(kbId);
      }

      this.logger.log(`更新知识库成功：${kbId}`);
      return updatedKb;
    } catch (error: any) {
      this.logger.error(`更新知识库失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 删除知识库（物理删除整个库目录）
   *
   * 顺序很重要：**先关闭 SQLite 连接，再删目录** —— Windows 上未释放的句柄会让
   * rm 失败（文件被占用）。
   */
  async remove(kbId: string) {
    const kb = await this.kbMetaStore.getKb(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    try {
      await this.databases.close(kbId);
      const dir = this.databases.getKbDir(kbId);
      await fsp.rm(dir, { recursive: true, force: true });
      this.kbMetaStore.forget(kbId);
      this.databases.invalidateKbList();
      this.logger.log(`删除知识库成功：${kbId}（目录已整体移除）`);
      return { message: "知识库已删除", success: true };
    } catch (error: any) {
      this.logger.error(`删除知识库失败：${error.message}`);
      throw error;
    }
  }
}
