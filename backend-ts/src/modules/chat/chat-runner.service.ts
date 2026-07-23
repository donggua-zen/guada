import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AgentEngine } from "./agent-engine.service";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionService } from "./session.service";
import { SessionContextFactory } from "./session-context.factory";
import { EventChunk } from "./types/event-chunk.types";
import {
  StreamFinishedEvent,
  StreamStartedEvent,
} from "../../common/events/stream.events";
import { ISessionContext } from "./session-context";

/**
 * 流订阅回调
 */
export interface StreamCallbacks {
  onEvent: (data: EventChunk) => void;
  onComplete: (reason: string) => void;
  onError: (err: any) => void;
}

/**
 * 队列消息项
 */
export interface QueueItem {
  id: string;
  sessionId: string;
  userId: string;
  content: string;
  source: Record<string, any>;
  createdAt: Date;
  callbacks?: StreamCallbacks;
}

/**
 * 会话队列状态
 */
interface SessionQueueState {
  items: QueueItem[];
  isProcessing: boolean;
}

/**
 * Chat 运行器服务
 *
 * 封装完整的对话执行业务逻辑，供 HTTP 请求和定时任务复用。
 * 集成消息队列能力，支持异步任务完成后自动注入消息并唤醒 Agent 循环。
 */
@Injectable()
export class ChatRunnerService {
  private readonly logger = new Logger(ChatRunnerService.name);
  private readonly queues = new Map<string, SessionQueueState>();

  constructor(
    private streamManager: SessionStreamManager,
    private sessionService: SessionService,
    private agentEngine: AgentEngine,
    private sessionContextFactory: SessionContextFactory,
    private eventEmitter: EventEmitter2,
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
        metadata?: Record<string, any>;
      };
      regenerationMode?: string;
      resumeData?: any;
      source?: Record<string, any>;
      lastContentId?: string | null;
    },
    callbacks?: StreamCallbacks,
  ): Promise<() => void> {
    const {
      sessionId,
      userId,
      userMessage,
      regenerationMode = "overwrite",
      resumeData,
      source,
      lastContentId = null,
    } = params;

    // 提取前端传入的 clientId，用于广播事件的 source 字段
    const clientId = source?.clientId as string | undefined;
    if (userMessage) {
      userMessage.metadata = { ...userMessage?.metadata, ...source };
    }
    // 获取会话
    const session = await this.sessionService.getSessionById(sessionId, userId);
    if (!session) {
      throw new HttpException(
        { error: "会话不存在", code: "SESSION_NOT_FOUND" },
        HttpStatus.NOT_FOUND,
      );
    }

    // 更新会话最后活跃时间，用于会话管理和清理策略
    await this.sessionService.updateLastActiveAt(sessionId);

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

    const subscriberId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // 情况 1: 该会话已有活跃流，加入订阅
    if (hasActiveStream) {
      return this.subscribeToStream(
        sessionId,
        subscriberId,
        callbacks,
        lastContentId,
      );
    }

    // 情况 2: 该会话没有活跃流，需要启动新流
    const abortController = new AbortController();

    const started = this.streamManager.startStream(
      sessionId,
      userId,
      abortController,
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

    // 广播流开始事件，携带完整会话信息供前端同步
    // source 使用前端传入的 clientId，使前端能正确识别自身发起的事件
    const streamStartedEvent: StreamStartedEvent = {
      userId,
      sessionId,
      timestamp: new Date().toISOString(),
      source: clientId || subscriberId,
      payload: {
        replaceMessageId: userMessage?.replaceMessageId || null,
        session,
      },
    };
    this.eventEmitter.emit("stream.started", streamStartedEvent);
    const sessionContext =
      await this.sessionContextFactory.createFromSession(session);

    // 在后台启动 Agent 循环
    this.runAgentEngine(
      sessionContext,
      userMessage,
      abortController,
      userId,
      regenerationMode,
      resumeData,
      clientId,
    ).catch((error) => {
      this.logger.error(`Agent engine error stack:`, error?.stack);
      this.streamManager.broadcast(sessionId, {
        type: "error",
        error: error.message,
      } as any);
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
    lastContentId?: string | null,
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
      lastContentId || null,
    );

    if (!unsubscribe) {
      this.logger.warn(`订阅流失败: ${sessionId}`);
      return null;
    }

    return unsubscribe;
  }

  /**
   * 投递消息到队列
   *
   * 供定时任务、子Agent等异步任务调用。
   * 根据会话Agent状态决定立即执行或排队等待。
   */
  async enqueueMessage(params: {
    sessionId: string;
    userId: string;
    content: string;
    source: Record<string, any>;
    callbacks?: StreamCallbacks;
  }): Promise<void> {
    const { sessionId, userId, content, source, callbacks } = params;

    const queueItem: QueueItem = {
      id: `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      userId,
      content,
      source,
      createdAt: new Date(),
      callbacks,
    };

    const queueState = this.getOrCreateQueueState(sessionId);

    // 使用 hasActiveStream 判断 Agent 是否正在运行，与 startStream 的冲突检测逻辑保持一致
    const hasActiveStream = this.streamManager.hasActiveStream(sessionId);

    queueState.items.push(queueItem);

    if (hasActiveStream) {
      this.logger.log(
        `消息已入队(Agent运行中): ${sessionId}, 队列长度: ${queueState.items.length}`,
      );
      return;
    }

    // 不阻塞调用方，后台消费队列并自行处理错误
    this.processQueue(sessionId).catch((error) => {
      this.logger.error(
        `队列消费异常: ${sessionId}, 错误: ${error?.message || error}`,
      );
    });
  }

  /**
   * 消费会话队列
   *
   * Agent循环结束后调用，按来源合并处理消息。
   * 只取出队首连续同来源的消息合并为一条执行，
   * 剩余消息留给 startStream 的 finally 再次触发消费。
   */
  async processQueue(sessionId: string): Promise<void> {
    const state = this.queues.get(sessionId);
    if (!state || state.isProcessing || state.items.length === 0) {
      return;
    }

    state.isProcessing = true;

    try {
      if (this.streamManager.hasActiveStream(sessionId)) {
        this.logger.warn(`会话 ${sessionId} 在队列处理期间被占用，暂停消费`);
        return;
      }

      // 提取队首连续同来源的消息进行合并
      const firstSourceType = state.items[0].source.type;
      const batch: QueueItem[] = [];
      while (
        state.items.length > 0 &&
        state.items[0].source.type === firstSourceType
      ) {
        batch.push(state.items.shift()!);
      }

      await this.executeQueueItem(batch);
    } catch (error) {
      this.logger.error(`队列处理出错: ${sessionId}`, error);
    } finally {
      state.isProcessing = false;

      if (state.items.length === 0 && !state.isProcessing) {
        this.queues.delete(sessionId);
      }
    }
  }

  /**
   * 获取队列状态（用于监控）
   */
  getQueueStatus(sessionId: string): {
    pendingCount: number;
    isProcessing: boolean;
  } | null {
    const state = this.queues.get(sessionId);
    if (!state) return null;
    return {
      pendingCount: state.items.length,
      isProcessing: state.isProcessing,
    };
  }

  /**
   * 从会话队列中查找并移除匹配指定条件的消息
   *
   * 适用于 waitForComplete、poll 撤回等场景：已通过其他方式获取了消息内容，
   * 需要从队列中移除以防止 processQueue 再次消费导致重复。
   *
   * @param sessionId 会话 ID
   * @param predicate 匹配条件函数，返回 true 的消息将被移除并返回
   * @returns 被移除的消息数组
   */
  peekQueuedMessage(
    sessionId: string,
    predicate: (item: QueueItem) => boolean,
  ): QueueItem[] {
    const state = this.queues.get(sessionId);
    if (!state || state.items.length === 0) return [];

    const removed: QueueItem[] = [];
    const kept: QueueItem[] = [];
    for (const item of state.items) {
      if (predicate(item)) {
        removed.push(item);
      } else {
        kept.push(item);
      }
    }
    state.items = kept;

    if (removed.length > 0) {
      this.logger.log(`从队列中移除了 ${removed.length} 条消息: ${sessionId}`);
    }

    // 清理空状态
    if (state.items.length === 0 && !state.isProcessing) {
      this.queues.delete(sessionId);
    }

    return removed;
  }

  /**
   * 检查会话是否有活跃流
   */
  hasActiveStream(sessionId: string): boolean {
    return this.streamManager.hasActiveStream(sessionId);
  }

  /**
   * 取消指定会话的活跃流（用于子 Agent 在父 Agent 中止时同步停止）
   */
  cancelStream(sessionId: string): void {
    this.streamManager.stopStream(sessionId, "user_cancel");
  }

  /**
   * 执行队列项（支持单条或同来源合并）
   */
  private async executeQueueItem(items: QueueItem[]): Promise<void> {
    const firstItem = items[0];
    const sessionId = firstItem.sessionId;
    const userId = firstItem.userId;
    const sourceType = firstItem.source.type;

    if (items.length === 1) {
      this.logger.log(
        `执行队列消息: ${firstItem.id}, 来源: ${sourceType}, 会话: ${sessionId}`,
      );
    } else {
      this.logger.log(
        `执行队列消息(合并${items.length}条): 来源: ${sourceType}, 会话: ${sessionId}`,
      );
    }

    // 合并内容：多条消息用换行分隔
    const mergedContent = items.map((item) => item.content).join("\n");

    // 合并 source，systemPayload 数组拼接，其他字段保留第一条
    const mergedSystemPayload = items.flatMap(
      (item) => item.source?.systemPayload || [],
    );
    // 合并 parseResult：取最后一个（最新）有 parseResult 的 source
    const lastParseResult = [...items]
      .reverse()
      .find((item) => item.source?.parseResult)?.source?.parseResult;
    const mergedSource = {
      ...firstItem.source,
      systemPayload:
        mergedSystemPayload.length > 0 ? mergedSystemPayload : undefined,
      parseResult: lastParseResult || undefined,
      queueItemCount: items.length,
      queueItemIds: items.map((item) => item.id),
      queuedAt: firstItem.createdAt.toISOString(),
    };

    // 取第一个带回调的项作为执行回调（合并场景下只取一个，避免重复触发）
    const callbacks = items.find((item) => item.callbacks)?.callbacks;

    try {
      await this.startStream(
        {
          sessionId,
          userId,
          userMessage: {
            content: mergedContent,
          },
          regenerationMode: "overwrite",
          source: mergedSource,
        },
        callbacks,
      );
    } catch (error: any) {
      const code = error?.response?.code || error?.code;

      if (code === "SESSION_BUSY" || code === "STREAM_START_FAILED") {
        this.logger.warn(`启动失败(会话忙碌)，${items.length}条消息重新入队`);
        const state = this.queues.get(sessionId);
        if (state) {
          // 按原顺序塞回队列头部
          state.items.unshift(...items);
        }
        throw error;
      }

      this.logger.error(`执行队列消息失败: ${firstItem.id}`, error);
    }
  }

  /**
   * 获取或创建队列状态
   */
  private getOrCreateQueueState(sessionId: string): SessionQueueState {
    let state = this.queues.get(sessionId);
    if (!state) {
      state = { items: [], isProcessing: false };
      this.queues.set(sessionId, state);
    }
    return state;
  }

  /**
   * 后台运行 Agent Engine
   */

  private async runAgentEngine(
    sessionContext: ISessionContext,
    userMessage: any,
    abortController: AbortController,
    userId: string,
    regenerationMode: string = "overwrite",
    resumeData?: any,
    clientId?: string,
  ): Promise<void> {
    const sessionId = sessionContext.sessionId;
    let lastFinishReason: string | undefined;
    try {
      const iterator = this.agentEngine.run(
        sessionContext,
        userMessage,
        regenerationMode,
        abortController.signal,
        resumeData,
      );

      for await (const chunk of iterator) {
        // 捕获最后一次 finishReason，用于 finally 判断是否跳过队列处理
        if (chunk.finishReason) {
          lastFinishReason = chunk.finishReason;
        }
        this.streamManager.broadcast(sessionId, chunk as EventChunk);
      }

      this.streamManager.stopStream(sessionId, "completed");

      const streamFinishedEvent: StreamFinishedEvent = {
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        source: clientId,
        payload: {
          reason: "completed",
          workspacePath: sessionContext.workspacePath,
          sessionType: sessionContext.sessionType,
        },
      };
      this.eventEmitter.emit("stream.finished", streamFinishedEvent);
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.logger.log(`Stream ${sessionId} aborted`);
        this.streamManager.stopStream(sessionId, "user_cancel");

        const streamFinishedEvent: StreamFinishedEvent = {
          userId,
          sessionId,
          timestamp: new Date().toISOString(),
          source: clientId,
          payload: {
            reason: "user_cancel",
            workspacePath: sessionContext.workspacePath,
            sessionType: sessionContext.sessionType,
          },
        };
        this.eventEmitter.emit("stream.finished", streamFinishedEvent);
      } else {
        const streamFinishedEvent: StreamFinishedEvent = {
          userId,
          sessionId,
          timestamp: new Date().toISOString(),
          source: clientId,
          payload: {
            reason: "error",
            error: error.message,
            workspacePath: sessionContext.workspacePath,
            sessionType: sessionContext.sessionType,
          },
        };
        this.eventEmitter.emit("stream.finished", streamFinishedEvent);

        throw error;
      }
    } finally {
      // 队列消息等待暂停态（max_iterations / approval / rate_limited）由用户操作触发 resume 后处理，不自动消费
      if (
        lastFinishReason !== "max_iterations_reached" &&
        lastFinishReason !== "approval_required" &&
        lastFinishReason !== "rate_limited"
      ) {
        await this.processQueue(sessionId);
      }
    }
  }
}
