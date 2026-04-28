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

// 导入 OneBots 企业微信适配器底层 Bot 类
import { WeComBot } from '@onebots/adapter-wecom';

/**
 * 企业微信机器人适配器
 *
 * 使用 @onebots/adapter-wecom 提供的底层 WeComBot 类
 * 直接封装企业微信开放平台 API，实现消息收发功能
 */
@Injectable()
export class WeComBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(WeComBotAdapter.name);
  private client: WeComBot;
  private messageSubject: Subject<BotMessage>;
  private status: BotStatus = BotStatus.STOPPED;
  private config: BotConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;

  constructor() {
    this.messageSubject = new Subject<BotMessage>();
  }

  getPlatform(): string {
    return 'wecom-app';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,       // 应用消息不支持流式回复
      supportsPushMessage: true,      // 支持主动推送
      supportsTemplateCard: true,     // 支持模板卡片
      supportsMultimedia: true,       // 支持多媒体消息
    };
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing WeCom bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 创建企业微信 Bot 实例
      this.client = new WeComBot({
        account_id: config.id,
        corp_id: config.platformConfig.corpId,
        corp_secret: config.platformConfig.corpSecret,
        agent_id: config.platformConfig.agentId,
        token: config.platformConfig.token,
        encoding_aes_key: config.platformConfig.encodingAesKey,
      });

      // 注册事件监听器
      this.client.on('ready', () => {
        this.logger.log('WeCom bot is ready');
        this.status = BotStatus.CONNECTED;
        this.reconnectAttempts = 0;
      });

      this.client.on('error', (error: Error) => {
        this.logger.error(`WeCom bot error: ${error.message}`);
        this.handleReconnect();
      });

      this.client.on('stopped', () => {
        this.logger.log('WeCom bot stopped');
        this.status = BotStatus.STOPPED;
      });

      // 启动 Bot（获取 access token）
      await this.client.start();

      this.logger.log(`WeCom bot initialized successfully: ${config.name}`);
    } catch (error: any) {
      this.logger.error(`Failed to initialize WeCom bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      this.handleReconnect();
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.client) {
      throw new Error('WeCom bot is not initialized');
    }

    try {
      this.logger.log(
        `Sending message: sourceType=${response.sourceType}, conversationId=${response.conversationId}, content=${response.content}`,
      );

      // 构建消息请求
      const request = {
        touser: response.conversationId,
        msgtype: 'text',
        agentid: parseInt(this.config!.platformConfig.agentId),
        text: {
          content: response.content,
        },
      };

      // 发送消息
      await this.client.sendMessage(request);

      this.logger.log(`Message sent successfully to: ${response.conversationId}`);
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
    this.logger.log(`Shutting down WeCom bot: ${this.config?.name}`);

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 停止 Bot
    if (this.client) {
      try {
        await this.client.stop();
        this.logger.log('WeCom bot disconnected gracefully');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }

    this.status = BotStatus.STOPPED;
    this.messageSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect WeCom bot...`);
    await this.shutdown();
    if (this.config) {
      await this.initialize(this.config);
    }
  }

  /**
   * 将企业微信原始事件转换为标准 BotMessage
   */
  private transformToBotMessage(rawEvent: any): BotMessage {
    // 企业微信事件结构需要根据实际 API 调整
    // 这里基于 OneBots adapter-wecom 的事件格式
    
    return {
      messageId: rawEvent.EventId || Date.now().toString(),
      senderId: rawEvent.FromUserName || rawEvent.fromuserid || 'unknown',
      senderName: rawEvent.FromUserName || 'Unknown',
      conversationId: rawEvent.FromUserName || rawEvent.fromuserid || 'unknown',
      content: this.extractContent(rawEvent),
      messageType: this.detectMessageType(rawEvent),
      sourceType: 'private', // 企业微信应用消息通常是私聊
      attachments: undefined, // TODO: 提取附件
      rawEvent,
      timestamp: new Date(rawEvent.TimeStamp ? rawEvent.TimeStamp * 1000 : Date.now()),
    };
  }

  /**
   * 提取消息内容
   */
  private extractContent(rawEvent: any): string {
    // 根据企业微信 API 文档，文本消息的内容在 Content 字段
    if (rawEvent.Content) {
      return rawEvent.Content;
    }
    
    // 如果是其他类型消息，尝试从 text 字段获取
    if (rawEvent.text?.content) {
      return rawEvent.text.content;
    }

    return '';
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(rawEvent: any): BotMessage['messageType'] {
    const msgType = rawEvent.MsgType || rawEvent.msgtype;
    
    if (msgType === 'image') return 'image';
    if (msgType === 'voice') return 'voice';
    if (msgType === 'file') return 'file';
    
    return 'text';
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
