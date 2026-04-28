import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { MessageRepository } from '../../../common/database/message.repository';
import { SettingsStorage } from '../../../common/utils/settings-storage.util';
import { SG_MODELS, SK_MOD_CHAT } from '../../../constants/settings.constants';
import { KnowledgeBaseRepository } from '../../../common/database/knowledge-base.repository';
import { UploadPathService } from '../../../common/services/upload-path.service';

/**
 * 会话映射服务
 *
 * 负责将外部平台用户映射到内部 Session
 */
@Injectable()
export class SessionMapperService {
  private readonly logger = new Logger(SessionMapperService.name);

  constructor(
    private prisma: PrismaService,
    private messageRepo: MessageRepository,
    private settingsStorage: SettingsStorage,
    private kbRepo: KnowledgeBaseRepository,
    private uploadPathService: UploadPathService,
  ) { }

  /**
   * 为 Bot 消息获取或创建会话
   * 
   * @param botId Bot 实例 ID
   * @param externalId 外部会话标识(由调用者根据平台策略组装)
   * @param platform 来源平台
   * @param defaultCharacterId 默认角色 ID
   * @param defaultModelId 默认模型 ID
   * @param title 会话标题(可选,不提供则自动生成)
   */
  async getOrCreateBotSession(
    botId: string,
    externalId: string,
    platform: string,
    defaultCharacterId: string,
    defaultModelId?: string,
    title?: string,
  ): Promise<any> {
    // 尝试查找已存在的会话
    let session = await this.prisma.session.findFirst({
      where: {
        botId,
        externalId,
        sessionType: 'bot',
        characterId: defaultCharacterId || null,
      },
    });

    if (!session) {
      // 查询机器人实例,获取创建者 userId
      const botInstance = await this.prisma.botInstance.findUnique({
        where: { id: botId },
        select: { userId: true },
      });

      if (!botInstance) {
        throw new Error(`Bot instance not found: ${botId}`);
      }

      // === 模型选择三级回退逻辑 ===
      let finalModelId: string | null = null;

      // 1. 优先使用传入的 defaultModelId
      if (defaultModelId) {
        finalModelId = defaultModelId;
      }
      // 2. 如果没有,查询角色是否有默认模型
      else if (defaultCharacterId) {
        const character = await this.prisma.character.findUnique({
          where: { id: defaultCharacterId },
          select: { modelId: true },
        });
        if (character?.modelId) {
          finalModelId = character.modelId;
        }
      }

      // 3. 如果还没有,使用全局默认对话模型
      if (!finalModelId) {
        // 从文件配置中获取默认对话模型
        finalModelId = this.settingsStorage.getSettingValue(
          SG_MODELS,
          SK_MOD_CHAT,
          null
        );
      }

      // 4. 如果都没有,抛出错误
      if (!finalModelId) {
        throw new Error('我还没有配置模型作为大脑，请先在设置中配置默认对话模型');
      }

      // 创建新会话,使用机器人创建者的 userId
      session = await this.prisma.session.create({
        data: {
          userId: botInstance.userId,  // 使用机器人创建者的用户ID
          sessionType: 'bot',
          botId,
          platform,
          externalId,
          characterId: defaultCharacterId,
          modelId: finalModelId,  // 使用解析后的模型ID
          title: title || this.generateBotSessionTitleFromExternalId(externalId),
          settings: {},
        },
      });
    }

    return session;
  }

  /**
   * 根据外部会话标识查找会话
   */
  async findByExternalId(
    botId: string,
    externalId: string,
    characterId?: string,
  ): Promise<any | null> {
    return this.prisma.session.findFirst({
      where: {
        botId,
        externalId,
        sessionType: 'bot',
        characterId: characterId || null,
      },
    });
  }

  /**
   * 查询某个 Bot 的所有会话
   */
  async findByBotId(botId: string): Promise<any[]> {
    return this.prisma.session.findMany({
      where: {
        botId,
        sessionType: 'bot',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  /**
   * 查询某个外部会话标识的所有会话(跨Bot)
   */
  async findByExternalIdOnly(
    externalId: string,
  ): Promise<any[]> {
    return this.prisma.session.findMany({
      where: {
        externalId,
        sessionType: 'bot',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  /**
   * 从 externalId 生成会话标题(简化版)
   */
  private generateBotSessionTitleFromExternalId(externalId: string): string {
    // externalId 格式: "platform:type:nativeId"
    const parts = externalId.split(':');
    if (parts.length >= 3) {
      const platform = parts[0].toUpperCase();
      const type = parts[1] === 'group' ? '群聊' : '私聊';
      const nativeId = parts[2].slice(0, 8);
      return `${platform} ${type} ${nativeId}`;
    }
    return `Bot Session ${externalId.slice(0, 8)}`;
  }

  /**
   * 创建用户消息
   * @param sessionId 会话 ID
   * @param content 消息内容
   * @param knowledgeBaseIds 引用的知识库 ID 列表(可选)
   */
  async createUserMessage(
    sessionId: string,
    content: string,
    knowledgeBaseIds?: string[],
    attachments?: Array<{
      type: 'image' | 'file' | 'voice' | 'video';
      url?: string;
      fileId?: string;
      fileName?: string;
      fileSize?: number;
    }>,
  ): Promise<any> {
    const message = await this.messageRepo.create({
      sessionId,
      role: 'user',
      parentId: null,
    });

    // 处理知识库引用逻辑
    let additionalKwargs: any = null;
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // 使用批量查询提升效率
      const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
      const kbMetadata = kbs.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
      }));
      additionalKwargs = { referencedKbs: kbMetadata };
    }

    await this.prisma.messageContent.create({
      data: {
        messageId: message.id,
        turnsId: this.generateTurnsId(),
        role: 'user',
        content,
        additionalKwargs,
      },
    });

    // 处理附件：将外部平台的附件转换为内部 File 记录
    if (attachments && attachments.length > 0) {
      await this.saveAttachments(message.id, sessionId, attachments);
    }

    return message;
  }

  /**
   * 保存附件到数据库
   */
  private async saveAttachments(
    messageId: string,
    sessionId: string,
    attachments: Array<{
      type: 'image' | 'file' | 'voice' | 'video';
      url?: string;
      fileId?: string;
      fileName?: string;
      fileSize?: number;
    }>,
  ): Promise<void> {
    for (const att of attachments) {
      try {
        // 确定文件类型
        let fileType = 'text';
        if (att.type === 'image') {
          fileType = 'image';
        } else if (att.type === 'voice' || att.type === 'video') {
          fileType = 'binary';
        }

        // 提取文件扩展名
        const fileExt = att.fileName ? att.fileName.split('.').pop()?.toLowerCase() || '' : '';

        // 如果有外部 URL，先下载到本地
        let localUrl = att.url;
        let previewUrl: string | undefined;
        let contentHash = att.fileId || '';

        if (att.url && (att.type === 'image' || att.type === 'file')) {
          try {
            const downloadResult = await this.downloadAndSaveFile(
              att.url,
              sessionId,
              messageId,
              att.fileName || `${att.fileId || 'attachment'}.${fileExt}`,
              fileType,
            );
            localUrl = downloadResult.url;
            previewUrl = downloadResult.previewUrl;
            contentHash = downloadResult.contentHash;
            this.logger.log(`Downloaded attachment from ${att.url} to ${localUrl}`);
          } catch (downloadError: any) {
            this.logger.error(`Failed to download attachment: ${downloadError.message}. Using original URL.`);
            // 下载失败时继续使用原始 URL
          }
        }

        // 创建 File 记录
        await this.prisma.file.create({
          data: {
            fileName: att.fileName || `${att.fileId || 'unknown'}.${fileExt}`,
            displayName: att.fileName || 'Attachment',
            fileSize: att.fileSize || 0,
            fileType,
            fileExtension: fileExt,
            url: localUrl,  // 使用本地路径
            previewUrl,     // 预览图路径（仅图片）
            contentHash,
            sessionId,
            messageId,
            isPublic: false,
            fileMetadata: {
              source: 'qq-bot',
              originalFileId: att.fileId,
              originalUrl: att.url,
            },
          },
        });

        this.logger.log(`Saved attachment: ${att.fileName || att.fileId}`);
      } catch (error: any) {
        this.logger.error(`Failed to save attachment: ${error.message}`);
      }
    }
  }

  /**
   * 下载并保存文件到本地存储
   */
  private async downloadAndSaveFile(
    url: string,
    sessionId: string,
    messageId: string,
    fileName: string,
    fileType: string,
  ): Promise<{ url: string; previewUrl?: string; contentHash: string }> {
    const crypto = await import('crypto');
    const fs = await import('fs');
    const path = await import('path');

    // 下载文件
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 计算内容哈希
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

    // 生成安全的文件名
    const safeFileName = `${messageId}_${contentHash}${path.extname(fileName)}`;

    // 根据文件类型选择子目录（参考 file.service.ts）
    let subDir: string;
    if (fileType === 'image') {
      subDir = 'images';  // 图片存到 images/
    } else {
      subDir = 'files';   // 其他文件存到 files/
    }

    // 使用 UploadPathService 获取存储路径（带 uploads/ 前缀）
    const storagePath = this.uploadPathService.getStoragePath(subDir, safeFileName);

    // 获取物理路径并保存文件
    const physicalPath = this.uploadPathService.toPhysicalPath(storagePath);
    const uploadDir = path.dirname(physicalPath);

    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 保存文件
    fs.writeFileSync(physicalPath, buffer);

    // 如果是图片，生成预览图（参考 file.service.ts）
    let previewUrl: string | undefined;
    if (fileType === 'image') {
      try {
        const sharp = (await import('sharp')).default;
        const previewSubDir = 'previews';
        const previewStoragePath = this.uploadPathService.getStoragePath(previewSubDir, safeFileName);
        const previewPhysicalPath = this.uploadPathService.toPhysicalPath(previewStoragePath);
        const previewDir = path.dirname(previewPhysicalPath);

        // 确保预览图目录存在
        if (!fs.existsSync(previewDir)) {
          fs.mkdirSync(previewDir, { recursive: true });
        }

        // 生成缩略图（最大边长 256px）
        await sharp(buffer)
          .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toFile(previewPhysicalPath);

        previewUrl = previewStoragePath;
        this.logger.log(`Generated preview for image: ${safeFileName}`);
      } catch (previewError: any) {
        this.logger.error(`Failed to generate preview: ${previewError.message}`);
        // 预览图生成失败不影响主流程
      }
    }

    // 返回存储路径（带 uploads/ 前缀）
    return {
      url: storagePath,
      previewUrl,
      contentHash,
    };
  }

  /**
   * 创建助手消息占位符
   */
  async createAssistantMessage(sessionId: string): Promise<string> {
    const message = await this.messageRepo.create({
      sessionId,
      role: 'assistant',
      parentId: null, // 需要根据实际逻辑设置
    });

    return message.id;
  }

  /**
   * 生成 turns ID
   */
  private generateTurnsId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}