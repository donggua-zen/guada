import { Injectable, Logger } from '@nestjs/common';
import {
  IBotPlatform,
  IBotAdapterFactory,
  BotConfig,
} from '../interfaces/bot-platform.interface';
import { QQBotAdapter } from '../adapters/qq-bot.adapter';
import { LarkBotAdapter } from '../adapters/lark-bot.adapter';
// TODO: 微信公众号适配器（已注释，使用 OneBots）
// import { WeChatBotAdapter } from '../adapters/wechat-bot.adapter';
import { WeComAiBotAdapter } from '../adapters/wecom-aibot.adapter';
// TODO: 企业微信应用消息适配器（已隐藏，使用智能机器人长连接模式）
// import { WeComAppBotAdapter } from '../adapters/wecom-app-bot.adapter';
// TODO: 待实现微信个人号适配器（基于 iLink Bot API）
// import { WeChatPersonalBotAdapter } from '../adapters/wechat-personal-bot.adapter';

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
    this.registerAdapter('lark', LarkBotAdapter);
    // TODO: 微信公众号适配器（已注释，使用 OneBots）
    // this.registerAdapter('wechat', WeChatBotAdapter);
    this.registerAdapter('wecom', WeComAiBotAdapter); // 企业微信智能机器人（WebSocket 长连接）
    // this.registerAdapter('wecom', WeComAppBotAdapter); // 企业微信应用消息适配器（已隐藏）
    // TODO: 待实现微信个人号适配器
    // this.registerAdapter('wechat-personal', WeChatPersonalBotAdapter);
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
