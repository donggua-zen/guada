import { Logger } from '@nestjs/common';
import {
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  BotDisconnectEvent,
  PlatformCapabilities,
} from '../interfaces/bot-platform.interface';
import { PlatformUtilsService } from '../services/platform-utils.service';

// 导入飞书官方 SDK
import * as Lark from '@larksuiteoapi/node-sdk';
import { BaseBotAdapter } from './base-bot.adapter';

/**
 * 飞书机器人适配器
 *
 * 实现飞书开放平台机器人的消息收发功能
 * 使用 @larksuiteoapi/node-sdk 进行集成
 * 
 * 注意: 不负责重连逻辑,重连由 BotInstanceManager 统一管理
 */
export class LarkBotAdapter extends BaseBotAdapter {
  private readonly logger = new Logger(LarkBotAdapter.name);
  private client: any; // Lark SDK Client 实例（用于 API 调用）
  private wsClient: any; // Lark SDK WSClient 实例（用于 WebSocket 长连接）

  constructor(
    private platformUtils: PlatformUtilsService,
  ) {
    super();
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
      handlesReconnectInternally: false, // 需要外部 BotInstanceManager 统一管理重连
    };
  }

  async connect(config: BotConfig): Promise<void> {
    this.logger.log(`Connecting to Lark bot: ${config.name}`);
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
            const botMessage = await this.transformToBotMessage(data);
            this.emitMessage(botMessage);
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
      
      // 发射连接成功事件
      this.emitConnected();
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
    this.completeSubjects();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect Lark bot...`);
    await this.shutdown();
    if (this.config) {
      await this.connect(this.config);
    }
  }

  /**
   * 将飞书原始事件转换为标准 BotMessage
   */
  private async transformToBotMessage(rawEvent: any): Promise<BotMessage> {
    // WebSocket 模式下，事件结构为: { message: { chat_id, content, message_type, chat_type, message_id }, sender: {...} }
    const message = rawEvent.message || {};
    const sender = rawEvent.sender || {};

    // 收集附件元数据（不下载，延迟到 downloadAttachment）
    // 注：downloadAttachment 直接通过 rawEvent 处理，无需在此处提取元数据
    const attachments = undefined;

    return {
      messageId: message.message_id,
      senderId: sender.sender_id?.open_id || 'unknown',
      senderName: sender.sender_name || 'Unknown',
      conversationId: message.chat_id,
      content: this.extractContent(message),
      messageType: this.detectMessageType(message),
      sourceType: this.detectSourceType(message),
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

  /**
   * 下载消息附件到指定目录
   * @param message 机器人消息（包含 rawEvent）
   * @param saveDir 保存目录的绝对路径
   * @returns 下载后的本地路径列表
   */
  async downloadAttachment(message: BotMessage, saveDir: string): Promise<string[]> {
    const rawEvent = message.rawEvent;
    if (!rawEvent?.message) return [];

    const msg = rawEvent.message;
    const results: string[] = [];

    try {
      if (msg.message_type === 'image' && msg.content) {
        const parsed = JSON.parse(msg.content);
        const fileKey = parsed.image_key || parsed.file_key;

        if (fileKey) {
          const imageUrl = `https://open.feishu.cn/open-apis/im/v1/messages/${msg.message_id}/resources/${fileKey}?type=image`;
          const fileName = `image_${fileKey}.jpg`;
          const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
          await this.platformUtils.downloadFile(imageUrl, savePath);
          this.logger.log(`[lark] 附件已下载: ${savePath}`);
          results.push(savePath);
        }
      }

      // TODO: 处理文件和语音附件
    } catch (error: any) {
      this.logger.error(`[lark] 下载附件失败: ${error.message}`);
    }

    return results;
  }
}
