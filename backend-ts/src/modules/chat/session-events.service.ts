import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Subject, Observable, Subscription, defer, concat, from } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import {
  StreamStatusChangedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  SubAgentCreatedEvent,
  SubAgentClosedEvent,
  TodoUpdatedEvent,
  UserQueueChangedEvent,
  toSessionEvent,
} from "../../common/events/stream.events";
import {
  EVENT_METHOD,
  createUnifiedEvent,
  type EventMethod,
} from "../../common/events/unified-event.types";
import type { SessionStreamEvent } from "./types/event-chunk.types";
import { SessionStreamManager } from "./session-stream.manager";
import { SessionMetaStore } from "./session-meta.store";
import { HOOKS } from "./types/hooks.contract";
import type { JobsSnapshotEvent } from "../jobs/job.types";
import { UserInputQueueService } from "./user-input-queue.service";
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
  | "jobs_snapshot"
  | "plugins_changed"
  | "queue_updated"
  | "queues_snapshot";

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
  /** 本次连接的唯一标识：unsubscribe 按它做身份校验，防止旧连接的 close 误删新连接注册 */
  connectionId: string;
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
  /** 在线连接表：键 = connectionId（同一 clientId 的多标签页/多窗口各占一条连接） */
  private readonly subscribers = new Map<string, UserEventSubscriber>();
  /** 连接序号：生成 connectionId 用 */
  private connectionSeq = 0;

  constructor(
    private readonly streamManager: SessionStreamManager,
    private readonly sessionStore: SessionMetaStore,
    private readonly userInputQueue: UserInputQueueService,
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
   * 订阅事件流（每条连接独立条目；同一 clientId 的多标签页并存，互不惊扰）
   * @param clientId 客户端唯一标识（如 tabId）
   * @returns observable 事件流 + connectionId（本次连接标识，unsubscribe 时回传做身份校验）
   */
  subscribe(clientId: string): {
    observable: Observable<MessageEvent>;
    connectionId: string;
  } {
    const subject = new Subject<MessageEvent>();
    const connectionId = `conn_${++this.connectionSeq}_${Date.now()}`;

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

    // 键即身份：同 clientId 的新连接（刷新重连/另一标签页）是独立条目，不覆盖旧连接；
    // 旧连接的 req close 只删自己那条，不会误删新连接，心跳定时器也不存在孤儿泄漏。
    this.subscribers.set(connectionId, {
      subject,
      connectedAt: new Date(),
      clientId,
      connectionId,
      heartbeatSubscription,
    });

    this.logger.debug(
      `Client ${clientId} (${connectionId}) subscribed, total connections: ${this.subscribers.size}`,
    );

    // 连接补发（connected + eventBuffer 重放 + running 状态）必须作为返回流自身的前缀，
    // 而不能往 subject 上异步 next：NestJS 对 @Sse 返回值的订阅发生在
    // Promise.resolve(result).then(...) 及拦截器链 transformDeferred 的 promise 反应里，
    // 严格晚于本方法的同步栈——此前用 queueMicrotask 补发，全部打在零订阅者的普通
    // Subject 上被静默丢弃（表现为刷新后已流出的事件丢失、isStreaming 状态丢失）。
    // defer + concat 语义：
    //   - defer：订阅真正发生的那一刻才计算补发快照，连接窗口内新进的 chunk 也在其中；
    //   - concat：补发先同步发出，随后同一同步栈内订阅 subject，两者之间无缝隙，
    //     不存在"补发算完但 subject 未订阅"的丢失窗口；
    //   - 若订阅时该连接已被注销（快速刷新秒关），跳过补发只接 live。
    const observable = defer(() => {
      if (this.subscribers.get(connectionId)?.subject !== subject) {
        return subject.asObservable();
      }
      return concat(from(this.buildCatchupEvents()), subject.asObservable());
    });

    return { observable, connectionId };
  }

  /**
   * 连接补发事件列表：connected 事件、活跃流 eventBuffer 重放、running 状态补发。
   * 在返回流被订阅时同步计算并作为流前缀发出（见 subscribe 的 defer+concat 说明）。
   */
  private buildCatchupEvents(): MessageEvent[] {
    const events: MessageEvent[] = [];

    // 连接成功事件
    events.push({
      data: JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      }),
    } as MessageEvent);

    // 用户队列计数快照：侧边栏角标在首次连接/刷新后即可恢复；
    // 具体条目按会话打开时 GET /sessions/:id/queue 拉取。
    events.push({
      data: JSON.stringify({
        type: "queues_snapshot",
        sessionId: "*",
        timestamp: new Date().toISOString(),
        payload: {
          epoch: this.userInputQueue.epoch,
          counts: this.userInputQueue.getAllCounts(),
        },
      }),
    } as MessageEvent);

    const activeStreams = this.streamManager.getActiveStreams();

    // 统一 SSE:连接建立时补发全部活跃流的 eventBuffer 增量。
    // 替代前端 catchup HTTP 拉取——刷新/多窗口重连时,连接前已产生的流式事件在此补发,
    // 前端按 payload.sessionId 归会话、按 streamSeq 入口幂等去重后消费。
    for (const stream of activeStreams) {
      for (const chunk of stream.eventBuffer) {
        const unified = createUnifiedEvent(
          this.mapStreamMethod(chunk.type),
          { sessionId: stream.sessionId, ...chunk } as Record<string, any>,
        );
        events.push({
          data: JSON.stringify(unified),
        } as MessageEvent);
      }
    }

    // 刷新安全（v1.8）：stream_status_changed 不在 eventBuffer 中、不随 catchup 重放，
    // 刷新后会话级 isStreaming/streamStatus 会丢失。对活跃流补发 running 状态，
    // 恢复"回合内原地阻塞等待应答仍工作中"的会话级视图（统一交互卡；阻止新消息撞 SESSION_BUSY）。
    // kind 随流类型下发：chat 流前端跳过事件页拉取靠 buffer 重放；maintenance 流
    // （手动压缩伪流）buffer 无回合历史，前端照常拉事件页，压缩中状态由 catchup 的
    // compression_start 恢复。
    // sessionType 随流下发：子会话（sub_agent/bot）补发需带上，否则前端
    // useSessionEvents 的 isSubOrBot 判定失效，子会话状态会误穿主会话分支
    // （污染主会话 isStreaming / 侧边栏 working）。ActiveStream 不含 sessionType，按 sessionId 查。
    for (const stream of activeStreams) {
      const sessionType =
        this.sessionStore.getSessionType(stream.sessionId) ?? "web";
      events.push({
        data: JSON.stringify(
          toSessionEvent("stream_status_changed", {
            sessionId: stream.sessionId,
            timestamp: new Date().toISOString(),
            payload: { status: "running", kind: stream.kind, sessionType },
          }),
        ),
      } as MessageEvent);
    }

    return events;
  }

  /**
   * 是否有前端 SSE 连接在线（= 用户界面开着，能看见审批卡）。
   *
   * 命令策略层用它做 fail-closed 判定：审批卡经本服务的直投通道到达界面，
   * `SessionStreamManager.subscribers` 只统计**进程内**消费者，看不见前端连接，
   * 因此不能用它判断"有没有人能应答审批"。
   */
  hasConnectedClients(): boolean {
    return this.subscribers.size > 0;
  }

  /**
   * 取消订阅
   * @param clientId 客户端标识（仅作日志/ sanity 校验）
   * @param connectionId 本次连接标识：订阅表按 connectionId 键控，旧连接的 req close
   *   晚到只删自己那条——刷新重连（同 clientId 新旧两条连接）不会误删新连接注册
   */
  unsubscribe(clientId: string, connectionId: string): void {
    const subscriber = this.subscribers.get(connectionId);
    if (!subscriber || subscriber.clientId !== clientId) return;
    subscriber.heartbeatSubscription?.unsubscribe();
    subscriber.subject.complete();
    this.subscribers.delete(connectionId);
    this.logger.debug(
      `Client ${clientId} (${connectionId}) unsubscribed, remaining: ${this.subscribers.size}`,
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

  /** 后台作业全量快照（含 shell/remote/subagent/workflow/scheduler）。 */
  @OnEvent("jobs.changed")
  handleJobsChanged(event: JobsSnapshotEvent) {
    this.broadcastToAllClients({
      type: "jobs_snapshot",
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: {
        // bootId = 后端进程启动标识：前端看到它变化就重置 revision 语义（重启后 revision 归零）
        bootId: event.bootId,
        revision: event.revision,
        jobs: event.jobs,
      },
    });
  }

  /**
   * 用户输入队列快照变化：广播给所有在线客户端（多窗口共享同一份服务端队列）
   */
  @OnEvent("chat.user_queue_changed")
  handleUserQueueChanged(event: UserQueueChangedEvent) {
    this.broadcastToAllClients(
      toSessionEvent("queue_updated", event),
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
        this.unsubscribe(subscriber.clientId, subscriber.connectionId);
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
        this.unsubscribe(subscriber.clientId, subscriber.connectionId);
      }
    }
  }

  /** 将 SessionStreamEvent.type 映射为统一 method(stream/*，消息级与 chunk.type 一致) */
  private mapStreamMethod(type: SessionStreamEvent["type"]): EventMethod {
    switch (type) {
      case "turn_start": return EVENT_METHOD.STREAM_TURN_START;
      case "turn_end": return EVENT_METHOD.STREAM_TURN_END;
      case "context_stats": return EVENT_METHOD.STREAM_CONTEXT_STATS;
      case "turn_delete": return EVENT_METHOD.STREAM_TURN_DELETE;
      case "user_message": return EVENT_METHOD.STREAM_USER_MESSAGE;
      case "retry": return EVENT_METHOD.STREAM_RETRY;
      case "tool_calls_response": return EVENT_METHOD.STREAM_TOOL_CALLS_RESPONSE;
      // 引擎级附属（压缩）
      case "compression_start": return EVENT_METHOD.STREAM_COMPRESSION_START;
      case "compression_error": return EVENT_METHOD.STREAM_COMPRESSION_ERROR;
      case "compression_end": return EVENT_METHOD.STREAM_COMPRESSION_END;
      case "compaction_summary": return EVENT_METHOD.STREAM_COMPACTION_SUMMARY;
      case "context_window_changed": return EVENT_METHOD.STREAM_CONTEXT_WINDOW_CHANGED;
      // 统一交互（审批/询问共用）
      case "ask_requested": return EVENT_METHOD.STREAM_ASK_REQUESTED;
      case "ask_resolved": return EVENT_METHOD.STREAM_ASK_RESOLVED;
      // Workflow 编排进度
      case "workflow_event": return EVENT_METHOD.STREAM_WORKFLOW_EVENT;
      // 子代理创建（工具调用 ↔ 子会话关联键，供工具行打开面板）
      case "subagent_link": return EVENT_METHOD.STREAM_SUBAGENT_LINK;
      // 计划模式变更（协作状态；事实源 session.settings，本帧驱动指示器与多窗口同步）
      case "plan_mode_changed": return EVENT_METHOD.STREAM_PLAN_MODE_CHANGED;
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
