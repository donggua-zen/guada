import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { FileRepository } from "../../common/database/file.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { UploadPathService } from "../../common/services/upload-path.service";
import { UrlService } from "../../common/services/url.service";
import { FileParserService } from "../knowledge-base/file-parser.service";

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);

  // 文件类型定义
  private readonly IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "tiff",
  ]);
  private readonly PDF_EXTENSIONS = new Set(["pdf"]);
  private readonly TEXT_EXTENSIONS = new Set([
    "txt",
    "md",
    "csv",
    "json",
    "xml",
    "html",
    "htm",
  ]);

  // 文件大小限制（字节）
  private readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  private readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  private readonly MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB

  constructor(
    private uploadPathService: UploadPathService,
    private fileRepo: FileRepository,
    private prisma: PrismaService,
    private fileParserService: FileParserService,
    private urlService: UrlService,
  ) { }

  async onModuleInit() {
    await this.cleanupOrphanFiles();
  }

  /**
   * 上传文件的统一入口方法
   */
  async uploadFile(sessionId: string, file: any, userId: string) {
    try {
      // 1. 验证文件
      this.validateFile(file);

      // 2. 提取文件信息
      const fileInfo = this.extractFileInfo(file);

      // 3. 根据文件类型分别处理
      let result: any;
      if (this.IMAGE_EXTENSIONS.has(fileInfo.fileExt)) {
        result = await this.uploadImageFile(sessionId, file, fileInfo, userId);
      } else if (this.PDF_EXTENSIONS.has(fileInfo.fileExt)) {
        result = await this.uploadPdfFile(sessionId, file, fileInfo, userId);
      } else {
        result = await this.uploadTextFile(sessionId, file, fileInfo, userId);
      }

      // 4. 转换 URL 为绝对路径后返回
      const transformedResult = {
        ...result,
        url: this.urlService.toResourceAbsoluteUrl(result.url),
        previewUrl: result.previewUrl
          ? this.urlService.toResourceAbsoluteUrl(result.previewUrl)
          : null,
      };
      return transformedResult;
    } catch (error: any) {
      this.logger.error(`文件上传失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 验证文件
   */
  private validateFile(file: any): void {
    // 检查文件名
    if (!file.originalname || file.originalname.trim() === "") {
      throw new Error("文件名为空");
    }

    // 检查文件扩展名
    const fileExt = this.getFileExtension(file.originalname);
    if (!fileExt) {
      throw new Error("无法识别的文件扩展名");
    }

    // 检查文件大小
    const fileSize = file.size;
    if (fileSize === 0) {
      throw new Error("文件大小为 0");
    }

    // 根据文件类型检查大小限制
    if (this.IMAGE_EXTENSIONS.has(fileExt) && fileSize > this.MAX_IMAGE_SIZE) {
      throw new Error(
        `图片文件大小超出限制（最大 ${this.MAX_IMAGE_SIZE / 1024 / 1024}MB）`,
      );
    } else if (
      this.PDF_EXTENSIONS.has(fileExt) &&
      fileSize > this.MAX_PDF_SIZE
    ) {
      throw new Error(
        `PDF 文件大小超出限制（最大 ${this.MAX_PDF_SIZE / 1024 / 1024}MB）`,
      );
    } else if (fileSize > this.MAX_FILE_SIZE) {
      throw new Error(
        `文件大小超出限制（最大 ${this.MAX_FILE_SIZE / 1024 / 1024}MB）`,
      );
    }
  }

  /**
   * 提取文件基本信息
   */
  private extractFileInfo(file: any): {
    fileName: string;
    displayName: string;
    fileExt: string;
    fileSize: number;
  } {
    // 修复中文文件名乱码问题
    let fileName = file.originalname;

    // 如果检测到常见的 UTF-8 被误读为 Latin-1 的乱码特征，尝试修复
    // 简单的启发式判断：如果包含 Ã, å, ä 等字符，很可能是编码错误
    if (/[^\x00-\x7F]/.test(fileName)) {
      try {
        // 将当前的“乱码”字符串转回 Buffer (latin1)，再以 utf8 读取
        const fixedName = Buffer.from(fileName, "latin1").toString("utf-8");
        // 如果修复后的字符串看起来更合理（例如长度变短或包含常见中文），则使用它
        // 这里我们直接应用修复，因为 Multer 在 Windows 下经常出这个问题
        fileName = fixedName;
      } catch (e) {
        this.logger.warn(`Failed to fix filename encoding for: ${fileName}`);
      }
    }

    this.logger.debug(`Processing file originalname: ${fileName}`);

    const fileExt = this.getFileExtension(fileName).toLowerCase();

    // 生成显示名称（不含扩展名）
    const lastDotIndex = fileName.lastIndexOf(".");
    const displayName =
      lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;

    return {
      fileName,
      displayName,
      fileExt,
      fileSize: file.size,
    };
  }

  /**
   * 获取文件扩展名
   */
  private getFileExtension(fileName: string): string {
    // 使用正则表达式更安全地处理文件名
    const match = fileName.match(/\.([^.]+)$/);
    return match ? match[1] : "";
  }

  /**
   * 上传图片文件
   */
  async uploadImageFile(
    sessionId: string,
    file: any,
    fileInfo: any,
    userId: string,
  ) {
    try {
      // 保存图片
      const { url, previewUrl, metadata } =
        await this.saveImageWithMetadata(file);

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 保存到数据库
      return await this.fileRepo.create({
        sessionId,
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "image",
        fileExtension: fileInfo.fileExt,
        url,
        previewUrl,
        contentHash,
        uploadUserId: userId,
        fileMetadata: metadata || null,
      });
    } catch (error: any) {
      throw new Error(`图片上传失败：${error.message}`);
    }
  }

  /**
   * 上传 PDF 文件
   */
  async uploadPdfFile(
    sessionId: string,
    file: any,
    fileInfo: any,
    userId: string,
  ) {
    try {
      // 保存 PDF 文件
      const url = await this.saveFile(file, fileInfo.fileExt);

      // 解析 PDF 内容
      let fileContent: string | null = null;
      try {
        const fileType = await this.fileParserService.detectFileType(fileInfo.fileExt);
        fileContent = await this.fileParserService.parseFile(
          file.buffer,
          fileType,
          fileInfo.fileExt,
          fileInfo.fileSize,
        );
        this.logger.debug(`PDF 内容提取成功，长度: ${fileContent.length}`);
      } catch (error: any) {
        this.logger.warn(`PDF 内容提取失败: ${error.message}，将保存文件但不存储内容`);
        fileContent = null;
      }

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 保存到数据库
      return await this.fileRepo.create({
        sessionId,
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "text",
        fileExtension: fileInfo.fileExt,
        url,
        contentHash,
        uploadUserId: userId,
        content: fileContent,
      });
    } catch (error: any) {
      throw new Error(`PDF 文件上传失败：${error.message}`);
    }
  }

  /**
   * 上传文本文件
   */
  async uploadTextFile(
    sessionId: string,
    file: any,
    fileInfo: any,
    userId: string,
  ) {
    try {
      // 读取文件内容
      const fileContent = file.buffer.toString("utf-8");

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 保存到数据库
      return await this.fileRepo.create({
        sessionId,
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "text",
        fileExtension: fileInfo.fileExt,
        contentHash,
        uploadUserId: userId,
        content: fileContent,
      });
    } catch (error: any) {
      if (error instanceof Error && error.message.includes("utf-8")) {
        throw new Error(`文件编码错误：${error.message}`);
      }
      throw new Error(`文本文件上传失败：${error.message}`);
    }
  }

  /**
   * 保存图片并提取元数据
   */
  private async saveImageWithMetadata(file: any): Promise<{
    url: string;
    previewUrl: string | null;
    metadata: any;
  }> {
    // 获取物理路径（自动创建目录）
    const imageDir = this.uploadPathService.getPhysicalPath("images");
    const previewDir = this.uploadPathService.getPhysicalPath("previews");

    // 生成唯一文件名
    const uniqueFilename = `${crypto.randomUUID()}.jpg`;
    const filePath = path.join(imageDir, uniqueFilename);
    const previewPath = path.join(previewDir, uniqueFilename);

    try {
      // 使用 sharp 处理图片：缩放并转换为 JPEG
      const imageProcessor = sharp(file.buffer);

      // 获取原始尺寸信息
      const originalMetadata = await imageProcessor.metadata();
      const metadata = {
        width: originalMetadata.width || 0,
        height: originalMetadata.height || 0,
      };

      // 1. 保存原图（最大边长 1024px）
      await imageProcessor
        .clone()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(filePath);

      // 2. 生成缩略图（最大边长 256px）
      await sharp(file.buffer)
        .resize(256, 256, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(previewPath);

      const url = this.uploadPathService.getStoragePath("images", uniqueFilename);
      const previewUrl = this.uploadPathService.getStoragePath(
        "previews",
        uniqueFilename,
      );

      return { url, previewUrl, metadata };
    } catch (error: any) {
      throw new Error(`图片处理失败: ${error.message}`);
    }
  }

  /**
   * 保存文件
   */
  private async saveFile(file: any, fileExt: string): Promise<string> {
    // 获取物理路径（自动创建目录）
    const fileDir = this.uploadPathService.getPhysicalPath("files");

    // 生成唯一文件名
    const uniqueFilename = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = path.join(fileDir, uniqueFilename);

    // 保存文件
    fs.writeFileSync(filePath, file.buffer);

    // 返回相对路径（不转换为 URL）
    return this.uploadPathService.getStoragePath("files", uniqueFilename);
  }

  /**
   * 复制文件
   */
  async copyFile(fileId: string, messageId: string, userId: string) {
    // 从消息中获取目标会话 ID
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new Error("Message not found");
    }

    const originalFile = await this.fileRepo.findById(fileId);
    if (!originalFile) {
      throw new Error("File not found");
    }

    // 创建新的文件记录
    const newFile = await this.fileRepo.create({
      sessionId: message.sessionId,
      messageId,
      fileName: originalFile.fileName,
      displayName: originalFile.displayName,
      fileSize: originalFile.fileSize,
      fileType: originalFile.fileType,
      fileExtension: originalFile.fileExtension,
      url: originalFile.url,
      previewUrl: originalFile.previewUrl,
      contentHash: originalFile.contentHash,
      uploadUserId: userId,
      content: originalFile.content,
      fileMetadata: originalFile.fileMetadata,
    });

    // 转换 URL 为绝对路径后返回
    return {
      ...newFile,
      url: this.urlService.toResourceAbsoluteUrl(newFile.url),
      previewUrl: newFile.previewUrl
        ? this.urlService.toResourceAbsoluteUrl(newFile.previewUrl)
        : null,
    };
  }

  /**
   * 计算文件哈希
   */
  private calculateContentHash(buffer: Buffer): string {
    return crypto.createHash("md5").update(buffer).digest("hex");
  }

  /**
   * 删除文件（物理删除）
   */
  async deleteFile(fileId: string): Promise<boolean> {
    try {
      const file = await this.fileRepo.findById(fileId);
      if (!file) {
        return false;
      }

      // 删除物理文件（如果有 URL）
      if (file.url) {
        const physicalPath = this.uploadPathService.toPhysicalPath(file.url);
        if (fs.existsSync(physicalPath)) {
          fs.unlinkSync(physicalPath);
          this.logger.log(`已删除文件: ${physicalPath}`);
        }
      }

      // 删除预览图（如果有）
      if (file.previewUrl) {
        const previewPath = this.uploadPathService.toPhysicalPath(file.previewUrl);
        if (fs.existsSync(previewPath)) {
          fs.unlinkSync(previewPath);
          this.logger.log(`已删除预览图: ${previewPath}`);
        }
      }

      // 删除数据库记录
      await this.prisma.file.delete({ where: { id: fileId } });
      this.logger.log(`已删除文件记录: ${fileId}`);

      return true;
    } catch (error: any) {
      this.logger.error(`删除文件失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 批量删除文件
   */
  async deleteFilesByMessageId(messageId: string): Promise<number> {
    try {
      // 查找该消息关联的所有文件
      const files = await this.prisma.file.findMany({
        where: { messageId },
      });

      let deletedCount = 0;
      for (const file of files) {
        const success = await this.deleteFile(file.id);
        if (success) {
          deletedCount++;
        }
      }

      this.logger.log(`删除消息 ${messageId} 的 ${deletedCount} 个附件`);
      return deletedCount;
    } catch (error: any) {
      this.logger.error(`批量删除文件失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 清理孤儿文件（启动时执行）
   * 删除所有 messageId 为 NULL 且 sessionId 为 NULL 的文件（即未关联任何消息或会话的文件）
   */
  private async cleanupOrphanFiles() {
    try {
      this.logger.log("🧹 开始扫描聊天孤儿文件...");

      // 查找所有未关联消息和会话的文件
      const orphanFiles = await this.prisma.file.findMany({
        where: {
          messageId: null,
          sessionId: null,
        },
      });

      let cleanedCount = 0;
      for (const file of orphanFiles) {
        try {
          await this.deleteFile(file.id);
          cleanedCount++;
        } catch (error: any) {
          this.logger.error(`清理孤儿文件失败: ${file.displayName}, 错误: ${error.message}`);
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`🧹 聊天孤儿文件清理完成：清理 ${cleanedCount} 个`);
      } else {
        this.logger.log("✅ 未发现聊天孤儿文件");
      }
    } catch (error: any) {
      this.logger.error(`聊天孤儿文件清理失败：${error.message}`);
    }
  }
}
