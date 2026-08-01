import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotStatus,
  BotRuntimeStatus,
  BotInstanceView,
} from '../interfaces/bot-platform.interface';
import { BotAdapterFactory } from './bot-adapter.factory';
import { BotOrchestrator } from './bot-orchestrator.service';
import { PrismaService } from '../../../common/database/prisma.service';

interface ManagedBotInstance {
  adapter: IBotPlatform;
  config: BotConfig;
  status: BotRuntimeStatus;
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
  reconnectTimedOut: boolean;
  disposed: boolean;
  subscriptions: Subscription[];
}

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
  private botInstances = new Map<string, ManagedBotInstance>();
  private readonly lifecycleOperations = new Map<string, Promise<void>>();
  private readonly restartOperations = new Map<string, Promise<void>>();
  private shuttingDown = false;

  // 重连超时时间(90秒) - 考虑到可能需要重新获取 token、处理频率限制和建立 WebSocket
  private readonly RECONNECT_TIMEOUT_MS = 90000;

  constructor(
    private prisma: PrismaService,
    private adapterFactory: BotAdapterFactory,
    private orchestrator: BotOrchestrator,
  ) { }

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
    this.shuttingDown = true;

    // 等待已经排队的生命周期操作结束，再统一关闭，防止退出过程中实例复活。
    await Promise.allSettled(Array.from(this.lifecycleOperations.values()));
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
          // 注意: startBot 内部已经记录了成功日志,这里不再重复记录
        } catch (error: any) {
          this.logger.error(
            `Failed to start bot ${bot.name}: ${error.message}`,
            error.stack,
          );

          // 注意：startBot 内部已经处理了重连逻辑，这里不需要再次调度
          // 只需要确保数据库状态已更新（startBot 内部也会更新）
        }
      }

      this.logger.log('Bot instances loaded and started');
    } catch (error: any) {
      this.logger.error(`Failed to load bots from database: ${error.message}`);
    }
  }

  /**
   * 同一 Bot 的生命周期操作串行执行，避免 start/stop/restart 互相穿插。
   */
  private runLifecycleOperation(
    botId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.lifecycleOperations.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.lifecycleOperations.set(botId, current);

    void current.finally(() => {
      if (this.lifecycleOperations.get(botId) === current) {
        this.lifecycleOperations.delete(botId);
      }
    }).catch(() => undefined);

    return current;
  }

  /**
   * 启动单个机器人实例
   */
  startBot(config: BotConfig): Promise<void> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('Bot manager is shutting down'));
    }
    return this.runLifecycleOperation(config.id, () => this.startBotInternal(config));
  }

  private async startBotInternal(config: BotConfig): Promise<void> {
    // 如果已存在，先停止旧的实例
    if (this.botInstances.has(config.id)) {
      this.logger.warn(`Bot ${config.id} is already running, stopping it first...`);
      try {
        await this.stopBotInternal(config.id, 'replace-before-start');
      } catch (error: any) {
        this.logger.error(`Failed to stop existing bot: ${error.message}`);
        await this.cleanupBotInstance(config.id, 'startBot-fallback');
      }
    }

    this.logger.log(`Starting bot: ${config.name} (${config.platform})`);

    // 创建适配器实例
    const adapter = this.adapterFactory.createAdapter(config.platform, config);

    // 立即保存实例到 Map（状态为 CONNECTING）
    const instance = {
      adapter,
      config,
      status: BotRuntimeStatus.CONNECTING,
      reconnectAttempts: 0,
      reconnectTimedOut: false,
      disposed: false,
      subscriptions: [] as Subscription[],
    };
    this.botInstances.set(config.id, instance);

    try {
      // 重要：先订阅所有事件，再建立连接，避免丢失早期事件

      // 1. 监听消息流并转发给 Orchestrator
      const messageSubscription = adapter.onMessage().subscribe({
        next: (message) => {
          void this.orchestrator
            .enqueueMessage(config.id, message, instance)
            .catch((error: Error) => {
              this.logger.error(
                `Failed to enqueue message for bot ${config.id}: ${error.message}`,
              );
            });
        },
        error: (error: Error) => {
          this.logger.error(
            `Message stream error for bot ${config.id}: ${error.message}`,
          );
        },
      });
      instance.subscriptions.push(messageSubscription);

      // 2. 监听断开连接事件（必须实现）
      const disconnectSubscription = adapter.onDisconnect().subscribe({
        next: (event) => {
          this.logger.warn(
            `Bot ${config.id} disconnected with code: ${event.code}${event.reason ? ` - ${event.reason}` : ''}, handling disconnect...`,
          );
          void this.handleBotDisconnect(config.id, event.code).catch(
            (error: Error) => {
              this.logger.error(
                `Failed to handle disconnect for bot ${config.id}: ${error.message}`,
              );
            },
          );
        },
        error: (error: Error) => {
          this.logger.error(`Disconnect stream error for bot ${config.id}: ${error.message}`);
        },
      });
      instance.subscriptions.push(disconnectSubscription);

      // 3. 监听连接成功事件（必须实现）
      const connectSubscription = adapter.onConnect().subscribe({
        next: () => {
          this.logger.log(`Bot ${config.id} connected successfully, resetting reconnect counter`);
          void this.handleBotConnect(config.id).catch((error: Error) => {
            this.logger.error(
              `Failed to handle connect for bot ${config.id}: ${error.message}`,
            );
          });
        },
        error: (error: Error) => {
          this.logger.error(`Connect stream error for bot ${config.id}: ${error.message}`);
        },
      });
      instance.subscriptions.push(connectSubscription);

      // 4. 最后才建立连接（确保不会丢失任何事件）
      await adapter.connect(config);
      instance.status = BotRuntimeStatus.CONNECTED;

      this.logger.log(`Bot started successfully: ${config.id}`);
    } catch (error: any) {
      // 初始化失败（通常是配置问题，如 token 错误、appId 无效等）
      this.logger.error(`Failed to initialize bot ${config.id}: ${error.message}`);

      // 初始化失败不调度重连，直接清理实例
      this.logger.log(`Initialization failed, removing bot instance ${config.id}`);
      await this.cleanupBotInstance(config.id, 'init-failed', instance);

      // 抛出异常，让调用者知道启动失败
      throw error;
    }
  }

  /**
   * 停止单个机器人实例
   */
  stopBot(botId: string): Promise<void> {
    return this.runLifecycleOperation(botId, () => this.stopBotInternal(botId));
  }

  private async stopBotInternal(
    botId: string,
    reason = 'manual-stop',
  ): Promise<void> {
    this.logger.log(`Stopping bot: ${botId}`);
    await this.cleanupBotInstance(botId, reason);
    this.logger.log(`Bot stopped: ${botId}`);
  }

  /**
   * 重启机器人实例。同一 Bot 的并发重启请求共享一次重启过程。
   */
  restartBot(botId: string): Promise<void> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('Bot manager is shutting down'));
    }

    const existing = this.restartOperations.get(botId);
    if (existing) return existing;

    const operation = this.runLifecycleOperation(botId, async () => {
      const instance = this.botInstances.get(botId);
      if (!instance) {
        throw new Error(`Bot not found: ${botId}`);
      }

      const config = instance.config;
      await this.stopBotInternal(botId, 'restart');
      await this.startBotInternal(config);
    });
    this.restartOperations.set(botId, operation);

    void operation.finally(() => {
      if (this.restartOperations.get(botId) === operation) {
        this.restartOperations.delete(botId);
      }
    }).catch(() => undefined);

    return operation;
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
   * 获取机器人实例视图（供编排器使用）
   */
  getInstanceView(botId: string): BotInstanceView | undefined {
    const instance = this.botInstances.get(botId);
    if (!instance) return undefined;
    return {
      adapter: instance.adapter,
      config: instance.config,
      status: instance.status,
    };
  }

  /**
   * 获取 Bot 配置（从内存中读取最新配置）
   */
  getBotConfig(botId: string): BotConfig | undefined {
    return this.botInstances.get(botId)?.config;
  }

  /**
   * 重新加载 Bot 配置（从数据库读取并更新内存）
   * 用于在不重启机器人的情况下更新动态配置
   */
  async reloadBotConfig(botId: string): Promise<void> {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      this.logger.warn(`Bot instance not found in memory: ${botId}`);
      return;
    }

    // 从数据库读取最新配置
    const botData = await this.prisma.botInstance.findUnique({
      where: { id: botId },
    });

    if (!botData) {
      this.logger.error(`Bot instance not found in database: ${botId}`);
      return;
    }

    // 从 additionalKwargs 中提取知识库ID列表
    const knowledgeBaseIds = (botData.additionalKwargs as any)?.knowledgeBaseIds || [];

    // 构建新的配置对象
    const newConfig: BotConfig = {
      id: botData.id,
      platform: botData.platform as any,
      name: botData.name,
      platformConfig: botData.platformConfig as any,
      enabled: botData.enabled,
      reconnectConfig: {
        enabled: botData.reconnectEnabled,
        maxRetries: botData.maxRetries,
        retryInterval: botData.retryInterval,
      },
      defaultCharacterId: botData.defaultCharacterId || undefined,
      defaultModelId: botData.defaultModelId || undefined,
      knowledgeBaseIds,
    };

    // 更新内存中的配置（直接修改对象属性，保持引用不变）
    Object.assign(instance.config, newConfig);

    this.logger.log(`Reloaded config for bot: ${botId}`);
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

  /** 限流：委托给 Orchestrator 的共享限流器 */
  throttleSend(botId: string, intervalMs: number): Promise<void> {
    return this.orchestrator.throttleSend(botId, intervalMs);
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
   * 获取机器人登录二维码 URL
   */
  getQrCodeUrl(botId: string): string | null {
    const instance = this.botInstances.get(botId);
    if (!instance) {
      return null;
    }
    return instance.adapter.getQrCodeUrl?.() ?? null;
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

    // 防重入检查：已有待执行或正在执行的重连时跳过重复断开事件。
    if (instance.status === BotRuntimeStatus.CONNECTING || instance.status === BotRuntimeStatus.RECONNECTING || instance.reconnectTimer) {
      this.logger.warn(
        `Bot ${botId} already has a reconnect operation, skipping duplicate schedule`,
      );
      return;
    }

    const maxRetries = config.reconnectConfig?.maxRetries ?? 5;
    const retryInterval = config.reconnectConfig?.retryInterval ?? 5000;

    // 检查是否达到最大重试次数
    if (instance.reconnectAttempts >= maxRetries) {
      this.logger.error(
        `Max reconnection attempts reached for bot ${botId} (${maxRetries}). Disabling bot.`,
      );

      void this.runLifecycleOperation(botId, () =>
        this.handleReconnectExhausted(botId, lastError, instance),
      ).catch((error: Error) => {
        this.logger.error(
          `Failed to handle reconnect exhaustion for bot ${botId}: ${error.message}`,
        );
      });
      return;
    }

    // 增加重试计数
    instance.reconnectAttempts++;

    // 首次重连立即执行，后续使用配置的间隔
    const delay = instance.reconnectAttempts === 1 ? 0 : retryInterval;

    // 有延迟时立即标记为重连中，使编排器在等待期间正确判断状态；
    // 无延迟（首次）时由定时器回调内设置，避免与上一次 finally 的重置产生竞争。
    if (delay > 0) {
      instance.status = BotRuntimeStatus.RECONNECTING;
    }

    this.logger.log(
      `Scheduling reconnect for bot ${botId} in ${delay}ms (attempt ${instance.reconnectAttempts}/${maxRetries})`,
    );

    // 设置重连定时器
    instance.reconnectTimer = setTimeout(async () => {
      instance.reconnectTimer = undefined;

      // 定时器触发前实例可能已经停止或被替换。
      if (this.botInstances.get(botId) !== instance) return;

      instance.status = BotRuntimeStatus.RECONNECTING;
      instance.reconnectTimedOut = false;
      try {
        this.logger.log(`Attempting to reconnect bot ${botId}...`);

        // 超时控制。Promise.race 超时不会取消底层重连，因此持续监控原 Promise：
        // 失效实例或已超时连接若稍后成功，必须立即关闭；超时重试要等它结束后再安排。
        const reconnectPromise = instance.adapter.reconnect();
        const timeoutErrorMessage =
          `Reconnect timed out after ${this.RECONNECT_TIMEOUT_MS / 1000}s`;
        void reconnectPromise
          .then(async () => {
            if (
              instance.disposed ||
              instance.reconnectTimedOut ||
              this.botInstances.get(botId) !== instance
            ) {
              await instance.adapter.shutdown();
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (!instance.reconnectTimedOut) return;

            instance.reconnectTimedOut = false;
            instance.status = BotRuntimeStatus.STOPPED;
            if (
              !instance.disposed &&
              this.botInstances.get(botId) === instance
            ) {
              this.scheduleReconnect(botId, config, timeoutErrorMessage);
            }
          });

        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            instance.reconnectTimedOut = true;
            reject(new Error(timeoutErrorMessage));
          }, this.RECONNECT_TIMEOUT_MS);
        });

        try {
          await Promise.race([reconnectPromise, timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }

        // 重连成功，onConnect 事件负责重置计数器。
        this.logger.log(
          `Bot ${botId} reconnect initiated successfully, waiting for connection confirmation...`,
        );
      } catch (error: any) {
        this.logger.error(`Reconnection failed for bot ${botId}: ${error.message}`);

        if (error.message.includes('timed out')) {
          this.logger.warn(
            `Reconnect timed out for bot ${botId}; waiting for the current attempt to stop before retrying.`,
          );
          await instance.adapter.shutdown().catch((shutdownError: Error) => {
            this.logger.error(
              `Failed to stop timed-out reconnect for bot ${botId}: ${shutdownError.message}`,
            );
          });
          return;
        }

        // 重连调用本身失败时不一定会再次触发断开事件，因此按既有策略继续重试。
        instance.status = BotRuntimeStatus.STOPPED;
        if (this.botInstances.get(botId) === instance) {
          this.scheduleReconnect(botId, config, error.message);
        }
      }
    }, delay);
  }

  /**
   * 处理机器人断开连接事件
   */
  async handleBotDisconnect(botId: string, code: number): Promise<void> {
    this.logger.warn(`Handling bot disconnect for ${botId} with code: ${code}`);

    // 从内存获取最新实例与配置
    const instance = this.botInstances.get(botId);
    if (!instance) {
      this.logger.error(`Bot config not found: ${botId}, may already be removed`);
      return;
    }
    const config = instance.config;

    // 检查是否启用重连
    if (!config.reconnectConfig?.enabled) {
      this.logger.log(`Reconnect disabled for bot ${botId}, cleaning up...`);
      void this.runLifecycleOperation(botId, () =>
        this.cleanupBotInstance(botId, 'reconnect-disabled', instance),
      ).catch((error: Error) => {
        this.logger.error(`Failed to cleanup bot ${botId}: ${error.message}`);
      });
      return;
    }

    // 检查适配器是否自行处理重连
    const adapter = this.getAdapter(botId);
    if (adapter) {
      const capabilities = adapter.getCapabilities();
      if (capabilities.handlesReconnectInternally) {
        this.logger.log(`Bot ${botId} handles reconnect internally, skipping external reconnect logic`);
        return;
      }
    }

    // 调度重连
    this.logger.log(`Scheduling reconnect for disconnected bot ${botId}`);
    this.scheduleReconnect(botId, config, `WebSocket closed with code: ${code}`);
  }

  /**
   * 处理机器人连接成功事件（重置重连计数器）
   */
  async handleBotConnect(botId: string): Promise<void> {
    this.logger.log(`Handling bot connect success for ${botId}`);

    const instance = this.botInstances.get(botId);
    if (!instance) {
      this.logger.warn(`Bot instance not found for ${botId}, cannot reset reconnect counter`);
      return;
    }

    // 已超时尝试的迟到连接由监控逻辑关闭，不能重置重试状态。
    if (instance.reconnectTimedOut) {
      this.logger.warn(`Ignoring late connect event for timed-out bot ${botId}`);
      return;
    }

    // 连接成功后取消尚未执行的重连并重置计数器。
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = undefined;
    }
    instance.status = BotRuntimeStatus.CONNECTED;
    instance.reconnectAttempts = 0;

    // 重连成功后，补发重连期间积压的回复消息
    void this.orchestrator.flushPendingReplies(botId, instance).catch((err) => {
      this.logger.error(`Failed to flush pending replies for ${botId}: ${err.message}`);
    });
  }

  private async handleReconnectExhausted(
    botId: string,
    errorMessage: string,
    instance: ManagedBotInstance,
  ): Promise<void> {
    if (this.botInstances.get(botId) !== instance) return;

    try {
      await this.cleanupBotInstance(
        botId,
        'max-retries-reached',
        instance,
      );
      await this.disableBot(botId, errorMessage);
    } catch (error: any) {
      this.logger.error(
        `Failed to disable bot ${botId} after reconnect exhaustion: ${error.message}`,
      );
    }
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

  /**
   * 清理机器人实例（关闭连接、取消订阅、删除内存实例）
   */
  private async cleanupBotInstance(
    botId: string,
    reason = 'cleanup',
    expectedInstance?: ManagedBotInstance,
  ): Promise<void> {
    const instance = this.botInstances.get(botId);
    if (!instance || (expectedInstance && instance !== expectedInstance)) {
      this.logger.warn(`Bot ${botId} not found or already replaced, skip cleanup`);
      return;
    }

    instance.disposed = true;
    instance.status = BotRuntimeStatus.STOPPED;
    this.logger.log(`Cleaning up bot instance: ${botId} (${reason})`);

    // 清除重连定时器
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = undefined;
    }

    // 取消所有订阅
    instance.subscriptions.forEach(sub => sub.unsubscribe());
    instance.subscriptions = [];

    // 清理 Orchestrator 中的消息队列
    this.orchestrator.cleanupBot(botId);

    // 关闭适配器连接
    try {
      await instance.adapter.shutdown();
      this.logger.log(`Bot ${botId} adapter shutdown completed`);
    } catch (error: any) {
      this.logger.error(`Error during bot ${botId} shutdown: ${error.message}`);
    }

    // 仅删除当前清理的实例，不能误删已替换的新实例。
    if (this.botInstances.get(botId) === instance) {
      this.botInstances.delete(botId);
    }

    this.logger.log(`Bot ${botId} cleanup completed`);
  }
}
