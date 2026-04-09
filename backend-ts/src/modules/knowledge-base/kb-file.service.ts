import { Injectable, Logger, NotFoundException, Inject, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/database/prisma.service';
import { KnowledgeBaseRepository } from '../../common/database/knowledge-base.repository';
import { KBFileRepository } from '../../common/database/kb-file.repository';
import { KBChunkRepository } from '../../common/database/kb-chunk.repository';
import { FileParserService } from './file-parser.service';
import { EmbeddingService } from './embedding.service';
import { ChunkingService } from './chunking.service';
import { VectorDatabase } from '../../common/vector-db/interfaces/vector-database.interface';
import { createPaginatedResponse } from '../../common/types/pagination';

@Injectable()
export class KbFileService implements OnModuleInit {
  private readonly logger = new Logger(KbFileService.name);
  private static processingSemaphore: Promise<void> = Promise.resolve();

  constructor(
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: KBFileRepository,
    private chunkRepo: KBChunkRepository,
    private parserService: FileParserService,
    private embeddingService: EmbeddingService,
    private chunkingService: ChunkingService,
    @Inject('VECTOR_DB') private vectorDb: VectorDatabase,
  ) {}

  async onModuleInit() {
    await this.resumePendingFileTasks();
  }

  /**
   * 恢复未完成的文件处理任务
   */
  private async resumePendingFileTasks() {
    try {
      this.logger.log('🔄 开始扫描未完成的知识库文件任务...');
      
      const pendingFiles = await this.fileRepo.findByStatus(['pending', 'processing']);
      this.logger.log(`📋 发现 ${pendingFiles.length} 个未完成任务`);

      for (const file of pendingFiles) {
        // 检查物理文件是否存在
        if (!file.filePath || !fs.existsSync(file.filePath)) {
          this.logger.error(`❌ 文件不存在，标记为失败：${file.displayName} (${file.filePath})`);
          await this.fileRepo.updateProcessingStatus(
            file.id,
            'failed',
            undefined,
            undefined,
            '文件丢失，无法恢复',
          );
          continue;
        }

        this.logger.log(`🔄 恢复任务：${file.displayName}`);
        this.processFileInBackground(file.id);
      }
    } catch (error: any) {
      this.logger.error(`恢复任务失败：${error.message}`);
    }
  }

  /**
   * 上传文件到知识库
   */
  async uploadFile(
    kbId: string,
    userId: string,
    file: any, // Express.Multer.File
  ) {
    // 验证知识库存在且有权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    // 生成唯一文件名
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const uniqueFilename = `${crypto.randomUUID()}${fileExtension}`;

    // 保存文件到临时目录
    const uploadDir = path.join(process.cwd(), 'data', 'uploads', 'knowledge-base');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filePath = path.join(uploadDir, uniqueFilename);
    fs.writeFileSync(filePath, file.buffer);

    const fileSize = file.buffer.length;

    // 检测文件类型
    const fileType = await this.parserService.detectFileType(fileExtension.replace(/^\./, ''));

    // 计算文件哈希
    const contentHash = crypto.createHash('md5').update(file.buffer).digest('hex');

    // 创建文件记录
    const fileRecord = await this.fileRepo.create({
      knowledgeBaseId: kbId,
      fileName: uniqueFilename,
      displayName: file.originalname,
      fileSize: fileSize,  // ✅ 使用 number 类型（避免 BigInt 序列化问题）
      fileType: fileType,
      fileExtension: fileExtension.replace(/^\./, ''),
      contentHash: contentHash,
      filePath: filePath,
      processingStatus: 'pending',
      progressPercentage: 0,
      currentStep: '等待处理...',
    });

    this.logger.log(`文件记录已创建：${file.originalname}, KB=${kbId}, File ID=${fileRecord.id}`);

    // 启动后台处理任务
    this.processFileInBackground(fileRecord.id);

    return fileRecord;
  }

  /**
   * 后台异步处理文件
   */
  private async processFileInBackground(fileId: string): Promise<void> {
    // 使用信号量控制并发（依次处理）
    KbFileService.processingSemaphore = KbFileService.processingSemaphore.then(async () => {
      await this.processFile(fileId);
    }).catch((error) => {
      this.logger.error(`后台任务执行失败：fileId=${fileId}, error=${error.message}`);
    });
  }

  /**
   * 处理文件（主流程）
   */
  async processFile(fileId: string): Promise<void> {
    try {
      // 1. 查询文件记录
      const fileRecord = await this.fileRepo.findById(fileId);
      if (!fileRecord) {
        this.logger.error(`❌ 文件记录不存在：${fileId}`);
        return;
      }

      const knowledgeBaseId = fileRecord.knowledgeBaseId;
      const displayName = fileRecord.displayName;
      const filePath = fileRecord.filePath;

      this.logger.log(`开始处理文件：${displayName} (KB: ${knowledgeBaseId}, ID: ${fileId})`);

      // 2. 获取知识库配置
      const kb = await this.kbRepo.findById(knowledgeBaseId);
      if (!kb) {
        throw new Error(`知识库不存在：${knowledgeBaseId}`);
      }

      // 3. 更新状态为处理中
      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        10,
        '正在解析文件...',
      );

      // 4. 解析文件内容
      let content = fileRecord.content;
      if (!content && filePath) {
        content = await this.parserService.parseFileFromPath(filePath);
      }

      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        30,
        '文件解析完成，正在分块...',
      );

      // 5. 文本分块（使用智能分块服务）
      // 固定使用 cl100k_base 编码进行 Token 计数
      const chunksData = await this.chunkingService.chunkText(content, {
        chunkSize: kb.chunkMaxSize,
        overlapSize: kb.chunkOverlapSize,
      });
      
      const chunks = chunksData.map(chunk => chunk.content);
      const totalChunks = chunks.length;

      this.logger.log(`文本分块完成：共${totalChunks}个分块`);

      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        50,
        `分块完成（${totalChunks}个），正在向量化...`,
      );

      // 6. 清理旧数据（重新处理场景）
      try {
        this.logger.log(`🔄 检测到文件 ${fileId}，开始清理旧数据...`);

        // 从向量库删除旧向量
        const tableId = `kb_${knowledgeBaseId}`;
        await this.vectorDb.deleteDocuments(
          tableId,
          { documentId: fileId },
        );

        // 从数据库删除旧分块记录
        const deletedCount = await this.chunkRepo.deleteByFileId(fileId);
        if (deletedCount > 0) {
          this.logger.log(`删除 ${deletedCount} 个旧分块记录`);
        }
      } catch (error: any) {
        this.logger.warn(`清理旧数据失败，但继续执行后续流程：${error.message}`);
      }

      // 7. 批量向量化
      const modelWithProvider = await this.prisma.model.findUnique({
        where: { id: kb.embeddingModelId },
        include: { provider: true },
      });

      if (!modelWithProvider) {
        throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
      }

      this.logger.log(`开始批量向量化 ${chunks.length} 个分块...`);
      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        50,
        `正在批量向量化 (${chunks.length} 个分块)...`,
      );

      const allEmbeddings = await this.embeddingService.getEmbeddings(
        chunks,
        modelWithProvider.provider.apiUrl || '',
        modelWithProvider.provider.apiKey || '',
        modelWithProvider.modelName,
      );

      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        90,
        '向量化完成，正在存储...',
      );

      // 8. 准备向量文档数据
      const tableId = `kb_${knowledgeBaseId}`;
      const documents = chunks.map((content, idx) => ({
        id: `chunk_${idx}_${fileId}`,
        documentId: fileId, // ✅ 使用独立顶层字段
        content,
        embedding: allEmbeddings[idx],
        metadata: {
          knowledgeBaseId: knowledgeBaseId,
          fileName: displayName,
          chunkIndex: idx,
        },
      }));

      // 9. 存储到向量数据库
      await this.vectorDb.addDocuments(tableId, documents);
      this.logger.log(`成功存储 ${documents.length} 个向量文档`);

      await this.fileRepo.updateProcessingStatus(
        fileId,
        'processing',
        95,
        '正在保存分块到数据库...',
      );

      // 9. 保存到数据库
      for (let idx = 0; idx < chunksData.length; idx++) {
        const chunkData = chunksData[idx];
        await this.chunkRepo.create({
          fileId: fileId,
          knowledgeBaseId: knowledgeBaseId,
          content: chunkData.cleanContent, // 存储纯净内容
          chunkIndex: idx,
          vectorId: `chunk_${idx}_${fileId}`,
          embeddingDimensions: allEmbeddings[idx].length,
          tokenCount: chunkData.metadata.tokenCount,
          metadata: {
            fileId: fileId,
            knowledgeBaseId: knowledgeBaseId,
            fileName: displayName,
            overlapLength: chunkData.metadata.overlapLength,
            strategy: chunkData.metadata.strategy,
          },
        });
      }

      // 10. 标记为完成
      const totalTokens = chunksData.reduce((sum, chunk) => sum + chunk.metadata.tokenCount, 0);
      await this.fileRepo.updateProcessingStatus(
        fileId,
        'completed',
        100,
        '处理完成',
        undefined,
        totalChunks,
        totalTokens,
      );

      this.logger.log(`文件处理完成：${displayName}, 分块数=${totalChunks}`);
    } catch (error: any) {
      this.logger.error(`文件处理失败：${error.message}`);

      // 更新状态为失败
      await this.fileRepo.updateProcessingStatus(
        fileId,
        'failed',
        0,
        '处理失败',
        error.message,
      );
    }
  }

  /**
   * 列出知识库中的所有文件
   */
  async listFiles(kbId: string, userId: string, skip: number = 0, limit: number = 50) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    const { items, total } = await this.fileRepo.findByKnowledgeBaseId(kbId, skip, limit);
    return createPaginatedResponse(items, total, { skip, limit });
  }

  /**
   * 获取文件详情
   */
  async getFile(fileId: string, kbId: string, userId: string) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    return file;
  }

  /**
   * 获取文件处理状态
   */
  async getFileStatus(fileId: string, kbId: string, userId: string) {
    const file = await this.getFile(fileId, kbId, userId);

    return {
      id: file.id,
      fileName: file.displayName,
      processingStatus: file.processingStatus,
      progressPercentage: file.progressPercentage,
      currentStep: file.currentStep,
      errorMessage: file.errorMessage,
      totalChunks: file.totalChunks,
      uploadedAt: file.uploadedAt.toISOString(),
      processedAt: file.processedAt ? file.processedAt.toISOString() : null,
    };
  }

  /**
   * 批量获取文件处理状态
   */
  async batchGetFileStatus(fileIds: string[], kbId: string, userId: string) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    const files = await this.fileRepo.findByIds(fileIds);
    return files.map((file) => ({
      id: file.id,
      fileName: file.displayName,
      processingStatus: file.processingStatus,
      progressPercentage: file.progressPercentage,
      currentStep: file.currentStep,
      errorMessage: file.errorMessage,
      totalChunks: file.totalChunks,
      uploadedAt: file.uploadedAt.toISOString(),
      processedAt: file.processedAt ? file.processedAt.toISOString() : null,
    }));
  }

  /**
   * 删除文件及其所有分块
   */
  async deleteFileAndChunks(fileId: string, kbId: string, userId: string): Promise<boolean> {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      return false;
    }

    try {
      // 1. 从向量库删除向量
      const tableId = `kb_${kbId}`;
      await this.vectorDb.deleteDocuments(tableId, {
        documentId: fileId,
      });
      this.logger.log(`从向量库删除文件 ${fileId} 的所有向量`);

      // 2. 从数据库删除分块
      const deletedCount = await this.chunkRepo.deleteByFileId(fileId);
      this.logger.log(`删除 ${deletedCount} 个分块`);

      // 3. 删除文件记录
      await this.fileRepo.delete(fileId);

      return true;
    } catch (error: any) {
      this.logger.error(`删除文件失败：${error.message}`);
      return false;
    }
  }

  /**
   * 重新处理文件
   */
  async retryFileProcessing(fileId: string, kbId: string, userId: string) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    // 检查文件状态，只允许 failed 或 completed 状态的文件重新处理
    if (!['failed', 'completed'].includes(file.processingStatus)) {
      throw new Error(`当前状态不允许重新处理（当前状态：${file.processingStatus}）`);
    }

    // 重置文件状态为 pending
    await this.fileRepo.updateProcessingStatus(
      fileId,
      'pending',
      0,
      '等待重新处理...',
    );

    // 启动后台处理任务
    this.processFileInBackground(fileId);

    this.logger.log(`重新开始处理文件：${file.displayName}, KB=${kbId}`);
    return { message: '文件已开始重新处理', success: true };
  }

  /**
   * 获取文件的分块内容
   */
  async getFileChunks(fileId: string, kbId: string, userId: string, skip: number = 0, limit: number = 10) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    // 验证文件是否存在
    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    // 检查文件处理状态，只允许 completed 状态的文件查看分块
    if (file.processingStatus !== 'completed') {
      throw new Error(`文件尚未处理完成，当前状态：${file.processingStatus}`);
    }

    // 获取文件的分块列表
    const chunks = await this.chunkRepo.findByFileId(fileId, skip, limit);

    // 转换为字典格式并返回
    return chunks.map((chunk) => ({
      id: chunk.id,
      fileId: chunk.fileId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      vectorId: chunk.vectorId,
      embeddingDimensions: chunk.embeddingDimensions,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata || null,
      createdAt: chunk.createdAt.toISOString(),
    }));
  }
}
