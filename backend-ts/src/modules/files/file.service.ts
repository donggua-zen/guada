import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { SessionFileStore } from "../chat/session-file.store";
import { UploadPathService } from "../../common/services/upload-path.service";
import { UrlService } from "../../common/services/url.service";
import { FileParserService } from "../knowledge-base/file-parser.service";
import { FileNamingService } from "../../common/services/file-naming.service";
import { FileRef } from "../../common/types/conversation.types";
import { normalizeMediaType } from "../../common/utils/media-type.util";

@Injectable()
export class FileService {
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
  private readonly MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_IMAGE_SIZE = 1024 * 1024 * 1024; // 1GB
  private readonly MAX_PDF_SIZE = 1024 * 1024 * 1024; // 1GB

  constructor(
    private uploadPathService: UploadPathService,
    private fileNamingService: FileNamingService,
    private sessionStore: SessionFileStore,
    private fileParserService: FileParserService,
    private urlService: UrlService,
  ) { }

  /** 会话存在性校验（单账户：无归属校验） */
  private async assertSessionExists(sessionId: string) {
    if (!this.sessionStore.get(sessionId)) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }
  }

  /**
   * 上传文件的统一入口方法
   */
  async uploadFile(sessionId: string, file: any) {
    try {
      await this.assertSessionExists(sessionId);

      // 1. 验证文件
      this.validateFile(file);

      // 2. 提取文件信息
      const fileInfo = this.extractFileInfo(file);

      // 3. 根据文件类型分别处理
      let result: FileRef;
      if (this.IMAGE_EXTENSIONS.has(fileInfo.fileExt)) {
        result = await this.uploadImageFile(sessionId, file, fileInfo);
      } else if (this.PDF_EXTENSIONS.has(fileInfo.fileExt)) {
        result = await this.uploadPdfFile(sessionId, file, fileInfo);
      } else {
        result = await this.uploadTextFile(sessionId, file, fileInfo);
      }

      // 4. 返回 FileRef（url/previewUrl 保持相对存储路径，由前端展示时绝对化）
      return result;
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
   * 构建文件元数据（不上 DB，直接返回）。
   * 响应为 FileRef 形状（self-contained 契约）：前端发消息时原样携带，
   * 事件落盘时内嵌进 user/message 块的 attachment。url 为相对存储路径
   * （uploads/...），由前端展示时绝对化；mediaType 为真 MIME。
   */
  private buildFileMeta(params: {
    fileName: string;
    displayName: string;
    fileSize: number;
    fileType: string;
    fileExtension: string;
    url: string;
    previewUrl?: string | null;
    contentHash: string;
  }): FileRef {
    return {
      mediaType: normalizeMediaType(params.fileType, params.fileExtension),
      bytes: params.fileSize,
      name: params.displayName,
      url: params.url,
      previewUrl: params.previewUrl ?? undefined,
      fileExtension: params.fileExtension,
    };
  }

  /**
   * 上传图片文件
   */
  async uploadImageFile(sessionId: string, file: any, fileInfo: any) {
    try {
      // 保存图片（传入已修复编码的文件名）
      const { url, previewUrl, metadata } =
        await this.saveImageWithMetadata(file, fileInfo.fileName);

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 生成文件元数据（不写 DB File 表，直接返回）
      return this.buildFileMeta({
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "image",
        fileExtension: fileInfo.fileExt,
        url,
        previewUrl,
        contentHash,
      });
    } catch (error: any) {
      throw new Error(`图片上传失败：${error.message}`);
    }
  }

  /**
   * 上传 PDF 文件
   */
  async uploadPdfFile(sessionId: string, file: any, fileInfo: any) {
    try {
      // 保存 PDF 文件
      const url = await this.saveFile(file, fileInfo.fileExt);

      // 解析 PDF 内容
      let fileContent: string | null = null;
      try {
        const savedFilePath = path.join(this.uploadPathService.getPhysicalPath("files"), url);
        const parseResult = await this.fileParserService.parseFile(savedFilePath);
        fileContent = parseResult.text;
        this.logger.debug(`PDF 内容提取成功，长度: ${fileContent.length}`);
      } catch (error: any) {
        this.logger.warn(`PDF 内容提取失败: ${error.message}，将保存文件但不存储内容`);
        fileContent = null;
      }

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 生成文件元数据（不写 DB File 表，直接返回）
      return this.buildFileMeta({
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "text",
        fileExtension: fileInfo.fileExt,
        url,
        contentHash,
      });
    } catch (error: any) {
      throw new Error(`PDF 文件上传失败：${error.message}`);
    }
  }

  /**
   * 上传文本文件
   */
  async uploadTextFile(sessionId: string, file: any, fileInfo: any) {
    try {
      // 读取文件内容
      const fileContent = file.buffer.toString("utf-8");

      // 保存文本文件到磁盘（JSONL 方案需要物理文件）
      const url = await this.saveFile(file, fileInfo.fileExt);

      // 计算哈希
      const contentHash = this.calculateContentHash(file.buffer);

      // 生成文件元数据（不写 DB File 表，直接返回）
      return this.buildFileMeta({
        fileName: fileInfo.fileName,
        displayName: fileInfo.displayName,
        fileSize: fileInfo.fileSize,
        fileType: "text",
        fileExtension: fileInfo.fileExt,
        url,
        contentHash,
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
  private async saveImageWithMetadata(file: any, originalName: string): Promise<{
    url: string;
    previewUrl: string | null;
    metadata: any;
  }> {
    try {
      // 使用 sharp 处理图片：缩放并转换为 JPEG
      const imageProcessor = sharp(file.buffer);

      // 获取原始尺寸信息
      const originalMetadata = await imageProcessor.metadata();
      const metadata = {
        width: originalMetadata.width || 0,
        height: originalMetadata.height || 0,
      };

      // 生成带日期的文件路径（使用已修复编码的文件名）
      const imagePathResult = await this.fileNamingService.generateFilePathWithDate(
        this.uploadPathService.getPhysicalPath('images'),
        originalName,
      );
      const previewPathResult = await this.fileNamingService.generateFilePathWithDate(
        this.uploadPathService.getPhysicalPath('previews'),
        originalName,
      );

      // 1. 保存原图（最大边长 1024px）
      await imageProcessor
        .clone()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(imagePathResult.filePath);

      // 2. 生成缩略图（最大边长 256px）
      await sharp(file.buffer)
        .resize(256, 256, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(previewPathResult.filePath);

      const url = this.uploadPathService.getStoragePath("images", imagePathResult.relativePath);
      const previewUrl = this.uploadPathService.getStoragePath(
        "previews",
        previewPathResult.relativePath,
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
    // 生成带日期的文件路径
    const originalName = file.originalname || `file.${fileExt}`;
    const pathResult = await this.fileNamingService.generateFilePathWithDate(
      this.uploadPathService.getPhysicalPath('files'),
      originalName,
    );

    // 保存文件
    await fs.promises.writeFile(pathResult.filePath, file.buffer);

    // 返回相对路径（不转换为 URL）
    return this.uploadPathService.getStoragePath("files", pathResult.relativePath);
  }

  /**
   * 计算文件哈希
   */
  private calculateContentHash(buffer: Buffer): string {
    return crypto.createHash("md5").update(buffer).digest("hex");
  }
}
