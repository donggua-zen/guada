import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import {
  IBotPlatform,
  BotMessage,
  BotConfig,
} from "../interfaces/bot-platform.interface";
import { AgentEngine } from "../../chat/agent-engine.service";
import { SessionMapperService } from "./session-mapper.service";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { buildExternalId } from "../utils/external-id";

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
    { messages: BotMessage[]; timer?: NodeJS.Timeout; session?: any }
  > = new Map();
  private processingSessions: Set<string> = new Set();
  private readonly MERGE_WINDOW_MS = 3000; // 3秒合并窗口
  private readonly MAX_QUEUE_LENGTH = 10; // 最大缓冲消息数

  constructor(
    private agentEngine: AgentEngine,
    private sessionMapper: SessionMapperService,
    private workspaceService: WorkspaceService,
  ) {}

  /**
   * 将消息加入缓冲队列(唯一对外暴露的方法)
   *
   * @param botId 机器人ID
   * @param message 机器人消息
   * @param config 机器人配置(由调用者传入,避免反向依赖)
   * @param adapter 适配器实例(由调用者传入,用于发送回复)
   */
  async enqueueMessage(
    botId: string,
    message: BotMessage,
    config: BotConfig,
    adapter: IBotPlatform,
  ): Promise<void> {
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
      } catch (error: any) {
        this.logger.error(
          `Failed to ensure session for ${queueKey}: ${error.message}`,
        );
      }
    }

    // 下载当前消息的附件（无论是否新会话都执行）
    if (queue.session && adapter.downloadAttachment) {
      try {
        const workspacePath =
          queue.session.workspacePath ||
          this.workspaceService.getDefaultWorkspaceDir(queue.session.id);
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
      await this.flushQueue(queueKey, botId, config, adapter);
    }, this.MERGE_WINDOW_MS);
  }

  /**
   * 刷新队列，合并并处理消息
   */
  private async flushQueue(
    queueKey: string,
    botId: string,
    config: BotConfig,
    adapter: IBotPlatform,
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
        config,
        adapter,
      );
    } catch (error: any) {
      this.logger.error(`Failed to process merged messages: ${error.message}`);
    } finally {
      // 处理完毕，移除标记并检查是否有积压消息
      this.processingSessions.delete(queueKey);
      if (queue.messages.length > 0) {
        // 如果在处理期间又有新消息进来，立即触发下一轮
        this.flushQueue(queueKey, botId, config, adapter);
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

    if (!config.defaultCharacterId) {
      throw new Error(`Bot config or defaultCharacterId not found: ${botId}`);
    }

    const session = await this.sessionMapper.getOrCreateBotSession(
      botId,
      externalId,
      platform,
      config.defaultCharacterId,
      config.defaultModelId,
    );

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
    config: BotConfig,
    adapter: IBotPlatform,
  ): Promise<void> {
    const firstMessage = messages[0];

    try {
      this.logger.log(
        `Processing merged messages from ${firstMessage.senderId}: ${messages.length} messages`,
      );

      // 从队列中获取已准备好的会话
      const queue = this.messageQueues.get(queueKey);
      const session = queue?.session;

      if (!session) {
        this.logger.error(`Session not prepared for ${queueKey}`);
        return;
      }

      // 合并消息内容（附件引用已在 enqueueMessage 时追加到各消息 content 中）
      // 过滤掉空白内容，并对非空白内容去除首尾空白字符
      const mergedContent = messages
        .map((m) => m.content?.trim())
        .filter((content) => content && content.length > 0)
        .join("\n\n");

      const capabilities = adapter.getCapabilities();

      // 创建用户消息记录
      this.logger.log(
        `Creating user message with knowledgeBaseIds: ${JSON.stringify(config.knowledgeBaseIds)}`,
      );

      const userMessage = await this.sessionMapper.createUserMessage(
        session.id,
        mergedContent,
        config.knowledgeBaseIds,
      );

      // 调用 AgentEngine 获取流式迭代器
      const iterator = this.agentEngine.completions(
        session,
        userMessage.id,
        "overwrite",
      );

      // 根据平台能力选择回复方式
      if (capabilities.supportsStreaming && adapter.sendStreamReply) {
        await this.handleStreamingReply(adapter, firstMessage, iterator);
      } else {
        await this.handleNormalReply(adapter, firstMessage, iterator);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to process message: ${error.message}`,
        error.stack,
      );

      // 向用户发送原始错误消息
      try {
        const capabilities = adapter.getCapabilities();

        if (capabilities.supportsStreaming && adapter.sendStreamReply) {
          await adapter.sendStreamReply(
            {
              conversationId: firstMessage.conversationId,
              content: error.message,
              replyToMessageId: firstMessage.messageId,
              sourceType: firstMessage.sourceType,
              rawFrame: firstMessage.rawEvent,
            },
            { finish: true },
          );
        } else {
          await adapter.sendMessage({
            conversationId: firstMessage.conversationId,
            content: error.message,
            replyToMessageId: firstMessage.messageId,
            sourceType: firstMessage.sourceType,
            rawFrame: firstMessage.rawEvent,
          });
        }

        this.logger.log(`Sent error message to ${firstMessage.senderId}`);
      } catch (sendError: any) {
        this.logger.error(`Failed to send error message: ${sendError.message}`);
      }
    }
  }

  /**
   * 处理流式回复（边生成边发送）
   *
   * 注意：企业微信智能机器人的流式回复机制是“更新”而非“追加”
   * - 使用相同 streamId 会替换消息内容
   * - 因此我们需要累积内容后，定期更新整条消息
   */
  private async handleStreamingReply(
    adapter: any,
    message: BotMessage,
    iterator: AsyncGenerator<any>,
  ): Promise<void> {
    const streamId = this.generateStreamId();
    let accumulatedContent = "";
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500; // 每 500ms 更新一次，避免频繁请求

    try {
      for await (const chunk of iterator) {
        // AgentService 返回的 type: "text" | "think" | "finish" | "tool_call" | "tool_calls_response"
        if (chunk.type === "text" && chunk.msg) {
          accumulatedContent += chunk.msg;

          const now = Date.now();
          // 定期更新消息内容（避免过于频繁的网络请求）
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            await adapter.sendStreamReply(
              {
                conversationId: message.conversationId,
                content: accumulatedContent,
                replyToMessageId: message.messageId,
                sourceType: message.sourceType,
                rawFrame: message.rawEvent,
              },
              {
                streamId,
                finish: false, // 还未完成
              },
            );
            lastUpdateTime = now;
          }
        }
      }

      // 发送最终完整内容（finish=true）
      await adapter.sendStreamReply(
        {
          conversationId: message.conversationId,
          content: accumulatedContent,
          replyToMessageId: message.messageId,
          sourceType: message.sourceType,
          rawFrame: message.rawEvent,
        },
        {
          streamId,
          finish: true, // 完成
        },
      );

      this.logger.log(`Replied to ${message.senderId} via streaming`);
    } catch (error: any) {
      this.logger.error(`Stream reply error: ${error.message}`);
      throw error;
    }
  }

  /**
   * 处理普通回复（收集完整后发送）
   */
  private async handleNormalReply(
    adapter: any,
    message: BotMessage,
    iterator: AsyncGenerator<any>,
  ): Promise<void> {
    try {
      // 收集完整回复
      let fullReply = "";
      for await (const chunk of iterator) {
        if (chunk.type === "text" && chunk.msg) {
          fullReply += chunk.msg;
        }
      }

      // 一次性发送完整回复
      await adapter.sendMessage({
        conversationId: message.conversationId,
        content: fullReply || "抱歉,我暂时无法回复。",
        replyToMessageId: message.messageId,
        sourceType: message.sourceType,
        rawFrame: message.rawEvent,
      });

      this.logger.log(`Replied to ${message.senderId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send normal reply: ${error.message}`);
      throw error;
    }
  }

  /**
   * 生成唯一的流 ID
   */
  private generateStreamId(): string {
    return `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
    this.logger.log("Bot orchestrator cleaned up");
  }
}
