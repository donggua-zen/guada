import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
} from '../interfaces/bot-platform.interface';

// 导入自研 QQ SDK
import { QQBot } from './qq/qq-bot.sdk';

/**
 * QQ机器人适配器
 *
 * 第一阶段:实现基础消息收发,自动回复"你好"
 */
@Injectable()
export class QQBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(QQBotAdapter.name);
  private client: any; // QQBotClient 实例(待实现)
  private messageSubject: Subject<BotMessage>;
  private status: BotStatus = BotStatus.STOPPED;
  private config: BotConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;

  constructor() {
    this.messageSubject = new Subject<BotMessage>();
  }

  getPlatform(): string {
    return 'qq';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,       // QQ 不支持流式回复
      supportsPushMessage: true,      // 支持主动推送
      supportsTemplateCard: false,    // 暂不支持模板卡片
      supportsMultimedia: true,       // 支持多媒体消息
    };
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing QQ bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 创建真实 QQ Bot 实例
      this.client = new QQBot({
        appId: config.platformConfig.appId,
        secret: config.platformConfig.appSecret,
        token: config.platformConfig.token,
        mode: config.platformConfig.mode || 'websocket',
        sandbox: false,
        intents: [
          'GROUP_AT_MESSAGE_CREATE',  // 群聊@消息
          'C2C_MESSAGE_CREATE',       // 私聊消息
        ],
        removeAt: true,  // 自动移除@机器人内容
        maxRetry: config.reconnectConfig?.maxRetries || 5,
      });

      // 注册消息监听器
      this.client.on('message.group', (event: any) => {
        this.logger.log('Received group message');
        const botMessage = this.transformToBotMessage(event, 'group');
        this.messageSubject.next(botMessage);
      });

      this.client.on('message.private', (event: any) => {
        this.logger.log('Received private message');
        const botMessage = this.transformToBotMessage(event, 'private');
        this.messageSubject.next(botMessage);
      });

      // 注册错误处理
      this.client.on('error', (error: Error) => {
        this.logger.error(`QQ bot error: ${error.message}`);
        this.handleReconnect();
      });

      // 启动连接（使用 start 方法）
      await this.client.start();
      
      this.status = BotStatus.CONNECTED;
      this.reconnectAttempts = 0;
      this.logger.log(`QQ bot connected: ${config.name}`);
    } catch (error: any) {
      this.logger.error(`Failed to initialize QQ bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      this.handleReconnect();
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.client) {
      throw new Error('QQ bot is not initialized');
    }

    try {
      // 根据消息来源类型调用对应的发送方法
      // sourceType 在接收消息时已经确定(private/group)
      
      this.logger.log(`Sending message: sourceType=${response.sourceType}, conversationId=${response.conversationId}, content=${response.content}`);
      
      if (response.sourceType === 'private') {
        // 私聊消息
        this.logger.log(`Calling sendC2CMessage with userOpenId: ${response.conversationId}`);
        
        // QQ C2C 消息需要 msg_type 和 content 对象
        const params = {
          msg_type: 0,  // 0=文本消息
          content: response.content,
        };
        
        this.logger.log(`Params:`, JSON.stringify(params));
        
        const result = await this.client.sendC2CMessage(response.conversationId, params);
        this.logger.log(`sendC2CMessage result:`, JSON.stringify(result));
        this.logger.log(`Reply sent to private chat: ${response.conversationId}`);
      } else if (response.sourceType === 'group') {
        // 群聊消息
        this.logger.log(`Calling sendGroupMessage with groupOpenId: ${response.conversationId}`);
        
        // QQ 群消息也需要 msg_type
        const params = {
          msg_type: 0,  // 0=文本消息
          content: response.content,
        };
        
        this.logger.log(`Params:`, JSON.stringify(params));
        
        const result = await this.client.sendGroupMessage(response.conversationId, params);
        this.logger.log(`sendGroupMessage result:`, JSON.stringify(result));
        this.logger.log(`Reply sent to group: ${response.conversationId}`);
      } else {
        // 未知类型,尝试私聊
        this.logger.warn(`Unknown source type, defaulting to private chat`);
        await this.client.sendC2CMessage(response.conversationId, {
          content: response.content,
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      this.logger.error(`Error details:`, error);
      throw error;
    }
  }

  onMessage(): Observable<BotMessage> {
    return this.messageSubject.asObservable();
  }

  getStatus(): BotStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.logger.log(`Shutting down QQ bot: ${this.config?.name}`);

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 关闭客户端连接
    if (this.client) {
      try {
        await this.client.stop();
        this.logger.log('QQ bot disconnected gracefully');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }

    this.status = BotStatus.STOPPED;
    this.messageSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect QQ bot...`);
    await this.shutdown();
    if (this.config) {
      await this.initialize(this.config);
    }
  }

  /**
   * 将 QQ 原始事件转换为标准 BotMessage
   */
  private transformToBotMessage(rawEvent: any, sourceType?: 'private' | 'group'): BotMessage {
    // 调试:打印事件结构
    this.logger.debug('Raw event:', JSON.stringify(rawEvent, null, 2));
    
    // 根据 QQ 官方 API 的事件结构调整
    return {
      messageId: rawEvent.id || rawEvent.msg_id,
      senderId: rawEvent.author?.id || rawEvent.user_openid || rawEvent.user_id,
      senderName: rawEvent.author?.username || rawEvent.member?.nickname || 'Unknown',
      conversationId: this.extractConversationId(rawEvent),
      content: rawEvent.content || rawEvent.text || '',
      messageType: this.detectMessageType(rawEvent),
      sourceType: sourceType,
      attachments: this.extractAttachments(rawEvent),
      rawEvent,
      timestamp: new Date(rawEvent.timestamp || Date.now()),
    };
  }

  /**
   * 提取会话 ID
   */
  private extractConversationId(rawEvent: any): string {
    // 私聊: author.user_openid
    // 群聊: group_openid (在根层级)
    return rawEvent.group_openid || rawEvent.author?.user_openid || rawEvent.channel_id || rawEvent.group_id || rawEvent.author?.id || 'unknown';
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(rawEvent: any): BotMessage['messageType'] {
    if (rawEvent.attachments?.length > 0) {
      return 'mixed';
    }
    return 'text';
  }

  /**
   * 提取附件信息
   */
  private extractAttachments(rawEvent: any): BotMessage['attachments'] {
    if (!rawEvent.attachments) {
      return undefined;
    }

    return rawEvent.attachments.map((att: any) => ({
      type: att.type === 'image' ? 'image' : 'file',
      url: att.url,
      fileId: att.id,
      fileName: att.filename,
      fileSize: att.size,
    }));
  }

  /**
   * 处理断线重连
   */
  private handleReconnect(): void {
    if (!this.config?.reconnectConfig?.enabled) {
      return;
    }

    const maxRetries = this.config.reconnectConfig.maxRetries || 5;
    const retryInterval = this.config.reconnectConfig.retryInterval || 5000;

    if (this.reconnectAttempts >= maxRetries) {
      this.logger.error(
        `Max reconnection attempts reached (${maxRetries})`,
      );
      this.status = BotStatus.ERROR;
      return;
    }

    this.reconnectAttempts++;
    this.status = BotStatus.DISCONNECTED;

    this.logger.log(
      `Reconnecting in ${retryInterval}ms (attempt ${this.reconnectAttempts}/${maxRetries})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error: any) {
        this.logger.error(`Reconnection failed: ${error.message}`);
      }
    }, retryInterval);
  }
}
