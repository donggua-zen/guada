import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../../common/database/prisma.service";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import { KBChunkRepository } from "../../common/database/kb-chunk.repository";
import { FileParserService } from "./file-parser.service";
import { EmbeddingService } from "./embedding.service";
import { ChunkingService } from "./chunking.service";
import { VectorDatabase } from "../../common/vector-db/interfaces/vector-database.interface";
import { createPaginatedResponse } from "../../common/types/pagination";
import { UploadPathService } from "../../common/services/upload-path.service";

@Injectable()
export class KbFileService implements OnModuleInit {
  private readonly logger = new Logger(KbFileService.name);
  private static processingSemaphore: Promise<void> = Promise.resolve();
  private kbUploadDir: string;

  constructor(
    private uploadPathService: UploadPathService,
    private prisma: PrismaService,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: KBFileRepository,
    private chunkRepo: KBChunkRepository,
    private parserService: FileParserService,
    private embeddingService: EmbeddingService,
    private chunkingService: ChunkingService,
    @Inject("VECTOR_DB") private vectorDb: VectorDatabase,
  ) {
    // 获取物理路径（自动创建目录）
    this.kbUploadDir = this.uploadPathService.getPhysicalPath("knowledge-base");
  }

  async onModuleInit() {
    await this.resumePendingFileTasks();
    await this.cleanupOrphanFiles();
  }

  /**
   * 恢复未完成的文件处理任务
   */
  private async resumePendingFileTasks() {
    try {
      this.logger.log("开始扫描未完成的知识库文件任务...");

      const pendingFiles = await this.fileRepo.findByStatus([
        "pending",
        "processing",
      ]);
      this.logger.log(`发现 ${pendingFiles.length} 个未完成任务`);

      for (const file of pendingFiles) {
        // 检查物理文件是否存在
        if (!file.filePath || !fs.existsSync(file.filePath)) {
          this.logger.error(
            `文件不存在，标记为失败：${file.displayName} (${file.filePath})`,
          );
          await this.fileRepo.updateProcessingStatus(
            file.id,
            "failed",
            undefined,
            undefined,
            "文件丢失，无法恢复",
          );
          continue;
        }

        this.logger.log(`恢复任务：${file.displayName}`);
        this.processFileInBackground(file.id);
      }
    } catch (error: any) {
      this.logger.error(`恢复任务失败：${error.message}`);
    }
  }

  /**
   * 清理孤儿文件（启动时执行）
   * 删除所有关联知识库不存在或 filePath 指向无效位置的记录
   */
  private async cleanupOrphanFiles() {
    try {
      this.logger.log("开始扫描孤儿文件...");

      // 1. 查找所有 filePath 不为空的文件
      const allFiles = await this.prisma.kBFile.findMany({
        where: {
          filePath: { not: null },
        },
        select: {
          id: true,
          filePath: true,
          knowledgeBaseId: true,
          displayName: true,
        },
      });

      let orphanCount = 0;
      let cleanedCount = 0;

      for (const file of allFiles) {
        let isOrphan = false;

        // 检查关联的知识库是否存在
        const kb = await this.kbRepo.findById(file.knowledgeBaseId);
        if (!kb) {
          isOrphan = true;
          this.logger.log(`发现孤儿文件（知识库已删除）: ${file.displayName}`);
        }

        // 检查物理文件是否存在
        if (file.filePath && !fs.existsSync(file.filePath)) {
          isOrphan = true;
          this.logger.log(`发现孤儿文件（物理文件不存在）: ${file.displayName}`);
        }

        // 如果是孤儿，删除数据库记录
        if (isOrphan) {
          orphanCount++;
          try {
            // 如果物理文件还存在，先删除（异步）
            if (file.filePath && fs.existsSync(file.filePath)) {
              await fs.promises.unlink(file.filePath);
              this.logger.log(`已删除孤儿物理文件: ${file.filePath}`);
            }
            // 删除数据库记录（会级联删除 chunks）
            await this.fileRepo.delete(file.id);
            cleanedCount++;
          } catch (error: any) {
            this.logger.error(`清理孤儿文件失败: ${file.displayName}, 错误: ${error.message}`);
          }
        }
      }

      if (orphanCount > 0) {
        this.logger.log(`孤儿文件清理完成：发现 ${orphanCount} 个，成功清理 ${cleanedCount} 个`);
      } else {
        this.logger.log("未发现孤儿文件");
      }
    } catch (error: any) {
      this.logger.error(`孤儿文件清理失败：${error.message}`);
    }
  }

  /**
   * 修复中文文件名乱码 (Windows + Node.js 常见兼容性问题)
   */
  private fixFilenameEncoding(fileName: string): string {
    if (/[\u0080-\uffff]/.test(fileName)) {
      try {
        // 尝试将 latin1 编码的字符串还原为 utf-8
        const fixedName = Buffer.from(fileName, "latin1").toString("utf-8");
        return fixedName;
      } catch (e) {
        this.logger.warn(`Failed to fix filename encoding for: ${fileName}`);
      }
    }
    return fileName;
  }

  /**
   * 确保文件夹结构存在(递归创建)
   */
  private async ensureFolderStructure(
    kbId: string,
    folderPath: string,
  ): Promise<string | null> {
    if (!folderPath) return null;

    const parts = folderPath.split("/");
    let currentParentId: string | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1).join("/");

      // 检查该层级文件夹是否已存在
      let folder = await this.fileRepo.findByPathAndParent(
        kbId,
        part,
        currentParentId,
      );

      if (!folder) {
        // 创建文件夹节点
        folder = await this.fileRepo.create({
          knowledgeBaseId: kbId,
          displayName: part,
          fileName: crypto.randomUUID(), // 文件夹也用UUID
          fileSize: 0,
          fileType: "directory",
          fileExtension: "",
          contentHash: "",
          processingStatus: "completed", // 文件夹无需处理
          progressPercentage: 100,
          currentStep: "文件夹节点",
          totalChunks: 0,
          totalTokens: 0,
          // 关键字段
          relativePath: currentPath,
          parentFolderId: currentParentId,
          isDirectory: true,
        });

        this.logger.log(`创建文件夹节点: ${currentPath}`);
      }

      currentParentId = folder.id;
    }

    return currentParentId;
  }

  /**
   * 上传文件到知识库
   */
  async uploadFile(
    kbId: string,
    userId: string,
    file: any, // Express.Multer.File
    relativePath?: string, // 可选的相对路径参数
  ) {
    // 验证知识库存在且有权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    // 修复原始文件名编码
    const originalName = this.fixFilenameEncoding(file.originalname);

    // 生成唯一文件名
    const fileExtension = path.extname(originalName).toLowerCase();
    const uniqueFilename = `${crypto.randomUUID()}${fileExtension}`;

    // 保存文件到临时目录（异步写入）
    const filePath = path.join(this.kbUploadDir, uniqueFilename);
    await fs.promises.writeFile(filePath, file.buffer);

    const fileSize = file.buffer.length;

    // 检测文件类型
    const fileType = await this.parserService.detectFileType(
      fileExtension.replace(/^\./, ""),
    );

    // 计算文件哈希
    const contentHash = crypto
      .createHash("md5")
      .update(file.buffer)
      .digest("hex");

    // 解析相对路径,提取父文件夹信息
    let parentFolderId: string | null = null;
    if (relativePath) {
      const pathParts = relativePath.split("/");
      const folderPath = pathParts.slice(0, -1).join("/"); // 去掉文件名

      if (folderPath) {
        // 确保文件夹结构存在(递归创建)
        parentFolderId = await this.ensureFolderStructure(kbId, folderPath);
      }
    }

    // 创建文件记录
    const fileRecord = await this.fileRepo.create({
      knowledgeBaseId: kbId,
      fileName: uniqueFilename,
      displayName: originalName,
      fileSize: fileSize, // 使用 number 类型（避免 BigInt 序列化问题）
      fileType: fileType,
      fileExtension: fileExtension.replace(/^\./, ""),
      contentHash: contentHash,
      filePath: filePath,
      processingStatus: "pending",
      progressPercentage: 0,
      currentStep: "等待处理...",
      relativePath: relativePath || null,
      parentFolderId: parentFolderId,
      isDirectory: false,
    });

    this.logger.log(
      `文件记录已创建：${originalName}, 相对路径:${relativePath || "无"}, KB=${kbId}, File ID=${fileRecord.id}`,
    );

    // 启动后台处理任务
    this.processFileInBackground(fileRecord.id);

    return fileRecord;
  }

  /**
   * 添加文本文档到知识库（供 AI Agent 工具调用）
   * 
   * @param kbId 知识库 ID
   * @param userId 用户 ID
   * @param sourceFilePath 源文件的绝对路径（包含文件名）
   * @param targetPath 目标知识库中的相对路径（包含文件名，例如："docs/api/guide.md"）
   * @returns 创建的文件记录
   */
  async addTextDocument(
    kbId: string,
    userId: string,
    sourceFilePath: string,
    targetPath: string,
  ) {
    // 验证知识库存在且有权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    // 检查源文件是否存在
    if (!fs.existsSync(sourceFilePath)) {
      throw new Error(`源文件不存在：${sourceFilePath}`);
    }

    // 读取文件内容（异步）
    const content = await fs.promises.readFile(sourceFilePath, 'utf-8');

    // 从目标路径提取显示名称和文件夹路径
    const displayName = path.basename(targetPath);
    const folderPath = path.dirname(targetPath);

    // 生成唯一文件名
    const uniqueFilename = `${crypto.randomUUID()}.txt`;

    // 保存文件到临时目录（异步写入）
    const tempFilePath = path.join(this.kbUploadDir, uniqueFilename);
    await fs.promises.writeFile(tempFilePath, content, 'utf-8');

    const fileSize = Buffer.byteLength(content, 'utf-8');

    // 计算内容哈希（用于后续可能的去重或统计）
    const contentHash = crypto.createHash("md5").update(content).digest("hex");

    // 解析目标路径，提取父文件夹信息
    let parentFolderId: string | null = null;
    if (folderPath && folderPath !== '.') {
      // 确保文件夹结构存在（递归创建）
      parentFolderId = await this.ensureFolderStructure(kbId, folderPath);
    }

    // 创建文件记录
    const fileRecord = await this.fileRepo.create({
      knowledgeBaseId: kbId,
      fileName: uniqueFilename,
      displayName: displayName,
      fileSize: fileSize,
      fileType: "text",
      fileExtension: "txt",
      contentHash: contentHash,
      filePath: tempFilePath,
      processingStatus: "pending",
      progressPercentage: 0,
      currentStep: "等待处理...",
      relativePath: targetPath || null,
      parentFolderId: parentFolderId,
      isDirectory: false,
    });

    this.logger.log(
      `文本文档记录已创建：${displayName}, KB=${kbId}, File ID=${fileRecord.id}`,
    );

    // 启动后台处理任务（与 uploadFile 保持一致）
    this.processFileInBackground(fileRecord.id);

    return fileRecord;
  }

  /**
   * 创建文件夹
   */
  async createFolder(
    kbId: string,
    userId: string,
    folderName: string,
    parentFolderId: string | null = null,
  ) {
    // 1. 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    // 2. 验证文件夹名称
    this.validateFileName(folderName, true);

    // 3. 冲突检测：检查同父目录下是否已存在同名文件或文件夹
    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      folderName,
      parentFolderId,
    );

    if (existingItem) {
      const existingType = existingItem.isDirectory ? '文件夹' : '文件';
      throw new Error(`已存在同名${existingType}「${folderName}」`);
    }

    // 4. 计算 relativePath
    let relativePath: string;
    if (parentFolderId) {
      const parent = await this.fileRepo.findById(parentFolderId);
      if (!parent) {
        throw new NotFoundException('父文件夹不存在');
      }
      if (!parent.isDirectory) {
        throw new Error('父节点不是文件夹');
      }
      relativePath = parent.relativePath
        ? `${parent.relativePath}/${folderName}`
        : folderName;
    } else {
      relativePath = folderName;
    }

    // 5. 创建文件夹记录
    const folder = await this.fileRepo.create({
      knowledgeBaseId: kbId,
      displayName: folderName,
      fileName: crypto.randomUUID(), // 文件夹也用 UUID
      fileSize: 0,
      fileType: 'directory',
      fileExtension: '',
      contentHash: '',
      processingStatus: 'completed', // 文件夹无需处理
      progressPercentage: 100,
      currentStep: '文件夹节点',
      totalChunks: 0,
      totalTokens: 0,
      relativePath: relativePath,
      parentFolderId: parentFolderId,
      isDirectory: true,
    });

    this.logger.log(
      `创建文件夹成功：${folderName}, KB=${kbId}, Parent=${parentFolderId || '根目录'}`,
    );

    return {
      id: folder.id,
      displayName: folder.displayName,
      relativePath: folder.relativePath,
      parentFolderId: folder.parentFolderId,
      isDirectory: folder.isDirectory,
    };
  }

  /**
   * 后台异步处理文件
   */
  private async processFileInBackground(fileId: string): Promise<void> {
    // 使用信号量控制并发（依次处理）
    KbFileService.processingSemaphore = KbFileService.processingSemaphore
      .then(async () => {
        await this.processFile(fileId);
      })
      .catch((error) => {
        this.logger.error(
          `后台任务执行失败：fileId=${fileId}, error=${error.message}`,
        );
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
        this.logger.error(`文件记录不存在：${fileId}`);
        return;
      }

      const knowledgeBaseId = fileRecord.knowledgeBaseId;
      const displayName = fileRecord.displayName;
      const filePath = fileRecord.filePath;

      this.logger.log(
        `开始处理文件：${displayName} (KB: ${knowledgeBaseId}, ID: ${fileId})`,
      );

      // 2. 获取知识库配置
      const kb = await this.kbRepo.findById(knowledgeBaseId);
      if (!kb) {
        throw new Error(`知识库不存在：${knowledgeBaseId}`);
      }

      // 3. 更新状态为处理中
      await this.fileRepo.updateProcessingStatus(
        fileId,
        "processing",
        10,
        "正在解析文件...",
      );

      // 4. 解析文件内容
      let content = fileRecord.content;
      if (!content && filePath) {
        content = await this.parserService.parseFileFromPath(filePath);
      }

      await this.fileRepo.updateProcessingStatus(
        fileId,
        "processing",
        30,
        "文件解析完成，正在分块...",
      );

      // 5. 文本分块（使用智能分块服务）
      // 固定使用 cl100k_base 编码进行 Token 计数
      const chunksData = await this.chunkingService.chunkText(content, {
        chunkSize: kb.chunkMaxSize,
        overlapSize: kb.chunkOverlapSize,
      });

      const chunks = chunksData.map((chunk) => chunk.content);
      const totalChunks = chunks.length;

      this.logger.log(`文本分块完成：共${totalChunks}个分块`);

      await this.fileRepo.updateProcessingStatus(
        fileId,
        "processing",
        50,
        `分块完成（${totalChunks}个），正在向量化...`,
      );

      // 6. 清理旧数据（重新处理场景）
      try {
        this.logger.log(`检测到文件 ${fileId}，开始清理旧数据...`);

        // 从向量库删除旧向量
        const tableId = `kb_${knowledgeBaseId}`;
        await this.vectorDb.deleteDocuments(tableId, { documentId: fileId });

        // 从数据库删除旧分块记录
        const deletedCount = await this.chunkRepo.deleteByFileId(fileId);
        if (deletedCount > 0) {
          this.logger.log(`删除 ${deletedCount} 个旧分块记录`);
        }
      } catch (error: any) {
        this.logger.warn(
          `清理旧数据失败，但继续执行后续流程：${error.message}`,
        );
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
        "processing",
        50,
        `正在批量向量化 (${chunks.length} 个分块)...`,
      );

      const allEmbeddings = await this.embeddingService.getEmbeddings(
        chunks,
        modelWithProvider.provider.apiUrl || "",
        modelWithProvider.provider.apiKey || "",
        modelWithProvider.modelName,
      );

      await this.fileRepo.updateProcessingStatus(
        fileId,
        "processing",
        90,
        "向量化完成，正在存储...",
      );

      // 8. 准备向量文档数据
      const tableId = `kb_${knowledgeBaseId}`;
      const documents = chunks.map((content, idx) => ({
        id: `chunk_${idx}_${fileId}`,
        documentId: fileId, // 使用独立顶层字段
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
        "processing",
        95,
        "正在保存分块到数据库...",
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
      const totalTokens = chunksData.reduce(
        (sum, chunk) => sum + chunk.metadata.tokenCount,
        0,
      );
      await this.fileRepo.updateProcessingStatus(
        fileId,
        "completed",
        100,
        "处理完成",
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
        "failed",
        0,
        "处理失败",
        error.message,
      );
    }
  }

  /**
   * 列出知识库中的所有文件
   */
  async listFiles(
    kbId: string,
    userId: string,
    skip: number = 0,
    limit: number = 50,
  ) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    const { items, total } = await this.fileRepo.findByKnowledgeBaseId(
      kbId,
      skip,
      limit,
    );
    return createPaginatedResponse(items, total, { skip, limit });
  }

  /**
   * 按父文件夹ID获取文件列表(支持懒加载)
   */
  async getFilesByParent(
    kbId: string,
    userId: string,
    parentFolderId: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    const { items, total } = await this.fileRepo.findByParentFolderId(
      kbId,
      parentFolderId,
      skip,
      limit,
    );
    return createPaginatedResponse(items, total, { skip, limit });
  }

  /**
   * 通过相对路径获取文件夹内容
   */
  async getFilesByRelativePath(
    kbId: string,
    userId: string,
    relativePath: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    let parentFolderId: string | null = null;

    if (relativePath) {
      // 查找该路径对应的目录ID
      const targetFolder = await this.fileRepo.findByRelativePath(kbId, relativePath, true);

      if (!targetFolder) {
        // 路径不存在，返回空列表
        return createPaginatedResponse([], 0, { skip, limit });
      }

      parentFolderId = targetFolder.id;
    }
    // else: relativePath 为 null，表示根目录，parentFolderId 保持为 null

    const { items, total } = await this.fileRepo.findByParentFolderId(
      kbId,
      parentFolderId,
      skip,
      limit,
    );

    return createPaginatedResponse(items, total, { skip, limit });
  }

  /**
   * 获取文件详情
   */
  async getFile(fileId: string, kbId: string, userId: string) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException("文件不存在");
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
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
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
   * 删除文件及其所有分块(支持递归删除文件夹)
   */
  async deleteFileAndChunks(
    fileId: string,
    kbId: string,
    userId: string,
  ): Promise<boolean> {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      return false;
    }

    try {
      // 如果是文件夹，递归删除所有子文件和子文件夹
      if (file.isDirectory) {
        await this.deleteFolderRecursive(fileId, kbId);
        return true;
      }

      // 1. 从向量库删除向量
      const tableId = `kb_${kbId}`;
      await this.vectorDb.deleteDocuments(tableId, {
        documentId: fileId,
      });
      this.logger.log(`从向量库删除文件 ${fileId} 的所有向量`);

      // 2. 从数据库删除分块
      const deletedCount = await this.chunkRepo.deleteByFileId(fileId);
      this.logger.log(`删除 ${deletedCount} 个分块`);

      // 3. 删除本地物理文件（异步）
      if (file.filePath && fs.existsSync(file.filePath)) {
        await fs.promises.unlink(file.filePath);
        this.logger.log(`已删除本地文件: ${file.filePath}`);
      }

      // 4. 删除文件记录
      await this.fileRepo.delete(fileId);

      return true;
    } catch (error: any) {
      this.logger.error(`删除文件失败：${error.message}`);
      return false;
    }
  }

  /**
   * 递归删除文件夹及其所有内容
   */
  private async deleteFolderRecursive(folderId: string, kbId: string): Promise<void> {
    // 查找该文件夹下的所有子项
    const { items } = await this.fileRepo.findChildren(folderId, 0, 1000);

    this.logger.log(`文件夹 ${folderId} 下有 ${items.length} 个子项`);

    // 递归处理每个子项
    for (const item of items) {
      if (item.isDirectory) {
        // 如果是子文件夹，递归删除
        await this.deleteFolderRecursive(item.id, kbId);
      } else {
        // 如果是文件，删除文件及其分块
        const tableId = `kb_${kbId}`;
        await this.vectorDb.deleteDocuments(tableId, {
          documentId: item.id,
        });
        await this.chunkRepo.deleteByFileId(item.id);
        
        // 删除本地物理文件（异步）
        if (item.filePath && fs.existsSync(item.filePath)) {
          await fs.promises.unlink(item.filePath);
          this.logger.log(`已删除本地文件: ${item.filePath}`);
        }
        
        await this.fileRepo.delete(item.id);
        this.logger.log(`删除子文件: ${item.displayName}`);
      }
    }

    // 删除文件夹节点本身
    await this.fileRepo.delete(folderId);
    this.logger.log(`删除文件夹节点: ${folderId}`);
  }

  /**
   * 重新处理文件
   */
  async retryFileProcessing(fileId: string, kbId: string, userId: string) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException("文件不存在");
    }

    // 检查文件状态，只允许 failed 或 completed 状态的文件重新处理
    if (!["failed", "completed"].includes(file.processingStatus)) {
      throw new Error(
        `当前状态不允许重新处理（当前状态：${file.processingStatus}）`,
      );
    }

    // 重置文件状态为 pending
    await this.fileRepo.updateProcessingStatus(
      fileId,
      "pending",
      0,
      "等待重新处理...",
    );

    // 启动后台处理任务
    this.processFileInBackground(fileId);

    this.logger.log(`重新开始处理文件：${file.displayName}, KB=${kbId}`);
    return { message: "文件已开始重新处理", success: true };
  }

  /**
   * 验证文件或文件夹名称
   */
  private validateFileName(name: string, isDirectory: boolean = false): void {
    if (!name || name.trim() === '') {
      throw new Error('名称不能为空');
    }

    // 长度限制
    if (name.length > 255) {
      throw new Error('名称不能超过 255 个字符');
    }

    // 不允许的字符：/ \ : * ? " < > | 以及控制字符
    const invalidChars = /[\\/:*?"<>|\x00-\x1f\x7f]/;
    if (invalidChars.test(name)) {
      throw new Error(
        '名称包含非法字符，不允许使用：\\ / : * ? " < > | 及控制字符',
      );
    }

    // Windows 保留名称检查（不区分大小写）
    const reservedNames = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    ];
    const upperName = name.toUpperCase();
    if (reservedNames.includes(upperName)) {
      throw new Error(`名称「${name}」是系统保留名称，不能使用`);
    }

    // 不允许以空格或点号开头/结尾
    if (name.startsWith(' ') || name.endsWith(' ') || 
        name.startsWith('.') || name.endsWith('.')) {
      throw new Error('名称不能以空格或点号开头或结尾');
    }
  }

  /**
   * 重命名文件或文件夹
   */
  async renameFile(
    fileId: string,
    kbId: string,
    userId: string,
    newName: string,
  ) {
    // 1. 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    // 2. 验证新名称
    this.validateFileName(newName);

    // 2. 查询文件
    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    // 3. 验证名称合法性
    if (!newName || newName.trim() === '') {
      throw new Error('名称不能为空');
    }

    // 4. 检查同名冲突（在同一父目录下）
    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      newName,
      file.parentFolderId,
    );
    if (existingItem && existingItem.id !== fileId) {
      throw new Error('该名称已存在');
    }

    // 5. 计算新的 relativePath
    let newRelativePath: string;
    if (file.isDirectory) {
      // 文件夹：需要级联更新所有子项
      const parentPath = file.parentFolderId
        ? (await this.fileRepo.findById(file.parentFolderId))?.relativePath
        : '';
      newRelativePath = parentPath ? `${parentPath}/${newName}` : newName;

      // 6. 事务：使用原生 SQL 批量更新文件夹及所有子项的路径
      const oldPrefix = file.relativePath + '/';
      const newPrefix = newRelativePath + '/';

      // 转义 LIKE 子句中的特殊字符（% 和 _）
      const escapedOldPrefix = oldPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const likePattern = escapedOldPrefix + '%';

      await this.prisma.$transaction(async (tx) => {
        // 6.1 批量更新所有子项的 relativePath（使用参数化查询防止 SQL 注入）
        const result = await tx.$executeRawUnsafe(
          `UPDATE kb_file SET relative_path = ? || SUBSTR(relative_path, LENGTH(?) + 1) WHERE knowledge_base_id = ? AND relative_path LIKE ? ESCAPE '\\'`,
          newPrefix,
          oldPrefix,
          kbId,
          likePattern,
        );

        this.logger.log(
          `文件夹重命名：批量更新了 ${result} 个子项的路径`,
        );

        // 6.2 更新文件夹本身
        await tx.kBFile.update({
          where: { id: fileId },
          data: {
            displayName: newName,
            relativePath: newRelativePath,
          },
        });
      });

      this.logger.log(
        `文件夹重命名成功：${file.displayName} -> ${newName}`,
      );
    } else {
      // 单文件：简单更新
      const parentPath = file.parentFolderId
        ? (await this.fileRepo.findById(file.parentFolderId))?.relativePath
        : '';
      newRelativePath = parentPath ? `${parentPath}/${newName}` : newName;

      await this.fileRepo.update(fileId, {
        displayName: newName,
        relativePath: newRelativePath,
      });

      this.logger.log(`文件重命名成功：${file.displayName} -> ${newName}`);
    }

    return {
      id: fileId,
      displayName: newName,
      relativePath: newRelativePath,
    };
  }

  /**
   * 移动文件或文件夹
   */
  async moveFile(
    fileId: string,
    kbId: string,
    userId: string,
    targetParentFolderId: string | null,
  ) {
    // 1. 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== userId) {
      throw new Error('无权访问该知识库');
    }

    // 2. 查询文件
    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    // 3. 如果目标位置与当前位置相同，直接返回
    if (file.parentFolderId === targetParentFolderId) {
      return {
        success: true,
        message: '文件已在目标位置',
        data: file,
      };
    }

    // 4. 循环引用检测（仅针对文件夹）
    if (file.isDirectory && targetParentFolderId) {
      const isDescendant = await this.isDescendant(
        targetParentFolderId,
        fileId,
      );
      if (isDescendant) {
        throw new Error('不能将文件夹移动到其子目录下');
      }
    }

    // 5. 验证目标文件夹存在
    if (targetParentFolderId) {
      const targetParent = await this.fileRepo.findById(targetParentFolderId);
      if (!targetParent) {
        throw new NotFoundException('目标文件夹不存在');
      }
      if (!targetParent.isDirectory) {
        throw new Error('目标不是文件夹');
      }
    }

    // 6. 冲突检测：检查目标位置是否已存在同名文件或文件夹
    const fileName = file.isDirectory
      ? file.displayName
      : file.relativePath?.split('/').pop() || file.displayName;

    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      fileName,
      targetParentFolderId,
    );

    if (existingItem && existingItem.id !== fileId) {
      // 检查类型是否一致（文件vs文件夹）
      const itemType = file.isDirectory ? '文件夹' : '文件';
      const existingType = existingItem.isDirectory ? '文件夹' : '文件';
      throw new Error(
        `目标位置已存在同名${existingType}「${fileName}」，无法移动`,
      );
    }

    // 7. 计算新的 relativePath
    let targetParentPath = '';
    if (targetParentFolderId) {
      const targetParent = await this.fileRepo.findById(targetParentFolderId);
      targetParentPath = targetParent?.relativePath || '';
    }

    const newRelativePath = targetParentPath
      ? `${targetParentPath}/${fileName}`
      : fileName;

    const oldRelativePath = file.relativePath;

    // 7. 事务：更新文件/文件夹及所有子项
    await this.prisma.$transaction(async (tx) => {
      // 7.1 更新文件/文件夹本身
      await tx.kBFile.update({
        where: { id: fileId },
        data: {
          parentFolderId: targetParentFolderId,
          relativePath: newRelativePath,
        },
      });

      // 7.2 如果是文件夹，使用原生 SQL 批量更新所有子项
      if (file.isDirectory && oldRelativePath) {
        const oldPrefix = oldRelativePath + '/';
        const newPrefix = newRelativePath + '/';
        
        // 转义 LIKE 子句中的特殊字符（% 和 _）
        const escapedOldPrefix = oldPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const likePattern = escapedOldPrefix + '%';

        const result = await tx.$executeRawUnsafe(
          `UPDATE kb_file SET relative_path = ? || SUBSTR(relative_path, LENGTH(?) + 1) WHERE knowledge_base_id = ? AND relative_path LIKE ? ESCAPE '\\'`,
          newPrefix,
          oldPrefix,
          kbId,
          likePattern,
        );

        this.logger.log(
          `文件夹移动：批量更新了 ${result} 个子项的路径`,
        );
      }
    });

    this.logger.log(
      `文件移动成功：${file.displayName}, 新路径: ${newRelativePath}`,
    );

    return {
      id: fileId,
      displayName: file.displayName,
      relativePath: newRelativePath,
      parentFolderId: targetParentFolderId,
    };
  }

  /**
   * 检测是否为后代节点（防止循环引用）
   */
  private async isDescendant(
    potentialDescendantId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let currentId = potentialDescendantId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === ancestorId) {
        return true;
      }
      if (visited.has(currentId)) {
        break; // 检测到循环
      }
      visited.add(currentId);

      const node = await this.fileRepo.findById(currentId);
      if (!node || !node.parentFolderId) {
        break;
      }
      currentId = node.parentFolderId;
    }

    return false;
  }

  /**
   * 获取文件的分块内容
   */
  async getFileChunks(
    fileId: string,
    kbId: string,
    userId: string,
    skip: number = 0,
    limit: number = 10,
  ) {
    // 验证知识库权限
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (kb.userId !== userId) {
      throw new Error("无权访问该知识库");
    }

    // 验证文件是否存在
    const file = await this.fileRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException("文件不存在");
    }

    // 检查文件处理状态，只允许 completed 状态的文件查看分块
    if (file.processingStatus !== "completed") {
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
