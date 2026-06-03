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
    onEvent: (data: string) => void,
    onComplete: () => void,
    onError: (err: any) => void,
    lastContentId: string | null = null,
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

    // 扫描 eventBuffer 中已收到 finish 的 contentId
    const finishedContentIds = new Set<string>();
    for (const event of stream.eventBuffer) {
      if (event.type === "finish" && event.contentId) {
        finishedContentIds.add(event.contentId);
      }
    }

    // 发送缓冲区中的历史事件，过滤掉前端已知的已完成内容
    let sentCount = 0;
    let skippedCount = 0;
    for (const event of stream.eventBuffer) {
      const contentId = event.contentId;

      // 已 finish 且 <= lastContentId，前端数据库已有，跳过
      if (
        contentId &&
        finishedContentIds.has(contentId) &&
        lastContentId &&
        contentId <= lastContentId
      ) {
        skippedCount++;
        continue;
      }

      try {
        subject.next({ data: JSON.stringify(event) });
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

    // 收到 finish 事件时，聚合该 content 的历史 chunk
    if (event.type === "finish" && event.contentId) {
      this.aggregateContentInBuffer(stream, event.contentId);
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
   * 聚合指定 contentId 在 eventBuffer 中的事件
   *
   * 将连续的 text/think 事件合并为单个事件，减少事件数量。
   * 保留 create/update、tool_call、tool_calls_response、finish 等事件。
   */
  private aggregateContentInBuffer(
    stream: ActiveStream,
    contentId: string,
  ): void {
    const contentEvents = stream.eventBuffer.filter(
      (e) => e.contentId === contentId,
    );
    if (contentEvents.length === 0) return;

    // 提取各类事件
    const textEvents = contentEvents.filter((e) => e.type === "text");
    const thinkEvents = contentEvents.filter((e) => e.type === "think");

    // 如果没有需要聚合的 text/think 事件，直接返回
    if (textEvents.length <= 1 && thinkEvents.length <= 1) return;

    // 构建聚合后的事件列表
    const aggregatedEvents: StreamEvent[] = [];

    // 保留 create/update 事件
    const createEvent = contentEvents.find(
      (e) => e.type === "create" || e.type === "update",
    );
    if (createEvent) aggregatedEvents.push(createEvent);

    // 聚合 text 事件
    if (textEvents.length > 0) {
      const aggregatedText = textEvents.map((e) => e.msg).join("");
      aggregatedEvents.push({
        type: "text",
        msg: aggregatedText,
        contentId,
      });
    }

    // 聚合 think 事件
    if (thinkEvents.length > 0) {
      const aggregatedThink = thinkEvents.map((e) => e.msg).join("");
      aggregatedEvents.push({
        type: "think",
        msg: aggregatedThink,
        contentId,
      });
    }

    // 聚合 tool_call 事件（增量参数累加）
    const toolCallEvents = contentEvents.filter((e) => e.type === "tool_call");
    if (toolCallEvents.length > 0) {
      const aggregatedToolCalls = this.aggregateToolCalls(toolCallEvents);
      aggregatedEvents.push({
        type: "tool_call",
        toolCalls: aggregatedToolCalls,
        contentId,
      });
    }

    // 保留 tool_calls_response 事件
    const toolCallsResponseEvents = contentEvents.filter(
      (e) => e.type === "tool_calls_response",
    );
    if (toolCallsResponseEvents.length > 0) {
      aggregatedEvents.push(
        toolCallsResponseEvents[toolCallsResponseEvents.length - 1],
      );
    }

    // 保留其他类型事件（如 compression_start 等）
    const otherEvents = contentEvents.filter(
      (e) =>
        e.type !== "create" &&
        e.type !== "update" &&
        e.type !== "text" &&
        e.type !== "think" &&
        e.type !== "tool_call" &&
        e.type !== "tool_calls_response" &&
        e.type !== "finish",
    );
    aggregatedEvents.push(...otherEvents);

    // 保留 finish 事件（放在最后，标记 content 完成）
    const finishEvent = contentEvents.find((e) => e.type === "finish");
    if (finishEvent) aggregatedEvents.push(finishEvent);

    // 从 eventBuffer 中移除该 content 的所有原始事件
    stream.eventBuffer = stream.eventBuffer.filter(
      (e) => e.contentId !== contentId,
    );

    // 插入聚合后的事件
    stream.eventBuffer.push(...aggregatedEvents);

    this.logger.debug(
      `Aggregated content ${contentId}: ${contentEvents.length} events → ${aggregatedEvents.length} events`,
    );
  }

  /**
   * 聚合 tool_call 事件
   *
   * tool_call 是增量发送的，每个 chunk 只包含部分参数。
   * 需要按 index 分组，累加 arguments 字符串，合并为完整的工具调用。
   */
  private aggregateToolCalls(toolCallEvents: StreamEvent[]): any[] {
    const toolCallMap = new Map<
      number,
      { id?: string; index: number; type: string; name: string; arguments: string }
    >();

    for (const event of toolCallEvents) {
      const toolCalls = event.toolCalls || [];
      for (const tc of toolCalls) {
        const index = tc.index;
        if (!toolCallMap.has(index)) {
          toolCallMap.set(index, {
            id: tc.id,
            index: tc.index,
            type: tc.type || "function",
            name: tc.name || "",
            arguments: "",
          });
        }
        const existing = toolCallMap.get(index)!;
        // 更新 id（可能从空到具体值）
        if (tc.id && !existing.id) {
          existing.id = tc.id;
        }
        // 更新 name（可能从空到具体值）
        if (tc.name) {
          existing.name = tc.name;
        }
        // 累加 arguments
        if (tc.arguments) {
          existing.arguments += tc.arguments;
        }
      }
    }

    return Array.from(toolCallMap.values());
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
