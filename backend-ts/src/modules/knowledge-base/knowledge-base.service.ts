import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import * as fs from "fs";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { VectorDatabase } from "../../common/vector-db/interfaces/vector-database.interface";
import { createPaginatedResponse } from "../../common/types/pagination";
import { KbFileService } from "./kb-file.service";
import { KbChunkFileStore } from "./kb-chunk-file.store";
import { KbFileStore } from "./kb-file.store";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { assertResolvableModelRef } from "../llm-core/utils/model-reference.util";

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private kbRepo: KnowledgeBaseRepository,
    @Inject("VECTOR_DB") private vectorDb: VectorDatabase,
    private kbFileService: KbFileService,
    private kbFileStore: KbFileStore,
    private chunkFileStore: KbChunkFileStore,
    private modelStore: ProviderFileStore,
  ) {}

  /**
   * 创建知识库
   */
  async create(userId: string, data: any) {
    // 验证必填字段
    if (!data.name) {
      throw new Error("知识库名称不能为空");
    }
    if (!data.embeddingModelId) {
      throw new Error("向量模型 ID 不能为空");
    }
    assertResolvableModelRef(this.modelStore, data.embeddingModelId, 'embeddingModelId');

    try {
      const kb = await this.kbRepo.create({
        name: data.name,
        userId: userId,
        embeddingModelId: data.embeddingModelId, // 使用驼峰式（Prisma TypeScript 属性名）
        description: data.description || null,
        chunkMaxSize: data.chunkMaxSize || 1000,
        chunkOverlapSize: data.chunkOverlapSize || 100,
        chunkMinSize: data.chunkMinSize || 50,
        isPublic: data.isPublic || false,
        metadataConfig: data.metadataConfig || null,
      });

      this.logger.log(`创建知识库成功：${kb.id}, user=${userId}`);
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
      const { items, total } = await this.kbRepo.findAll(
        skip,
        limit,
      );
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
    const kb = await this.kbRepo.findById(kbId);

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
    const kbs = await this.kbRepo.findByIds(ids);
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
    const kb = await this.kbRepo.findById(kbId);

    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    try {
      // 检测向量模型是否变更
      const newModelId = data.embeddingModelId !== undefined
        ? data.embeddingModelId
        : null;
      if (newModelId) {
        assertResolvableModelRef(this.modelStore, newModelId, 'embeddingModelId');
      }
      const modelChanged = newModelId !== null && newModelId !== kb.embeddingModelId;

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
      if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
      if (data.metadataConfig !== undefined) {
        updateData.metadataConfig = data.metadataConfig || null;
      }

      const updatedKb = await this.kbRepo.update(kbId, updateData);

      // 向量模型变更：清空已有分块和向量，重置文件状态，重新处理
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
   * 删除知识库（物理删除）
   */
  async remove(kbId: string) {
    const kb = await this.kbRepo.findById(kbId);

    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    try {
      // 1. 删除向量集合（异步）
      const tableId = `kb_${kbId}`;
      const vectorDeletePromise = this.vectorDb.deleteCollection(tableId)
        .then(() => {
          this.logger.log(`已删除向量集合: ${tableId}`);
        })
        .catch((error: any) => {
          this.logger.warn(`删除向量集合失败: ${error.message}`);
        });

      // 1.1 删除分块 JSONL 目录（异步，容错）
      const chunkDirDeletePromise = this.chunkFileStore
        .deleteKbDir(kbId)
        .catch((error: any) => {
          this.logger.warn(`删除分块目录失败: ${error.message}`);
        });

      // 2. 获取知识库下的所有文件路径（权威来源是 kb 文件存储的 file.json，
      //    主库 kb_file 已冻结停写；用主库会漏删迁移后新上传的物理文件）
      const files = this.kbFileStore
        .queryFiles((m) => m.knowledgeBaseId === kbId && !m.isDirectory)
        .map((m) => ({ filePath: m.filePath }));

      // 3. 异步并行删除所有本地物理文件
      const fileDeletePromises = files
        .filter(file => file.filePath)  // 过滤掉没有 filePath 的记录
        .map(async (file) => {
          try {
            if (fs.existsSync(file.filePath!)) {
              await fs.promises.unlink(file.filePath!);  // 使用异步删除
              return { success: true, path: file.filePath };
            }
            return { success: true, path: file.filePath, skipped: true };
          } catch (error: any) {
            this.logger.warn(`删除本地文件失败: ${file.filePath}, 错误: ${error.message}`);
            return { success: false, path: file.filePath, error: error.message };
          }
        });

      // 并行执行所有删除操作
      await Promise.all([
        vectorDeletePromise,
        chunkDirDeletePromise,
      ]);
      const fileResults = await Promise.allSettled(fileDeletePromises);  // 使用 allSettled 确保单个失败不影响其他

      // 统计删除结果
      const successCount = fileResults.filter(
        r => r.status === 'fulfilled' && r.value.success
      ).length;
      const failCount = fileResults.filter(
        r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      ).length;

      this.logger.log(`共删除 ${successCount} 个本地文件，${failCount} 个失败`);

      // 4. 物理删除知识库（会级联删除所有关联的 KBFile 和 KBChunk）
      const success = await this.kbRepo.delete(kbId);

      if (success) {
        this.logger.log(`删除知识库成功：${kbId}`);
        return { message: "知识库已删除", success: true };
      } else {
        throw new Error("删除失败");
      }
    } catch (error: any) {
      this.logger.error(`删除知识库失败：${error.message}`);
      throw error;
    }
  }
}
