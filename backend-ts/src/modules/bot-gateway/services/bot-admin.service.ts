import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { BotInstanceManager } from './bot-instance-manager.service';
import { PLATFORM_METADATA } from '../constants/platform-metadata';
import { CreateBotDto, UpdateBotDto } from '../dto/bot-admin.dto';
import { BotConfig } from '../interfaces/bot-platform.interface';

@Injectable()
export class BotAdminService {
  private readonly logger = new Logger(BotAdminService.name);

  constructor(
    private prisma: PrismaService,
    private instanceManager: BotInstanceManager,
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
  async getAllInstances(userId?: string) {
    const where = userId ? { userId } : {};
    
    const instances = await this.prisma.botInstance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // 附加运行时状态
    return instances.map(instance => ({
      ...instance,
      runtimeStatus: this.instanceManager.getStatus(instance.id),
    }));
  }

  /**
   * 获取单个机器人实例
   */
  async getInstance(id: string) {
    const instance = await this.prisma.botInstance.findUnique({
      where: { id },
    });

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
  async createInstance(userId: string, dto: CreateBotDto) {
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

    // 保存到数据库
    const instance = await this.prisma.botInstance.create({
      data: {
        userId,
        platform: dto.platform,
        name: dto.name,
        platformConfig: dto.platformConfig,
        reconnectEnabled: dto.reconnectConfig?.enabled ?? true,
        maxRetries: dto.reconnectConfig?.maxRetries ?? 5,
        retryInterval: dto.reconnectConfig?.retryInterval ?? 5000,
        defaultCharacterId: dto.defaultCharacterId,
        defaultModelId: dto.defaultModelId,
        enabled: true,
        status: 'stopped',
      },
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
    const instance = await this.prisma.botInstance.findUnique({
      where: { id },
    });

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    const updateData: any = {};
    
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.platformConfig !== undefined) updateData.platformConfig = dto.platformConfig;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
    if (dto.defaultCharacterId !== undefined) updateData.defaultCharacterId = dto.defaultCharacterId;
    if (dto.defaultModelId !== undefined) updateData.defaultModelId = dto.defaultModelId;
    
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

    const updated = await this.prisma.botInstance.update({
      where: { id },
      data: updateData,
    });

    // 如果更新了平台配置或启用状态,可能需要重启
    if (dto.platformConfig || dto.enabled) {
      try {
        await this.restartInstance(id);
      } catch (error: any) {
        this.logger.error(`Failed to restart bot after update: ${error.message}`);
      }
    }

    return updated;
  }

  /**
   * 启动机器人
   */
  async startInstance(id: string) {
    const instance = await this.prisma.botInstance.findUnique({
      where: { id },
    });

    if (!instance) {
      throw new NotFoundException(`Bot instance ${id} not found`);
    }

    if (!instance.enabled) {
      throw new BadRequestException('Bot is disabled');
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
    };

    // 启动机器人
    await this.instanceManager.startBot(config);

    // 更新状态
    await this.prisma.botInstance.update({
      where: { id },
      data: {
        status: 'running',
        lastStartedAt: new Date(),
        lastError: null,
      },
    });

    return { success: true };
  }

  /**
   * 停止机器人
   */
  async stopInstance(id: string) {
    await this.instanceManager.stopBot(id);

    await this.prisma.botInstance.update({
      where: { id },
      data: {
        status: 'stopped',
      },
    });

    return { success: true };
  }

  /**
   * 重启机器人
   */
  async restartInstance(id: string) {
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
    await this.prisma.botInstance.delete({
      where: { id },
    });

    return { success: true };
  }
}
