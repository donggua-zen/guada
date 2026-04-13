import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { VectorDatabase } from "../../common/vector-db/interfaces/vector-database.interface";
import { createPaginatedResponse } from "../../common/types/pagination";

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    @Inject("VECTOR_DB") private vectorDb: VectorDatabase,
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
   * 列出用户的所有知识库
   */
  async list(userId: string, skip: number = 0, limit: number = 20) {
    try {
      const { items, total } = await this.kbRepo.findByUserId(
        userId,
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
  async findOne(kbId: string, userId: string) {
    const kb = await this.kbRepo.findById(kbId);

    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    if (kb.userId !== userId) {
      throw new ForbiddenException("无权访问该知识库");
    }

    return kb;
  }

  /**
   * 更新知识库
   */
  async update(kbId: string, userId: string, data: any) {
    const kb = await this.kbRepo.findById(kbId);

    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    if (kb.userId !== userId) {
      throw new ForbiddenException("无权访问该知识库");
    }

    try {
      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined)
        updateData.description = data.description;
      if (data.embedding_model_id !== undefined)
        updateData.embeddingModelId = data.embedding_model_id;
      if (data.chunk_max_size !== undefined)
        updateData.chunkMaxSize = data.chunk_max_size;
      if (data.chunk_overlap_size !== undefined)
        updateData.chunkOverlapSize = data.chunk_overlap_size;
      if (data.chunk_min_size !== undefined)
        updateData.chunkMinSize = data.chunk_min_size;
      if (data.is_public !== undefined) updateData.isPublic = data.is_public;
      if (data.metadata_config !== undefined) {
        updateData.metadataConfig = data.metadata_config || null;
      }

      const updatedKb = await this.kbRepo.update(kbId, updateData);
      this.logger.log(`更新知识库成功：${kbId}`);
      return updatedKb;
    } catch (error: any) {
      this.logger.error(`更新知识库失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 删除知识库（软删除）
   */
  async remove(kbId: string, userId: string) {
    const kb = await this.kbRepo.findById(kbId);

    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    if (kb.userId !== userId) {
      throw new ForbiddenException("无权访问该知识库");
    }

    try {
      // 删除向量集合
      const tableId = `kb_${kbId}`;
      await this.vectorDb.deleteCollection(tableId);

      // 软删除知识库
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
