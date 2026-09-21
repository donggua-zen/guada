import { Injectable, Logger } from "@nestjs/common";
import { Subject } from "rxjs";
import { WireStreamEvent } from "./types/event-chunk.types";

/**
 * 流式事件
 */
export type StreamEvent = WireStreamEvent;

/**
 * 流订阅者
 */
interface StreamSubscriber {
  id: string;
  subject: Subject<WireStreamEvent>;
  connectedAt: Date;
}

/**
 * 活跃流任务
 */
interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  subscribers: Map<string, StreamSubscriber>;
  eventBuffer: StreamEvent[];
  maxBufferSize: number;
  isRunning: boolean;
  startedAt: Date;
  /** 停止原因，由 stopStream 设置，subscribe 的 complete 回调通过闭包读取 */
  stopReason?: "user_cancel" | "completed" | "error";
  /** 流类型：chat=对话回合；maintenance=维护任务（手动压缩等伪流，buffer 无回合历史） */
  kind: "chat" | "maintenance";
}

/**
 * 会话流管理器
 *
 * 职责：
 * - 管理每个会话的活跃流式任务生命周期
 * - 支持多客户端订阅同一会话的流式输出
 * - 维护事件缓冲区，使新加入的客户端能够追赶上当前进度
 * - 将流式输出与单个客户端连接解耦，实现刷新不中断
 * - 唯一发布点（publish）：一次调用完成 eventBuffer 缓存 + 进程内订阅者扇出
 *   + SSE 直投（经 streamRelay 回调推给 SessionEventsService，避免循环依赖）
 */
@Injectable()
export class SessionStreamManager {
  private readonly logger = new Logger(SessionStreamManager.name);
  private readonly activeStreams = new Map<string, ActiveStream>();
  private readonly DEFAULT_MAX_BUFFER_SIZE = 2000;
  /**
   * 进程启动标识：随每条事件下发（streamBootId）。进程重启后计数器归零，
   * 前端幂等游标据此识别"序号已重置"，避免把新流的首批事件误判为重复。
   */
  private readonly bootId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  /**
   * 每会话单调流序号（publish 唯一盖戳点）。不随 ActiveStream 销毁重置——
   * 回合结束 stopStream 后下一回合序号继续递增，否则前端会把新回合事件误判为已消费。
   * 仅按会话累积一个数字，无清理钩子（量级可忽略）。
   */
  private readonly streamSeqBySession = new Map<string, number>();

  /**
   * SSE 直投回调（SessionEventsService 启动时注入）
   *
   * 经回调而非构造器注入：SessionEventsService 已依赖本服务（连接补发读 eventBuffer），
   * 反向构造器注入会成环；回调保持 publish 同步调用链，事件顺序不因 relay 而变。
   */
  private streamRelay?: (sessionId: string, event: StreamEvent) => void;

  /**
   * 注册 SSE 直投回调
   */
  setStreamRelay(fn: (sessionId: string, event: StreamEvent) => void): void {
    this.streamRelay = fn;
  }

  /**
   * 启动新的流式任务
   *
   * @param sessionId 会话 ID
   * @param abortController 用于中止底层 LLM 请求的控制器
   * @param kind 流类型：chat=对话回合（默认）；maintenance=维护任务（手动压缩等伪流，
   *             占用会话互斥但不产生回合内容，buffer 无历史——前端据此决定是否跳过事件页拉取）
   * @returns 是否成功启动（如果同一会话已有活跃流则返回 false）
   */
  startStream(
    sessionId: string,
    abortController: AbortController,
    kind: "chat" | "maintenance" = "chat",
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
      abortController,
      subscribers: new Map(),
      eventBuffer: [],
      maxBufferSize: this.DEFAULT_MAX_BUFFER_SIZE,
      isRunning: true,
      startedAt: new Date(),
      kind,
    };

    this.activeStreams.set(sessionId, stream);
    this.logger.log(`Stream started for session ${sessionId}`);
    return true;
  }

  /**
   * 订阅已存在的流（内部订阅：事件实时经 subject 转发，无游标补发——
   * 增量续传由 SSE 全局广播 + 前端 StreamEventHub(prevSeq>=lastSeq) 承担）
   *
   * @param sessionId 会话 ID
   * @param subscriberId 订阅者唯一标识
   * @returns 可观察的 Subject，如果流不存在或未运行则返回 null
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    onEvent: (data: WireStreamEvent) => void,
    onComplete: (reason: string) => void,
    onError: (err: any) => void,
  ): (() => void) | null {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return null;
    }

    const subject = new Subject<WireStreamEvent>();
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

    // 内部订阅者在流启动前注册，buffer 为空；订阅后事件经 subject 实时转发
    // （历史补发走 SSE 连接补发 → StreamEventHub 邮箱，不在此处重放）
    this.logger.debug(`Subscriber ${subscriberId} joined stream ${sessionId}`);

    // 返回取消订阅的清理函数
    return () => {
      subscription.unsubscribe();
      this.unsubscribe(sessionId, subscriberId);
    };
  }

  /**
   * 发布流式事件（唯一发布入口）
   *
   * 一次调用完成三件事：eventBuffer 缓存（供 SSE 连接补发）、进程内订阅者实时扇出、
   * 经 relay 直投该用户全部 SSE 客户端，调用方无需再单独广播。
   *
   * 收到 finish 事件时，自动聚合该 content 的所有 chunk，
   * 将连续的 text/think 事件合并为单个事件，减少新订阅者的事件数量。
   *
   * @param sessionId 会话 ID
   * @param event 流式事件（prevSeq 由生产者赋值——"先入库后发事件"契约）
   */
  publish(sessionId: string, event: StreamEvent): void {
    const stream = this.activeStreams.get(sessionId);
    if (!stream || !stream.isRunning) {
      return;
    }

    // 收到 finish 事件时，清理该 content 的中间事件
    if (event.type === "finish" && event.messageId) {
      this.cleanupIntermediateEvents(stream, event.messageId);
    }

    // 盖戳：每会话单调 streamSeq + 进程 bootId。前端 StreamEventHub 据此做入口幂等——
    // SSE 重连时连接补发会重放整个 eventBuffer，已消费过的事件（序号 <= 游标）直接丢弃，
    // 防止 delta 重复追加导致文本翻倍。
    const streamSeq = (this.streamSeqBySession.get(sessionId) ?? 0) + 1;
    this.streamSeqBySession.set(sessionId, streamSeq);
    const stamped: StreamEvent = {
      ...event,
      streamSeq,
      streamBootId: this.bootId,
    };

    // 缓存事件
    stream.eventBuffer.push(stamped);
    if (stream.eventBuffer.length > stream.maxBufferSize) {
      stream.eventBuffer.shift();
    }

    // 广播到所有订阅者
    for (const subscriber of stream.subscribers.values()) {
      try {
        subscriber.subject.next(stamped);
      } catch (error) {
        this.logger.warn(
          `Failed to send to subscriber ${subscriber.id}, removing`,
        );
        stream.subscribers.delete(subscriber.id);
      }
    }

    // SSE 直投：所有在线客户端（单账户，多窗口）
    this.streamRelay?.(sessionId, stamped);
  }

  /**
   * 清理指定 messageId 在 eventBuffer 中的中间事件
   *
   * block_end 携带该块的权威终态，新订阅者只需回合级事件 + block_end + finish 即可重建，
   * 因此移除 block_start/text_delta/reasoning_delta/tool_call_delta 等中间增量事件。
   */
  private cleanupIntermediateEvents(
    stream: ActiveStream,
    messageId: string,
  ): void {
    stream.eventBuffer = stream.eventBuffer.filter((e) => {
      if ((e as { messageId?: string }).messageId !== messageId) return true;
      return !(
        e.type === "block_start" ||
        e.type === "text_delta" ||
        e.type === "reasoning_delta" ||
        e.type === "tool_call_delta"
      );
    });

    this.logger.debug(
      `Cleaned up intermediate events for message ${messageId}`,
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
   * 获取所有活跃流（SSE 订阅建立时补发 eventBuffer 用；单账户故无用户维度）。
   *
   * activeStreams 是 Map<sessionId, ActiveStream>；由 SessionEventsService.subscribe
   * 逐条补发缓存事件，替代前端 catchup HTTP 拉取——统一走全局 SSE 通道。
   */
  getActiveStreams(): ActiveStream[] {
    const result: ActiveStream[] = [];
    for (const stream of this.activeStreams.values()) {
      if (stream.isRunning) result.push(stream);
    }
    return result;
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
