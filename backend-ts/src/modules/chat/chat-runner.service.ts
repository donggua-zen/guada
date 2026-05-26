import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { AgentEngine } from "./agent-engine.service";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionEventsService } from "./session-events.service";
import { SessionService } from "./session.service";
import { MessageService } from "./message.service";

/**
 * 流订阅回调
 */
export interface StreamCallbacks {
  onEvent: (data: string) => void;
  onComplete: () => void;
  onError: (err: any) => void;
}

/**
 * Chat 运行器服务
 *
 * 封装完整的对话执行业务逻辑，供 HTTP 请求和定时任务复用。
 * Controller 只负责 HTTP 响应，所有业务逻辑（消息创建、流初始化、订阅管理、AgentEngine 运行）都在此服务中处理。
 */
@Injectable()
export class ChatRunnerService {
  private readonly logger = new Logger(ChatRunnerService.name);

  constructor(
    private agentEngine: AgentEngine,
    private streamManager: SessionStreamManager,
    private sessionEventsService: SessionEventsService,
    private sessionService: SessionService,
    private messageService: MessageService,
  ) {}

  /**
   * 启动会话的流式对话（完整业务逻辑）
   *
   * 处理以下全部流程：
   * 1. 获取会话
   * 2. overwrite 模式下创建用户消息
   * 3. 检查活跃流状态
   * 4. 情况1：已有活跃流 → 加入订阅
   * 5. 情况2：无活跃流 → 启动新流 + 运行 AgentEngine
   *
   * Controller 只需提供回调函数处理 HTTP 响应，无需关心内部实现。
   *
   * @param params 启动参数
   * @param callbacks 流事件回调（Controller 提供 HTTP 响应处理）
   * @returns 订阅清理函数
   * @throws HttpException 各种业务错误（会话不存在、活跃流冲突、缺少内容等）
   */
  async startStream(
    params: {
      sessionId: string;
      userId: string;
      userMessage?: {
        id?: string;
        content?: string;
        files?: string[];
        replaceMessageId?: string;
        knowledgeBaseIds?: string[];
      };
      regenerationMode?: string;
      assistantMessageId?: string | null;
      resumeData?: any;
      source?: string;
    },
    callbacks?: StreamCallbacks,
  ): Promise<() => void> {
    const {
      sessionId,
      userId,
      userMessage,
      regenerationMode = "overwrite",
      assistantMessageId = null,
      resumeData,
      source = "unknown",
    } = params;

    // 获取会话
    const session = await this.sessionService.getSessionById(sessionId, userId);
    if (!session) {
      throw new HttpException(
        { error: "会话不存在", code: "SESSION_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }

    const isSubscribeMode = regenerationMode === "subscribe";
    const hasActiveStream = this.streamManager.hasActiveStream(sessionId);

    // 发起模式：如果已有活跃流，拒绝
    if (!isSubscribeMode && hasActiveStream) {
      throw new HttpException(
        { error: "当前已有任务正在进行，请等待结束", code: "SESSION_BUSY" },
        HttpStatus.CONFLICT,
      );
    }

    // 订阅模式：如果没有活跃流，拒绝
    if (isSubscribeMode && !hasActiveStream) {
      throw new HttpException(
        { error: "No active stream to subscribe", code: "NO_ACTIVE_STREAM" },
        HttpStatus.CONFLICT,
      );
    }

    let createdUserMessage: any = null;

    // overwrite 模式下自动创建消息
    if (regenerationMode === "overwrite" || !regenerationMode) {
      if (!userMessage?.content) {
        throw new HttpException(
          { error: "缺少消息内容", code: "MISSING_CONTENT" },
          HttpStatus.BAD_REQUEST,
        );
      }
      try {
        createdUserMessage = await this.messageService.addMessage(
          sessionId,
          "user",
          userMessage.content,
          userMessage.files || [],
          userMessage.replaceMessageId,
          userMessage.knowledgeBaseIds,
          userId,
        );
      } catch (error: any) {
        this.logger.error(`创建消息失败:`, error);
        throw new HttpException(
          {
            error: "创建消息失败: " + (error.message || "Unknown error"),
            code: "MESSAGE_CREATE_FAILED",
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    const subscriberId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // 情况 1: 该会话已有活跃流，加入订阅
    if (hasActiveStream) {
      return this.subscribeToStream(sessionId, subscriberId, callbacks);
    }

    // 情况 2: 该会话没有活跃流，需要启动新流
    const abortController = new AbortController();

    const started = this.streamManager.startStream(
      sessionId,
      userId,
      abortController,
      assistantMessageId,
    );
    if (!started) {
      throw new HttpException(
        { error: "Session is busy", code: "STREAM_START_FAILED" },
        HttpStatus.CONFLICT,
      );
    }

    // 注册订阅者（如果提供了回调）
    let unsubscribe: (() => void) | null = null;
    if (callbacks) {
      unsubscribe = this.streamManager.subscribe(
        sessionId,
        subscriberId,
        callbacks.onEvent,
        callbacks.onComplete,
        callbacks.onError,
      );
      if (!unsubscribe) {
        throw new HttpException(
          { error: "Stream not available", code: "SUBSCRIBE_FAILED" },
          HttpStatus.CONFLICT,
        );
      }
    }

    // 广播流开始事件
    this.sessionEventsService.broadcastToUser(userId, {
      type: "stream_started",
      userId,
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        messageId: createdUserMessage?.id || userMessage?.id,
        source: subscriberId,
        replaceMessageId: userMessage?.replaceMessageId || null,
      },
    });

    // 如果有用户消息，广播给所有流订阅者
    if (createdUserMessage) {
      this.streamManager.broadcast(sessionId, {
        type: "user_message",
        message: createdUserMessage,
      });
    }

    // 在后台启动 Agent 循环
    this.runAgentEngine(
      sessionId,
      session,
      userMessage?.id || createdUserMessage?.id,
      abortController,
      userId,
      regenerationMode,
      assistantMessageId,
      resumeData,
    ).catch((error) => {
      this.logger.error(`Agent engine error for ${sessionId}:`, error);
      this.streamManager.broadcast(sessionId, {
        type: "error",
        error: error.message,
      });
      this.streamManager.stopStream(sessionId, "error");
    });

    return unsubscribe || (() => {});
  }

  /**
   * 订阅已存在的活跃流
   */
  private subscribeToStream(
    sessionId: string,
    subscriberId: string,
    callbacks?: StreamCallbacks,
  ): (() => void) | null {
    if (!callbacks) {
      // 后台执行不需要订阅
      return () => {};
    }

    const unsubscribe = this.streamManager.subscribe(
      sessionId,
      subscriberId,
      callbacks.onEvent,
      callbacks.onComplete,
      callbacks.onError,
    );

    if (!unsubscribe) {
      this.logger.warn(`订阅流失败: ${sessionId}`);
      return null;
    }

    return unsubscribe;
  }

  /**
   * 检查会话是否有活跃流
   */
  hasActiveStream(sessionId: string): boolean {
    return this.streamManager.hasActiveStream(sessionId);
  }

  /**
   * 后台运行 Agent Engine
   */
  private async runAgentEngine(
    sessionId: string,
    session: any,
    userMessageId: string,
    abortController: AbortController,
    userId: string,
    regenerationMode: string = "overwrite",
    assistantMessageId?: string | null,
    resumeData?: any,
  ): Promise<void> {
    try {
      const iterator = this.agentEngine.completions(
        session,
        userMessageId,
        regenerationMode,
        assistantMessageId || undefined,
        abortController.signal,
        resumeData,
      );

      for await (const chunk of iterator) {
        this.streamManager.broadcast(sessionId, chunk);
      }

      // this.streamManager.broadcast(sessionId, { type: "finish" });
      this.streamManager.stopStream(sessionId, "completed");

      this.sessionEventsService.broadcastToUser(userId, {
        type: "stream_finished",
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        payload: { reason: "completed" },
      });
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.logger.log(`Stream ${sessionId} aborted`);
        this.streamManager.stopStream(sessionId, "user_cancel");

        this.sessionEventsService.broadcastToUser(userId, {
          type: "stream_finished",
          userId,
          sessionId,
          timestamp: new Date().toISOString(),
          payload: { reason: "user_cancel" },
        });
      } else {
        this.sessionEventsService.broadcastToUser(userId, {
          type: "stream_finished",
          userId,
          sessionId,
          timestamp: new Date().toISOString(),
          payload: { reason: "error", error: error.message },
        });
        throw error;
      }
    }
  }
}
