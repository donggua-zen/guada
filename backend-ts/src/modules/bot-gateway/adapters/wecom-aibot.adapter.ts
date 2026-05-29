import { Logger } from '@nestjs/common';
import {
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
  StreamReplyOptions,
} from '../interfaces/bot-platform.interface';
import { PlatformUtilsService } from '../services/platform-utils.service';

// 导入企业微信智能机器人官方 SDK
import { WSClient } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { generateReqId } from '@wecom/aibot-node-sdk';
import { BaseBotAdapter } from './base-bot.adapter';

/**
 * 企业微信智能机器人适配器（WebSocket 长连接模式）
 *
 * 使用 @wecom/aibot-node-sdk 官方 SDK
 * 基于 WebSocket 长连接通道，支持消息收发、流式回复等功能
 */
export class WeComAiBotAdapter extends BaseBotAdapter {
  private readonly logger = new Logger(WeComAiBotAdapter.name);
  private client: WSClient;

  constructor(
    private platformUtils: PlatformUtilsService,
  ) {
    super();
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
      handlesReconnectInternally: true, // SDK 内部有完善的重连机制
    };
  }

  async connect(config: BotConfig): Promise<void> {
    this.logger.log(`Connecting to WeCom AI Bot: ${config.name}`);
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

      // 监听认证成功事件 - 这才是真正的连接成功
      this.client.on('authenticated', () => {
        this.logger.log('WeCom AI Bot authenticated successfully');
        this.status = BotStatus.CONNECTED;
        // 发射连接成功事件
        this.emitConnected();
      });

      // 监听连接断开事件
      this.client.on('disconnected', () => {
        this.logger.warn('WeCom AI Bot disconnected');
        this.status = BotStatus.DISCONNECTED;
        // 通过 Subject 发射断开事件
        this.emitDisconnected({
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
          this.emitMessage(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing text message: ${error.message}`);
        }
      });

      // 监听图片消息
      this.client.on('message.image', async (frame: WsFrame) => {
        try {
          this.logger.log('Received image message');
          const botMessage = await this.transformToBotMessage(frame, 'image');
          this.emitMessage(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing image message: ${error.message}`);
        }
      });

      // 监听语音消息
      this.client.on('message.voice', async (frame: WsFrame) => {
        try {
          this.logger.log('Received voice message');
          const botMessage = await this.transformToBotMessage(frame, 'voice');
          this.emitMessage(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing voice message: ${error.message}`);
        }
      });

      // 监听文件消息
      this.client.on('message.file', async (frame: WsFrame) => {
        try {
          this.logger.log('Received file message');
          const botMessage = await this.transformToBotMessage(frame, 'file');
          this.emitMessage(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing file message: ${error.message}`);
        }
      });

      // 监听混合消息
      this.client.on('message.mixed', async (frame: WsFrame) => {
        try {
          this.logger.log('Received mixed message');
          const botMessage = await this.transformToBotMessage(frame, 'mixed');
          this.emitMessage(botMessage);
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

      // this.logger.log(`Stream reply sent (finish: ${finish}, streamId: ${streamId})`);

      return true;
    } catch (error: any) {
      this.logger.error(`Failed to send stream reply: ${error.message}`);
      return false;
    }
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
    this.completeSubjects();
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
    } else if (body.voice) {
      // 企业微信语音消息已自动转文本，直接使用转文本内容
      content = body.voice.content || '[语音]';
    } else if (body.location) {
      const loc = body.location;
      content = `[位置] ${loc.name || ''} (${loc.address || ''})`;
    } else if (body.link) {
      const link = body.link;
      content = `[链接] ${link.title || ''} ${link.url || ''}`;
    } else if (body.mixed?.msg_item?.length) {
      // 图文混排消息：拼接所有子项的文本内容
      const parts: string[] = [];
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'text' && item.text?.content) {
          parts.push(item.text.content);
        } else if (item.msgtype === 'voice' && item.voice) {
          // 语音子项使用转文本内容
          parts.push(item.voice.content || '[语音]');
        } else if (item.msgtype === 'location') {
          const loc = item.location;
          parts.push(`[位置] ${loc.name || ''} (${loc.address || ''})`);
        } else if (item.msgtype === 'link') {
          const link = item.link;
          parts.push(`[链接] ${link.title || ''} ${link.url || ''}`);
        }
      }
      content = parts.join(' ');
    }

    // 收集附件元数据（不下载，延迟到 downloadAttachment）
    // 注：downloadAttachment 直接通过 rawEvent 处理，无需在此处提取元数据

    return {
      messageId: frame.headers?.req_id || Date.now().toString(),
      senderId,
      senderName,
      conversationId,
      content,
      messageType,
      sourceType: this.detectSourceType(body),
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
   * 下载消息附件到指定目录
   * @param message 机器人消息（包含 rawEvent）
   * @param saveDir 保存目录的绝对路径
   * @returns 下载后的本地路径列表
   */
  async downloadAttachment(message: BotMessage, saveDir: string): Promise<string[]> {
    const frame = message.rawEvent as WsFrame | undefined;
    if (!frame) return [];

    const body = frame.body;
    const results: string[] = [];

    // 下载图片
    if (body.image) {
      try {
        const fileName = `image_${Date.now()}.jpg`;
        const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
        const aesKey = body.image.aeskey;

        if (!aesKey) {
          await this.platformUtils.downloadFile(body.image.url, savePath);
        } else {
          await this.platformUtils.downloadFile(
            body.image.url,
            savePath,
            {
              postProcessor: async (b) => this.decryptWeComImage(b, aesKey),
            },
          );
        }

        this.logger.log(`[wecom] 图片已下载: ${savePath}`);
        results.push(savePath);
      } catch (error: any) {
        this.logger.error(`[wecom] 图片下载失败: ${error.message}`);
      }
    }

    // 下载语音（企业微信语音消息已自动转文本，无URL，跳过下载）
    // 注：语音内容在 transformToBotMessage 中已提取为 body.voice.content

    // 下载视频
    if (body.video) {
      try {
        const fileName = `video_${Date.now()}.mp4`;
        const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
        await this.platformUtils.downloadFile(body.video.url, savePath);
        this.logger.log(`[wecom] 视频已下载: ${savePath}`);
        results.push(savePath);
      } catch (error: any) {
        this.logger.error(`[wecom] 视频下载失败: ${error.message}`);
      }
    }

    // 下载文件
    if (body.file) {
      try {
        const fileName = `file_${Date.now()}`;
        const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
        await this.platformUtils.downloadFile(body.file.url, savePath);
        this.logger.log(`[wecom] 文件已下载: ${savePath}`);
        results.push(savePath);
      } catch (error: any) {
        this.logger.error(`[wecom] 文件下载失败: ${error.message}`);
      }
    }

    // 下载图文混排消息中的附件
    if (body.mixed?.msg_item?.length) {
      for (const item of body.mixed.msg_item) {
        if (item.msgtype === 'image' && item.image) {
          try {
            const fileName = `image_${Date.now()}.jpg`;
            const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
            const aesKey = item.image.aeskey;

            if (!aesKey) {
              await this.platformUtils.downloadFile(item.image.url, savePath);
            } else {
              await this.platformUtils.downloadFile(
                item.image.url,
                savePath,
                {
                  postProcessor: async (b) => this.decryptWeComImage(b, aesKey),
                },
              );
            }

            this.logger.log(`[wecom] 图文混排-图片已下载: ${savePath}`);
            results.push(savePath);
          } catch (error: any) {
            this.logger.error(`[wecom] 图文混排-图片下载失败: ${error.message}`);
          }
        } else if (item.msgtype === 'voice' && item.voice) {
          // 企业微信语音子项已自动转文本，无URL，跳过下载
          // 注：语音内容在 transformToBotMessage 中已提取为 item.voice.content
        } else if (item.msgtype === 'video' && item.video) {
          try {
            const fileName = `video_${Date.now()}.mp4`;
            const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
            await this.platformUtils.downloadFile(item.video.url, savePath);
            this.logger.log(`[wecom] 图文混排-视频已下载: ${savePath}`);
            results.push(savePath);
          } catch (error: any) {
            this.logger.error(`[wecom] 图文混排-视频下载失败: ${error.message}`);
          }
        } else if (item.msgtype === 'file' && item.file) {
          try {
            const fileName = `file_${Date.now()}`;
            const savePath = await this.platformUtils.ensureUniqueFileName(saveDir, fileName);
            await this.platformUtils.downloadFile(item.file.url, savePath);
            this.logger.log(`[wecom] 图文混排-文件已下载: ${savePath}`);
            results.push(savePath);
          } catch (error: any) {
            this.logger.error(`[wecom] 图文混排-文件下载失败: ${error.message}`);
          }
        }
      }
    }

    return results;
  }

  /**
   * 解密企业微信加密的图片
   * @param encryptedBuffer 加密的buffer
   * @param aesKey AES密钥（Base64编码的32字节密钥）
   * @returns 解密后的buffer
   */
  private async decryptWeComImage(encryptedBuffer: Buffer, aesKey: string): Promise<Buffer> {
    const crypto = await import('crypto');

    // AES密钥是Base64编码的，需要先解码
    let paddedAesKey = aesKey;
    const paddingNeeded = (-aesKey.length % 4);
    if (paddingNeeded > 0) {
      paddedAesKey += '='.repeat(paddingNeeded);
    }

    const keyBuffer = Buffer.from(paddedAesKey, 'base64');

    if (keyBuffer.length !== 32) {
      throw new Error(`Invalid AES key length after Base64 decode: expected 32 bytes, got ${keyBuffer.length} bytes`);
    }

    // IV取AESKey前16字节
    const iv = keyBuffer.slice(0, 16);
    const key = keyBuffer;

    // 使用手动 PKCS#7 填充处理（参考 AstrBot）
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);

    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // 手动去除 PKCS#7 填充
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 32) {
      throw new Error(`Invalid PKCS#7 padding length: ${padLen}`);
    }

    // 验证填充是否正确
    for (let i = 0; i < padLen; i++) {
      if (decrypted[decrypted.length - 1 - i] !== padLen) {
        throw new Error(`Invalid PKCS#7 padding at position ${i}`);
      }
    }

    decrypted = decrypted.slice(0, decrypted.length - padLen);

    return decrypted;
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
