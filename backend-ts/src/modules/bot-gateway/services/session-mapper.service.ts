import { Injectable, Logger } from '@nestjs/common';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { SessionMetaStore } from '../../chat/session-meta.store';
import { AgentFileStore } from '../../agents/agent-file.store';
import { WorkspaceService } from '../../../common/services/workspace.service';
import { BotFileStore } from '../bot-file.store';
import { isMeaningfulSenderName } from '../utils/bot-user';

/** Bot 会话动态 enrich 所需的最小配置切片 */
export interface BotSessionEnrichConfig {
  defaultAgentId: string;
  defaultModelId?: string | null;
  defaultThinkingEffort?: string | null;
}

/** 私聊用户身份（用于左侧会话列表展示） */
export interface BotUserIdentity {
  id?: string;
  name?: string;
  /** 平台提供的用户头像 URL（可选） */
  avatarUrl?: string;
}

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
    private sessionStore: SessionMetaStore,
    private agentStore: AgentFileStore,
    private workspaceService: WorkspaceService,
    private botStore: BotFileStore,
  ) { }

  /**
   * 为 Bot 消息获取或创建会话
   * 
   * @param botId Bot 实例 ID
   * @param externalId 外部会话标识(由调用者根据平台策略组装)
   * @param platform 来源平台
   * @param defaultAgentId 默认智能体 ID
   * @param defaultModelId 默认模型 ID（可选，用于模型解析优先级）
   * @param defaultThinkingEffort 默认思考强度（可选，动态注入到 session.settings）
   * @param title 会话标题(可选,不提供则自动生成)
   * @param botUser 私聊发送者身份（可选，写入 session.data.botUser 供会话列表展示）
   */
  async getOrCreateBotSession(
    botId: string,
    externalId: string,
    platform: string,
    defaultAgentId: string,
    defaultModelId?: string | null,
    defaultThinkingEffort?: string | null,
    title?: string,
    botUser?: BotUserIdentity,
  ): Promise<{ session: any; created: boolean }> {
    const normalizedBotUser = this.normalizeBotUser(botUser);

    // 尝试查找已存在的会话（Bot 会话的 agentId 为 null）
    let session = this.sessionStore.findByBotAndExternalId(
      botId,
      externalId,
    );
    const created = !session;

    if (!session) {
      // 校验机器人实例存在（权威来源 bots/<id>.yaml）
      if (!this.botStore.findById(botId)) {
        throw new Error(`Bot instance not found: ${botId}`);
      }

      // 注意：不设置 agentId 和 modelId，都由下游动态解析
      // Bot 会话工作目录使用 BOT 前缀，与 Web 会话的 WORK 前缀区分
      const workspacePath = await this.workspaceService.generateWorkspaceDir('BOT');
      session = await this.sessionStore.create({
        sessionType: 'bot',
        botId,
        platform,
        externalId,
        agentId: null, // 不存储 agentId，动态从 Bot 实例读取
        // modelId 不设置，保持 null，由下游动态解析
        title: title || this.generateBotSessionTitleFromExternalId(externalId),
        settings: {},
        workspacePath,
        data: normalizedBotUser ? { botUser: normalizedBotUser } : undefined,
      });

    } else {
      await this.backfillBotUser(session, normalizedBotUser);
    }

    // 动态挂载 agent 和 model（确保与 Bot 配置同步）
    await this.enrichSession(session, {
      defaultAgentId,
      defaultModelId,
      defaultThinkingEffort,
    });

    return { session, created };
  }

  /**
   * 为 Bot 会话动态挂载 agent / model / 思考强度。
   *
   * 供会话详情、管理员续聊等非消息链路复用；调用方负责 catch，
   * 因为 Bot 配置被删除/改坏时这里会抛错。
   */
  async enrichSession(
    session: any,
    config: BotSessionEnrichConfig,
  ): Promise<void> {
    await this.enrichBotSessionAgent(session, config.defaultAgentId);
    await this.enrichBotSessionModel(session, config.defaultModelId);
    this.enrichBotSessionThinkingEffort(session, config.defaultThinkingEffort);
  }

  /**
   * 归一化用户身份：丢弃占位昵称/空值，避免把“用户”“Unknown”写进会话列表。
   */
  private normalizeBotUser(
    botUser?: BotUserIdentity,
  ): BotUserIdentity | undefined {
    if (!botUser) return undefined;

    const name = isMeaningfulSenderName(botUser.name, botUser.id)
      ? botUser.name?.trim()
      : undefined;
    const avatarUrl = botUser.avatarUrl?.trim() || undefined;

    // 只有 id、没有昵称/头像时不写 botUser：externalId 已经能定位用户，
    // 空的 botUser 只会让前端误以为存在用户资料。
    if (!name && !avatarUrl) return undefined;

    return {
      ...(botUser.id ? { id: botUser.id } : {}),
      ...(name ? { name } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };
  }

  /**
   * 已有会话首次拿到昵称/头像时回填，保留 data 中的其他键（含 settings）。
   * name 与 avatarUrl 独立判断：任一缺失都可以补，已有真实值不被覆盖。
   */
  private async backfillBotUser(
    session: any,
    botUser?: BotUserIdentity,
  ): Promise<void> {
    if (!botUser) return;

    const existing = session.data?.botUser;
    const next: Record<string, any> = { ...(existing ?? {}) };
    let changed = false;

    if (botUser.id && !next.id) {
      next.id = botUser.id;
      changed = true;
    }
    if (botUser.name && !isMeaningfulSenderName(next.name, botUser.id)) {
      next.name = botUser.name;
      changed = true;
    }
    if (botUser.avatarUrl && !next.avatarUrl) {
      next.avatarUrl = botUser.avatarUrl;
      changed = true;
    }
    if (!changed) return;

    const data = {
      ...(session.data ?? {}),
      botUser: next,
    };

    await this.sessionStore.update(session.id, { data });
    session.data = data;
  }

  /**
   * 为 Bot 会话动态解析并挂载 agent 信息
   * 
   * 从 Bot 实例的 defaultAgentId 中读取智能体配置
   * 这样确保修改 Bot 的默认智能体后立即生效，无需重启
   * 
   * @param session 会话对象
   * @param defaultAgentId Bot 实例配置的默认智能体 ID
   */
  private async enrichBotSessionAgent(session: any, defaultAgentId: string): Promise<void> {
    if (!defaultAgentId) {
      throw new Error('Bot 实例未配置默认智能体');
    }

    // 查询智能体信息（权威来源 agents/<id>/AGENT.md）
    const agent = await this.agentStore.findById(defaultAgentId);

    if (!agent) {
      throw new Error(`智能体不存在：${defaultAgentId}，请检查 Bot 实例的智能体配置`);
    }

    // 将 agent 对象挂载到 session，模拟 include 的效果
    session.agent = agent;
    session.agentId = agent.id;
  }

  /**
   * 为 Bot 会话动态解析并挂载 model 信息
   * 
   * 优先级链：Bot实例配置 -> 智能体配置 -> 全局默认设置
   * 这样确保 Bot 会话的模型配置与智能体/全局设置实时同步
   * 
   * 注意：此方法仅用于 Bot 会话，不影响 Web 会话等其他模块
   * 注意：调用此方法前必须先调用 enrichBotSessionAgent 挂载 agent
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

    // 2. 其次使用智能体的 modelId（agent 已通过 enrichBotSessionAgent 挂载）
    if (!modelId && session.agent?.modelId) {
      modelId = session.agent.modelId;
    }

    // 全局默认对话模型已移除：Bot 和智能体都没有配置时直接报错
    if (!modelId) {
      throw new Error('我还没有配置模型作为大脑，请先在 Bot 配置或智能体设置中选择模型');
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
