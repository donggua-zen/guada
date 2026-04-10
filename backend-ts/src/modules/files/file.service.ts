import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { FileRepository } from '../../common/database/file.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { UploadPathService } from '../../common/services/upload-path.service';

@Injectable()
export class FileService {
    private readonly logger = new Logger(FileService.name);

    // 文件类型定义
    private readonly IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff']);
    private readonly PDF_EXTENSIONS = new Set(['pdf']);
    private readonly TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm']);

    // 文件大小限制（字节）
    private readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    private readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
    private readonly MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB

    constructor(
        private uploadPathService: UploadPathService,
        private fileRepo: FileRepository,
        private prisma: PrismaService,
    ) { }

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
            if (this.IMAGE_EXTENSIONS.has(fileInfo.fileExt)) {
                return await this.uploadImageFile(sessionId, file, fileInfo, userId);
            } else if (this.PDF_EXTENSIONS.has(fileInfo.fileExt)) {
                return await this.uploadPdfFile(sessionId, file, fileInfo, userId);
            } else {
                return await this.uploadTextFile(sessionId, file, fileInfo, userId);
            }
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
        if (!file.originalname || file.originalname.trim() === '') {
            throw new Error('文件名为空');
        }

        // 检查文件扩展名
        const fileExt = this.getFileExtension(file.originalname);
        if (!fileExt) {
            throw new Error('无法识别的文件扩展名');
        }

        // 检查文件大小
        const fileSize = file.size;
        if (fileSize === 0) {
            throw new Error('文件大小为 0');
        }

        // 根据文件类型检查大小限制
        if (this.IMAGE_EXTENSIONS.has(fileExt) && fileSize > this.MAX_IMAGE_SIZE) {
            throw new Error(`图片文件大小超出限制（最大 ${this.MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
        } else if (this.PDF_EXTENSIONS.has(fileExt) && fileSize > this.MAX_PDF_SIZE) {
            throw new Error(`PDF 文件大小超出限制（最大 ${this.MAX_PDF_SIZE / 1024 / 1024}MB）`);
        } else if (fileSize > this.MAX_FILE_SIZE) {
            throw new Error(`文件大小超出限制（最大 ${this.MAX_FILE_SIZE / 1024 / 1024}MB）`);
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
                const fixedName = Buffer.from(fileName, 'latin1').toString('utf-8');
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
        const lastDotIndex = fileName.lastIndexOf('.');
        const displayName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;

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
        return match ? match[1] : '';
    }

    /**
     * 上传图片文件
     */
    async uploadImageFile(sessionId: string, file: any, fileInfo: any, userId: string) {
        try {
            // 保存图片
            const { url, previewUrl, metadata } = await this.saveImageWithMetadata(file);

            // 计算哈希
            const contentHash = this.calculateContentHash(file.buffer);

            // 保存到数据库
            return await this.fileRepo.create({
                sessionId,
                fileName: fileInfo.fileName,
                displayName: fileInfo.displayName,
                fileSize: fileInfo.fileSize,
                fileType: 'image',
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
    async uploadPdfFile(sessionId: string, file: any, fileInfo: any, userId: string) {
        try {
            // 保存 PDF 文件
            const url = await this.saveFile(file, fileInfo.fileExt);

            // TODO: 解析 PDF 内容（需要安装 pdf-parse 或类似库）
            // const fileContent = await this.parsePdfFile(filePath);
            const fileContent = null; // 暂时不提取文本

            // 计算哈希
            const contentHash = this.calculateContentHash(file.buffer);

            // 保存到数据库
            return await this.fileRepo.create({
                sessionId,
                fileName: fileInfo.fileName,
                displayName: fileInfo.displayName,
                fileSize: fileInfo.fileSize,
                fileType: 'text',
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
    async uploadTextFile(sessionId: string, file: any, fileInfo: any, userId: string) {
        try {
            // 读取文件内容
            const fileContent = file.buffer.toString('utf-8');

            // 计算哈希
            const contentHash = this.calculateContentHash(file.buffer);

            // 保存到数据库
            return await this.fileRepo.create({
                sessionId,
                fileName: fileInfo.fileName,
                displayName: fileInfo.displayName,
                fileSize: fileInfo.fileSize,
                fileType: 'text',
                fileExtension: fileInfo.fileExt,
                contentHash,
                uploadUserId: userId,
                content: fileContent,
            });
        } catch (error: any) {
            if (error instanceof Error && error.message.includes('utf-8')) {
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
        const imageDir = this.uploadPathService.getPhysicalPath('images');
        const previewDir = this.uploadPathService.getPhysicalPath('previews');

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
            await imageProcessor.clone()
                .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(filePath);

            // 2. 生成缩略图（最大边长 256px）
            await sharp(file.buffer)
                .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 75 })
                .toFile(previewPath);

            const url = this.uploadPathService.getWebUrl('images', uniqueFilename);
            const previewUrl = this.uploadPathService.getWebUrl('previews', uniqueFilename);

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
        const fileDir = this.uploadPathService.getPhysicalPath('files');

        // 生成唯一文件名
        const uniqueFilename = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = path.join(fileDir, uniqueFilename);

        // 保存文件
        fs.writeFileSync(filePath, file.buffer);

        return this.uploadPathService.getWebUrl('files', uniqueFilename);
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
            throw new Error('Message not found');
        }

        const originalFile = await this.fileRepo.findById(fileId);
        if (!originalFile) {
            throw new Error('File not found');
        }

        // 创建新的文件记录
        return await this.fileRepo.create({
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
    }

    /**
     * 计算文件哈希
     */
    private calculateContentHash(buffer: Buffer): string {
        return crypto.createHash('md5').update(buffer).digest('hex');
    }
}
