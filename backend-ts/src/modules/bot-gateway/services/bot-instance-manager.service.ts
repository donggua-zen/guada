import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
  forwardRef,
  Inject,
} from '@nestjs/common';
import {
  IBotPlatform,
  BotConfig,
  BotStatus,
} from '../interfaces/bot-platform.interface';
import { BotAdapterFactory } from './bot-adapter.factory';
import { BotOrchestrator } from './bot-orchestrator.service';
import { PrismaService } from '../../../common/database/prisma.service';

/**
 * 机器人实例管理器
 *
 * 负责:
 * 1. 从数据库加载机器人配置
 * 2. 创建和管理适配器实例
 * 3. 提供 CRUD API 供前端调用
 */
@Injectable()
export class BotInstanceManager implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BotInstanceManager.name);
  private botInstances: Map<
    string,
    { adapter: IBotPlatform; config: BotConfig }
  > = new Map();

  constructor(
    private prisma: PrismaService,
    private adapterFactory: BotAdapterFactory,
    @Inject(forwardRef(() => BotOrchestrator))
    private orchestrator: BotOrchestrator,
  ) {}

  /**
   * 模块初始化时自动启动已启用的机器人
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing bot instances...');
    await this.loadAndStartBots();
  }

  /**
   * 应用关闭时优雅停止所有机器人
   */
  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Shutting down all bot instances...');
    await this.stopAllBots();
    this.orchestrator.cleanup();
  }

  /**
   * 从数据库加载并启动所有启用的机器人
   */
  async loadAndStartBots(): Promise<void> {
    this.logger.log('Loading bot instances from database...');

    try {
      // 从数据库读取所有启用的机器人配置
      const bots = await this.prisma.botInstance.findMany({
        where: { enabled: true },
      });

      this.logger.log(`Found ${bots.length} enabled bot(s)`);

      // 逐个启动机器人
      for (const bot of bots) {
        const config: BotConfig = {
          id: bot.id,
          platform: bot.platform as any,
          name: bot.name,
          platformConfig: bot.platformConfig as any,
          enabled: bot.enabled,
          reconnectConfig: {
            enabled: bot.reconnectEnabled,
            maxRetries: bot.maxRetries,
            retryInterval: bot.retryInterval,
          },
          defaultCharacterId: bot.defaultCharacterId,  // 必填字段
          defaultModelId: bot.defaultModelId || undefined,
        };

        try {
          this.logger.log(`Starting bot: ${bot.name} (${bot.platform})`);
          await this.startBot(config);
          this.logger.log(`Bot started successfully: ${bot.id}`);
        } catch (error: any) {
          this.logger.error(
            `Failed to start bot ${bot.name}: ${error.message}`,
            error.stack,
          );
          
          // 更新状态为错误
          await this.prisma.botInstance.update({
            where: { id: bot.id },
            data: {
              status: 'error',
              lastError: error.message,
            },
          });
        }
      }

      this.logger.log('Bot instances loaded and started');
    } catch (error: any) {
      this.logger.error(`Failed to load bots from database: ${error.message}`);
    }
  }

  /**
   * 启动单个机器人实例
   */
  async startBot(config: BotConfig): Promise<void> {
    if (this.botInstances.has(config.id)) {
      throw new Error(`Bot already running: ${config.id}`);
    }

    this.logger.log(`Starting bot: ${config.name} (${config.platform})`);

    // 创建适配器
    const adapter = this.adapterFactory.createAdapter(config.platform, config);

    // 初始化适配器
    await adapter.initialize(config);

    // 保存实例
    this.botInstances.set(config.id, { adapter, config });

    // 启动消息监听
    await this.orchestrator.startBotListener(config.id, adapter, config);

    this.logger.log(`Bot started successfully: ${config.id}`);
  }

  /**
   * 停止单个机器人实例
   */
  async stopBot(botId: string): Promise<void> {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      throw new Error(`Bot not found: ${botId}`);
    }

    this.logger.log(`Stopping bot: ${botId}`);

    // 停止消息监听
    this.orchestrator.stopBotListener(botId);

    // 关闭适配器
    await instance.adapter.shutdown();

    // 移除实例
    this.botInstances.delete(botId);

    this.logger.log(`Bot stopped: ${botId}`);
  }

  /**
   * 重启机器人实例
   */
  async restartBot(botId: string): Promise<void> {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      throw new Error(`Bot not found: ${botId}`);
    }

    await this.stopBot(botId);
    await this.startBot(instance.config);
  }

  /**
   * 停止所有机器人
   */
  async stopAllBots(): Promise<void> {
    const botIds = Array.from(this.botInstances.keys());
    await Promise.all(
      botIds.map((id) =>
        this.stopBot(id).catch((err) => {
          this.logger.error(`Failed to stop bot ${id}: ${err.message}`);
        }),
      ),
    );
  }

  /**
   * 获取适配器实例
   */
  getAdapter(botId: string): IBotPlatform | undefined {
    return this.botInstances.get(botId)?.adapter;
  }

  /**
   * 获取单个机器人状态
   */
  getStatus(botId: string): BotStatus | null {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      return null;
    }
    return instance.adapter.getStatus();
  }

  /**
   * 获取所有机器人状态
   */
  getAllBotStatuses(): Array<{
    id: string;
    name: string;
    platform: string;
    status: BotStatus;
  }> {
    return Array.from(this.botInstances.entries()).map(
      ([id, { adapter, config }]) => ({
        id,
        name: config.name,
        platform: config.platform,
        status: adapter.getStatus(),
      }),
    );
  }
}
