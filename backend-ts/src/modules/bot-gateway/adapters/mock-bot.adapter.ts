import { Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  BotConfig,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
} from '../interfaces/bot-platform.interface';
import { BaseBotAdapter } from './base-bot.adapter';

/**
 * 模拟机器人适配器（用于测试重连机制）
 *
 * 特性:
 * - 每5秒自动断开一次连接
 * - 模拟真实的连接/断开流程
 * - 用于验证状态管理和重连逻辑是否正确
 */
export class MockBotAdapter extends BaseBotAdapter {
  private readonly logger = new Logger(MockBotAdapter.name);
  // 控制定时器
  private disconnectTimer: NodeJS.Timeout | null = null;
  private destroy$ = new Subject<void>();

  constructor() {
    super();
  }

  getPlatform(): string {
    return 'mock';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: false,
      handlesReconnectInternally: false, // 需要外部 BotInstanceManager 统一管理重连
    };
  }

  async connect(config: BotConfig): Promise<void> {
    this.config = config;
    this.status = BotStatus.CONNECTING;

    this.logger.log(`Connecting mock bot: ${config.id}`);

    try {
      // 模拟连接延迟（1秒）
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.status = BotStatus.CONNECTED;
      this.logger.log(`Mock bot connected: ${config.id}`);

      // 发射连接成功事件
      this.emitConnected();

      // 启动定时断开机制（5秒后断开）
      this.startDisconnectTimer();

    } catch (error: any) {
      this.status = BotStatus.ERROR;
      this.logger.error(`Failed to initialize mock bot: ${error.message}`);
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (this.status !== BotStatus.CONNECTED) {
      throw new Error(`Cannot send message: bot is ${this.status}`);
    }

    this.logger.log(`Mock bot sending message to ${response.conversationId}: ${response.content.substring(0, 50)}...`);

    // 模拟发送延迟
    await new Promise(resolve => setTimeout(resolve, 100));
  }



  async shutdown(): Promise<void> {
    this.logger.log(`Shutting down mock bot: ${this.config?.id}`);

    // 清除定时器
    this.stopDisconnectTimer();

    // 通知所有订阅者销毁
    this.destroy$.next();
    this.destroy$.complete();

    this.status = BotStatus.STOPPED;
    this.completeSubjects();
    this.logger.log(`Mock bot shutdown completed`);
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Reconnecting mock bot: ${this.config?.id}`);

    // 先关闭当前连接
    await this.shutdown();

    // 重新连接
    if (this.config) {
      await this.connect(this.config);
    }
  }

  /**
   * 启动定时断开机制（5秒后自动断开）
   */
  private startDisconnectTimer(): void {
    this.stopDisconnectTimer(); // 先清除旧的定时器

    this.disconnectTimer = setTimeout(() => {
      this.simulateDisconnect();
    }, 5000); // 5秒后断开

    this.logger.log(`Disconnect timer started for bot ${this.config?.id}, will disconnect in 5 seconds`);
  }

  /**
   * 停止定时断开机制
   */
  private stopDisconnectTimer(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      this.logger.log(`Disconnect timer stopped for bot ${this.config?.id}`);
    }
  }

  /**
   * 模拟断开连接
   */
  private simulateDisconnect(): void {
    if (this.status === BotStatus.CONNECTED) {
      this.logger.warn(`Simulating disconnect for bot ${this.config?.id}`);

      this.status = BotStatus.DISCONNECTED;

      // 发射断开事件
      this.emitDisconnected({
        code: 4000, // 自定义断开码
        reason: 'Simulated periodic disconnect (every 5 seconds)',
        timestamp: new Date(),
      });

      // 重置定时器，准备下一次断开
      // 注意：这里不自动重启定时器，等待 Manager 触发重连
      // 重连成功后会再次调用 initialize()，从而重新启动定时器
    }
  }
}
