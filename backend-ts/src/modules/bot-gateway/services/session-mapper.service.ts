import { Injectable, Logger } from '@nestjs/common';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { SessionRepository } from '../../../common/database/session.repository';
import { CharacterRepository } from '../../../common/database/character.repository';
import { SettingsStorage } from '../../../common/utils/settings-storage.util';
import { SG_MODELS, SK_MOD_CHAT } from '../../../constants/settings.constants';
import { WorkspaceService } from '../../../common/services/workspace.service';
import { BotFileStore } from '../bot-file.store';

/**
 * 会话映射服务
 *
 * 负责将外部平台用户映射到内部 Session。
 * 消息本身由 chatRunner 经 JSONL 事件日志落盘，本服务只处理会话映射。
 */
@Injectable()
export class SessionMapperService {
  private readonly logger = new Logger(SessionMapperService.name);

  constructor(
    private providerStore: ProviderFileStore,
    private sessionRepo: SessionRepository,
    private characterRepo: CharacterRepository,
    private settingsStorage: SettingsStorage,
    private workspaceService: WorkspaceService,
    private botStore: BotFileStore,
  ) { }

  /**
   * 为 Bot 消息获取或创建会话
   * 
   * @param botId Bot 实例 ID
   * @param externalId 外部会话标识(由调用者根据平台策略组装)
   * @param platform 来源平台
   * @param defaultCharacterId 默认角色 ID
   * @param defaultModelId 默认模型 ID（可选，用于模型解析优先级）
   * @param defaultThinkingEffort 默认思考强度（可选，动态注入到 session.settings）
   * @param title 会话标题(可选,不提供则自动生成)
   */
  async getOrCreateBotSession(
    botId: string,
    externalId: string,
    platform: string,
    defaultCharacterId: string,
    defaultModelId?: string | null,
    defaultThinkingEffort?: string | null,
    title?: string,
  ): Promise<any> {
    // 尝试查找已存在的会话（Bot 会话的 characterId 为 null）
    let session = await this.sessionRepo.findByBotAndExternalId(
      botId,
      externalId,
    );

    if (!session) {
      // 校验机器人实例存在（权威来源 bots/<id>.yaml）
      if (!this.botStore.findById(botId)) {
        throw new Error(`Bot instance not found: ${botId}`);
      }

      // 注意：不设置 characterId 和 modelId，都由下游动态解析
      // Bot 会话工作目录使用 BOT 前缀，与 Web 会话的 WORK 前缀区分
      const workspacePath = await this.workspaceService.generateWorkspaceDir('BOT');
      session = await this.sessionRepo.create({
        sessionType: 'bot',
        botId,
        platform,
        externalId,
        characterId: null, // 不存储 characterId，动态从 Bot 实例读取
        // modelId 不设置，保持 null，由下游动态解析
        title: title || this.generateBotSessionTitleFromExternalId(externalId),
        settings: {},
        workspacePath,
      });

    }

    // 动态挂载 character 和 model（确保与 Bot 配置同步）
    await this.enrichBotSessionCharacter(session, defaultCharacterId);
    await this.enrichBotSessionModel(session, defaultModelId);
    this.enrichBotSessionThinkingEffort(session, defaultThinkingEffort);

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

    // 查询角色信息（权威来源 agents/<id>/AGENT.md）
    const character = await this.characterRepo.findById(defaultCharacterId);

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

    // 0. 如果会话已有 modelId（用户通过 UI 选择的），优先使用
    if (session.modelId) {
      modelId = session.modelId;
    }

    // 1. 其次使用传入的 defaultModelId（如果用户在 Bot 配置中明确选择了模型）
    if (!modelId && defaultModelId) {
      modelId = defaultModelId;
    }

    // 2. 其次使用角色的 modelId（character 已通过 enrichBotSessionCharacter 挂载）
    if (!modelId && session.character?.modelId) {
      modelId = session.character.modelId;
    }

    // 3. 最后使用全局默认对话模型
    if (!modelId) {
      modelId = await this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
        null
      );
    }

    // 如果无法解析模型ID，抛出错误
    if (!modelId) {
      throw new Error('我还没有配置模型作为大脑，请先在设置中配置默认对话模型');
    }

    // 查询并验证模型是否存在
    const model = this.providerStore.findModel(modelId);

    if (!model) {
      throw new Error(`模型不存在：${modelId}，请检查 Bot 实例的模型配置`);
    }

    // 将 model 对象挂载到 session，模拟 include 的效果
    session.model = model;
    session.modelId = model.id;
  }

  /**
   * 为 Bot 会话动态注入思考强度设置
   *
   * 将 Bot 实例的 defaultThinkingEffort 注入到 session.settings.thinkingEffort（仅内存，不持久化）。
   * 这样确保修改 Bot 的思考强度后立即对所有会话生效，无需重启。
   * 仅对支持 thinking feature 的模型实际生效（由 PersistentSessionContext 判断）。
   *
   * @param session 会话对象
   * @param defaultThinkingEffort Bot 实例配置的默认思考强度（可选）
   */
  private enrichBotSessionThinkingEffort(
    session: any,
    defaultThinkingEffort?: string | null,
  ): void {
    if (!defaultThinkingEffort) return;

    if (!session.settings) session.settings = {};
    session.settings.thinkingEffort = defaultThinkingEffort;
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
}
