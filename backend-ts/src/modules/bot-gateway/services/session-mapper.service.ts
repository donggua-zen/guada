import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../common/database/prisma.service';
import { MessageRepository } from '../../../common/database/message.repository';
import { SessionRepository } from '../../../common/database/session.repository';
import { SettingsStorage } from '../../../common/utils/settings-storage.util';
import { SG_MODELS, SK_MOD_CHAT } from '../../../constants/settings.constants';
import { KnowledgeBaseRepository } from '../../../common/database/knowledge-base.repository';
import { UploadPathService } from '../../../common/services/upload-path.service';
import { WorkspaceService } from '../../../common/services/workspace.service';
import { appendResetMarker } from '../utils/external-id';
import { TempFileManager } from './temp-file-manager.service';

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
    private sessionRepo: SessionRepository,
    private settingsStorage: SettingsStorage,
    private kbRepo: KnowledgeBaseRepository,
    private uploadPathService: UploadPathService,
    private workspaceService: WorkspaceService,
    private tempFileManager: TempFileManager,
  ) { }

  /**
   * 为 Bot 消息获取或创建会话
   * 
   * @param botId Bot 实例 ID
   * @param externalId 外部会话标识(由调用者根据平台策略组装)
   * @param platform 来源平台
   * @param defaultCharacterId 默认角色 ID
   * @param defaultModelId 默认模型 ID（可选，用于模型解析优先级）
   * @param title 会话标题(可选,不提供则自动生成)
   */
  async getOrCreateBotSession(
    botId: string,
    externalId: string,
    platform: string,
    defaultCharacterId: string,
    defaultModelId?: string | null,
    title?: string,
  ): Promise<any> {
    // 尝试查找已存在的会话（Bot 会话的 characterId 为 null）
    let session = await this.sessionRepo.findByBotAndExternalId(
      botId,
      externalId,
    );

    if (!session) {
      // 查询机器人实例,获取创建者 userId
      const botInstance = await this.prisma.botInstance.findUnique({
        where: { id: botId },
        select: { userId: true },
      });

      if (!botInstance) {
        throw new Error(`Bot instance not found: ${botId}`);
      }

      // 创建新会话,使用机器人创建者的 userId
      // 注意：不设置 characterId 和 modelId，都由下游动态解析
      // Bot 会话工作目录使用 BOT 前缀，与 Web 会话的 WORK 前缀区分
      const workspacePath = this.workspaceService.generateWorkspaceDir('BOT');
      session = await this.prisma.session.create({
        data: {
          userId: botInstance.userId,  // 使用机器人创建者的用户ID
          sessionType: 'bot',
          botId,
          platform,
          externalId,
          characterId: null, // 不存储 characterId，动态从 Bot 实例读取
          // modelId 不设置，保持 null，由下游动态解析
          title: title || this.generateBotSessionTitleFromExternalId(externalId),
          settings: {},
          workspacePath,
        },
      });

    }

    // 动态挂载 character 和 model（确保与 Bot 配置同步）
    await this.enrichBotSessionCharacter(session, defaultCharacterId);
    await this.enrichBotSessionModel(session, defaultModelId);

    return session;
  }

  /**
   * 为 Bot 会话动态解析并挂载 character 信息
   * 
   * 从 Bot 实例的 defaultCharacterId 中读取角色配置
   * 这样确保修改 Bot 的默认角色后立即生效，无需重启
   * 
   * @param session 会话对象
   * @param defaultCharacterId Bot 实例配置的默认角色 ID
   */
  private async enrichBotSessionCharacter(session: any, defaultCharacterId: string): Promise<void> {
    if (!defaultCharacterId) {
      throw new Error('Bot 实例未配置默认角色');
    }

    // 查询角色信息
    const character = await this.prisma.character.findUnique({
      where: { id: defaultCharacterId },
    });

    if (!character) {
      throw new Error(`角色不存在：${defaultCharacterId}，请检查 Bot 实例的角色配置`);
    }

    // 将 character 对象挂载到 session，模拟 include 的效果
    session.character = character;
    session.characterId = character.id;
  }

  /**
   * 为 Bot 会话动态解析并挂载 model 信息
   * 
   * 优先级链：Bot实例配置 -> 角色配置 -> 全局默认设置
   * 这样确保 Bot 会话的模型配置与角色/全局设置实时同步
   * 
   * 注意：此方法仅用于 Bot 会话，不影响 Web 会话等其他模块
   * 注意：调用此方法前必须先调用 enrichBotSessionCharacter 挂载 character
   * 
   * @param session 会话对象
   * @param defaultModelId Bot 实例配置的默认模型 ID（可选）
   */
  private async enrichBotSessionModel(session: any, defaultModelId?: string | null): Promise<void> {
    let modelId: string | null = null;

    // 1. 优先使用传入的 defaultModelId（如果用户在 Bot 配置中明确选择了模型）
    if (defaultModelId) {
      modelId = defaultModelId;
    }

    // 2. 其次使用角色的 modelId（character 已通过 enrichBotSessionCharacter 挂载）
    if (!modelId && session.character?.modelId) {
      modelId = session.character.modelId;
    }

    // 3. 最后使用全局默认对话模型
    if (!modelId) {
      modelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
        null
      );
    }

    // 3. 如果无法解析模型ID，抛出错误
    if (!modelId) {
      throw new Error('我还没有配置模型作为大脑，请先在设置中配置默认对话模型');
    }

    // 4. 查询并验证模型是否存在（isActive 只影响前端展示，不影响实际使用）
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      include: {
        provider: true,
      },
    });

    if (!model) {
      throw new Error(`模型不存在：${modelId}，请检查 Bot 实例的模型配置`);
    }

    // 5. 将 model 对象挂载到 session，模拟 include 的效果
    session.model = model;
    session.modelId = model.id;
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
  ): Promise<any> {
    const message = await this.messageRepo.create({
      sessionId,
      role: 'user',
      parentId: null,
    });

    // 处理知识库引用逻辑
    let metadata: any = null;
    if (knowledgeBaseIds && knowledgeBaseIds.length > 0) {
      // 使用批量查询提升效率
      const kbs = await this.kbRepo.findByIds(knowledgeBaseIds);
      const kbMetadata = kbs.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
      }));
      metadata = { referencedKbs: kbMetadata };
    }

    await this.prisma.messageContent.create({
      data: {
        messageId: message.id,
        turnsId: this.generateTurnsId(),
        role: 'user',
        content,
        metadata,
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
   * 清空会话（通过修改 externalId 实现软清空）
   * 
   * 原理：
   * 1. 为当前会话的 externalId 添加时间戳后缀
   * 2. 更新数据库中的 externalId 字段
   * 3. 后续消息因找不到匹配的 externalId，会创建新 session
   * 4. 旧 session 及其消息保留在数据库中，但不再接收新消息
   * 
   * @param sessionId 要清空的会话 ID
   * @returns 新的 externalId（用于前端显示或日志）
   */
  async clearSession(sessionId: string): Promise<string> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.sessionType !== 'bot') {
      throw new Error('Only bot sessions can be cleared using this method');
    }

    const oldExternalId = session.externalId;
    const newExternalId = appendResetMarker(oldExternalId);

    this.logger.log(
      `Clearing session ${sessionId}: ${oldExternalId} -> ${newExternalId}`,
    );

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        externalId: newExternalId,
        title: `${session.title || '会话'} (已清空)`,
      },
    });

    return newExternalId;
  }

  /**
   * 获取会话的历史版本列表（所有被清空的版本）
   * 
   * @param baseExternalId 基础 externalId（不含时间戳后缀）
   * @param botId Bot 实例 ID
   * @returns 按时间倒序排列的会话列表
   */
  async getSessionHistory(
    baseExternalId: string,
    botId: string,
  ): Promise<any[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        botId,
        sessionType: 'bot',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return sessions.filter((session) => {
      const extractedBase = this.extractBaseFromExternalId(session.externalId);
      return extractedBase === baseExternalId;
    });
  }

  /**
   * 从 externalId 提取基础部分（内部辅助方法）
   */
  private extractBaseFromExternalId(externalId: string): string {
    const atIndex = externalId.indexOf('@');
    if (atIndex === -1) {
      return externalId;
    }
    return externalId.substring(0, atIndex);
  }

  /**
   * 生成 turns ID
   */
  private generateTurnsId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}