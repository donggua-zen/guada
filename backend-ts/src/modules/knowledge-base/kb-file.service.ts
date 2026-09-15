import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { KnowledgeBaseRepository } from "../../common/database/knowledge-base.repository";
import { KBFileRepository } from "../../common/database/kb-file.repository";
import {
  KBChunkRepository,
  KbChunkFileRow,
} from "../../common/database/kb-chunk.repository";
import { KbDatabaseService } from "./kb-database.service";
import { FileParserService } from "./file-parser.service";
import { EmbeddingService } from "./embedding.service";
import { ChunkingService } from "./chunking.service";
import { createPaginatedResponse } from "../../common/types/pagination";
import type { FileProgressCallback } from "../../common/types/file-progress.types";

/**
 * 知识库文件服务
 *
 * 存储形态（每库一个自包含目录）：
 *   `<KB根>/<kbId>/kb.json`                KB 配置
 *   `<KB根>/<kbId>/kb.db`                  条目元信息 + 分块正文 + 向量 + FTS
 *   `<KB根>/<kbId>/raw/<itemId>/<文件名>`   原件副本（上传时写入）
 *
 * 与原实现的三点差异（都是刻意的）：
 * 1. **原件复制进库**，不再散落在共享上传目录。删条目/删库即真正释放空间，
 *    库目录可整体拷走，且不再通过无鉴权的 `/uploads` 静态挂载暴露。
 * 2. **原件目录用 itemId 命名**，所以改名/移动只改数据库行、不搬字节
 *    （数千条目下改名由 N+1 次整文件重写降到 1 条 UPDATE）。
 * 3. 分块与向量写入**同一个事务**（replaceChunks），不再有"向量写成功、
 *    正本写失败"的跨存储不一致。
 */
@Injectable()
export class KbFileService implements OnModuleInit {
  private readonly logger = new Logger(KbFileService.name);
  private static processingSemaphore: Promise<void> = Promise.resolve();

  constructor(
    private providerStore: ProviderFileStore,
    private kbRepo: KnowledgeBaseRepository,
    private fileRepo: KBFileRepository,
    private chunkRepo: KBChunkRepository,
    private databases: KbDatabaseService,
    private parserService: FileParserService,
    private embeddingService: EmbeddingService,
    private chunkingService: ChunkingService,
  ) {}

  async onModuleInit() {
    // 迁移导入完成前不得读写库（门控超时兜底在 gate 内）
    await this.databases.ready();
    await this.resumePendingFileTasks();
    await this.cleanupOrphanFiles();
    await this.reportOrphanRawDirs();
  }

  // ============ 原件落盘 ============

  /**
   * 把原件写进 `<kbId>/raw/<itemId>/`，返回落盘文件名。
   *
   * 文件名保留原件的可读性（用户在文件管理器里看得懂），因为 itemId 目录已经
   * 保证唯一性，所以不需要再做"加时间戳防冲突"那套。
   */
  private async writeRawFile(
    kbId: string,
    itemId: string,
    originalName: string,
    content: Buffer | string,
  ): Promise<string> {
    const dir = this.databases.getItemRawDir(kbId, itemId);
    await fs.promises.mkdir(dir, { recursive: true });
    const safeName = this.safeRawName(originalName);
    await fs.promises.writeFile(path.join(dir, safeName), content);
    return safeName;
  }

  /** 原件文件名净化：去掉路径分隔符/控制字符，兜底给个名字 */
  private safeRawName(name: string): string {
    const base = path.basename(name || "").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_");
    const trimmed = base.replace(/^[.\s]+|[.\s]+$/g, "");
    return trimmed || "file";
  }

  /** 原件绝对路径（raw/<itemId>/<rawName>）；无原件返回 null */
  private rawFilePath(
    kbId: string,
    itemId: string,
    rawName: string | null,
  ): string | null {
    if (!rawName) return null;
    return path.join(this.databases.getItemRawDir(kbId, itemId), rawName);
  }

  /** 删除条目的原件目录（容错） */
  private async removeRawDir(kbId: string, itemId: string): Promise<void> {
    const dir = this.databases.getItemRawDir(kbId, itemId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (error: any) {
      this.logger.warn(`删除原件目录失败 ${dir}: ${error.message}`);
    }
  }

  // ============ 启动期对账 ============

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
        const rawPath = this.rawFilePath(
          file.knowledgeBaseId,
          file.id,
          file.rawName,
        );
        if (!rawPath || !fs.existsSync(rawPath)) {
          this.logger.error(
            `原件缺失，标记为失败：${file.displayName} (${rawPath ?? "无原件记录"})`,
          );
          await this.fileRepo.updateProcessingStatus(
            file.knowledgeBaseId,
            file.id,
            "failed",
            undefined,
            undefined,
            "原件丢失，无法恢复",
          );
          continue;
        }
        this.logger.log(`恢复任务：${file.displayName}`);
        this.processFileInBackground(file.knowledgeBaseId, file.id);
      }
    } catch (error: any) {
      this.logger.error(`恢复任务失败：${error.message}`);
    }
  }

  /**
   * 清理孤儿条目（启动时执行）
   *
   * 方向是**元信息 → 磁盘**：条目行还在但原件已被用户手动删除 → 标记失败。
   * 条目行还在但库目录已被删除 → 删掉条目行（与旧实现一致）。
   */
  private async cleanupOrphanFiles() {
    try {
      const allFiles = (await this.fileRepo.listItems(undefined, false)).filter(
        (m) => m.rawName,
      );
      let orphanCount = 0;
      let cleanedCount = 0;

      for (const file of allFiles) {
        let isOrphan = false;
        const kb = await this.kbRepo.findById(file.knowledgeBaseId);
        if (!kb) {
          isOrphan = true;
          this.logger.log(`发现孤儿条目（知识库已不存在）: ${file.displayName}`);
        }
        const rawPath = this.rawFilePath(
          file.knowledgeBaseId,
          file.id,
          file.rawName,
        );
        if (rawPath && !fs.existsSync(rawPath)) {
          isOrphan = true;
          this.logger.log(`发现孤儿条目（原件不存在）: ${file.displayName}`);
        }

        if (isOrphan) {
          orphanCount++;
          try {
            await this.fileRepo.delete(file.knowledgeBaseId, file.id);
            await this.removeRawDir(file.knowledgeBaseId, file.id);
            cleanedCount++;
          } catch (error: any) {
            this.logger.error(
              `清理孤儿条目失败: ${file.displayName}, 错误: ${error.message}`,
            );
          }
        }
      }

      if (orphanCount > 0) {
        this.logger.log(
          `孤儿条目清理完成：发现 ${orphanCount} 个，成功清理 ${cleanedCount} 个`,
        );
      }
    } catch (error: any) {
      this.logger.error(`孤儿条目清理失败：${error.message}`);
    }
  }

  /**
   * 报告 `raw/` 下没有对应条目行的目录（**只报告，不删**）
   *
   * 崩溃可能停在"原件已写入、条目行还没插"之间，于是 raw 目录成为孤儿。
   * 这是本设计唯一的固有失败模式，且目录里是**用户的字节**，所以只报告交由用户决定。
   */
  private async reportOrphanRawDirs(): Promise<string[]> {
    const orphans: string[] = [];
    try {
      const kbIds = await this.fileRepo.listKbIds();
      for (const kbId of kbIds) {
        const rawDir = this.databases.getRawDir(kbId);
        let entries: import("fs").Dirent[];
        try {
          entries = await fs.promises.readdir(rawDir, { withFileTypes: true });
        } catch {
          continue; // 该库还没有原件
        }
        const known = new Set(await this.fileRepo.listItemIds(kbId));
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!known.has(entry.name)) {
            const full = path.join(rawDir, entry.name);
            orphans.push(full);
            this.logger.warn(
              `发现无人认领的原件目录（不自动删除，请人工确认后处理）: ${full}`,
            );
          }
        }
      }
      if (orphans.length > 0) {
        this.logger.warn(
          `共 ${orphans.length} 个无人认领的原件目录；这些文件不会自动清理。`,
        );
      }
    } catch (error: any) {
      this.logger.warn(`原件目录对账失败：${error.message}`);
    }
    return orphans;
  }

  // ============ 工具 ============

  /**
   * 修复中文文件名乱码 (Windows + Node.js 常见兼容性问题)
   */
  private fixFilenameEncoding(fileName: string): string {
    if (/[\u0080-\uffff]/.test(fileName)) {
      try {
        return Buffer.from(fileName, "latin1").toString("utf-8");
      } catch {
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

      let folder = await this.fileRepo.findByPathAndParent(
        kbId,
        part,
        currentParentId,
        true,
      );

      if (!folder) {
        folder = await this.fileRepo.create(kbId, {
          displayName: part,
          fileName: crypto.randomUUID(),
          fileSize: 0,
          fileType: "directory",
          fileExtension: "",
          contentHash: "",
          processingStatus: "completed",
          progressPercentage: 100,
          currentStep: "文件夹节点",
          totalChunks: 0,
          totalTokens: 0,
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

  // ============ 上传 / 添加 ============

  /**
   * 上传文件到知识库（原件复制进库内 raw/）
   */
  async uploadFile(
    kbId: string,
    file: any,
    relativePath?: string,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }

    const originalName = this.fixFilenameEncoding(file.originalname);
    const fileExtension = path.extname(originalName).toLowerCase();
    const fileType = await this.parserService.detectFileType(
      fileExtension.replace(/^\./, ""),
    );
    const contentHash = crypto
      .createHash("md5")
      .update(file.buffer)
      .digest("hex");

    // 解析相对路径,提取父文件夹信息
    let parentFolderId: string | null = null;
    if (relativePath) {
      const folderPath = relativePath.split("/").slice(0, -1).join("/");
      if (folderPath) {
        parentFolderId = await this.ensureFolderStructure(kbId, folderPath);
      }
    }

    // 先建条目行（拿到 itemId），再把原件写进 raw/<itemId>/
    const fileRecord = await this.fileRepo.create(kbId, {
      fileName: originalName,
      displayName: originalName,
      fileSize: file.buffer.length,
      fileType,
      fileExtension: fileExtension.replace(/^\./, ""),
      contentHash,
      processingStatus: "pending",
      progressPercentage: 0,
      currentStep: "等待处理...",
      relativePath: relativePath || null,
      parentFolderId,
      isDirectory: false,
    });

    const rawName = await this.writeRawFile(
      kbId,
      fileRecord.id,
      originalName,
      file.buffer,
    );
    await this.fileRepo.update(kbId, fileRecord.id, { rawName });

    this.logger.log(
      `文件记录已创建：${originalName}, 相对路径:${relativePath || "无"}, KB=${kbId}, File ID=${fileRecord.id}`,
    );

    this.processFileInBackground(kbId, fileRecord.id);
    return { ...fileRecord, rawName };
  }

  /**
   * 添加文本文档到知识库（供 AI Agent 工具调用）
   *
   * @param sourceFilePath 源文件绝对路径；会被**复制**进库内 raw/
   * @param targetPath 知识库内相对路径（如 "docs/api/guide.md"）
   */
  async addTextDocument(
    kbId: string,
    sourceFilePath: string,
    targetPath: string,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    if (!fs.existsSync(sourceFilePath)) {
      throw new Error(`源文件不存在：${sourceFilePath}`);
    }

    const content = await fs.promises.readFile(sourceFilePath, "utf-8");
    const displayName = path.basename(targetPath);
    const contentHash = crypto
      .createHash("md5")
      .update(content)
      .digest("hex");

    let parentFolderId: string | null = null;
    const folderPath = path.dirname(targetPath);
    if (folderPath && folderPath !== ".") {
      parentFolderId = await this.ensureFolderStructure(kbId, folderPath);
    }

    const fileRecord = await this.fileRepo.create(kbId, {
      fileName: displayName,
      displayName,
      fileSize: Buffer.byteLength(content, "utf-8"),
      fileType: "text",
      fileExtension: path.extname(displayName).replace(/^\./, "") || "txt",
      contentHash,
      processingStatus: "pending",
      progressPercentage: 0,
      currentStep: "等待处理...",
      relativePath: targetPath || null,
      parentFolderId,
      isDirectory: false,
      // 记下来源，便于日后「重新摄取」时优先用原始文件
      sourcePath: sourceFilePath,
    });

    const rawName = await this.writeRawFile(
      kbId,
      fileRecord.id,
      displayName,
      content,
    );
    await this.fileRepo.update(kbId, fileRecord.id, { rawName });

    this.logger.log(
      `文本文档记录已创建：${displayName}, KB=${kbId}, File ID=${fileRecord.id}`,
    );

    this.processFileInBackground(kbId, fileRecord.id);
    return { ...fileRecord, rawName };
  }

  /**
   * 创建文件夹
   */
  async createFolder(
    kbId: string,
    folderName: string,
    parentFolderId: string | null = null,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new NotFoundException("知识库不存在");
    }
    this.validateFileName(folderName, true);

    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      folderName,
      parentFolderId,
    );
    if (existingItem) {
      const existingType = existingItem.isDirectory ? "文件夹" : "文件";
      throw new Error(`已存在同名${existingType}「${folderName}」`);
    }

    let relativePath: string;
    if (parentFolderId) {
      const parent = await this.fileRepo.findById(kbId, parentFolderId);
      if (!parent) throw new NotFoundException("父文件夹不存在");
      if (!parent.isDirectory) throw new Error("父节点不是文件夹");
      relativePath = parent.relativePath
        ? `${parent.relativePath}/${folderName}`
        : folderName;
    } else {
      relativePath = folderName;
    }

    const folder = await this.fileRepo.create(kbId, {
      displayName: folderName,
      fileName: crypto.randomUUID(),
      fileSize: 0,
      fileType: "directory",
      fileExtension: "",
      contentHash: "",
      processingStatus: "completed",
      progressPercentage: 100,
      currentStep: "文件夹节点",
      totalChunks: 0,
      totalTokens: 0,
      relativePath,
      parentFolderId,
      isDirectory: true,
    });

    this.logger.log(
      `创建文件夹成功：${folderName}, KB=${kbId}, Parent=${parentFolderId || "根目录"}`,
    );

    return {
      id: folder.id,
      displayName: folder.displayName,
      relativePath: folder.relativePath,
      parentFolderId: folder.parentFolderId,
      isDirectory: folder.isDirectory,
    };
  }

  // ============ 处理流程 ============

  /**
   * 后台异步处理文件（信号量串行，避免多文件同时跑 OCR/嵌入压垮机器）
   */
  private async processFileInBackground(
    kbId: string,
    fileId: string,
  ): Promise<void> {
    KbFileService.processingSemaphore = KbFileService.processingSemaphore
      .then(async () => {
        await this.processFile(kbId, fileId);
      })
      .catch((error) => {
        this.logger.error(
          `后台任务执行失败：kbId=${kbId}, fileId=${fileId}, error=${error.message}`,
        );
      });
  }

  /**
   * 处理文件（主流程）
   *
   * 顺序：解析 → 分块 → 嵌入 → **一个事务写入分块+向量+FTS** → 标记完成。
   * 旧实现是「先写向量库、再写 JSONL」，中间崩溃会留下不可自愈的不一致。
   */
  async processFile(kbId: string, fileId: string): Promise<void> {
    let lastPct = -1;
    const updateProgress: FileProgressCallback = async (pct, step) => {
      if (pct === lastPct) return;
      lastPct = pct;
      try {
        await this.fileRepo.updateProcessingStatus(
          kbId,
          fileId,
          "processing",
          pct,
          step,
        );
      } catch {
        /* 进度更新失败不中断主流程 */
      }
    };

    try {
      const fileRecord = await this.fileRepo.findById(kbId, fileId);
      if (!fileRecord) {
        this.logger.error(`文件记录不存在：${kbId}/${fileId}`);
        return;
      }

      const displayName = fileRecord.displayName;
      this.logger.log(
        `开始处理文件：${displayName} (KB: ${kbId}, ID: ${fileId})`,
      );

      const kb = await this.kbRepo.findById(kbId);
      if (!kb) {
        throw new Error(`知识库不存在：${kbId}`);
      }

      await updateProgress(1, "正在准备处理...");

      const rawPath = this.rawFilePath(kbId, fileId, fileRecord.rawName);
      if (!rawPath || !fs.existsSync(rawPath)) {
        throw new Error("原件不存在，无法解析");
      }

      const parseOnProgress: FileProgressCallback | undefined = async (
        pct,
        step,
      ) => {
        // 解析器内部 0%~100% 映射到全局 2%~80%
        await updateProgress(2 + Math.round((pct / 100) * 78), step);
      };

      const parseResult = await this.parserService.parseFile(
        rawPath,
        parseOnProgress,
      );
      await updateProgress(82, "文件解析完成，正在分块...");

      const chunksData = await this.chunkingService.chunkPages(
        parseResult.pages,
        {
          chunkSize: kb.chunkMaxSize,
          overlapSize: kb.chunkOverlapSize,
        },
      );
      const chunks = chunksData.map((chunk) => chunk.content);
      const totalChunks = chunks.length;
      this.logger.log(`文本分块完成：共${totalChunks}个分块`);

      await updateProgress(86, `分块完成（${totalChunks}个），正在向量化...`);

      const modelWithProvider = this.providerStore.findModel(
        kb.embeddingModelId,
      );
      if (!modelWithProvider) {
        throw new Error(`向量模型不存在：${kb.embeddingModelId}`);
      }

      const allEmbeddings = await this.embeddingService.getEmbeddings(
        chunks,
        modelWithProvider.provider.apiUrl || "",
        modelWithProvider.provider.apiKey || "",
        modelWithProvider.modelName,
        async (current, total) => {
          // 向量化进度映射：88%~93%
          await updateProgress(
            88 + Math.round((current / total) * 5),
            `向量化进度：${current}/${total}`,
          );
        },
      );

      await updateProgress(95, "正在保存分块与向量...");

      const chunkRows: KbChunkFileRow[] = chunksData.map((chunkData, idx) => ({
        id: `chunk_${idx}_${fileId}`,
        vectorId: `chunk_${idx}_${fileId}`,
        chunkIndex: idx,
        content: chunkData.content,
        tokenCount: chunkData.metadata.tokenCount,
        embedding: allEmbeddings[idx] ?? null,
        embeddingDimensions: allEmbeddings[idx]?.length ?? null,
        createdAt: new Date().toISOString(),
        metadata: {
          fileId,
          knowledgeBaseId: kbId,
          fileName: displayName,
          overlapLength: chunkData.metadata.overlapLength,
          strategy: chunkData.metadata.strategy,
        },
      }));

      // 单事务：旧分块、旧 FTS、新分块、新向量一起替换
      const insertedCount = await this.chunkRepo.replaceChunks(
        kbId,
        fileId,
        chunkRows,
      );

      const totalTokens = chunksData.reduce(
        (sum, chunk) => sum + chunk.metadata.tokenCount,
        0,
      );
      await this.fileRepo.updateProcessingStatus(
        kbId,
        fileId,
        "completed",
        100,
        "处理完成",
        undefined,
        totalChunks,
        totalTokens,
      );

      this.logger.log(
        `文件处理完成：${displayName}, 分块数=${insertedCount}`,
      );
    } catch (error: any) {
      this.logger.error(`文件处理失败：${error.message}`);
      try {
        await this.fileRepo.updateProcessingStatus(
          kbId,
          fileId,
          "failed",
          0,
          "处理失败",
          error.message,
        );
      } catch (dbError: any) {
        this.logger.error(`标记文件失败状态失败：${dbError.message}`);
      }
    }
  }

  // ============ 查询 ============

  async listFiles(kbId: string, skip: number = 0, limit: number = 50) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");
    const { items, total } = await this.fileRepo.findByKnowledgeBaseId(
      kbId,
      skip,
      limit,
    );
    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getFilesByParent(
    kbId: string,
    parentFolderId: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");
    const { items, total } = await this.fileRepo.findByParentFolderId(
      kbId,
      parentFolderId,
      skip,
      limit,
    );
    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getFilesByRelativePath(
    kbId: string,
    relativePath: string | null,
    skip: number = 0,
    limit: number = 50,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    let parentFolderId: string | null = null;
    if (relativePath) {
      const targetFolder = await this.fileRepo.findByRelativePath(
        kbId,
        relativePath,
        true,
      );
      if (!targetFolder) {
        return createPaginatedResponse([], 0, { skip, limit });
      }
      parentFolderId = targetFolder.id;
    }

    const { items, total } = await this.fileRepo.findByParentFolderId(
      kbId,
      parentFolderId,
      skip,
      limit,
    );
    return createPaginatedResponse(items, total, { skip, limit });
  }

  async getFile(fileId: string, kbId: string) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");
    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) throw new NotFoundException("文件不存在");
    return file;
  }

  async getFileStatus(fileId: string, kbId: string) {
    const file = await this.getFile(fileId, kbId);
    return this.toStatusView(file);
  }

  async batchGetFileStatus(fileIds: string[], kbId: string) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");
    const files = await this.fileRepo.findByIds(kbId, fileIds);
    return files.map((file) => this.toStatusView(file));
  }

  private toStatusView(file: Record<string, any>) {
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

  // ============ 删除 ============

  /**
   * 删除文件及其所有分块(支持递归删除文件夹)
   *
   * 因为分块/向量/元信息都在同一个库里，这里是「一个事务 + 一次目录删除」，
   * 不再是旧实现的「向量库删一次 + JSONL 删一次 + 元信息删一次」。
   */
  async deleteFileAndChunks(fileId: string, kbId: string): Promise<boolean> {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) return false;

    try {
      if (file.isDirectory) {
        await this.deleteFolderRecursive(kbId, fileId);
        return true;
      }

      await this.chunkRepo.deleteByItemId(kbId, fileId);
      await this.fileRepo.delete(kbId, fileId);
      await this.removeRawDir(kbId, fileId);
      this.logger.log(`已删除文件：${file.displayName} (${fileId})`);
      return true;
    } catch (error: any) {
      this.logger.error(`删除文件失败：${error.message}`);
      return false;
    }
  }

  /**
   * 递归删除文件夹及其所有内容。
   *
   * 子项一次性收齐（不再分页 1000 递归），分块一批删，条目行一批删，
   * 原件目录逐个删。
   */
  private async deleteFolderRecursive(
    kbId: string,
    folderId: string,
  ): Promise<void> {
    const allItems = await this.collectSubtree(kbId, folderId);
    const itemIds = [folderId, ...allItems.map((i) => i.id)];

    try {
      await this.chunkRepo.deleteMany(kbId, itemIds);
      for (const itemId of itemIds) {
        await this.fileRepo.delete(kbId, itemId);
        await this.removeRawDir(kbId, itemId);
      }
      this.logger.log(
        `已递归删除文件夹 ${folderId}（含 ${allItems.length} 个子项）`,
      );
    } catch (error: any) {
      this.logger.error(`递归删除文件夹失败 ${folderId}: ${error.message}`);
      throw error;
    }
  }

  /** 收集文件夹的全部后代（不含自身） */
  private async collectSubtree(
    kbId: string,
    folderId: string,
  ): Promise<Array<Record<string, any>>> {
    const out: Array<Record<string, any>> = [];
    const queue: string[] = [folderId];
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await this.fileRepo.findChildren(kbId, current, 0, 10000);
      for (const child of children.items) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        out.push(child);
        if (child.isDirectory) queue.push(child.id);
      }
    }
    return out;
  }

  /**
   * 重新处理文件
   */
  async retryFileProcessing(fileId: string, kbId: string) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) throw new NotFoundException("文件不存在");

    if (!["failed", "completed"].includes(file.processingStatus)) {
      throw new Error(
        `当前状态不允许重新处理（当前状态：${file.processingStatus}）`,
      );
    }

    await this.fileRepo.updateProcessingStatus(
      kbId,
      fileId,
      "pending",
      0,
      "等待重新处理...",
    );
    this.processFileInBackground(kbId, fileId);

    this.logger.log(`重新开始处理文件：${file.displayName}, KB=${kbId}`);
    return { message: "文件已开始重新处理", success: true };
  }

  /**
   * 清空知识库所有分块和向量数据，重置文件状态为待处理
   * 在向量模型变更时调用（维度变了，旧向量无法复用）
   */
  async clearAndReprocessKnowledgeBase(kbId: string): Promise<void> {
    this.logger.log(`开始清空知识库分块和向量数据: ${kbId}`);

    // 一次性清空全部条目→分块→FTS
    await this.chunkRepo.deleteAll(kbId);

    const allFiles = await this.fileRepo.listItems(kbId, false);
    if (allFiles.length === 0) {
      this.logger.log(`知识库 ${kbId} 没有需要重新处理的文件`);
      return;
    }

    for (const file of allFiles) {
      await this.fileRepo.updateProcessingStatus(
        kbId,
        file.id,
        "pending",
        0,
        "等待重新处理...",
        null,
        0,
        0,
      );
    }
    this.logger.log(`已重置 ${allFiles.length} 个文件状态为 pending`);

    for (const file of allFiles) {
      this.processFileInBackground(kbId, file.id);
    }
    this.logger.log(`知识库 ${kbId} 已开始全部重新处理`);
  }

  // ============ 重命名 / 移动 ============

  /**
   * 验证文件或文件夹名称
   */
  private validateFileName(name: string, isDirectory: boolean = false): void {
    if (!name || name.trim() === "") {
      throw new Error("名称不能为空");
    }
    if (name.length > 255) {
      throw new Error("名称不能超过 255 个字符");
    }
    const invalidChars = /[\\/:*?"<>|\x00-\x1f\x7f]/;
    if (invalidChars.test(name)) {
      throw new Error(
        '名称包含非法字符，不允许使用：\\ / : * ? " < > | 及控制字符',
      );
    }
    const reservedNames = [
      "CON", "PRN", "AUX", "NUL",
      "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
      "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if (reservedNames.includes(name.toUpperCase())) {
      throw new Error(`名称「${name}」是系统保留名称，不能使用`);
    }
    if (
      name.startsWith(" ") ||
      name.endsWith(" ") ||
      name.startsWith(".") ||
      name.endsWith(".")
    ) {
      throw new Error("名称不能以空格或点号开头或结尾");
    }
  }

  /**
   * 重命名文件或文件夹
   *
   * 改名只动数据库行：原件目录以 itemId 命名，不随显示名变化。
   */
  async renameFile(fileId: string, kbId: string, newName: string) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    this.validateFileName(newName);

    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) throw new NotFoundException("文件不存在");

    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      newName,
      file.parentFolderId,
    );
    if (existingItem && existingItem.id !== fileId) {
      throw new Error("该名称已存在");
    }

    const parentPath = file.parentFolderId
      ? (await this.fileRepo.findById(kbId, file.parentFolderId))?.relativePath
      : "";
    const newRelativePath = parentPath ? `${parentPath}/${newName}` : newName;

    if (file.isDirectory) {
      // 级联重写子项路径：单条 UPDATE（旧实现是逐个子项重写 file.json）
      const changed = await this.fileRepo.rewriteRelativePathPrefix(
        kbId,
        file.relativePath + "/",
        newRelativePath + "/",
      );
      this.logger.log(`文件夹重命名：级联更新了 ${changed} 个子项的路径`);
    }

    await this.fileRepo.update(kbId, fileId, {
      displayName: newName,
      relativePath: newRelativePath,
    });

    this.logger.log(`重命名成功：${file.displayName} -> ${newName}`);
    return { id: fileId, displayName: newName, relativePath: newRelativePath };
  }

  /**
   * 移动文件或文件夹
   */
  async moveFile(
    fileId: string,
    kbId: string,
    targetParentFolderId: string | null,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) throw new NotFoundException("文件不存在");

    if (file.parentFolderId === targetParentFolderId) {
      return { success: true, message: "文件已在目标位置", data: file };
    }

    if (file.isDirectory && targetParentFolderId) {
      const isDescendant = await this.isDescendant(
        kbId,
        targetParentFolderId,
        fileId,
      );
      if (isDescendant) {
        throw new Error("不能将文件夹移动到其子目录下");
      }
    }

    if (targetParentFolderId) {
      const targetParent = await this.fileRepo.findById(
        kbId,
        targetParentFolderId,
      );
      if (!targetParent) throw new NotFoundException("目标文件夹不存在");
      if (!targetParent.isDirectory) throw new Error("目标不是文件夹");
    }

    const fileName = file.isDirectory
      ? file.displayName
      : file.relativePath?.split("/").pop() || file.displayName;

    const existingItem = await this.fileRepo.findByPathAndParent(
      kbId,
      fileName,
      targetParentFolderId,
    );
    if (existingItem && existingItem.id !== fileId) {
      const existingType = existingItem.isDirectory ? "文件夹" : "文件";
      throw new Error(
        `目标位置已存在同名${existingType}「${fileName}」，无法移动`,
      );
    }

    let targetParentPath = "";
    if (targetParentFolderId) {
      const targetParent = await this.fileRepo.findById(
        kbId,
        targetParentFolderId,
      );
      targetParentPath = targetParent?.relativePath || "";
    }
    const newRelativePath = targetParentPath
      ? `${targetParentPath}/${fileName}`
      : fileName;
    const oldRelativePath = file.relativePath;

    if (file.isDirectory && oldRelativePath) {
      const changed = await this.fileRepo.rewriteRelativePathPrefix(
        kbId,
        oldRelativePath + "/",
        newRelativePath + "/",
      );
      this.logger.log(`文件夹移动：级联更新了 ${changed} 个子项的路径`);
    }

    await this.fileRepo.update(kbId, fileId, {
      parentFolderId: targetParentFolderId,
      relativePath: newRelativePath,
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
    kbId: string,
    potentialDescendantId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let currentId: string | null = potentialDescendantId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const node = await this.fileRepo.findById(kbId, currentId);
      if (!node || !node.parentFolderId) break;
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
    skip: number = 0,
    limit: number = 10,
  ) {
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) throw new NotFoundException("知识库不存在");

    const file = await this.fileRepo.findById(kbId, fileId);
    if (!file) throw new NotFoundException("文件不存在");

    if (
      file.processingStatus !== "completed" &&
      file.processingStatus !== "failed"
    ) {
      throw new Error(`文件尚未处理完成，当前状态：${file.processingStatus}`);
    }

    return await this.chunkRepo.findByItemId(kbId, fileId, skip, limit);
  }
}
