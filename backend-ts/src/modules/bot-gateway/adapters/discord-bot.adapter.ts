import { Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
  BotDisconnectEvent,
} from '../interfaces/bot-platform.interface';
import { PlatformUtilsService } from '../services/platform-utils.service';

// 导入 Discord.js SDK
import { Client, GatewayIntentBits, Message, Partials } from 'discord.js';

/**
 * Discord机器人适配器
 *
 * 职责:
 * - 封装 Discord API
 * - 转换消息格式
 * - 管理 WebSocket 长连接
 * 
 * 注意: 不负责重连逻辑,重连由 BotInstanceManager 统一管理
 */
export class DiscordBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(DiscordBotAdapter.name);
  private client: Client;
  private messageSubject: Subject<BotMessage>;
  private disconnectSubject: Subject<BotDisconnectEvent>;
  private status: BotStatus = BotStatus.STOPPED;
  private config: BotConfig | null = null;

  constructor(
    private platformUtils: PlatformUtilsService,
  ) {
    this.messageSubject = new Subject<BotMessage>();
    this.disconnectSubject = new Subject<BotDisconnectEvent>();
  }

  getPlatform(): string {
    return 'discord';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,       // Discord 不支持流式回复
      supportsPushMessage: true,      // 支持主动推送
      supportsTemplateCard: false,    // 暂不支持模板卡片
      supportsMultimedia: true,       // 支持多媒体消息
    };
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing Discord bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 如果已有 client，先清理
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (error: any) {
          this.logger.warn(`Error during client destroy: ${error.message}`);
        }
        this.client = null as any;
      }

      // 创建 Discord Client
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,           // 服务器
          GatewayIntentBits.GuildMessages,    // 服务器消息
          GatewayIntentBits.MessageContent,   // 消息内容（需要特权意图）
          GatewayIntentBits.DirectMessages,   // 私聊消息
          GatewayIntentBits.DirectMessageReactions, // 私聊反应
        ],
        partials: [
          Partials.Channel,  // 处理部分频道对象
        ],
      });

      // 注册消息监听器 - 群聊消息
      this.client.on('messageCreate', async (message: Message) => {
        try {
          // 忽略机器人自己的消息
          if (message.author.bot) {
            return;
          }

          // 忽略系统消息
          if (message.system) {
            return;
          }

          this.logger.log(`Received message from ${message.author.username}: ${message.content.substring(0, 50)}...`);
          
          const botMessage = await this.transformToBotMessage(message);
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing message: ${error.message}`);
        }
      });

      // 注册错误处理
      this.client.on('error', (error: Error) => {
        this.logger.error(`Discord bot error: ${error.message}`);
        this.status = BotStatus.ERROR;
        
        // 发送断开事件
        this.disconnectSubject.next({
          code: 1000,
          reason: error.message,
          timestamp: new Date(),
        });
      });

      // 注册就绪事件
      this.client.once('ready', () => {
        this.logger.log(`Discord bot logged in as ${this.client.user?.tag}`);
        this.status = BotStatus.CONNECTED;
      });

      // 注册断开事件
      this.client.on('disconnect', () => {
        this.logger.warn('Discord bot disconnected');
        this.status = BotStatus.DISCONNECTED;
        
        this.disconnectSubject.next({
          code: 1000,
          reason: 'WebSocket disconnected',
          timestamp: new Date(),
        });
      });

      // 登录 Discord
      const token = config.platformConfig.token;
      if (!token) {
        throw new Error('Discord bot token is not configured');
      }

      await this.client.login(token);
      
      this.logger.log('Discord bot initialized successfully');
    } catch (error: any) {
      this.logger.error(`Failed to initialize Discord bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log('Shutting down Discord bot...');
    
    if (this.client) {
      try {
        await this.client.destroy();
        this.logger.log('Discord bot destroyed');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }
    
    this.status = BotStatus.STOPPED;
  }

  getStatus(): BotStatus {
    return this.status;
  }

  onMessage(): Observable<BotMessage> {
    return this.messageSubject.asObservable();
  }

  onDisconnect(): Observable<BotDisconnectEvent> {
    return this.disconnectSubject.asObservable();
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.client || !this.client.isReady()) {
      throw new Error('Discord client is not ready');
    }

    try {
      // 获取频道
      const channel = await this.client.channels.fetch(response.conversationId);
      
      if (!channel || !('send' in channel)) {
        throw new Error(`Channel not found or not sendable: ${response.conversationId}`);
      }

      // 发送消息
      await channel.send({
        content: response.content,
      });

      this.logger.log(`Sent message to channel ${response.conversationId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将 Discord 原始消息转换为标准 BotMessage
   */
  private async transformToBotMessage(message: Message): Promise<BotMessage> {
    // 提取会话ID（频道ID）
    const conversationId = message.channel.id;

    // 提取消息内容
    let content = message.content || '';

    // 如果机器人被@，移除@部分
    if (this.client.user && message.mentions.has(this.client.user)) {
      const mentionPattern = new RegExp(`<@!?${this.client.user.id}>`, 'g');
      content = content.replace(mentionPattern, '').trim();
    }

    // 异步提取附件（在适配器层完成下载）
    const attachments = await this.extractAttachments(message);

    // 检测消息类型
    const messageType = this.detectMessageType(message);

    // 检测来源类型
    const sourceType = message.channel.isDMBased() ? 'private' : 'group';

    return {
      messageId: message.id,
      senderId: message.author.id,
      senderName: message.author.username || message.author.globalName || 'Unknown',
      conversationId,
      content,
      messageType,
      sourceType,
      attachments,
      rawEvent: message,
      timestamp: new Date(message.createdTimestamp),
    };
  }

  /**
   * 提取附件信息（在适配器层完成下载）
   */
  private async extractAttachments(message: Message): Promise<BotMessage['attachments']> {
    if (message.attachments.size === 0) {
      return undefined;
    }

    const attachments: BotMessage['attachments'] = [];

    for (const attachment of message.attachments.values()) {
      try {
        // 判断附件类型
        let type: 'image' | 'file' | 'voice' = 'file';

        if (attachment.contentType?.startsWith('image/')) {
          type = 'image';
        } else if (attachment.contentType?.startsWith('audio/')) {
          type = 'voice';
        }

        // 如果是图片，下载到临时文件
        if (type === 'image') {
          const result = await this.platformUtils.downloadAndProcessImage(
            attachment.url,
            { ttl: 10 * 60 * 1000 } // 10分钟TTL
          );

          attachments.push({
            type,
            localPath: result.tempPath, // 使用本地临时文件路径
            fileName: attachment.name,
            fileSize: result.fileSize,
          });

          this.logger.log(`Extracted image attachment: ${result.tempPath}`);
        } else {
          // 其他类型暂不处理，只记录元数据
          attachments.push({
            type,
            url: attachment.url,
            fileId: attachment.id,
            fileName: attachment.name,
            fileSize: attachment.size,
          });
        }
      } catch (error: any) {
        this.logger.error(`Failed to process attachment: ${error.message}`);
        // 继续处理其他附件
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(message: Message): BotMessage['messageType'] {
    if (message.attachments.size > 0) {
      const firstAttachment = message.attachments.first();
      if (firstAttachment?.contentType?.startsWith('image/')) {
        return 'image';
      }
      // Discord 视频作为文件处理
      if (firstAttachment?.contentType?.startsWith('video/')) {
        return 'file';
      }
    }

    return 'text';
  }
}
