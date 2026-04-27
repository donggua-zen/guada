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
      const platform = message.rawEvent?.platform || 'qq';
      const isGroupChat = message.sourceType === 'group';
      const type = isGroupChat ? 'group' : 'private';

      // nativeId: 私聊=发送者ID, 群聊=群ID
      const nativeId = isGroupChat
        ? message.conversationId  // 群聊使用群ID
        : message.senderId;        // 私聊使用用户ID

      // 2. 获取或创建会话
      const session = await this.sessionMapper.getOrCreateBotSession(
        botId,
        platform,
        type,
        nativeId,
        config.defaultCharacterId,
        config.defaultModelId,
      );

      this.logger.log(
        `Using session: ${session.id}, externalId: ${session.externalId}`
      );

      // 3. 调用 AgentService 生成回复(内部会创建消息记录)
      const reply = await this.generateReply(session, message);

      // 4. 发送回复
      const adapter = this.instanceManager.getAdapter(botId);
      if (adapter) {
        await adapter.sendMessage({
          conversationId: message.conversationId,
          content: reply,
          replyToMessageId: message.messageId,
          sourceType: message.sourceType,
        });

        this.logger.log(`Replied to ${message.senderId}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to process message: ${error.message}`, error.stack);
      
      // 向用户发送原始错误消息
      const adapter = this.instanceManager.getAdapter(botId);
      if (adapter) {
        try {
          await adapter.sendMessage({
            conversationId: message.conversationId,
            content: error.message,
            replyToMessageId: message.messageId,
            sourceType: message.sourceType,
          });
          
          this.logger.log(`Sent error message to ${message.senderId}`);
        } catch (sendError: any) {
          this.logger.error(`Failed to send error message: ${sendError.message}`);
        }
      }
    }
  }

  /**
   * 调用 AgentService 生成回复
   */
  private async generateReply(session: any, message: BotMessage): Promise<string> {
    try {
      // 1. 创建用户消息记录
      const userMessage = await this.sessionMapper.createUserMessage(
        session.id,
        message.content,
      );

      // 2. 调用 AgentService (Bot场景不需要assistantMessageId)
      const iterator = this.agentService.completions(
        session.id,
        userMessage.id,
        'overwrite',
      );

      // 3. 收集完整回复
      let fullReply = '';
      for await (const chunk of iterator) {
        // AgentService 返回的 type: "text" | "think" | "finish" | "tool_call" | "tool_calls_response"
        if (chunk.type === 'text' && chunk.msg) {
          fullReply += chunk.msg;
        }
      }

      return fullReply || '抱歉,我暂时无法回复。';
    } catch (error: any) {
      this.logger.error(`Failed to generate reply: ${error.message}`);
      return '抱歉,处理您的消息时出现了错误。';
    }
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
