import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AgentFileStore } from '../../agents/agent-file.store';
import {
  SessionMetaStore,
  toRow,
} from '../../chat/session-meta.store';
import { ChatRunnerService } from '../../chat/chat-runner.service';
import { normalizeTurnSettingsOverride } from '../../chat/types/turn-settings-override';
import { BotFileInstance, BotFileStore } from '../bot-file.store';
import { BotInstanceManager } from './bot-instance-manager.service';
import { SessionMapperService } from './session-mapper.service';
import { PLATFORM_METADATA } from '../constants/platform-metadata';
import {
  CreateBotDto,
  SendBotSessionMessageDto,
  UpdateBotDto,
} from '../dto/bot-admin.dto';
import { BotConfig, BotStatus } from '../interfaces/bot-platform.interface';
import { buildChatGroups, type ChatBotMeta } from '../utils/chat-groups';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { assertResolvableModelRef } from '../../llm-core/utils/model-reference.util';
import { EventBusService } from '../../../common/events/event-bus.service';
import type { BotChangedEvent } from '../../../common/events/stream.events';

@Injectable()
export class BotAdminService {
  private readonly logger = new Logger(BotAdminService.name);

  constructor(
    private instanceManager: BotInstanceManager,
    private modelStore: ProviderFileStore,
    private agentStore: AgentFileStore,
    private sessionStore: SessionMetaStore,
    private botStore: BotFileStore,
    private sessionMapper: SessionMapperService,
    private chatRunner: ChatRunnerService,
    private eventBus: EventBusService,
  ) {}

  /**
   * 广播机器人配置变化（SessionEventsService 转为 SSE 的 bot_changed），用于多窗口同步。
   * 本地窗口仍走各自的 @changed 回调，不依赖事件回环。
   */
  private emitBotChanged(
    action: BotChangedEvent['action'],
    botId?: string,
  ): void {
    this.eventBus.emit('bot.changed', {
      ...(botId ? { botId } : {}),
      timestamp: new Date().toISOString(),
      action,
    });
  }

  /**
   * 获取所有平台元数据(包含配置字段定义)
   */
  getPlatforms() {
    // 直接返回完整的平台元数据,包含 fields
    return Object.values(PLATFORM_METADATA);
  }

  /**
   * 获取指定平台的配置字段定义
   */
  getPlatformFields(platform: string) {
    const metadata = PLATFORM_METADATA[platform];
    if (!metadata) {
      throw new NotFoundException(`Platform ${platform} not supported`);
    }
    return metadata.fields;
  }

  /**
   * 获取所有机器人实例（顺序与侧栏分组一致：sortOrder 优先）
   */
  async getAllInstances() {
    const instances = this.botStore.listOrdered();

    // 附加运行时状态
    return instances.map(instance => ({
      ...instance,
      runtimeStatus: this.instanceManager.getStatus(instance.id),
    }));
  }

  /**
   * 按前端拖拽后的 id 顺序回写 sortOrder。
   */
  async reorderInstances(orderedIds: string[]) {
    const reordered = await this.botStore.reorder(orderedIds);
    this.emitBotChanged('reordered');
    return reordered.map(instance => ({
      id: instance.id,
      sortOrder: instance.sortOrder,
      runtimeStatus: this.instanceManager.getStatus(instance.id),
    }));
  }

  /**
   * 获取 Bot 会话列表
   */
  async getBotSessions(skip: number, limit: number, botId?: string) {
    const { rows, total } = this.sessionStore.queryPaged(
      { sessionType: "bot", ...(botId ? { botId } : {}) },
      "lastActiveDesc",
      { skip, limit },
    );
    const items = rows.map((m) => toRow(m));

    const charMap = await this.agentStore.findManyByIds(
      items
        .map((s: any) => s.agentId)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
    );

    return {
      items: items.map((s: any) => ({
        ...s,
        agent: s.agentId ? charMap.get(s.agentId) ?? null : null,
      })),
      total,
      page: Math.floor(skip / limit) + 1,
      pageSize: limit,
    };
  }

  /**
   * 微信式会话工作台：按「机器人 → 用户」聚合 Bot 会话。
   */
  async getChatGroups(perBotLimit = 200) {
    await this.sessionStore.initialize();

    const sessions = this.sessionStore.query(
      { sessionType: 'bot' },
      'lastActiveDesc',
    );

    const bots: ChatBotMeta[] = this.botStore.listOrdered().map((bot) => {
      const runtimeStatus = this.instanceManager.getStatus(bot.id);
      return {
        id: bot.id,
        name: bot.name,
        platform: bot.platform,
        enabled: bot.enabled,
        status: bot.status,
        runtimeStatus: runtimeStatus ?? null,
        online: runtimeStatus === BotStatus.CONNECTED,
        sortOrder: bot.sortOrder,
      };
    });

    const limit =
      Number.isFinite(perBotLimit) && perBotLimit > 0
        ? Math.min(Math.floor(perBotLimit), 1000)
        : 200;

    return {
      groups: buildChatGroups(sessions, bots, limit),
    };
  }

  /**
   * 单个 Bot 会话详情：带动态挂载的 agent/model，供右侧 ChatPanel 复用。
   */
  async getSessionDetail(sessionId: string) {
    const raw = this.sessionStore.get(sessionId);
    if (!raw) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    if (raw.sessionType !== 'bot') {
      throw new BadRequestException('Not a bot session');
    }

    const instance = raw.botId ? this.botStore.findById(raw.botId) : null;
    const session = { ...raw };
    let warning: string | null = null;
    let canReply = false;
    let bot: {
      id: string;
      name: string;
      platform: string;
      enabled: boolean;
      runtimeStatus: string | null;
      online: boolean;
      supportsPushMessage: boolean;
    } | null = null;

    if (!instance) {
      warning = '机器人不存在或已删除，仅可查看历史记录';
    } else {
      const runtimeStatus = this.instanceManager.getStatus(instance.id);
      const adapter = this.instanceManager.getAdapter(instance.id);
      bot = {
        id: instance.id,
        name: instance.name,
        platform: instance.platform,
        enabled: instance.enabled,
        runtimeStatus: runtimeStatus ?? null,
        online: runtimeStatus === BotStatus.CONNECTED,
        supportsPushMessage:
          adapter?.getCapabilities().supportsPushMessage ?? false,
      };

      try {
        await this.sessionMapper.enrichSession(session, {
          defaultAgentId: instance.defaultAgentId,
          defaultModelId: instance.defaultModelId,
          defaultThinkingEffort: instance.defaultThinkingEffort,
        });
        canReply = !!session.agent && !!session.modelId;
      } catch (error: any) {
        warning = error?.message ?? '机器人配置不完整，仅可查看历史记录';
      }
    }

    // session.modelSource（session/bot/agent）由 enrichSession 在内存中写入，
    // 仅用于前端区分「用户显式选择」与「跟随默认」，不落库。
    return {
      session: {
        ...session,
        agent: session.agent ?? null,
        model: session.model ?? null,
      },
      bot,
      canReply,
      warning,
    };
  }

  /**
   * 管理台续聊：在 Bot 会话中继续一轮对话。
   *
   * 本期只把消息写入会话并让 AI 正常回复，不回推 IM；
   * forwardToPlatform 预留给后续版本。
   */
  async sendSessionMessage(sessionId: string, dto: SendBotSessionMessageDto) {
    const raw = this.sessionStore.get(sessionId);
    if (!raw) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    if (raw.sessionType !== 'bot') {
      throw new BadRequestException('Not a bot session');
    }
    if (!raw.botId) {
      throw new BadRequestException('会话未关联机器人');
    }
    if (!dto.content?.trim() && !dto.files?.length) {
      throw new BadRequestException('消息内容不能为空');
    }

    const instance = this.botStore.findById(raw.botId);
    if (!instance) {
      throw new NotFoundException('机器人不存在或已删除');
    }

    const session = { ...raw };
    try {
      await this.sessionMapper.enrichSession(session, {
        defaultAgentId: instance.defaultAgentId,
        defaultModelId: instance.defaultModelId,
        defaultThinkingEffort: instance.defaultThinkingEffort,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ?? '机器人配置不完整，无法继续对话',
      );
    }

    if (dto.forwardToPlatform) {
      throw new BadRequestException('当前版本暂不支持回推消息到 IM 平台');
    }

    const settingsOverride = normalizeTurnSettingsOverride(
      dto.settingsOverride,
    );

    await this.chatRunner.startStream({
      sessionId,
      userMessage: {
        content: dto.content ?? '',
        files: dto.files as any,
        replaceTurnId: dto.replaceTurnId,
        knowledgeBaseIds: dto.knowledgeBaseIds,
      },
      source: { origin: 'bot-admin', botId: raw.botId },
      preloadedSession: session,
      ...(settingsOverride ? { settingsOverride } : {}),
    });

    return { ok: true, started: true };
  }

  /**
   * 从文件实例构造 orchestrator/chatRunner 共用的 BotConfig。
   */
  private buildBotConfig(instance: BotFileInstance): BotConfig {
    return {
      id: instance.id,
      platform: instance.platform as any,
      name: instance.name,
      platformConfig: instance.platformConfig as any,
      enabled: instance.enabled,
      reconnectConfig: {
        enabled: instance.reconnectEnabled,
        maxRetries: instance.maxRetries,
        retryInterval: instance.retryInterval,
      },
      defaultAgentId: instance.defaultAgentId || undefined,
      defaultModelId: instance.defaultModelId || undefined,
      defaultThinkingEffort: instance.defaultThinkingEffort || undefined,
      knowledgeBaseIds:
        (instance.additionalKwargs as any)?.knowledgeBaseIds || [],
    };
  }

  /**
   * 获取单个机器人实例
   */
  async getInstance(id: string) {
    const instance = this.botStore.findById(id);

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    return {
      ...instance,
      runtimeStatus: this.instanceManager.getStatus(instance.id),
    };
  }

  /**
   * 创建新机器人
   */
  async createInstance(dto: CreateBotDto) {
    // 验证平台是否支持
    if (!PLATFORM_METADATA[dto.platform]) {
      throw new BadRequestException(`Unsupported platform: ${dto.platform}`);
    }

    // 验证必填字段
    const metadata = PLATFORM_METADATA[dto.platform];
    const missingFields = metadata.fields
      .filter(f => f.required && !dto.platformConfig[f.key])
      .map(f => f.key);

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields: ${missingFields.join(', ')}`,
      );
    }

    // 验证 defaultAgentId 必填
    if (!dto.defaultAgentId) {
      throw new BadRequestException('defaultAgentId is required for bot instance');
    }

    // 保存到文件（权威来源 bots/<id>.yaml）
    assertResolvableModelRef(this.modelStore, dto.defaultModelId, 'defaultModelId');
    const instance = await this.botStore.create({
      platform: dto.platform,
      name: dto.name,
      platformConfig: dto.platformConfig,
      reconnectEnabled: dto.reconnectConfig?.enabled ?? true,
      maxRetries: dto.reconnectConfig?.maxRetries ?? 5,
      retryInterval: dto.reconnectConfig?.retryInterval ?? 5000,
      defaultAgentId: dto.defaultAgentId,
      defaultModelId: dto.defaultModelId ?? null,
      defaultThinkingEffort: dto.defaultThinkingEffort ?? null,
      additionalKwargs: dto.additionalKwargs || null,
      enabled: true,
      status: 'stopped',
    });
    this.emitBotChanged('created', instance.id);

    // 如果启用了自动启动,则立即启动
    if (dto.autoStart) {
      await this.startInstance(instance.id);
    }

    return instance;
  }

  /**
   * 更新机器人配置
   */
  async updateInstance(id: string, dto: UpdateBotDto) {
    const instance = this.botStore.findById(id);

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    const updateData: any = {};
    
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.platformConfig !== undefined) updateData.platformConfig = dto.platformConfig;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
    if (dto.defaultAgentId !== undefined) updateData.defaultAgentId = dto.defaultAgentId;
    if (dto.defaultModelId !== undefined) updateData.defaultModelId = dto.defaultModelId;
    if (dto.defaultThinkingEffort !== undefined) updateData.defaultThinkingEffort = dto.defaultThinkingEffort;
    if (dto.additionalKwargs !== undefined) updateData.additionalKwargs = dto.additionalKwargs;
    if (updateData.defaultModelId !== undefined) {
      assertResolvableModelRef(this.modelStore, updateData.defaultModelId, 'defaultModelId');
    }
    
    if (dto.reconnectConfig) {
      if (dto.reconnectConfig.enabled !== undefined) {
        updateData.reconnectEnabled = dto.reconnectConfig.enabled;
      }
      if (dto.reconnectConfig.maxRetries !== undefined) {
        updateData.maxRetries = dto.reconnectConfig.maxRetries;
      }
      if (dto.reconnectConfig.retryInterval !== undefined) {
        updateData.retryInterval = dto.reconnectConfig.retryInterval;
      }
    }

    const updated = await this.botStore.update(id, updateData);
    if (!updated) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    // 处理启用状态变更
    if (dto.enabled !== undefined) {
      try {
        if (dto.enabled) {
          // 启用机器人，尝试启动
          await this.startInstance(id);
        } else {
          // 禁用机器人，停止运行
          await this.stopInstance(id);
        }
      } catch (error: any) {
        this.logger.error(`Failed to ${dto.enabled ? 'start' : 'stop'} bot after enabled change: ${error.message}`);
      }
    }
    // 如果更新了平台配置（认证信息等），且机器人处于启用状态，需要重启以加载新配置
    else if (dto.platformConfig && updated.enabled) {
      try {
        await this.restartInstance(id);
      } catch (error: any) {
        this.logger.error(`Failed to restart bot after update: ${error.message}`);
      }
    }
    // 其他配置更新（智能体、模型、知识库等），重新加载内存中的配置
    else {
      try {
        await this.instanceManager.reloadBotConfig(id);
      } catch (error: any) {
        this.logger.error(`Failed to reload bot config: ${error.message}`);
      }
    }

    this.emitBotChanged('updated', id);
    return updated;
  }

  /**
   * 启动机器人
   */
  async startInstance(id: string) {
    const instance = this.botStore.findById(id);

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    // 如果机器人被禁用，先启用它
    if (!instance.enabled) {
      this.logger.log(`Bot ${id} is disabled, enabling it first...`);
      await this.botStore.update(id, { enabled: true });
    }

    // 构建 BotConfig（与编排器/续聊共用同一份字段映射）
    const config = this.buildBotConfig(instance);

    // 启动机器人
    await this.instanceManager.startBot(config);

    // 更新状态
    await this.botStore.update(id, {
      status: 'running',
      lastStartedAt: new Date().toISOString(),
      lastError: null,
    });

    return { success: true };
  }

  /**
   * 停止机器人
   */
  async stopInstance(id: string) {
    await this.instanceManager.stopBot(id);

    await this.botStore.update(id, {
      status: 'stopped',
    });

    return { success: true };
  }

  /**
   * 重启机器人
   */
  async restartInstance(id: string) {
    const instance = this.botStore.findById(id);

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    if (!instance.enabled) {
      throw new BadRequestException('Bot is disabled');
    }

    await this.stopInstance(id).catch(() => {});
    await this.startInstance(id);
    return { success: true };
  }

  /**
   * 删除机器人
   */
  async deleteInstance(id: string) {
    // 先停止
    await this.instanceManager.stopBot(id).catch(() => {});

    // 再删除
    await this.botStore.delete(id);
    this.emitBotChanged('deleted', id);

    return { success: true };
  }

  /**
   * 获取机器人登录二维码状态
   * @returns status: 'logged_in' | 'qr_ready' | 'verify_code_required' | 'pending' | 'unavailable'
   */
  getQrCodeStatus(id: string) {
    const adapter = this.instanceManager.getAdapter(id);
    if (!adapter) {
      return { status: 'unavailable', message: '机器人未启动' };
    }

    const botStatus = adapter.getStatus();

    // 已登录
    if (botStatus === BotStatus.CONNECTED) {
      return { status: 'logged_in', message: '已登录' };
    }

    // 连接中，优先提示需要输入数字配对码
    if (botStatus === BotStatus.CONNECTING) {
      if (adapter.getVerificationState?.() === 'pair_code') {
        return {
          status: 'verify_code_required',
          message: '请输入手机微信显示的数字配对码',
        };
      }
      const qrUrl = adapter.getQrCodeUrl?.();
      if (qrUrl) {
        return { status: 'qr_ready', qrCodeUrl: qrUrl };
      }
      return { status: 'pending', message: '二维码生成中，请稍后再试' };
    }

    return { status: 'unavailable', message: '机器人未处于登录状态' };
  }

  /**
   * 提交扫码登录的数字配对码
   */
  async submitVerification(id: string, code: string) {
    const adapter = this.instanceManager.getAdapter(id);
    if (!adapter) {
      throw new NotFoundException('机器人未启动');
    }

    if (!adapter.submitVerificationCode) {
      throw new BadRequestException('当前平台不支持提交数字配对码');
    }

    try {
      adapter.submitVerificationCode(code);
    } catch (error: any) {
      throw new BadRequestException(error?.message ?? '数字配对码提交失败');
    }

    return { success: true, message: '数字配对码已提交' };
  }

  /**
   * 退出机器人登录
   */
  async logout(id: string) {
    const adapter = this.instanceManager.getAdapter(id);
    if (!adapter) {
      throw new NotFoundException('机器人未启动');
    }

    if (adapter.logout) {
      await adapter.logout();
      return { success: true, message: '已退出登录' };
    }

    return { success: false, message: '当前平台不支持退出登录' };
  }
}
