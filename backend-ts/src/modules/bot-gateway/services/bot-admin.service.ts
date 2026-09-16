import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CharacterFileStore } from '../../characters/character-file.store';
import {
  byLastActiveDesc,
  SessionFileStore,
} from '../../chat/session-file.store';
import { BotFileStore } from '../bot-file.store';
import { BotInstanceManager } from './bot-instance-manager.service';
import { PLATFORM_METADATA } from '../constants/platform-metadata';
import { CreateBotDto, UpdateBotDto } from '../dto/bot-admin.dto';
import { BotConfig, BotStatus } from '../interfaces/bot-platform.interface';
import { ProviderFileStore } from '../../llm-core/provider-file.store';
import { assertResolvableModelRef } from '../../llm-core/utils/model-reference.util';

@Injectable()
export class BotAdminService {
  private readonly logger = new Logger(BotAdminService.name);

  constructor(
    private instanceManager: BotInstanceManager,
    private modelStore: ProviderFileStore,
    private characterStore: CharacterFileStore,
    private sessionStore: SessionFileStore,
    private botStore: BotFileStore,
  ) {}

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
   * 获取所有机器人实例
   */
  async getAllInstances() {
    const instances = this.botStore
      .list()
      .sort((a, b) =>
        b.createdAt === a.createdAt
          ? a.id.localeCompare(b.id)
          : b.createdAt.localeCompare(a.createdAt),
      );

    // 附加运行时状态
    return instances.map(instance => ({
      ...instance,
      runtimeStatus: this.instanceManager.getStatus(instance.id),
    }));
  }

  /**
   * 获取 Bot 会话列表
   */
  async getBotSessions(skip: number, limit: number, botId?: string) {
    const rows = this.sessionStore.query(
      (m) => m.sessionType === "bot" && (botId ? m.botId === botId : true),
      byLastActiveDesc,
    );
    const items = rows
      .slice(skip, skip + limit)
      .map((m) => this.sessionStore.get(m.id)!);
    const total = rows.length;

    const charMap = await this.characterStore.findManyByIds(
      items
        .map((s: any) => s.characterId)
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
    );

    return {
      items: items.map((s: any) => ({
        ...s,
        character: s.characterId ? charMap.get(s.characterId) ?? null : null,
      })),
      total,
      page: Math.floor(skip / limit) + 1,
      pageSize: limit,
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

    // 验证 defaultCharacterId 必填
    if (!dto.defaultCharacterId) {
      throw new BadRequestException('defaultCharacterId is required for bot instance');
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
      defaultCharacterId: dto.defaultCharacterId,
      defaultModelId: dto.defaultModelId ?? null,
      defaultThinkingEffort: dto.defaultThinkingEffort ?? null,
      additionalKwargs: dto.additionalKwargs || null,
      enabled: true,
      status: 'stopped',
    });

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
    if (dto.defaultCharacterId !== undefined) updateData.defaultCharacterId = dto.defaultCharacterId;
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
    // 其他配置更新（角色、模型、知识库等），重新加载内存中的配置
    else {
      try {
        await this.instanceManager.reloadBotConfig(id);
      } catch (error: any) {
        this.logger.error(`Failed to reload bot config: ${error.message}`);
      }
    }

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

    // 构建 BotConfig
    const config: BotConfig = {
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
      defaultCharacterId: instance.defaultCharacterId || undefined,
      defaultModelId: instance.defaultModelId || undefined,
      defaultThinkingEffort: instance.defaultThinkingEffort || undefined,
      // 从 additionalKwargs 中提取知识库ID列表
      knowledgeBaseIds: (instance.additionalKwargs as any)?.knowledgeBaseIds || [],
    };

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

    return { success: true };
  }

  /**
   * 获取机器人登录二维码状态
   * @returns status: 'logged_in' | 'qr_ready' | 'pending' | 'unavailable'
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

    // 连接中，检查是否有二维码
    if (botStatus === BotStatus.CONNECTING) {
      const qrUrl = adapter.getQrCodeUrl?.();
      if (qrUrl) {
        return { status: 'qr_ready', qrCodeUrl: qrUrl };
      }
      return { status: 'pending', message: '二维码生成中，请稍后再试' };
    }

    return { status: 'unavailable', message: '机器人未处于登录状态' };
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
