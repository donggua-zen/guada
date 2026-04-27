import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { MessageRepository } from '../../../common/database/message.repository';
import { buildExternalId } from '../utils/external-id';
import { SettingsStorage } from '../../../common/utils/settings-storage.util';
import { SG_MODELS, SK_MOD_CHAT } from '../../../constants/settings.constants';

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
  ) {}

  /**
   * 为 Bot 消息获取或创建会话
   */
  async getOrCreateBotSession(
    botId: string,
    platform: string,
    type: 'private' | 'group',
    nativeId: string,        // 私聊=用户ID, 群聊=群ID
    defaultCharacterId?: string,
    defaultModelId?: string,
  ): Promise<any> {
    // 构建唯一的外部会话标识
    const externalId = buildExternalId(platform, type, nativeId);

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
          title: this.generateBotSessionTitle(platform, type, nativeId),
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
    platform: string,
    type: 'private' | 'group',
    nativeId: string,
    characterId?: string,
  ): Promise<any | null> {
    const externalId = buildExternalId(platform, type, nativeId);
    
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
    platform: string,
    type: 'private' | 'group',
    nativeId: string,
  ): Promise<any[]> {
    const externalId = buildExternalId(platform, type, nativeId);
    
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
   * 生成 Bot 会话标题
   */
  private generateBotSessionTitle(
    platform: string,
    type: 'private' | 'group',
    nativeId: string,
  ): string {
    const platformName = platform.toUpperCase();
    const typeName = type === 'private' ? '私聊' : '群聊';
    const shortId = nativeId.slice(0, 8);
    
    return `${platformName} ${typeName} ${shortId}`;
  }

  /**
   * 创建用户消息
   */
  async createUserMessage(
    sessionId: string,
    content: string,
    attachments?: any[],
  ): Promise<any> {
    const message = await this.messageRepo.create({
      sessionId,
      role: 'user',
      parentId: null,
    });

    // TODO: 如果有附件,创建 File 记录并关联

    await this.prisma.messageContent.create({
      data: {
        messageId: message.id,
        turnsId: this.generateTurnsId(),
        role: 'user',
        content,
      },
    });

    return message;
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