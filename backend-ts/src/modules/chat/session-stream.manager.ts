import { Injectable, Logger } from "@nestjs/common";
import { Subject } from "rxjs";
import { EventChunk } from "./types/event-chunk.types";

/**
 * 流式事件
 */
export type StreamEvent = EventChunk;

/**
 * 流订阅者
 */
interface StreamSubscriber {
  id: string;
  subject: Subject<EventChunk>;
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
  /** 停止原因，由 stopStream 设置，subscribe 的 complete 回调通过闭包读取 */
  stopReason?: "user_cancel" | "completed" | "error";
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
   * @returns 是否成功启动（如果同一会话已有活跃流则返回 false）
   */
  startStream(
    sessionId: string,
    userId: string,
    abortController: AbortController,
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
    };

    this.activeStreams.set(sessionId, stream);
    this.logger.log(`Stream started for session ${sessionId}`);
    return true;
  }

  /**
   * 订阅已存在的流（用于新窗口打开或刷新后重连）
   *
   * 支持基于 lastContentId 的过滤：
   * - 扫描 eventBuffer 中已收到 finish 的 contentId
   * - 已 finish 且 contentId <= lastContentId 的事件跳过（前端数据库已有）
   * - 未 finish 的 content 按原始 chunk 发送
   *
   * @param sessionId 会话 ID
   * @param subscriberId 订阅者唯一标识
   * @param lastContentId 前端最后已完成的 contentId（可选）
   * @returns 可观察的 Subject，如果流不存在或未运行则返回 null
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    onEvent: (data: EventChunk) => void,
    onComplete: (reason: string) => void,
    onError: (err: any) => void,
    lastContentId: string | null = null,
  ): (() => void) | null {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return null;
    }

    const subject = new Subject<EventChunk>();
    const subscriber: StreamSubscriber = {
      id: subscriberId,
      subject,
      connectedAt: new Date(),
    };

    stream.subscribers.set(subscriberId, subscriber);

    // 建立订阅，将事件转发到调用方提供的回调
    const subscription = subject.subscribe({
      next: (event) => onEvent(event),
      complete: () => {
        const stream = this.activeStreams.get(sessionId);
        onComplete(stream?.stopReason || "completed");
      },
      error: onError,
    });

    // 发送缓冲区中的历史事件，过滤掉前端已知的已完成内容
    let sentCount = 0;
    let skippedCount = 0;
    for (const event of stream.eventBuffer) {
      const contentId = event.contentId;

      // 已 finish 且 <= lastContentId，前端数据库已有，跳过
      if (contentId && lastContentId && contentId <= lastContentId) {
        skippedCount++;
        continue;
      }

      try {
        subject.next(event);
        sentCount++;
      } catch (error) {
        this.logger.warn(
          `Failed to send buffered event to subscriber ${subscriberId}`,
        );
      }
    }

    this.logger.debug(
      `Subscriber ${subscriberId} joined stream ${sessionId}, sent ${sentCount} events, skipped ${skippedCount} events`,
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
   * 收到 finish 事件时，自动聚合该 content 的所有 chunk，
   * 将连续的 text/think 事件合并为单个事件，减少新订阅者的事件数量。
   *
   * @param sessionId 会话 ID
   * @param event 流式事件
   */
  broadcast(sessionId: string, event: StreamEvent): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return;
    }

    // 收到 finish 事件时，清理该 content 的中间事件
    if (event.type === "finish" && event.contentId) {
      this.cleanupIntermediateEvents(stream, event.contentId);
    }

    // 缓存事件
    stream.eventBuffer.push(event);
    if (stream.eventBuffer.length > stream.maxBufferSize) {
      stream.eventBuffer.shift();
    }

    // 广播到所有订阅者
    for (const subscriber of stream.subscribers.values()) {
      try {
        subscriber.subject.next(event);
      } catch (error) {
        this.logger.warn(
          `Failed to send to subscriber ${subscriber.id}, removing`,
        );
        stream.subscribers.delete(subscriber.id);
      }
    }
  }

  /**
   * 清理指定 contentId 在 eventBuffer 中的中间事件
   *
   * finish 事件已携带完整内容，新订阅者只需 create/update + finish 即可重建。
   * 因此移除 text/think/tool_call 等中间事件，只保留首尾和特殊事件。
   */
  private cleanupIntermediateEvents(
    stream: ActiveStream,
    contentId: string,
  ): void {
    // 从 eventBuffer 中移除该 content 的所有中间流式事件
    // 只保留 create/update、tool_calls_response、finish
    stream.eventBuffer = stream.eventBuffer.filter((e) => {
      if (e.contentId !== contentId) return true;
      return (
        e.type === "create" ||
        e.type === "update" ||
        e.type === "tool_calls_response" ||
        e.type === "finish"
      );
    });

    this.logger.debug(
      `Cleaned up intermediate events for content ${contentId}`,
    );
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
   * 中止底层 LLM 请求（不关闭流）
   *
   * 仅触发 abortController.abort()，让 Agent 引擎捕获中止后
   * 生成 finish 事件并广播，再由 runAgentEngine 自然结束流。
   * 与 stopStream 的区别：不关闭订阅者连接，保留 finish 事件的传输通道。
   */
  abortStream(sessionId: string): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream) {
      return;
    }
    try {
      stream.abortController.abort();
    } catch (error) {
      this.logger.warn(`Error aborting stream for ${sessionId}:`, error);
    }
    this.logger.log(`Stream aborted for session ${sessionId}`);
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
    stream.stopReason = reason;

    // 通知所有订 阅者流已结束，然后关闭连接
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
