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

// 导入自研 QQ SDK
import { QQBot } from './qq/qq-bot.sdk';

/**
 * QQ机器人适配器
 *
 * 职责:
 * - 封装 QQ 官方 API
 * - 转换消息格式
 * - 管理 WebSocket 连接
 * 
 * 注意: 不负责重连逻辑,重连由 BotInstanceManager 统一管理
 */
export class QQBotAdapter implements IBotPlatform {
  private readonly logger = new Logger(QQBotAdapter.name);
  private client: any;
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
      // 如果已有 client,先清理
      if (this.client) {
        try {
          await this.client.reset();
        } catch (error: any) {
          this.logger.warn(`Error during client reset: ${error.message}`);
        }
        this.client = null;
      }
      
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
        maxRetry: 0, // 禁用 SDK 内部的重试,由上层统一管理
      });

      // 注册消息监听器
      this.client.on('message.group', async (event: any) => {
        try {
          this.logger.log('Received group message');
          const botMessage = await this.transformToBotMessage(event, 'group');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing group message: ${error.message}`);
        }
      });

      this.client.on('message.private', async (event: any) => {
        try {
          this.logger.log('Received private message');
          const botMessage = await this.transformToBotMessage(event, 'private');
          this.messageSubject.next(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing private message: ${error.message}`);
        }
      });

      // 注册错误处理 - 只记录日志,不处理重连
      this.client.on('error', (error: Error) => {
        this.logger.error(`QQ bot error: ${error.message}`);
        this.status = BotStatus.ERROR;
      });

      // 监听 WebSocket 连接成功事件
      this.client.on('ws_open', () => {
        this.logger.log('QQ bot WebSocket connected');
      });

      // 监听 WebSocket 关闭事件(来自 SDK 的主动通知)
      this.client.on('ws_close', (code: number, reason: string) => {
        this.logger.warn(`QQ bot WebSocket closed with code: ${code}${reason ? ` - ${reason}` : ''}`);
        this.status = BotStatus.DISCONNECTED;
        // 通过 Subject 发射断开事件
        this.disconnectSubject.next({
          code,
          reason,
          timestamp: new Date(),
        });
      });

      // 启动连接(使用 start 方法)
      await this.client.start();

      this.status = BotStatus.CONNECTED;
      this.logger.log(`QQ bot connected: ${config.name}`);
    } catch (error: any) {
      this.logger.error(`Failed to initialize QQ bot: ${error.message}`);
      this.status = BotStatus.ERROR;
      // 直接抛出异常,由 BotInstanceManager 决定如何处理
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
        
      // 构建消息参数
      const params: any = {
        msg_type: 0,  // 0=文本消息
        content: response.content,
      };
        
      // 如果有附件，需要特殊处理
      if (response.rawFrame?.attachments && response.rawFrame.attachments.length > 0) {
        // TODO: 实现附件发送逻辑
        // QQ官方API要求先上传媒体获取file_info，然后使用msg_type=7发送富媒体消息
        this.logger.warn('Attachment sending not fully implemented yet');
      }
        
      if (response.sourceType === 'private') {
        // 私聊消息
        this.logger.log(`Calling sendC2CMessage with userOpenId: ${response.conversationId}`);
        this.logger.log(`Params:`, JSON.stringify(params));
          
        const result = await this.client.sendC2CMessage(response.conversationId, params);
        this.logger.log(`sendC2CMessage result:`, JSON.stringify(result));
        this.logger.log(`Reply sent to private chat: ${response.conversationId}`);
      } else if (response.sourceType === 'group') {
        // 群聊消息
        this.logger.log(`Calling sendGroupMessage with groupOpenId: ${response.conversationId}`);
        this.logger.log(`Params:`, JSON.stringify(params));
          
        const result = await this.client.sendGroupMessage(response.conversationId, params);
        this.logger.log(`sendGroupMessage result:`, JSON.stringify(result));
        this.logger.log(`Reply sent to group: ${response.conversationId}`);
      } else {
        // 未知类型,尝试私聊
        this.logger.warn(`Unknown source type, defaulting to private chat`);
        await this.client.sendC2CMessage(response.conversationId, params);
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

  onDisconnect(): Observable<BotDisconnectEvent> {
    return this.disconnectSubject.asObservable();
  }

  getStatus(): BotStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.logger.log(`Shutting down QQ bot: ${this.config?.name}`);

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
    this.disconnectSubject.complete();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect QQ bot...`);
    
    // 1. 先彻底关闭旧客户端
    if (this.client) {
      try {
        await this.client.reset();  // 调用新增的 reset 方法,彻底重置所有状态
        this.logger.log('Old QQ bot client reset successfully');
      } catch (error: any) {
        this.logger.warn(`Error during client reset: ${error.message}`);
      }
      this.client = null;
    }
    
    // 2. 等待一小段时间,避免频繁请求被限流
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 3. 重新初始化(会创建新的 QQBot 实例并强制刷新 Token)
    if (this.config) {
      this.logger.log('Re-initializing QQ bot with fresh credentials...');
      await this.initialize(this.config);
    }
  }

  /**
   * 将 QQ 原始事件转换为标准 BotMessage
   */
  private async transformToBotMessage(rawEvent: any, sourceType?: 'private' | 'group'): Promise<BotMessage> {
    // 调试:打印事件结构
    this.logger.debug('Raw event:', JSON.stringify(rawEvent, null, 2));

    // 异步提取附件（在适配器层完成下载）
    const attachments = await this.extractAttachments(rawEvent);

    // 根据 QQ 官方 API 的事件结构调整
    return {
      messageId: rawEvent.id || rawEvent.msg_id,
      senderId: rawEvent.author?.id || rawEvent.user_openid || rawEvent.user_id,
      senderName: rawEvent.author?.username || rawEvent.member?.nickname || 'Unknown',
      conversationId: this.extractConversationId(rawEvent),
      content: rawEvent.content || rawEvent.text || '',
      messageType: this.detectMessageType(rawEvent),
      sourceType: sourceType,
      attachments,
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
   * 提取附件信息（在适配器层完成下载）
   */
  private async extractAttachments(rawEvent: any): Promise<BotMessage['attachments']> {
    if (!rawEvent.attachments || rawEvent.attachments.length === 0) {
      return undefined;
    }

    const attachments: BotMessage['attachments'] = [];

    for (const att of rawEvent.attachments) {
      try {
        // QQ官方API的附件类型映射
        let type: 'image' | 'file' | 'voice' = 'file';

        if (att.content_type?.startsWith('image/')) {
          type = 'image';
        } else if (att.content_type?.startsWith('audio/')) {
          type = 'voice';
        } else if (att.content_type?.startsWith('video/')) {
          // 视频暂时作为文件处理
          type = 'file';
        }

        // 如果是图片，下载到临时文件
        if (type === 'image' && att.url) {
          const result = await this.platformUtils.downloadAndProcessImage(
            att.url,
            { ttl: 10 * 60 * 1000 } // 10分钟TTL
          );

          attachments.push({
            type,
            localPath: result.tempPath, // 使用本地临时文件路径
            fileName: att.filename || att.file_name,
            fileSize: result.fileSize,
          });

          this.logger.log(`Extracted image attachment: ${result.tempPath}`);
        } else {
          // 其他类型暂不处理，只记录元数据
          attachments.push({
            type,
            url: att.url,
            fileId: att.id || att.file_id,
            fileName: att.filename || att.file_name,
            fileSize: att.size || att.file_size,
          });
        }
      } catch (error: any) {
        this.logger.error(`Failed to process attachment: ${error.message}`);
        // 继续处理其他附件
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }
}
