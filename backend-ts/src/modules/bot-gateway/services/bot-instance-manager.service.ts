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
 * 职责:
 * 1. 从数据库加载机器人配置
 * 2. 创建和管理适配器实例
 * 3. 统一管理重连策略
 * 4. 同步状态到数据库
 * 5. 提供 CRUD API 供前端调用
 */
@Injectable()
export class BotInstanceManager implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BotInstanceManager.name);
  private botInstances: Map<
    string,
    {
      adapter: IBotPlatform;
      config: BotConfig;
      reconnectAttempts: number;
      reconnectTimer?: NodeJS.Timeout;
    }
  > = new Map();

  // 防重入锁:记录正在重连的机器人ID
  private reconnectingBots: Set<string> = new Set();

  // 重连超时时间(30秒)
  private readonly RECONNECT_TIMEOUT_MS = 30000;

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
        // 从 additionalKwargs 中提取知识库ID列表
        const knowledgeBaseIds = (bot.additionalKwargs as any)?.knowledgeBaseIds || [];
        
        this.logger.log(
          `Bot ${bot.name} (${bot.id}): additionalKwargs=${JSON.stringify(bot.additionalKwargs)}, knowledgeBaseIds=${JSON.stringify(knowledgeBaseIds)}`
        );
        
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
          knowledgeBaseIds,
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
          
          // 检查是否需要重连
          if (bot.reconnectEnabled) {
            this.scheduleReconnect(bot.id, config, error.message);
          }
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
    // 如果已存在，先停止旧的实例
    if (this.botInstances.has(config.id)) {
      this.logger.warn(`Bot ${config.id} is already running, stopping it first...`);
      try {
        await this.stopBot(config.id);
      } catch (error: any) {
        this.logger.error(`Failed to stop existing bot: ${error.message}`);
        this.botInstances.delete(config.id);
      }
    }

    this.logger.log(`Starting bot: ${config.name} (${config.platform})`);

    // 创建适配器实例
    const adapter = this.adapterFactory.createAdapter(config.platform, config);

    // 立即保存实例到 Map（状态为 CONNECTING）
    const instance = {
      adapter,
      config,
      reconnectAttempts: 0,
    };
    this.botInstances.set(config.id, instance);

    try {
      // 初始化适配器（建立连接）
      await adapter.initialize(config);

      // 初始化成功，启动消息监听
      await this.orchestrator.startBotListener(config.id, adapter, config);

      this.logger.log(`Bot started successfully: ${config.id}`);
    } catch (error: any) {
      // 初始化失败
      this.logger.error(`Failed to initialize bot ${config.id}: ${error.message}`);
      
      // 更新数据库状态为错误
      await this.prisma.botInstance.update({
        where: { id: config.id },
        data: {
          status: 'error',
          lastError: error.message,
        },
      }).catch((dbError) => {
        this.logger.error(`Failed to update bot status in database: ${dbError.message}`);
      });

      // 检查是否需要重连
      if (config.reconnectConfig?.enabled) {
        this.logger.log(`Scheduling reconnect for bot ${config.id}`);
        this.scheduleReconnect(config.id, config, error.message);
      } else {
        // 不重连，移除实例
        this.logger.log(`Reconnect disabled, removing bot instance ${config.id}`);
        this.botInstances.delete(config.id);
      }

      // 抛出异常，让调用者知道启动失败
      throw error;
    }
  }

  /**
   * 停止单个机器人实例
   */
  async stopBot(botId: string): Promise<void> {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      this.logger.warn(`Bot not found: ${botId}, may already be stopped`);
      return;
    }

    this.logger.log(`Stopping bot: ${botId}`);

    // 清除重连定时器
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = undefined;
    }

    // 停止消息监听
    this.orchestrator.stopBotListener(botId);

    // 关闭适配器
    try {
      await instance.adapter.shutdown();
    } catch (error: any) {
      this.logger.error(`Error during bot shutdown: ${error.message}`);
    }

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

  /**
   * 调度重连任务
   */
  private scheduleReconnect(botId: string, config: BotConfig, lastError: string): void {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      this.logger.error(`Cannot schedule reconnect: bot instance not found for ${botId}`);
      return;
    }

    // 防重入检查
    if (this.reconnectingBots.has(botId)) {
      this.logger.warn(`Bot ${botId} is already reconnecting, skipping duplicate schedule`);
      return;
    }

    // 检查是否启用重连
    if (!config.reconnectConfig?.enabled) {
      this.logger.log(`Reconnect disabled for bot ${botId}`);
      this.botInstances.delete(botId);
      return;
    }

    const maxRetries = config.reconnectConfig.maxRetries || 5;
    const retryInterval = config.reconnectConfig.retryInterval || 5000;

    // 检查是否达到最大重试次数
    if (instance.reconnectAttempts >= maxRetries) {
      this.logger.error(
        `Max reconnection attempts reached for bot ${botId} (${maxRetries}). Disabling bot.`,
      );
      
      // 禁用机器人
      this.disableBot(botId, lastError).catch((err) => {
        this.logger.error(`Failed to disable bot ${botId}: ${err.message}`);
      });
      
      // 清理实例
      this.botInstances.delete(botId);
      return;
    }

    // 增加重试计数
    instance.reconnectAttempts++;

    this.logger.log(
      `Scheduling reconnect for bot ${botId} in ${retryInterval}ms (attempt ${instance.reconnectAttempts}/${maxRetries})`,
    );

    // 标记为正在重连
    this.reconnectingBots.add(botId);

    // 设置重连定时器
    instance.reconnectTimer = setTimeout(async () => {
      try {
        this.logger.log(`Attempting to reconnect bot ${botId}...`);
        
        // 超时控制
        const reconnectPromise = instance.adapter.reconnect();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Reconnect timed out after 30s')), 
                     this.RECONNECT_TIMEOUT_MS);
        });
        
        await Promise.race([reconnectPromise, timeoutPromise]);
        
        // 重连成功后重新绑定消息监听
        await this.orchestrator.startBotListener(botId, instance.adapter, config);
        
        // 重连成功，重置计数器
        instance.reconnectAttempts = 0;
        this.logger.log(`Bot ${botId} reconnected successfully`);
        
        // 更新数据库状态为已连接
        await this.prisma.botInstance.update({
          where: { id: botId },
          data: { status: 'connected', lastError: null },
        }).catch((err) => {
          this.logger.error(`Failed to update bot status: ${err.message}`);
        });
      } catch (error: any) {
        this.logger.error(`Reconnection failed for bot ${botId}: ${error.message}`);
        
        // 如果超时，强制销毁旧客户端
        if (error.message.includes('timed out')) {
          this.logger.error(`Reconnect timed out for bot ${botId}, forcing cleanup`);
          try {
            await instance.adapter.shutdown();
          } catch {}
          this.botInstances.delete(botId);
        }
        
        // 更新数据库状态
        await this.prisma.botInstance.update({
          where: { id: botId },
          data: {
            status: 'error',
            lastError: error.message,
          },
        }).catch((dbError) => {
          this.logger.error(`Failed to update bot status: ${dbError.message}`);
        });
        
        // 继续调度下一次重连
        this.scheduleReconnect(botId, config, error.message);
      } finally {
        // 无论成功还是失败，都移除重连标记
        this.reconnectingBots.delete(botId);
      }
    }, retryInterval);
  }

  /**
   * 禁用机器人并更新数据库
   */
  private async disableBot(botId: string, errorMessage: string): Promise<void> {
    try {
      await this.prisma.botInstance.update({
        where: { id: botId },
        data: {
          enabled: false,
          status: 'error',
          lastError: errorMessage,
        },
      });
      this.logger.log(`Bot ${botId} has been disabled in database`);
    } catch (error: any) {
      this.logger.error(`Failed to disable bot ${botId} in database: ${error.message}`);
      throw error;
    }
  }
}
