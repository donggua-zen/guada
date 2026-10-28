import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  IBotPlatform,
  BotMessage,
  BotConfig,
  BotResponse,
  BotInstanceView,
  BotRuntimeStatus,
} from "../interfaces/bot-platform.interface";
import { ChatRunnerService } from "../../chat/chat-runner.service";
import { SessionMapperService } from "./session-mapper.service";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { EventBusService } from "../../../common/events/event-bus.service";
import { buildExternalId } from "../utils/external-id";
import { isMeaningfulSenderName } from "../utils/bot-user";
import { StreamReplyCoalescer } from "../utils/stream-reply-coalescer";

/**
 * 机器人消息编排器
 *
 * 职责:
 * 1. 接收外部传入的消息(通过 enqueueMessage)
 * 2. 创建/获取会话
 * 3. 调用 AgentEngine 生成回复
 * 4. 发送回复到外部平台
 *
 * 注意: 本服务不直接订阅适配器事件,由 BotInstanceManager 负责监听并转发
 */
@Injectable()
export class BotOrchestrator {
  private readonly logger = new Logger(BotOrchestrator.name);
  private messageQueues: Map<
    string,
    {
      messages: BotMessage[];
      timer?: NodeJS.Timeout;
      session?: any;
      /** 最近一次会话准备失败的原因，用于向用户反馈 */
      sessionError?: string;
    }
  > = new Map();
  private processingSessions: Set<string> = new Set();
  private pendingReplies: Map<string, BotResponse[]> = new Map();
  private readonly MERGE_WINDOW_MS = 3000; // 3秒合并窗口
  private readonly MAX_QUEUE_LENGTH = 10; // 最大缓冲消息数
  private readonly MAX_PENDING_REPLIES = 50; // 每个机器人最大待发送回复数
  private readonly FALLBACK_REPLY = "抱歉,我暂时无法回复。";
  private lastSendAt = new Map<string, number>();

  constructor(
    private chatRunner: ChatRunnerService,
    private sessionMapper: SessionMapperService,
    private workspaceService: WorkspaceService,
    private eventBus: EventBusService,
  ) {}

  /**
   * 限流：确保两次发送之间至少间隔 sendIntervalMs。
   * 如果距上次发送已超过间隔，立即返回；否则等待剩余时间。
   * 供 Orchestrator sendReply 和 BotFileSenderPlugin 共享使用。
   */
  async throttleSend(botId: string, intervalMs: number): Promise<void> {
    if (intervalMs <= 0) return;
    const now = Date.now();
    const last = this.lastSendAt.get(botId) ?? 0;
    const elapsed = now - last;
    if (elapsed < intervalMs) {
      // Reserve the slot BEFORE waiting to prevent concurrent callers from bypassing
      this.lastSendAt.set(botId, last + intervalMs);
      await new Promise((r) => setTimeout(r, intervalMs - elapsed));
    } else {
      this.lastSendAt.set(botId, now);
    }
  }

  /**
   * 将消息加入缓冲队列(唯一对外暴露的方法)
   *
   * @param botId 机器人ID
   * @param message 机器人消息
   * @param config 机器人配置(由调用者传入,避免反向依赖)
   * @param instance 机器人实例视图（adapter + config + status）
   */
  async enqueueMessage(
    botId: string,
    message: BotMessage,
    instance: BotInstanceView,
  ): Promise<void> {
    const { config, adapter } = instance;
    // 使用 externalId 作为队列 Key，确保同一会话的消息被合并
    const platform = config.platform || "qq";
    const isGroupChat = message.sourceType === "group";
    const type = isGroupChat ? "group" : "private";
    const nativeId = isGroupChat ? message.conversationId : message.senderId;
    const externalId = buildExternalId(platform, type, nativeId);
    const queueKey = `${botId}:${externalId}`;

    if (!this.messageQueues.has(queueKey)) {
      this.messageQueues.set(queueKey, { messages: [] });
    }

    const queue = this.messageQueues.get(queueKey)!;

    // 队列长度保护：如果超过上限，丢弃最旧的消息
    if (queue.messages.length >= this.MAX_QUEUE_LENGTH) {
      const droppedMsg = queue.messages.shift();
      this.logger.warn(
        `Queue overflow for ${queueKey}, dropped oldest message: ${droppedMsg?.messageId}`,
      );
    }

    queue.messages.push(message);

    // 立即创建会话并下载附件（附件有效期短，不能等合并后再下载）
    // 注意：这段逻辑必须在 processingSessions 检查之前执行，
    // 否则 AI 处理期间收到的新消息会跳过附件下载
    if (!queue.session) {
      try {
        queue.session = await this.ensureSession(botId, message, config);
        queue.sessionError = undefined;
      } catch (error: any) {
        queue.sessionError = this.extractErrorMessage(error);
        this.logger.error(
          `Failed to ensure session for ${queueKey}: ${queue.sessionError}`,
        );
      }
    }

    // 下载当前消息的附件（无论是否新会话都执行）
    if (queue.session && adapter.downloadAttachment) {
      try {
        const workspacePath =
          queue.session.workspacePath ||
          (await this.workspaceService.getDefaultWorkspaceDir(
            queue.session.id,
          ));
        const destDir = path.join(workspacePath, "files");
        await fs.promises.mkdir(destDir, { recursive: true });
        const downloadedPaths = await adapter
          .downloadAttachment(message, destDir)
          .catch((error: any) => {
            this.logger.error(
              `Failed to download attachment for message ${message.messageId}: ${error.message}`,
            );
            return [] as string[];
          });
        // 将附件引用直接追加到消息内容中
        for (const downloadedPath of downloadedPaths) {
          const relativePath = path
            .relative(workspacePath, downloadedPath)
            .replace(/\\/g, "/");
          message.content += `\n[上传了文件: ${relativePath}]`;
        }
      } catch (error: any) {
        this.logger.error(`Failed to download attachment: ${error.message}`);
      }
    }

    // 如果当前会话正在处理中，仅将消息加入队列等待
    if (this.processingSessions.has(queueKey)) {
      this.logger.debug(`Message buffered for busy session: ${queueKey}`);
      return;
    }

    // 防抖：每次收到消息重置定时器，直到指定时间没收到消息才合并
    if (queue.timer) {
      clearTimeout(queue.timer);
    }
    queue.timer = setTimeout(async () => {
      await this.flushQueue(queueKey, botId, instance);
    }, this.MERGE_WINDOW_MS);
  }

  /**
   * 刷新队列，合并并处理消息
   */
  private async flushQueue(
    queueKey: string,
    botId: string,
    instance: BotInstanceView,
  ): Promise<void> {
    const queue = this.messageQueues.get(queueKey);
    if (!queue || queue.messages.length === 0) return;

    // 标记为处理中
    this.processingSessions.add(queueKey);

    // 取出所有待处理消息并清空队列
    const messagesToProcess = [...queue.messages];
    queue.messages = [];
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = undefined;

    try {
      await this.handleIncomingMessage(
        queueKey,
        botId,
        messagesToProcess,
        instance,
      );
    } catch (error: any) {
      this.logger.error(`Failed to process merged messages: ${error.message}`);
    } finally {
      // 处理完毕，移除标记并检查是否有积压消息
      this.processingSessions.delete(queueKey);
      if (queue.messages.length > 0) {
        // 如果在处理期间又有新消息进来，立即触发下一轮
        this.flushQueue(queueKey, botId, instance);
      } else {
        this.messageQueues.delete(queueKey);
      }
    }
  }

  /**
   * 获取或创建会话
   */
  private async ensureSession(
    botId: string,
    message: BotMessage,
    config: BotConfig,
  ): Promise<any> {
    const platform = config.platform || "qq";
    const isGroupChat = message.sourceType === "group";
    const type = isGroupChat ? "group" : "private";
    const nativeId = isGroupChat ? message.conversationId : message.senderId;
    const externalId = buildExternalId(platform, type, nativeId);

    if (!config.defaultAgentId) {
      throw new Error(`Bot config or defaultAgentId not found: ${botId}`);
    }

    // 仅私聊记录发送者身份；群聊的 senderName 是群成员，不能当会话名。
    // 昵称要过滤平台占位值；头像独立判断，没有昵称时也可以记录头像。
    const senderName = isMeaningfulSenderName(
      message.senderName,
      message.senderId,
    )
      ? message.senderName?.trim()
      : undefined;
    const senderAvatar = message.senderAvatar?.trim() || undefined;
    const botUser =
      !isGroupChat && (senderName || senderAvatar)
        ? {
            id: message.senderId,
            ...(senderName ? { name: senderName } : {}),
            ...(senderAvatar ? { avatarUrl: senderAvatar } : {}),
          }
        : undefined;

    const { session, created } = await this.sessionMapper.getOrCreateBotSession(
      botId,
      externalId,
      platform,
      config.defaultAgentId,
      config.defaultModelId,
      config.defaultThinkingEffort,
      undefined,
      botUser,
    );

    // 新建的 Bot 会话不会经过 sessions.controller，得自己广播，
    // 否则前端只能等 20s 轮询才发现有新会话。source 留空 = 所有窗口都收。
    if (created) {
      this.eventBus.emit("session.created", {
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        payload: { session },
      });
    }

    this.logger.log(
      `Session ensured: ${session.id}, externalId: ${session.externalId}`,
    );

    return session;
  }

  /**
   * 处理 incoming 消息
   */
  private async handleIncomingMessage(
    queueKey: string,
    botId: string,
    messages: BotMessage[],
    instance: BotInstanceView,
  ): Promise<void> {
    const { config, adapter } = instance;
    const firstMessage = messages[0];
    let coalescer: StreamReplyCoalescer | null = null;

    const baseReply = {
      conversationId: firstMessage.conversationId,
      replyToMessageId: firstMessage.messageId,
      sourceType: firstMessage.sourceType,
      rawFrame: firstMessage.rawEvent,
    };

    const capabilities = adapter.getCapabilities();
    let sendChain = Promise.resolve();

    const sendReply = (
      content: string,
      extra: {
        streamId?: string;
        finish?: boolean;
      } = {},
    ): Promise<void> => {
      const operation = sendChain.then(async () => {
        // 发送前检查运行时状态
        if (instance.status === BotRuntimeStatus.RECONNECTING) {
          // 重连中：仅最终消息入队，中间片段丢弃
          if (extra.finish === true) {
            this.enqueuePendingReply(botId, { ...baseReply, content });
            this.logger.warn(
              `Adapter reconnecting, queued final reply for bot ${botId}`,
            );
          } else {
            this.logger.debug(
              `Adapter reconnecting, dropping intermediate stream fragment for bot ${botId}`,
            );
          }
          return;
        }

        if (instance.status !== BotRuntimeStatus.CONNECTED) {
          // 已停止/错误：直接丢弃，不入队
          this.logger.warn(
            `Bot runtime status is ${instance.status}, dropping reply for bot ${botId}`,
          );
          return;
        }

        if (capabilities.supportsStreaming && adapter.sendStreamReply) {
          const sent = await adapter.sendStreamReply(
            { ...baseReply, content },
            extra,
          );
          if (!sent) throw new Error("Platform rejected stream reply");
        } else if (extra.finish === true) {
          const interval = capabilities.sendIntervalMs ?? 0;
          if (interval > 0) {
            await this.throttleSend(botId, interval);
          }
          await adapter.sendMessage({ ...baseReply, content });
        }
      });

      sendChain = operation.catch(() => undefined);
      return operation;
    };

    try {
      this.logger.log(
        `Processing merged messages from ${firstMessage.senderName || firstMessage.senderId}: ${messages.length} messages`,
      );

      // 从队列中获取已准备好的会话
      const queue = this.messageQueues.get(queueKey);
      const session = queue?.session;

      if (!session) {
        const reason = queue?.sessionError;

        // 队列已被清理时没有可反馈的原因，保持静默
        if (!reason) {
          this.logger.error(`Session not prepared for ${queueKey}`);
          return;
        }

        this.logger.error(`Session not prepared for ${queueKey}: ${reason}`);
        try {
          await sendReply(reason, { finish: true });
          this.logger.log(
            `Sent session error message to ${firstMessage.senderName || firstMessage.senderId}`,
          );
        } catch (sendError: any) {
          this.logger.error(
            `Failed to send error message: ${sendError.message}`,
          );
        }
        return;
      }

      // 合并消息内容（附件引用已在 enqueueMessage 时追加到各消息 content 中）
      // 群聊时在每条消息前标注发送者昵称，避免 AI 无法区分说话人
      const isGroupChat = firstMessage.sourceType === "group";
      const mergedContent = messages
        .map((m) => {
          const text = m.content?.trim();
          if (!text) return null;
          // 群聊消息用昵称标注来源，不暴露 senderId（openid/uin 等敏感字段）
          if (isGroupChat && m.senderName && m.senderName !== m.senderId) {
            return `[${m.senderName}]: ${text}`;
          }
          return text;
        })
        .filter(
          (content): content is string =>
            content !== null && content.length > 0,
        )
        .join("\n\n");

      let streamId = this.generateStreamId();
      let accumulatedContent = "";
      let hasSentAnyMessage = false;

      // 流式平台：高频 token 增量合并为固定节奏的最新全文，避免逐帧等 ack 积压
      if (capabilities.supportsStreaming) {
        coalescer = new StreamReplyCoalescer(
          (content) => sendReply(content, { streamId, finish: false }),
          capabilities.streamUpdateIntervalMs ?? 150,
          (error) =>
            this.logger.error(`Failed to send stream reply: ${error.message}`),
        );
      }

      // startStream 本身不阻塞到流结束，用 Promise 包装 onComplete/onError
      // 使 flushQueue 的 await 真正等到流结束，期间 processingSessions 保持锁定
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        let unsubscribe: (() => void) | undefined;

        // 流启动/运行失败时把原因反馈给用户；发送失败只记日志，避免错误回环
        const replyError = (error: any, logLabel: string) => {
          const reason = this.extractErrorMessage(error);
          this.logger.error(`${logLabel}: ${reason}`);
          void sendReply(reason, { finish: true })
            .catch((sendError: Error) => {
              this.logger.error(
                `Failed to send error reply: ${sendError.message}`,
              );
            })
            .finally(() => {
              unsubscribe?.();
              done();
            });
        };

        this.chatRunner
          .startStream(
            {
              sessionId: session.id,
              userMessage: {
                content: mergedContent,
                knowledgeBaseIds: config.knowledgeBaseIds,
              },
              source: { origin: "bot", platform: config.platform, botId },
              preloadedSession: session,
            },
            {
              onEvent: (chunk) => {
                if (chunk.type === "text_delta") {
                  accumulatedContent += chunk.text;
                  coalescer?.update(accumulatedContent);
                } else if (
                  (chunk.type === "finish" || chunk.type === "turn_end") &&
                  !capabilities.supportsStreaming
                ) {
                  if (accumulatedContent.trim()) {
                    hasSentAnyMessage = true;
                    void sendReply(accumulatedContent, { finish: true }).catch(
                      (error: Error) => {
                        this.logger.error(
                          `Failed to send turn reply: ${error.message}`,
                        );
                      },
                    );
                    accumulatedContent = "";
                  }
                }
              },
              onComplete: () => {
                // 丢弃尚未发出的中间帧，最终帧包含完整内容
                coalescer?.dispose();

                const finishSend = (content: string) =>
                  sendReply(content, { streamId, finish: true })
                    .then(() => {
                      this.logger.log(
                        `Replied to ${firstMessage.senderName || firstMessage.senderId}`,
                      );
                    })
                    .catch((error: Error) => {
                      this.logger.error(
                        `Failed to send final reply: ${error.message}`,
                      );
                    })
                    .finally(() => {
                      unsubscribe?.();
                      done();
                    });

                if (capabilities.supportsStreaming) {
                  void finishSend(accumulatedContent || this.FALLBACK_REPLY);
                } else if (accumulatedContent.trim()) {
                  void finishSend(accumulatedContent);
                } else if (!hasSentAnyMessage) {
                  void finishSend(this.FALLBACK_REPLY);
                } else {
                  unsubscribe?.();
                  done();
                }
              },
              onError: (err) => {
                coalescer?.dispose();
                replyError(err, "Stream error");
              },
            },
          )
          .then((unsub) => {
            unsubscribe = unsub;
          })
          .catch((error: any) => {
            // startStream 是 async，SESSION_BUSY 等启动失败只会走这里
            replyError(error, "Failed to start stream");
          });
      });
    } catch (error: any) {
      const reason = this.extractErrorMessage(error);
      this.logger.error(`Failed to process message: ${reason}`, error?.stack);

      // 向用户发送错误消息
      try {
        await sendReply(reason, { finish: true });
        this.logger.log(
          `Sent error message to ${firstMessage.senderName || firstMessage.senderId}`,
        );
      } catch (sendError: any) {
        this.logger.error(`Failed to send error message: ${sendError.message}`);
      }
    } finally {
      coalescer?.dispose();
    }
  }

  /**
   * 提取适合反馈给用户/日志的错误文案
   *
   * NestJS HttpException 的 message 可能是 JSON 字符串，这里优先取
   * response.error / response.message，避免把内部结构直接发给用户。
   */
  private extractErrorMessage(error: any): string {
    const response = error?.getResponse?.();

    if (typeof response === "string" && response.trim()) {
      return response;
    }

    if (response && typeof response === "object") {
      const message = response.error || response.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }

    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message;
    }

    return this.FALLBACK_REPLY;
  }

  /**
   * 生成唯一的流 ID
   */
  private generateStreamId(): string {
    return `stream-${randomUUID()}`;
  }

  /**
   * 将发送失败的回复入队，等待适配器重连后补发
   */
  private enqueuePendingReply(botId: string, response: BotResponse): void {
    const queue = this.pendingReplies.get(botId) || [];
    if (queue.length >= this.MAX_PENDING_REPLIES) {
      queue.shift();
      this.logger.warn(
        `Pending reply queue full for bot ${botId}, dropped oldest`,
      );
    }
    queue.push(response);
    this.pendingReplies.set(botId, queue);
  }

  /**
   * 发送重连期间积压的待发送回复
   * 由 BotInstanceManager 在适配器重连成功后调用
   */
  async flushPendingReplies(
    botId: string,
    instance: BotInstanceView,
  ): Promise<void> {
    const { adapter } = instance;
    const capabilities = adapter.getCapabilities();
    const interval = capabilities.sendIntervalMs ?? 0;
    const queue = this.pendingReplies.get(botId);
    if (!queue || queue.length === 0) return;

    const messages = [...queue];
    this.pendingReplies.delete(botId);
    this.logger.log(
      `Flushing ${messages.length} pending replies for bot ${botId}`,
    );

    for (const msg of messages) {
      try {
        if (interval > 0) {
          await this.throttleSend(botId, interval);
        }
        await adapter.sendMessage(msg);
      } catch (error: any) {
        this.logger.error(`Failed to flush pending reply: ${error.message}`);
        // 重新入队，下次重连后重试
        this.enqueuePendingReply(botId, msg);
      }
    }
  }

  /**
   * 清理指定机器人的消息队列(在机器人停止时调用)
   */
  cleanupBot(botId: string): void {
    const keysToDelete: string[] = [];
    this.messageQueues.forEach((queue, key) => {
      if (key.startsWith(`${botId}:`)) {
        keysToDelete.push(key);
        if (queue.timer) {
          clearTimeout(queue.timer);
        }
      }
    });

    keysToDelete.forEach((key) => {
      this.messageQueues.delete(key);
      this.processingSessions.delete(key);
    });
    this.pendingReplies.delete(botId);
    this.lastSendAt.delete(botId);

    this.logger.log(`Cleaned up message queues for bot: ${botId}`);
  }

  /**
   * 清理所有队列
   */
  cleanup(): void {
    this.messageQueues.forEach((queue) => {
      if (queue.timer) {
        clearTimeout(queue.timer);
      }
    });
    this.messageQueues.clear();
    this.processingSessions.clear();
    this.pendingReplies.clear();
    this.logger.log("Bot orchestrator cleaned up");
  }
}
