import { Injectable, Logger } from "@nestjs/common";
import { Subject } from "rxjs";

/**
 * 流式事件
 */
export interface StreamEvent {
  type: string;
  [key: string]: any;
}

/**
 * 流订阅者
 */
interface StreamSubscriber {
  id: string;
  subject: Subject<{ data: string }>;
  connectedAt: Date;
}

/**
 * 活跃流任务
 */
interface ActiveStream {
  sessionId: string;
  userId: string;
  abortController: AbortController;
  subscribers: Map<string, StreamSubscriber>;
  eventBuffer: StreamEvent[];
  maxBufferSize: number;
  isRunning: boolean;
  startedAt: Date;
  assistantMessageId: string | null;
}

/**
 * 会话流管理器
 *
 * 职责：
 * - 管理每个会话的活跃流式任务生命周期
 * - 支持多客户端订阅同一会话的流式输出
 * - 维护事件缓冲区，使新加入的客户端能够追赶上当前进度
 * - 将流式输出与单个客户端连接解耦，实现刷新不中断
 */
@Injectable()
export class SessionStreamManager {
  private readonly logger = new Logger(SessionStreamManager.name);
  private readonly activeStreams = new Map<string, ActiveStream>();
  private readonly DEFAULT_MAX_BUFFER_SIZE = 2000;

  /**
   * 启动新的流式任务
   *
   * @param sessionId 会话 ID
   * @param userId 用户 ID
   * @param abortController 用于中止底层 LLM 请求的控制器
   * @param assistantMessageId 现有助手消息 ID
   * @returns 是否成功启动（如果同一会话已有活跃流则返回 false）
   */
  startStream(
    sessionId: string,
    userId: string,
    abortController: AbortController,
    assistantMessageId: string | null = null,
  ): boolean {
    if (this.activeStreams.has(sessionId)) {
      const existing = this.activeStreams.get(sessionId)!;
      if (existing.isRunning) {
        this.logger.warn(
          `Stream already running for session ${sessionId}, refusing to start new one`,
        );
        return false;
      }
    }

    const stream: ActiveStream = {
      sessionId,
      userId,
      abortController,
      subscribers: new Map(),
      eventBuffer: [],
      maxBufferSize: this.DEFAULT_MAX_BUFFER_SIZE,
      isRunning: true,
      startedAt: new Date(),
      assistantMessageId,
    };

    this.activeStreams.set(sessionId, stream);
    this.logger.log(`Stream started for session ${sessionId}`);
    return true;
  }

  /**
   * 订阅已存在的流（用于新窗口打开或刷新后重连）
   *
   * @param sessionId 会话 ID
   * @param subscriberId 订阅者唯一标识
   * @returns 可观察的 Subject，如果流不存在或未运行则返回 null
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    onEvent: (data: string) => void,
    onComplete: () => void,
    onError: (err: any) => void,
  ): (() => void) | null {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return null;
    }

    const subject = new Subject<{ data: string }>();
    const subscriber: StreamSubscriber = {
      id: subscriberId,
      subject,
      connectedAt: new Date(),
    };

    stream.subscribers.set(subscriberId, subscriber);

    // 建立订阅，将事件转发到调用方提供的回调
    const subscription = subject.subscribe({
      next: (event) => onEvent(event.data),
      complete: onComplete,
      error: onError,
    });

    // 发送缓冲区中的历史事件，让新客户端追赶上进度
    for (const event of stream.eventBuffer) {
      try {
        subject.next({ data: JSON.stringify(event) });
      } catch (error) {
        this.logger.warn(
          `Failed to send buffered event to subscriber ${subscriberId}`,
        );
      }
    }

    this.logger.debug(
      `Subscriber ${subscriberId} joined stream ${sessionId}, sent ${stream.eventBuffer.length} buffered events`,
    );

    // 返回取消订阅的清理函数
    return () => {
      subscription.unsubscribe();
      this.unsubscribe(sessionId, subscriberId);
    };
  }

  /**
   * 广播事件到所有订阅者，并缓存到缓冲区
   *
   * @param sessionId 会话 ID
   * @param event 流式事件
   */
  broadcast(sessionId: string, event: StreamEvent): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return;
    }

    // 缓存事件
    stream.eventBuffer.push(event);
    if (stream.eventBuffer.length > stream.maxBufferSize) {
      stream.eventBuffer.shift();
    }

    // 广播到所有订阅者
    const data = JSON.stringify(event);
    for (const subscriber of stream.subscribers.values()) {
      try {
        subscriber.subject.next({ data });
      } catch (error) {
        this.logger.warn(
          `Failed to send to subscriber ${subscriber.id}, removing`,
        );
        stream.subscribers.delete(subscriber.id);
      }
    }
  }

  /**
   * 取消订阅
   *
   * @param sessionId 会话 ID
   * @param subscriberId 订阅者 ID
   */
  unsubscribe(sessionId: string, subscriberId: string): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream) {
      return;
    }

    const existed = stream.subscribers.delete(subscriberId);
    if (existed) {
      this.logger.debug(
        `Subscriber ${subscriberId} left stream ${sessionId}, remaining: ${stream.subscribers.size}`,
      );
    }
  }

  /**
   * 停止流式任务
   *
   * @param sessionId 会话 ID
   * @param reason 停止原因
   */
  stopStream(
    sessionId: string,
    reason: "user_cancel" | "completed" | "error",
  ): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream) {
      return;
    }

    stream.isRunning = false;

    // 通知所有订阅者流已结束，然后关闭连接
    for (const subscriber of stream.subscribers.values()) {
      try {
        subscriber.subject.complete();
      } catch (error) {
        // 忽略错误，客户端可能已断开
      }
    }

    // 中止底层 LLM 请求
    try {
      stream.abortController.abort();
    } catch (error) {
      this.logger.warn(`Error aborting stream for ${sessionId}:`, error);
    }

    this.activeStreams.delete(sessionId);
    this.logger.log(
      `Stream stopped for session ${sessionId}, reason: ${reason}, had ${stream.subscribers.size} subscribers`,
    );
  }

  /**
   * 获取流状态
   *
   * @param sessionId 会话 ID
   */
  getStreamStatus(sessionId: string): {
    isRunning: boolean;
    subscriberCount: number;
    bufferedEventCount: number;
    startedAt?: Date;
  } | null {
    const stream = this.activeStreams.get(sessionId);
    if (!stream) {
      return null;
    }

    return {
      isRunning: stream.isRunning,
      subscriberCount: stream.subscribers.size,
      bufferedEventCount: stream.eventBuffer.length,
      startedAt: stream.startedAt,
    };
  }

  /**
   * 检查会话是否有活跃流
   *
   * @param sessionId 会话 ID
   */
  hasActiveStream(sessionId: string): boolean {
    const stream = this.activeStreams.get(sessionId);
    return stream !== undefined && stream.isRunning;
  }

  /**
   * 获取活跃流数量（用于监控）
   */
  getActiveStreamCount(): number {
    let count = 0;
    for (const stream of this.activeStreams.values()) {
      if (stream.isRunning) {
        count++;
      }
    }
    return count;
  }
}
