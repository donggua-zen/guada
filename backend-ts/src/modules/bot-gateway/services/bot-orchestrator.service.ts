import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { IBotPlatform, BotMessage, BotConfig } from '../interfaces/bot-platform.interface';
import { AgentService } from '../../chat/agent.service';
import { SessionMapperService } from './session-mapper.service';
import { BotInstanceManager } from './bot-instance-manager.service';
import { buildExternalId } from '../utils/external-id';

/**
 * 机器人消息编排器
 *
 * 负责:
 * 1. 监听外部平台消息
 * 2. 创建/获取会话
 * 3. 调用 AgentService 生成回复
 * 4. 发送回复到外部平台
 */
@Injectable()
export class BotOrchestrator {
  private readonly logger = new Logger(BotOrchestrator.name);
  private activeSubscriptions: Map<string, Subscription> = new Map();

  constructor(
    private agentService: AgentService,
    private sessionMapper: SessionMapperService,
    @Inject(forwardRef(() => BotInstanceManager))
    private instanceManager: BotInstanceManager,
  ) { }

  /**
   * 启动机器人实例的消息监听
   */
  async startBotListener(
    botId: string,
    adapter: IBotPlatform,
    config: BotConfig,
  ): Promise<void> {
    this.logger.log(`Starting message listener for bot: ${botId}`);

    const subscription = adapter.onMessage().subscribe({
      next: async (message: BotMessage) => {
        await this.handleIncomingMessage(botId, message, config);
      },
      error: (error: Error) => {
        this.logger.error(
          `Message stream error for bot ${botId}: ${error.message}`,
        );
      },
    });

    this.activeSubscriptions.set(botId, subscription);
  }

  /**
   * 停止机器人实例的消息监听
   */
  stopBotListener(botId: string): void {
    const subscription = this.activeSubscriptions.get(botId);
    if (subscription) {
      subscription.unsubscribe();
      this.activeSubscriptions.delete(botId);
      this.logger.log(`Stopped message listener for bot: ${botId}`);
    }
  }

  /**
   * 处理 incoming 消息
   */
  private async handleIncomingMessage(
    botId: string,
    message: BotMessage,
    config: BotConfig,
  ): Promise<void> {
    try {
      this.logger.log(
        `Received message from ${message.senderId}: ${message.content}`,
      );

      // 1. 确定会话类型和ID
      const platform = config.platform || 'qq';
      const isGroupChat = message.sourceType === 'group';
      const type = isGroupChat ? 'group' : 'private';

      // nativeId: 私聊=发送者ID, 群聊=群ID
      const nativeId = isGroupChat
        ? message.conversationId  // 群聊使用群ID
        : message.senderId;        // 私聊使用用户ID

      // 2. 组装 externalId(由调用者决定隔离策略)
      const externalId = buildExternalId(platform, type, nativeId);

      // 3. 获取或创建会话
      const session = await this.sessionMapper.getOrCreateBotSession(
        botId,
        externalId,
        platform,
        config.defaultCharacterId,
        config.defaultModelId,
      );

      this.logger.log(
        `Using session: ${session.id}, externalId: ${session.externalId}`
      );

      // 4. 调用 AgentService 生成回复（流式）
      const adapter = this.instanceManager.getAdapter(botId);
      if (!adapter) {
        this.logger.error('Adapter not found');
        return;
      }

      const capabilities = adapter.getCapabilities();

      // 1. 创建用户消息记录
      this.logger.log(
        `Creating user message with knowledgeBaseIds: ${JSON.stringify(config.knowledgeBaseIds)}`
      );

      const userMessage = await this.sessionMapper.createUserMessage(
        session.id,
        message.content,
        config.knowledgeBaseIds,
      );

      // 2. 调用 AgentService 获取流式迭代器
      const iterator = this.agentService.completions(
        session.id,
        userMessage.id,
        'overwrite',
      );

      // 3. 根据平台能力选择回复方式
      if (capabilities.supportsStreaming && adapter.sendStreamReply) {
        // ✅ 支持流式：边生成边发送
        await this.handleStreamingReply(adapter, message, iterator);
      } else {
        // ❌ 不支持流式：收集完整回复后发送
        await this.handleNormalReply(adapter, message, iterator);
      }
    } catch (error: any) {
      this.logger.error(`Failed to process message: ${error.message}`, error.stack);

      // 向用户发送原始错误消息
      const adapter = this.instanceManager.getAdapter(botId);
      if (adapter) {
        try {
          const capabilities = adapter.getCapabilities();

          // 优先使用流式回复（如果平台支持）
          if (capabilities.supportsStreaming && adapter.sendStreamReply) {
            await adapter.sendStreamReply({
              conversationId: message.conversationId,
              content: error.message,
              replyToMessageId: message.messageId,
              sourceType: message.sourceType,
              rawFrame: message.rawEvent,
            }, { finish: true });
          } else {
            await adapter.sendMessage({
              conversationId: message.conversationId,
              content: error.message,
              replyToMessageId: message.messageId,
              sourceType: message.sourceType,
              rawFrame: message.rawEvent,
            });
          }

          this.logger.log(`Sent error message to ${message.senderId}`);
        } catch (sendError: any) {
          this.logger.error(`Failed to send error message: ${sendError.message}`);
        }
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
    let accumulatedContent = '';
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500; // 每 500ms 更新一次，避免频繁请求

    try {
      for await (const chunk of iterator) {
        // AgentService 返回的 type: "text" | "think" | "finish" | "tool_call" | "tool_calls_response"
        if (chunk.type === 'text' && chunk.msg) {
          accumulatedContent += chunk.msg;

          const now = Date.now();
          // 定期更新消息内容（避免过于频繁的网络请求）
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            await adapter.sendStreamReply({
              conversationId: message.conversationId,
              content: accumulatedContent,
              replyToMessageId: message.messageId,
              sourceType: message.sourceType,
              rawFrame: message.rawEvent,
            }, {
              streamId,
              finish: false,  // 还未完成
            });
            lastUpdateTime = now;
          }
        }
      }

      // 发送最终完整内容（finish=true）
      await adapter.sendStreamReply({
        conversationId: message.conversationId,
        content: accumulatedContent,
        replyToMessageId: message.messageId,
        sourceType: message.sourceType,
        rawFrame: message.rawEvent,
      }, {
        streamId,
        finish: true,  // 完成
      });

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
      let fullReply = '';
      for await (const chunk of iterator) {
        if (chunk.type === 'text' && chunk.msg) {
          fullReply += chunk.msg;
        }
      }

      // 一次性发送完整回复
      await adapter.sendMessage({
        conversationId: message.conversationId,
        content: fullReply || '抱歉,我暂时无法回复。',
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
   * 清理所有订阅
   */
  cleanup(): void {
    this.activeSubscriptions.forEach((sub, botId) => {
      sub.unsubscribe();
      this.logger.log(`Cleaned up subscription for bot: ${botId}`);
    });
    this.activeSubscriptions.clear();
  }
}
