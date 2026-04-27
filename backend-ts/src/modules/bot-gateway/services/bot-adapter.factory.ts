import { Injectable, Logger } from '@nestjs/common';
import {
  IBotPlatform,
  IBotAdapterFactory,
  BotConfig,
} from '../interfaces/bot-platform.interface';
import { QQBotAdapter } from '../adapters/qq-bot.adapter';

/**
 * 机器人适配器工厂
 *
 * 使用策略模式动态创建不同平台的适配器实例
 */
@Injectable()
export class BotAdapterFactory implements IBotAdapterFactory {
  private readonly logger = new Logger(BotAdapterFactory.name);
  private adapterRegistry: Map<string, new () => IBotPlatform> = new Map();

  constructor() {
    // 注册内置适配器
    this.registerAdapter('qq', QQBotAdapter);
    // 未来扩展: this.registerAdapter('wechat', WeChatBotAdapter);
    // 未来扩展: this.registerAdapter('discord', DiscordBotAdapter);
  }

  createAdapter(platform: string, config: BotConfig): IBotPlatform {
    const AdapterClass = this.adapterRegistry.get(platform);

    if (!AdapterClass) {
      throw new Error(`Unsupported bot platform: ${platform}`);
    }

    this.logger.log(`Creating adapter for platform: ${platform}`);
    const adapter = new AdapterClass();
    return adapter;
  }

  registerAdapter(
    platform: string,
    adapterClass: new () => IBotPlatform,
  ): void {
    this.adapterRegistry.set(platform, adapterClass);
    this.logger.log(`Registered adapter for platform: ${platform}`);
  }
}
