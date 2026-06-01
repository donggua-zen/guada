import { Logger } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { PlatformUtilsService } from "../services/platform-utils.service";
import {
  BotConfig,
  BotMessage,
  BotResponse,
  BotStatus,
  PlatformCapabilities,
} from "../interfaces/bot-platform.interface";
import { BaseBotAdapter } from "./base-bot.adapter";
import { IlinkBot } from "./wechat-personal-sdk/ilink-bot";
import type { NormalizedChatEvent } from "./wechat-personal-sdk/protocol/chat-event";

/**
 * 微信个人号适配器（基于 iLink Bot HTTP API）
 *
 * 实现扫码登录 + 长轮询消息接收
 * SDK 内部自行处理重连和凭证失效重登
 */
export class WechatPersonalBotAdapter extends BaseBotAdapter {
  private readonly logger = new Logger(WechatPersonalBotAdapter.name);
  private client: IlinkBot | null = null;
  private latestQrCodeUrl: string | null = null;
  private loginAbortController: AbortController | null = null;
  private loginBusy = false;

  constructor(private readonly platformUtils: PlatformUtilsService) {
    super();
  }

  getPlatform(): string {
    return "wechat-personal";
  }

  getCapabilities(): PlatformCapabilities {
    return {
      supportsStreaming: false,
      supportsPushMessage: true,
      supportsTemplateCard: false,
      supportsMultimedia: true,
      handlesReconnectInternally: false,
    };
  }

  private getSessionPath(config: BotConfig): string {
    const safeId = String(config.id).replace(/[^a-zA-Z0-9._-]/g, "_");
    // 优先使用 USERDATA_DIR（Electron 用户数据目录），其次 DATA_DIR，最后回退到 process.cwd()/data
    const dataDir = process.env.USERDATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), "data");
    const sessionDir = path.join(dataDir, "wechat-personal");
    return path.join(sessionDir, `${safeId}.json`);
  }

  private async ensureSessionDir(sessionPath: string): Promise<void> {
    const dir = path.dirname(sessionPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // 忽略
    }
  }

  async connect(config: BotConfig): Promise<void> {
    this.logger.log(`Connecting to WeChat Personal bot: ${config.name}`);
    this.config = config;
    this.status = BotStatus.CONNECTING;

    // 终止旧的登录流程
    if (this.loginAbortController) {
      this.loginAbortController.abort();
    }
    this.loginAbortController = new AbortController();

    try {
      if (this.client) {
        await this.client.stopPolling();
        this.client.removeAllListeners();
        this.client = null;
      }

      const sessionPath = this.getSessionPath(config);
      await this.ensureSessionDir(sessionPath);

      this.client = new IlinkBot({
        sessionStore: sessionPath,
        baseUrl: config.platformConfig.baseUrl,
        cdnBaseUrl: config.platformConfig.cdnBaseUrl,
      });

      this.client.on("login", (session) => {
        this.logger.log(
          `[wechat-personal] ${config.id} 扫码登录成功，ilink_bot_id=${session.accountId}`,
        );
      });

      this.client.on("credential_stale", (err: Error) => {
        this.logger.warn(
          `[wechat-personal] ${config.id} 会话已失效，将自动重新登录: ${err.message}`,
        );
        this.emitDisconnected({
          code: 401,
          reason: `会话已失效: ${err.message}`,
          timestamp: new Date(),
        });
      });

      this.client.on("polling_error", (err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[wechat-personal] ${config.id} 轮询错误: ${errorMessage}`,
        );
      });

      this.client.on("message", (evt: NormalizedChatEvent) => {
        try {
          const botMessage = this.transformToBotMessage(evt);
          this.emitMessage(botMessage);
        } catch (error: any) {
          this.logger.error(`Error processing message: ${error.message}`);
        }
      });

      await this.startBotClient(config);

      this.logger.log(
        `WeChat Personal bot connection initiated: ${config.name}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize WeChat Personal bot: ${error.message}`,
      );
      this.status = BotStatus.ERROR;
      throw error;
    }
  }

  private async startBotClient(config: BotConfig): Promise<void> {
    if (!this.client) {
      throw new Error("iLink client is not initialized");
    }

    // 防止并发登录
    if (this.loginBusy) {
      throw new Error(`[wechat-personal] ${config.id} 登录流程已在进行中`);
    }

    // 统一走 loginAsync：有会话直接启动轮询，无会话则扫码登录
    void this.loginAsync(config);
  }

  private async loginAsync(config: BotConfig, maxRetries = 3): Promise<void> {
    if (!this.client || this.loginBusy) return;
    this.loginBusy = true;

    // 检查是否已有会话
    const session = await this.client.getSession();
    if (session) {
      this.logger.log(
        `[wechat-personal] ${config.id} 恢复已有会话，启动轮询...`,
      );
    } else {
      // 无会话，循环创建二维码并等待扫码
      this.logger.log(
        `[wechat-personal] ${config.id} 未找到会话，开始扫码登录...`,
      );

      let loginSession: { sessionKey: string; qrCodeUrl?: string } | null =
        null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          loginSession = await this.client.createLoginSession();
          this.latestQrCodeUrl = (loginSession as any).qrCodeUrl ?? null;
          this.logger.log(
            `[wechat-personal] ${config.id} 二维码已生成（第 ${attempt}/${maxRetries} 次）: ${this.latestQrCodeUrl}`,
          );

          const result = await this.client.waitForLogin(
            loginSession.sessionKey,
            {
              timeoutMs: config.platformConfig.qrLoginTimeoutMs ?? 480_000,
              signal: this.loginAbortController?.signal,
            },
          );

          if (result.connected) {
            break; // 登录成功，跳出循环
          }

          // 登录失败（过期或超时）
          this.logger.warn(
            `[wechat-personal] ${config.id} 第 ${attempt}/${maxRetries} 次扫码登录失败: ${result.message}`,
          );
          this.latestQrCodeUrl = null;
          loginSession = null;

          if (attempt >= maxRetries) {
            this.logger.error(
              `[wechat-personal] ${config.id} 扫码登录重试次数已用完`,
            );
            this.status = BotStatus.DISCONNECTED;
            this.emitDisconnected({
              code: 401,
              reason: "扫码登录重试次数已用完",
              timestamp: new Date(),
            });
            this.loginBusy = false;
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        } catch (error: any) {
          this.logger.error(
            `[wechat-personal] ${config.id} 扫码登录异常: ${error.message}`,
          );
          this.latestQrCodeUrl = null;
          this.status = BotStatus.ERROR;
          this.emitDisconnected({
            code: 500,
            reason: error.message,
            timestamp: new Date(),
          });
          this.loginBusy = false;
          return;
        }
      }

      if (!loginSession) {
        this.loginBusy = false;
        return;
      }

      this.logger.log(
        `[wechat-personal] ${config.id} 扫码登录成功，启动轮询...`,
      );
    }

    // 统一启动消息轮询
    void this.client
      .startPolling({
        timeoutMs: config.platformConfig.pollingTimeoutMs,
        retryDelayMs: config.platformConfig.pollingRetryDelayMs,
      })
      .catch((err: unknown) => {
        this.logger.error(`[wechat-personal] ${config.id} 轮询错误:`, err);
      });

    this.status = BotStatus.CONNECTED;
    this.emitConnected();
    this.loginBusy = false;
  }

  async sendMessage(response: BotResponse): Promise<void> {
    if (!this.client || this.status !== BotStatus.CONNECTED) {
      throw new Error("WeChat Personal bot is not connected");
    }

    try {
      this.logger.log(
        `Sending message: conversationId=${response.conversationId}, content=${response.content.substring(0, 50)}...`,
      );

      await this.client.sendTextToUser(
        response.conversationId,
        response.content,
      );

      this.logger.log(
        `Message sent successfully to: ${response.conversationId}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      throw error;
    }
  }

  getQrCodeUrl(): string | null {
    return this.latestQrCodeUrl;
  }

  /**
   * 退出登录并清除本地会话
   */
  async logout(): Promise<void> {
    this.logger.log(`[wechat-personal] 退出登录，清除会话: ${this.config?.id}`);
    if (this.client) {
      try {
        await this.client.clearSession();
        this.logger.log("[wechat-personal] 会话已清除");
      } catch (error: any) {
        this.logger.error(`[wechat-personal] 清除会话失败: ${error.message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    // 防重入：已停止则直接返回
    if (this.status === BotStatus.STOPPED) {
      return;
    }

    this.logger.log(`Shutting down WeChat Personal bot: ${this.config?.name}`);
    this.latestQrCodeUrl = null;

    // 终止正在进行的登录流程
    if (this.loginAbortController) {
      this.loginAbortController.abort();
      this.loginAbortController = null;
    }

    if (this.client) {
      try {
        await this.client.stopPolling();
        this.logger.log("WeChat Personal bot polling stopped");
      } catch (error: any) {
        this.logger.error(`Error during shutdown: ${error.message}`);
      }
      this.client = null;
    }

    this.status = BotStatus.STOPPED;
    this.completeSubjects();
  }

  async reconnect(): Promise<void> {
    this.logger.log(`Attempting to reconnect WeChat Personal bot...`);
    if (this.config) {
      await this.connect(this.config);
    }
  }

  /**
   * 下载消息附件到指定目录
   * @param message 机器人消息（包含 rawEvent）
   * @param saveDir 保存目录的绝对路径
   * @returns 下载后的本地路径列表
   */
  async downloadAttachment(
    message: BotMessage,
    saveDir: string,
  ): Promise<string[]> {
    if (!this.client) return [];

    // rawEvent 是 NormalizedChatEvent
    const evt = message.rawEvent as NormalizedChatEvent | undefined;
    if (!evt || !evt.media) return [];

    try {
      const result = await this.client.downloadInboundMedia(evt);
      const ext = path.extname(result.fileName || "") || ".bin";
      let fileName = result.fileName || `file_${Date.now()}${ext}`;

      // 去重：如果文件已存在，添加序号
      const savePath = await this.platformUtils.ensureUniqueFileName(
        saveDir,
        fileName,
      );

      await fs.writeFile(savePath, result.buffer);
      this.logger.log(
        `[wechat-personal] 附件已下载: ${savePath} (${result.mimeType})`,
      );
      return [savePath];
    } catch (error: any) {
      this.logger.error(`[wechat-personal] 下载附件失败: ${error.message}`);
      return [];
    }
  }

  private transformToBotMessage(evt: NormalizedChatEvent): BotMessage {
    const rawText = evt.text ?? evt.caption ?? "";

    return {
      messageId: String(evt.id ?? evt.seq ?? Date.now()),
      senderId: evt.from.id,
      senderName: evt.from.id,
      conversationId: evt.chat.id,
      content: rawText,
      messageType: this.detectMessageType(evt),
      sourceType: "private",
      rawEvent: evt,
      timestamp: new Date(evt.date ?? Date.now()),
    };
  }

  private detectMessageType(
    evt: NormalizedChatEvent,
  ): BotMessage["messageType"] {
    switch (evt.type) {
      case "photo":
        return "image";
      case "voice":
        return "voice";
      case "video":
      case "document":
        return "file";
      case "text":
      default:
        return "text";
    }
  }
}
