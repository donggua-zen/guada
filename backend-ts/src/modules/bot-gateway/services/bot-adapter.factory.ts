import { Injectable, Logger } from '@nestjs/common';
import {
  IBotPlatform,
  IBotAdapterFactory,
  BotConfig,
} from '../interfaces/bot-platform.interface';
import { QQBotAdapter } from '../adapters/qq-bot.adapter';
import { LarkBotAdapter } from '../adapters/lark-bot.adapter';
import { DiscordBotAdapter } from '../adapters/discord-bot.adapter';
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
  private adapterRegistry: Map<string, IBotPlatform> = new Map();

  constructor(
    private qqAdapter: QQBotAdapter,
    private larkAdapter: LarkBotAdapter,
    private discordAdapter: DiscordBotAdapter,
    private wecomAdapter: WeComAiBotAdapter,
  ) {
    // 注册内置适配器（使用注入的实例）
    this.adapterRegistry.set('qq', qqAdapter);
    this.adapterRegistry.set('lark', larkAdapter);
    this.adapterRegistry.set('discord', discordAdapter);
    // TODO: 微信公众号适配器（已注释，使用 OneBots）
    // this.adapterRegistry.set('wechat', wechatAdapter);
    this.adapterRegistry.set('wecom', wecomAdapter); // 企业微信智能机器人（WebSocket 长连接）
    // this.adapterRegistry.set('wecom-app', wecomAppAdapter); // 企业微信应用消息适配器（已隐藏）
    // TODO: 待实现微信个人号适配器
    // this.adapterRegistry.set('wechat-personal', wechatPersonalAdapter);
    // 未来扩展: this.adapterRegistry.set('telegram', telegramAdapter);
  }

  createAdapter(platform: string, config: BotConfig): IBotPlatform {
    const adapter = this.adapterRegistry.get(platform);

    if (!adapter) {
      throw new Error(`Unsupported bot platform: ${platform}`);
    }

    this.logger.log(`Creating adapter for platform: ${platform}`);
    return adapter;
  }
}
