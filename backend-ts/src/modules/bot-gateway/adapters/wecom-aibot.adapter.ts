import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBotPlatform,
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
  StreamReplyOptions,
  BotDisconnectEvent,
} from '../interfaces/bot-platform.interface';
import { PlatformUtilsService } from '../services/platform-utils.service';

// 导入企业微信智能机器人官方 SDK
import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';

/**
 * 企业微信智能机器人适配器（WebSocket 长连接模式）
 *
 * 使用 @wecom/aibot-node-sdk 官方 SDK
 * 基于 WebSocket 长连接通道，支持消息收发、流式回复等功能
 */
@Injectable()
export class WeComAiBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(WeComAiBotAdapter.name);
  private client: WSClient;
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
    return 'wecom';
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: true,        // 支持流式回复
      supportsPushMessage: false,     // 暂不支持主动推送（需要额外 API）
      supportsTemplateCard: true,     // 支持模板卡片
      supportsMultimedia: true,       // 支持多媒体消息
    };
  }

  async initialize(config: BotConfig): Promise<void> {
    this.logger.log(`Initializing WeCom AI Bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    try {
      // 获取配置
      const botId = config.platformConfig.botId;
      const secret = config.platformConfig.secret;
      const wsUrl = config.platformConfig.wsUrl || 'wss://openws.work.weixin.qq.com';

      if (!botId || !secret) {
        throw new Error('BotId and Secret are required for WeCom AI Bot');
      }

      // 创建 WSClient 实例
      this.client = new WSClient({
        botId,
        secret,
        wsUrl,
      });

      // 监听认证成功事件
      this.client.on('authenticated', () => {
        this.logger.log('WeCom AI Bot authenticated successfully');
        this.status = BotStatus.CONNECTED;
      });

      // 监听连接断开事件
      this.client.on('disconnected', () => {
        this.logger.warn('WeCom AI Bot disconnected');
        this.status = BotStatus.DISCONNECTED;
        // 通过 Subject 发射断开事件
        this.disconnectSubject.next({
          code: 0,
          timestamp: new Date(),
        });
      });

      // 监听错误事件
      this.client.on('error', (error: Error) => {
        this.logger.error(`WeCom AI Bot error: ${error.message}`);
        this.status = BotStatus.ERROR;
      });

      // 监听文本消息
      this.client.on('message.text', async (frame: WsFrame) => {
        try {
          const content = frame.body.text?.content || '';
          this.logger.log(`Received text message: ${content.substring(0, 50)}...`);

          const botMessage = await this.transformToBotMessage(frame, 'text');
          
          // 将消息传递给上层处理（不保存帧）
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing text message: ${error.message}`);
        }
      });

      // 监听图片消息
      this.client.on('message.image', async (frame: WsFrame) => {
        try {
          this.logger.log('Received image message');
          const botMessage = await this.transformToBotMessage(frame, 'image');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing image message: ${error.message}`);
        }
      });

      // 监听语音消息
      this.client.on('message.voice', async (frame: WsFrame) => {
        try {
          this.logger.log('Received voice message');
          const botMessage = await this.transformToBotMessage(frame, 'voice');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing voice message: ${error.message}`);
        }
      });

      // 监听文件消息
      this.client.on('message.file', async (frame: WsFrame) => {
        try {
          this.logger.log('Received file message');
          const botMessage = await this.transformToBotMessage(frame, 'file');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing file message: ${error.message}`);
        }
      });

      // 监听混合消息
      this.client.on('message.mixed', async (frame: WsFrame) => {
        try {
          this.logger.log('Received mixed message');
          const botMessage = await this.transformToBotMessage(frame, 'mixed');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing mixed message: ${error.message}`);
        }
      });

      // 监听进入会话事件（发送欢迎语）
      this.client.on('event.enter_chat', (frame: WsFrame) => {
        this.logger.log('User entered chat session');
        // 自动发送欢迎语
        this.sendWelcomeMessage(frame);
      });

      // 建立连接
      await this.client.connect();

      this.logger.log(`WeCom AI Bot initialized successfully: ${config.name}`);
    } catch (error: any) {
      this.logger.error(`Failed to initialize WeCom AI Bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      throw error;
    }
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.client || this.status !== BotStatus.CONNECTED) {
      throw new Error('WeCom AI Bot is not connected');
    }

    try {
      this.logger.log(
        `Sending message: conversationId=${response.conversationId}, content=${response.content}`,
      );

      // 企业微信智能机器人需要使用流式回复
      // 调用 sendStreamReply 方法
      const success = await this.sendStreamReply(response, { finish: true });
      
      if (!success) {
        throw new Error('Failed to send stream reply');
      }
      
      this.logger.log(`Message sent successfully to: ${response.conversationId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      this.logger.error(`Error details:`, error);
      throw error;
    }
  }

  /**
   * 发送流式回复
   */
  async sendStreamReply(
    response: BotResponse,
    options?: StreamReplyOptions,
  ): Promise<boolean> {
    if (!this.client || this.status !== BotStatus.CONNECTED) {
      throw new Error('WeCom AI Bot is not connected');
    }

    try {
      // 直接从 response.rawFrame 获取原始消息帧
      const frame = response.rawFrame;
      
      if (!frame) {
        this.logger.error('rawFrame is required for WeCom AI Bot streaming reply');
        return false;
      }

      const streamId = options?.streamId || generateReqId('stream');
      const finish = options?.finish ?? true;

      await this.client.replyStream(frame, streamId, response.content, finish);
      
      this.logger.log(`Stream reply sent (finish: ${finish}, streamId: ${streamId})`);
      
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send stream reply: ${error.message}`);
      return false;
    }
  }

  onMessage(): Observable<BotMessage> {
    return this.messageSubject.asObservable();
  }

  onDisconnect(): Observable<BotDisconnectEvent> {
    return this.disconnectSubject.asObservable();
  }

  getStatus(): BotStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.logger.log(`Shutting down WeCom AI Bot: ${this.config?.name}`);

    // 断开连接
    if (this.client) {
      try {
        await this.client.disconnect();
        this.logger.log('WeCom AI Bot disconnected gracefully');
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
    }

    this.status = BotStatus.STOPPED;
    this.messageSubject.complete();
    this.disconnectSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect WeCom AI Bot...`);
    await this.shutdown();
    if (this.config) {
      await this.initialize(this.config);
    }
  }

  /**
   * 将企业微信原始事件转换为标准 BotMessage
   */
  private async transformToBotMessage(
    frame: WsFrame,
    messageType: BotMessage['messageType'],
  ): Promise<BotMessage> {
    const body = frame.body;

    // 提取发送者信息
    const senderId = body.from?.userid || 'unknown';
    const senderName = body.from?.name || 'Unknown';

    // 提取会话 ID
    const conversationId = body.conversation_id || senderId;

    // 提取消息内容
    let content = '';
    if (body.text) {
      content = body.text.content || '';
    } else if (body.image) {
      content = `[图片] ${body.image.filename || ''}`;
    } else if (body.voice) {
      content = `[语音]`;
    } else if (body.file) {
      content = `[文件] ${body.file.filename || ''}`;
    }

    // 异步提取附件（在适配器层完成下载和解密）
    const attachments = await this.extractAttachments(body);

    return {
      messageId: frame.headers?.req_id || Date.now().toString(),
      senderId,
      senderName,
      conversationId,
      content,
      messageType,
      sourceType: this.detectSourceType(body),
      attachments,
      rawEvent: frame,
      timestamp: new Date(),
    };
  }

  /**
   * 检测消息来源类型
   */
  private detectSourceType(body: any): 'private' | 'group' | 'channel' {
    // 根据 conversation_type 判断
    // single: 私聊, group: 群聊
    return body.conversation_type === 'group' ? 'group' : 'private';
  }

  /**
   * 提取附件信息（在适配器层完成下载和解密）
   */
  private async extractAttachments(body: any): Promise<BotMessage['attachments']> {
    const attachments: BotMessage['attachments'] = [];

    if (body.image) {
      try {
        // 在适配器层完成下载、解密、保存到临时文件
        const result = await this.platformUtils.downloadAndProcessImage(
          body.image.url,
          {
            platform: 'wecom',
            aesKey: body.image.aeskey,
            ttl: 10 * 60 * 1000, // 10分钟TTL
          }
        );

        // 从 URL 中提取文件名
        let fileName = body.image.filename;
        if (!fileName && body.image.url) {
          try {
            const urlObj = new URL(body.image.url);
            const pathParts = urlObj.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart) {
              fileName = `image_${lastPart}.jpg`; // 企业微信图片通常是 JPEG
            }
          } catch (e) {
            // URL 解析失败，使用默认名称
          }
        }
        
        attachments.push({
          type: 'image',
          localPath: result.tempPath, // 传递本地临时文件路径
          fileName: fileName || `image_${Date.now()}.jpg`,
          fileSize: result.fileSize,
        });

        this.logger.log(`Extracted image attachment: ${result.tempPath}`);
      } catch (error: any) {
        this.logger.error(`Failed to process image attachment: ${error.message}`);
        // 继续处理其他附件，不阻断流程
      }
    }

    // TODO: 处理 voice 和 file 类型的附件

    return attachments.length > 0 ? attachments : undefined;
  }

  /**
   * 发送欢迎语
   */
  private async sendWelcomeMessage(frame: WsFrame): Promise<void> {
    if (!this.client) {
      this.logger.warn('Client not initialized, cannot send welcome message');
      return;
    }

    try {
      // 从 platformConfig 中读取欢迎语配置
      const welcomeConfig = this.config?.platformConfig.welcomeMessage;
      
      // 如果未配置或禁用，则不发送
      if (!welcomeConfig || welcomeConfig.enabled === false) {
        this.logger.debug('Welcome message is disabled');
        return;
      }

      const welcomeContent = welcomeConfig.content || '您好！我是智能助手，有什么可以帮您的吗？';
      
      // 使用 replyWelcome 方法发送欢迎语
      await this.client.replyWelcome(frame, {
        msgtype: 'text',
        text: {
          content: welcomeContent,
        },
      });
      
      this.logger.log('Welcome message sent successfully');
    } catch (error: any) {
      this.logger.error(`Failed to send welcome message: ${error.message}`);
    }
  }
}
