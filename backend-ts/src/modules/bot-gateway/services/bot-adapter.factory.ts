import { Injectable, Logger } from '@nestjs/common';
import {
  IBotPlatform,
  IBotAdapterFactory,
  BotConfig,
} from '../interfaces/bot-platform.interface';
import { QQBotAdapter } from '../adapters/qq-bot.adapter';
import { LarkBotAdapter } from '../adapters/lark-bot.adapter';
import { DiscordBotAdapter } from '../adapters/discord-bot.adapter';
import { WeComAiBotAdapter } from '../adapters/wecom-aibot.adapter';
import { WechatPersonalBotAdapter } from '../adapters/wechat-personal-bot.adapter';
import { MockBotAdapter } from '../adapters/mock-bot.adapter';
import { PlatformUtilsService } from './platform-utils.service';

/**
 * 机器人适配器工厂
 *
 * 使用策略模式动态创建不同平台的适配器实例
 */
@Injectable()
export class BotAdapterFactory implements IBotAdapterFactory {
  private readonly logger = new Logger(BotAdapterFactory.name);

  constructor(
    private platformUtils: PlatformUtilsService,
  ) {}

  createAdapter(platform: string, config: BotConfig): IBotPlatform {
    this.logger.log(`Creating adapter instance for platform: ${platform}, bot: ${config.name}`);
    
    // 每次调用都创建新的适配器实例，支持同一平台多个机器人
    switch (platform) {
      case 'qq':
        return new QQBotAdapter(this.platformUtils);
      case 'lark':
        return new LarkBotAdapter(this.platformUtils);
      case 'discord':
        return new DiscordBotAdapter(this.platformUtils);
      case 'wecom':
        return new WeComAiBotAdapter(this.platformUtils);
      case 'mock':
        return new MockBotAdapter();
      case 'wechat-personal':
        return new WechatPersonalBotAdapter(this.platformUtils);
      default:
        throw new Error(`Unsupported bot platform: ${platform}`);
    }
  }
}
