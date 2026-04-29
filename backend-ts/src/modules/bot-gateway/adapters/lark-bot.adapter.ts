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

// 导入飞书官方 SDK
import * as Lark from '@larksuiteoapi/node-sdk';

/**
 * 飞书机器人适配器
 *
 * 实现飞书开放平台机器人的消息收发功能
 * 使用 @larksuiteoapi/node-sdk 进行集成
 * 
 * 注意: 不负责重连逻辑,重连由 BotInstanceManager 统一管理
 */
@Injectable()
export class LarkBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(LarkBotAdapter.name);
  private client: any; // Lark SDK Client 实例（用于 API 调用）
  private wsClient: any; // Lark SDK WSClient 实例（用于 WebSocket 长连接）
  private messageSubject: Subject<BotMessage>;
  private status: BotStatus = BotStatus.STOPPED;
  private config: BotConfig | null = null;

  constructor() {
    this.messageSubject = new Subject<BotMessage>();
  }

  getPlatform(): string {
    return 'lark';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,       // 飞书暂不支持流式回复
      supportsPushMessage: true,      // 支持主动推送
      supportsTemplateCard: false,    // 暂不支持模板卡片
      supportsMultimedia: true,       // 支持多媒体消息
    };
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing Lark bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 获取 API 域名（默认国内）
      const domain = config.platformConfig.domain || 'https://open.feishu.cn';
      
      // 创建飞书 SDK 客户端（用于 API 调用）
      this.logger.log('Creating Lark Client for API calls...');
      this.client = new Lark.Client({
        appId: config.platformConfig.appId,
        appSecret: config.platformConfig.appSecret,
        domain,
      });

      this.logger.log('Lark Client created successfully');

      // 创建 WebSocket 客户端（用于长连接接收事件）
      this.logger.log('Creating Lark WSClient for WebSocket connection...');
      this.wsClient = new Lark.WSClient({
        appId: config.platformConfig.appId,
        appSecret: config.platformConfig.appSecret,
        domain,
      });

      this.logger.log('Lark WSClient created successfully');

      // 创建事件分发器并注册消息事件监听器
      this.logger.log('Creating EventDispatcher and registering message handler...');
      const eventDispatcher = new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: any) => {
          try {
            const botMessage = this.transformToBotMessage(data);
            this.messageSubject.next(botMessage);
          } catch (error: any) {
            this.logger.error(`Error processing message: ${error.message}`);
          }
        },
      });

      this.logger.log('EventDispatcher registered, starting WebSocket connection...');
      
      // 启动 WebSocket 长连接，传入事件分发器
      await this.wsClient.start({ eventDispatcher });
      
      this.logger.log('Lark bot connected via WebSocket successfully');
      
      this.logger.log('Lark bot initialized successfully');
      this.status = BotStatus.CONNECTED;
    } catch (error: any) {
      this.logger.error(`Failed to initialize Lark bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      // 直接抛出异常,由 BotInstanceManager 决定如何处理
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.config || !this.client) {
      throw new Error('Lark bot is not initialized');
    }

    try {
      this.logger.log(
        `Sending message: sourceType=${response.sourceType}, conversationId=${response.conversationId}, content=${response.content}`,
      );

      // 构建消息体
      const msgContent = {
        text: response.content,
      };

      // 根据消息来源类型调用不同的 API
      if (response.sourceType === 'private') {
        // 私聊：使用 chat_id 作为接收者（飞书要求）
        const result = await this.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: response.conversationId,
            content: JSON.stringify(msgContent),
            msg_type: 'text',
          },
        });

        this.logger.log(`Private message sent successfully`);
      } else if (response.sourceType === 'group') {
        // 群聊：使用 chat_id 作为接收者
        const result = await this.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: response.conversationId,
            content: JSON.stringify(msgContent),
            msg_type: 'text',
          },
        });

        this.logger.log(`Group message sent successfully`);
      } else {
        throw new Error(`Unsupported source type: ${response.sourceType}`);
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
    this.logger.log(`Shutting down Lark bot: ${this.config?.name}`);

    // 关闭 WebSocket 连接
    if (this.wsClient) {
      try {
        // WSClient 可能没有 stop 方法，直接置空即可
        this.wsClient = null;
        this.logger.log('Lark bot disconnected gracefully');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }

    this.status = BotStatus.STOPPED;
    this.messageSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect Lark bot...`);
    await this.shutdown();
    if (this.config) {
      await this.initialize(this.config);
    }
  }

  /**
   * 将飞书原始事件转换为标准 BotMessage
   */
  private transformToBotMessage(rawEvent: any): BotMessage {
    // WebSocket 模式下，事件结构为: { message: { chat_id, content, message_type, chat_type, message_id }, sender: {...} }
    const message = rawEvent.message || {};
    const sender = rawEvent.sender || {};

    return {
      messageId: message.message_id,
      senderId: sender.sender_id?.open_id || 'unknown',
      senderName: sender.sender_name || 'Unknown',
      conversationId: message.chat_id,
      content: this.extractContent(message),
      messageType: this.detectMessageType(message),
      sourceType: this.detectSourceType(message),
      attachments: undefined, // TODO: 提取附件
      rawEvent,
      timestamp: new Date(),
    };
  }

  /**
   * 提取消息内容
   */
  private extractContent(message: any): string {
    try {
      if (message.content) {
        const parsed = JSON.parse(message.content);
        return parsed.text || '';
      }
    } catch (error) {
      this.logger.warn('Failed to parse message content');
    }
    return '';
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(message: any): BotMessage['messageType'] {
    const msgType = message.message_type;
    
    if (msgType === 'image') return 'image';
    if (msgType === 'file') return 'file';
    if (msgType === 'audio') return 'voice';
    
    return 'text';
  }

  /**
   * 检测消息来源类型
   */
  private detectSourceType(message: any): 'private' | 'group' | 'channel' {
    // p2p = 私聊, group = 群聊
    return message.chat_type === 'group' ? 'group' : 'private';
  }
}
