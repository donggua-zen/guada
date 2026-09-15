import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Subject, Observable, Subscription } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import {
  StreamStatusChangedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  SubAgentCreatedEvent,
  SubAgentClosedEvent,
  TodoUpdatedEvent,
  ProcessChangedEvent,
  toSessionEvent,
} from "../../common/events/stream.events";
import {
  EVENT_METHOD,
  createUnifiedEvent,
  type EventMethod,
} from "../../common/events/unified-event.types";
import type { SessionStreamEvent } from "./types/event-chunk.types";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionRepository } from "../../common/database/session.repository";
import { HOOKS } from "./types/hooks.contract";
/**
 * 会话事件类型
 */
export type SessionEventType =
  | "connected"
  | "session_created"
  | "session_deleted"
  | "session_renamed"
  | "session_updated"
  | "stream_status_changed"
  | "user_message_created"
  | "sub_agent_create"
  | "sub_agent_closed"
  | "todo_updated"
  | "process_changed"
  | "plugins_changed";

/**
 * 会话事件
 */
export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  // 事件负载，根据 type 不同而变化
  payload?: Record<string, any>;
  // 发起者标识，用于前端忽略自身消息
  source?: string;
}

/**
 * 用户事件订阅者
 */
interface UserEventSubscriber {
  subject: Subject<MessageEvent>;
  connectedAt: Date;
  clientId: string;
  heartbeatSubscription?: any;
}

/**
 * 内部事件监听器
 */
interface InternalEventListener {
  type: SessionEventType;
  callback: (event: SessionEvent) => void;
}

/**
 * 用户级会话事件服务
 *
 * 职责：
 * - 为每个在线用户维护 SSE 事件流
 * - 聚合所有会话相关事件（CRUD + 流式状态变更）
 * - 支持多客户端同时连接（同用户多窗口/多设备）
 */
@Injectable()
export class SessionEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionEventsService.name);
  /** 单账户：所有客户端订阅同一张表 */
  private readonly subscribers = new Map<string, UserEventSubscriber>();

  constructor(
    private readonly streamManager: SessionStreamManager,
    private readonly sessionRepository: SessionRepository,
  ) {}

  /**
   * 注册 SSE 直投回调（唯一发布入口的消费者侧）
   *
   * 流式事件的发布统一走 streamManager.publish（缓存+进程内扇出+直投三合一），
   * 本服务经此回调接收并推给该用户全部在线客户端——发布点唯一，无生产者双写。
   */
  onModuleInit() {
    this.streamManager.setStreamRelay((sessionId, chunk) =>
      this.pushStreamEvent(sessionId, chunk),
    );
  }

  /**
   * 订阅事件流（单账户：所有客户端平级）
   * @param clientId 客户端唯一标识（如 tabId）
   * @returns Observable<MessageEvent>
   */
  subscribe(clientId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    // 每 90 秒发送一次心跳，防止前端超时断开
    const heartbeatSubscription = new Subscription();
    const heartbeatTimer = setInterval(() => {
      try {
        this.logger.debug(`Sending heartbeat to ${clientId}`);
        subject.next({
          data: JSON.stringify({
            type: "heartbeat",
            timestamp: new Date().toISOString(),
          }),
        } as MessageEvent);
      } catch (error) {
        // 如果发送失败，说明连接已断开，取消心跳
        clearInterval(heartbeatTimer);
      }
    }, 90000);
    heartbeatSubscription.add(() => clearInterval(heartbeatTimer));

    this.subscribers.set(clientId, {
      subject,
      connectedAt: new Date(),
      clientId,
      heartbeatSubscription,
    });

    this.logger.debug(
      `Client ${clientId} subscribed, total clients: ${this.subscribers.size}`,
    );

    // 连接建立时的补发（connected + eventBuffer 重放 + running 状态）必须延迟到 NestJS
    // 订阅返回的 observable 之后。此前用普通 Subject 在 subscribe() 同步栈内直接 next，
    // 而框架是在拿到 asObservable() 返回值后才订阅——同步 emit 早于订阅者附加，全部被
    // 无重放缓冲的 Subject 静默丢弃（表现为刷新后会话级 isStreaming/streamStatus 丢失）。
    // 用 queueMicrotask 推迟到当前同步栈之后（订阅已建立），并在回调内做三重防护：
    //   1) 重新取 subscriber 确认连接仍在（快速刷新/断连时已被 unsubscribe 删除则跳过）
    //   2) running 补发重新取当下活跃流快照，避免闭包捕获旧列表发出 stale running
    //   3) 每次 next 包 try/catch，与 broadcastToUser/pushStreamToUser 一致
    queueMicrotask(() => {
      void this.emitCatchup(clientId, subject);
    });

    return subject.asObservable();
  }

  /**
   * 连接建立后的补发：connected 事件、活跃流 eventBuffer 重放、running 状态补发。
   * 在 queueMicrotask 中执行，确保晚于 NestJS 对返回 observable 的订阅。
   */
  private async emitCatchup(
    clientId: string,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    // 防护 1：连接可能在微任务前已断开（req close → unsubscribe → subject.complete + map 删除）
    const stillSubscribed = () =>
      this.subscribers.get(clientId)?.subject === subject && !subject.closed;

    const safeNext = (event: MessageEvent): boolean => {
      if (!stillSubscribed()) return false;
      try {
        subject.next(event);
        return true;
      } catch (error) {
        this.logger.debug(
          `emitCatchup next failed for ${clientId}: ${String(error)}`,
        );
        return false;
      }
    };

    // 发送连接成功事件
    if (
      !safeNext({
        data: JSON.stringify({
          type: "connected",
          timestamp: new Date().toISOString(),
        }),
      } as MessageEvent)
    ) {
      return;
    }

    // 防护 2：重新取当下活跃流快照（微任务窗口内流可能已 stop）
    const activeStreams = this.streamManager.getActiveStreams();

    // 统一 SSE:连接建立时补发全部活跃流的 eventBuffer 增量。
    // 替代前端 catchup HTTP 拉取——刷新/多窗口重连时,连接前已产生的流式事件在此补发,
    // 前端按 payload.sessionId 归会话、按 prevSeq >= lastSeq 去重后消费。
    for (const stream of activeStreams) {
      for (const chunk of stream.eventBuffer) {
        const unified = createUnifiedEvent(
          this.mapStreamMethod(chunk.type),
          { sessionId: stream.sessionId, ...chunk } as Record<string, any>,
        );
        if (
          !safeNext({
            data: JSON.stringify(unified),
          } as MessageEvent)
        ) {
          return;
        }
      }
    }

    // 刷新安全（v1.8）：stream_status_changed 不在 eventBuffer 中、不随 catchup 重放，
    // 刷新后会话级 isStreaming/streamStatus 会丢失。对活跃流补发 running 状态，
    // 恢复"暂停中的循环仍工作中"的会话级视图（审批/迭代暂停卡；阻止新消息撞 SESSION_BUSY）。
    // kind 随流类型下发：chat 流前端跳过事件页拉取靠 buffer 重放；maintenance 流
    // （手动压缩伪流）buffer 无回合历史，前端照常拉事件页，压缩中状态由 catchup 的
    // compression_start 恢复。
    // sessionType 随流下发：子会话（sub_agent/bot）补发需带上，否则前端
    // useSessionEvents 的 isSubOrBot 判定失效，子会话状态会误穿主会话分支
    // （污染主会话 isStreaming / 侧边栏 working）。ActiveStream 不含 sessionType，按 sessionId 查。
    for (const stream of activeStreams) {
      const sessionType =
        (await this.sessionRepository
          .getSessionType(stream.sessionId)
          .catch(() => null)) ?? "web";
      if (
        !safeNext({
          data: JSON.stringify(
            toSessionEvent("stream_status_changed", {
              sessionId: stream.sessionId,
              timestamp: new Date().toISOString(),
              payload: { status: "running", kind: stream.kind, sessionType },
            }),
          ),
        } as MessageEvent)
      ) {
        return;
      }
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(clientId: string): void {
    const subscriber = this.subscribers.get(clientId);
    if (!subscriber) return;
    subscriber.heartbeatSubscription?.unsubscribe();
    subscriber.subject.complete();
    this.subscribers.delete(clientId);
    this.logger.debug(
      `Client ${clientId} unsubscribed, remaining: ${this.subscribers.size}`,
    );
  }

  /**
   * 监听内部 stream.status_changed 事件，转发给 SSE 客户端
   *
   * 统一会话流生命周期状态（running/completed/user_cancel/error），取代旧 stream.started/stream.finished。
   */
  @OnEvent("stream.status_changed")
  handleStreamStatusChanged(event: StreamStatusChangedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("stream_status_changed", event),
    );
  }

  /**
   * 监听内部 session.created 事件，转发给 SSE 客户端
   */
  @OnEvent("session.created")
  handleSessionCreated(event: SessionCreatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("session_created", event),
    );
  }

  /**
   * 监听内部 session.updated 事件，转发给 SSE 客户端
   */
  @OnEvent("session.updated")
  handleSessionUpdated(event: SessionUpdatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("session_updated", event),
    );
  }

  /**
   * 监听内部 session.deleted 事件，转发给 SSE 客户端
   */
  @OnEvent("session.deleted")
  handleSessionDeleted(event: SessionDeletedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("session_deleted", event),
    );
  }

  /**
   * 监听内部 subagent.created 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.created")
  handleSubAgentCreated(event: SubAgentCreatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("sub_agent_create", event),
    );
  }

  /**
   * 监听内部 subagent.closed 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.closed")
  handleSubAgentClosed(event: SubAgentClosedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("sub_agent_closed", event),
    );
  }

  /**
   * 监听内部 todo.updated 事件，转发给 SSE 客户端
   */
  @OnEvent(HOOKS.TODO_UPDATED)
  handleTodoUpdated(event: TodoUpdatedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("todo_updated", event),
    );
  }

  /**
   * 监听内部 process.changed 事件（后台进程转后台/结束/移除），转发给 SSE 客户端
   */
  @OnEvent("process.changed")
  handleProcessChanged(event: ProcessChangedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("process_changed", event),
    );
  }

  /**
   * 监听内部 plugins.changed 事件（插件注册/卸载/启停），广播给所有在线用户
   */
  @OnEvent("plugins.changed")
  handlePluginsChanged(event: { pluginId: string; action: string }) {
    const sessionEvent: SessionEvent = {
      type: "plugins_changed",
      sessionId: "*",
      timestamp: new Date().toISOString(),
      payload: event,
    };
    this.broadcastToAllClients(sessionEvent);
  }

  /**
   * 向指定用户的所有客户端广播事件
   */
  private broadcastToAllClients(event: SessionEvent): void {
    if (this.subscribers.size === 0) return;

    const messageEvent: MessageEvent = {
      data: JSON.stringify(event),
    } as MessageEvent;

    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.subject.next(messageEvent);
      } catch {
        this.logger.warn(
          `Failed to send event to ${subscriber.clientId}, removing`,
        );
        this.unsubscribe(subscriber.clientId);
      }
    }
  }

  /**
   * SSE 直投（唯一发布入口的消费者侧，由 streamManager relay 调用）
   *
   * 构造统一事件信封(UnifiedEvent),method = stream/*,payload 保留原始 EventChunk 字段 + sessionId。
   * 该用户的所有在线客户端(多窗口)都会收到,前端按 method 路由、按 payload.sessionId 归会话。
   *
   * @param sessionId 会话 ID
   * @param chunk 流式事件块(EventChunk)
   */
  private pushStreamEvent(sessionId: string, chunk: SessionStreamEvent): void {
    if (this.subscribers.size === 0) return;

    const unified = createUnifiedEvent(
      this.mapStreamMethod(chunk.type),
      { sessionId, ...chunk } as Record<string, any>,
    );
    const messageEvent: MessageEvent = {
      data: JSON.stringify(unified),
    } as MessageEvent;

    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.subject.next(messageEvent);
      } catch {
        this.logger.warn(
          `Failed to send stream event to ${subscriber.clientId}, removing`,
        );
        this.unsubscribe(subscriber.clientId);
      }
    }
  }

  /** 将 SessionStreamEvent.type 映射为统一 method(stream/*，消息级与 chunk.type 一致) */
  private mapStreamMethod(type: SessionStreamEvent["type"]): EventMethod {
    switch (type) {
      case "turn_start": return EVENT_METHOD.STREAM_TURN_START;
      case "turn_end": return EVENT_METHOD.STREAM_TURN_END;
      case "turn_delete": return EVENT_METHOD.STREAM_TURN_DELETE;
      case "user_message": return EVENT_METHOD.STREAM_USER_MESSAGE;
      case "retry": return EVENT_METHOD.STREAM_RETRY;
      case "tool_calls_response": return EVENT_METHOD.STREAM_TOOL_CALLS_RESPONSE;
      // 引擎级附属（压缩）
      case "compression_start": return EVENT_METHOD.STREAM_COMPRESSION_START;
      case "compression_error": return EVENT_METHOD.STREAM_COMPRESSION_ERROR;
      case "compression_end": return EVENT_METHOD.STREAM_COMPRESSION_END;
      case "compaction_summary": return EVENT_METHOD.STREAM_COMPACTION_SUMMARY;
      // 统一交互（审批/询问/迭代暂停共用）
      case "ask_requested": return EVENT_METHOD.STREAM_ASK_REQUESTED;
      case "ask_resolved": return EVENT_METHOD.STREAM_ASK_RESOLVED;
      // Workflow 编排进度
      case "workflow_event": return EVENT_METHOD.STREAM_WORKFLOW_EVENT;
      // 消息级:StreamChunk 直通
      case "block_start": return EVENT_METHOD.STREAM_BLOCK_START;
      case "text_delta": return EVENT_METHOD.STREAM_TEXT_DELTA;
      case "reasoning_delta": return EVENT_METHOD.STREAM_REASONING_DELTA;
      case "tool_call_delta": return EVENT_METHOD.STREAM_TOOL_CALL_DELTA;
      case "block_end": return EVENT_METHOD.STREAM_BLOCK_END;
      case "usage": return EVENT_METHOD.STREAM_USAGE;
      case "finish": return EVENT_METHOD.STREAM_FINISH;
      default: {
        const exhaustive: never = type;
        this.logger.warn(`Unknown stream event type: ${exhaustive}`);
        return EVENT_METHOD.STREAM_FINISH;
      }
    }
  }

  /** 在线客户端数量 */
  getClientCount(): number {
    return this.subscribers.size;
  }

  onModuleDestroy() {
    for (const subscriber of this.subscribers.values()) {
      subscriber.heartbeatSubscription?.unsubscribe();
      subscriber.subject.complete();
    }
    this.subscribers.clear();
  }
}
