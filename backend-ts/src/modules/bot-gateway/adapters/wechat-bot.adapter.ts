import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
} from '../interfaces/bot-platform.interface';

// 导入 onebots 微信适配器
import { WechatAdapter } from '@onebots/adapter-wechat';

/**
 * 微信机器人适配器
 *
 * 使用 @onebots/adapter-wechat 实现微信公众号机器人
 * 支持订阅号和服务号
 */
@Injectable()
export class WeChatBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(WeChatBotAdapter.name);
  private bot: any; // WechatBot 实例
  private messageSubject: Subject<BotMessage>;
  private status: BotStatus = BotStatus.STOPPED;
  private config: BotConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;

  constructor() {
    this.messageSubject = new Subject<BotMessage>();
  }

  getPlatform(): string {
    return 'wechat';
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing WeChat bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 创建微信公众号适配器实例
      const adapter = new WechatAdapter({
        appId: config.platformConfig.appId,
        appSecret: config.platformConfig.appSecret,
        token: config.platformConfig.token,
        encodingAESKey: config.platformConfig.encodingAESKey,
      } as any);

      // 注册消息监听器
      adapter.on('message.text', (event: any) => {
        this.logger.log('Received WeChat text message');
        const botMessage = this.transformToBotMessage(event);
        this.messageSubject.next(botMessage);
      });

      adapter.on('message.image', (event: any) => {
        this.logger.log('Received WeChat image message');
        const botMessage = this.transformToBotMessage(event);
        this.messageSubject.next(botMessage);
      });

      adapter.on('message.voice', (event: any) => {
        this.logger.log('Received WeChat voice message');
        const botMessage = this.transformToBotMessage(event);
        this.messageSubject.next(botMessage);
      });

      // 注册事件监听器
      adapter.on('event.subscribe', (event: any) => {
        this.logger.log(`User subscribed: ${event.FromUserName}`);
      });

      adapter.on('event.unsubscribe', (event: any) => {
        this.logger.log(`User unsubscribed: ${event.FromUserName}`);
      });

      // 注册错误处理
      adapter.on('error', (error: Error) => {
        this.logger.error(`WeChat bot error: ${error.message}`);
        this.handleReconnect();
      });

      // 保存引用
      this.bot = adapter;
      
      // 启动 Webhook 服务器
      await adapter.start();
      
      const port = config.platformConfig.webhookPort || 3002;
      const path = config.platformConfig.webhookPath || '/webhook/wechat';
      this.logger.log(`WeChat webhook server started on port ${port}${path}`);
      this.logger.log('请在微信公众平台配置服务器地址: http://your-domain' + path);
      
      this.status = BotStatus.CONNECTED;
      this.reconnectAttempts = 0;
      this.logger.log('WeChat bot initialized successfully');
    } catch (error: any) {
      this.logger.error(`Failed to initialize WeChat bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      this.handleReconnect();
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.bot) {
      throw new Error('WeChat bot is not initialized');
    }

    try {
      this.logger.log(
        `Sending message: conversationId=${response.conversationId}, content=${response.content}`,
      );

      // 使用 bot.sendMessage 发送消息
      await this.bot.sendMessage(response.conversationId, {
        type: 'text',
        text: response.content,
      });
      
      this.logger.log(`Reply sent to user: ${response.conversationId}`);
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
    this.logger.log(`Shutting down WeChat bot: ${this.config?.name}`);

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 关闭应用
    if (this.bot) {
      try {
        await this.bot.stop();
        this.logger.log('WeChat bot disconnected gracefully');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }

    this.status = BotStatus.STOPPED;
    this.messageSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect WeChat bot...`);
    await this.shutdown();
    if (this.config) {
      await this.initialize(this.config);
    }
  }

  /**
   * 将微信原始事件转换为标准 BotMessage
   */
  private transformToBotMessage(rawEvent: any): BotMessage {
    this.logger.debug('Raw WeChat event:', JSON.stringify(rawEvent, null, 2));
    
    return {
      messageId: rawEvent.MsgId || Date.now().toString(),
      senderId: rawEvent.FromUserName,
      senderName: rawEvent.from?.nickname || 'Unknown',
      conversationId: rawEvent.FromUserName,
      content: this.extractContent(rawEvent),
      messageType: this.detectMessageType(rawEvent),
      sourceType: 'private', // 微信公众号都是私聊
      attachments: this.extractAttachments(rawEvent),
      rawEvent,
      timestamp: new Date((rawEvent.CreateTime || Date.now() / 1000) * 1000),
    };
  }

  /**
   * 提取消息内容
   */
  private extractContent(rawEvent: any): string {
    if (rawEvent.Content) {
      return rawEvent.Content;
    }
    
    // 处理其他类型的消息
    if (rawEvent.MsgType === 'image') {
      return '[图片]';
    } else if (rawEvent.MsgType === 'voice') {
      return '[语音]';
    } else if (rawEvent.MsgType === 'video') {
      return '[视频]';
    }
    
    return '';
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(rawEvent: any): BotMessage['messageType'] {
    const msgType = rawEvent.MsgType || 'text';
    
    if (msgType === 'image') {
      return 'image';
    } else if (msgType === 'voice') {
      return 'voice';
    } else if (msgType === 'video' || msgType === 'file') {
      return 'file';
    }
    
    return 'text';
  }

  /**
   * 提取附件信息
   */
  private extractAttachments(rawEvent: any): BotMessage['attachments'] {
    const attachments: any[] = [];

    // 处理图片附件
    if (rawEvent.MsgType === 'image' && rawEvent.PicUrl) {
      attachments.push({
        type: 'image',
        url: rawEvent.PicUrl,
        fileId: rawEvent.MediaId,
      });
    }

    // 处理语音附件
    if (rawEvent.MsgType === 'voice' && rawEvent.MediaId) {
      attachments.push({
        type: 'voice',
        fileId: rawEvent.MediaId,
        fileName: rawEvent.Recognition,
      });
    }

    // 处理视频附件
    if (rawEvent.MsgType === 'video' && rawEvent.MediaId) {
      attachments.push({
        type: 'file',
        fileId: rawEvent.MediaId,
        fileName: rawEvent.Title,
      });
    }

    return attachments.length > 0 ? attachments : undefined;
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
