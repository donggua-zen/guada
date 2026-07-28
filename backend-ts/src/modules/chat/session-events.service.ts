import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Subject, Observable, Subscription } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import {
  StreamFinishedEvent,
  StreamStartedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
  SubAgentCreatedEvent,
  SubAgentClosedEvent,
  TodoUpdatedEvent,
  toSessionEvent,
} from "../../common/events/stream.events";
/**
 * 会话事件类型
 */
export type SessionEventType =
  | "connected"
  | "session_created"
  | "session_deleted"
  | "session_renamed"
  | "session_updated"
  | "stream_started"
  | "stream_finished"
  | "user_message_created"
  | "sub_agent_create"
  | "sub_agent_closed"
  | "todo_updated";

/**
 * 会话事件
 */
export interface SessionEvent {
  type: SessionEventType;
  userId: string;
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
  userId: string;
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
export class SessionEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionEventsService.name);
  private readonly userSubscribers = new Map<
    string,
    Map<string, UserEventSubscriber>
  >();

  /**
   * 订阅用户事件流
   * @param userId 用户 ID
   * @param clientId 客户端唯一标识（如 tabId）
   * @returns Observable<MessageEvent>
   */
  subscribe(userId: string, clientId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    if (!this.userSubscribers.has(userId)) {
      this.userSubscribers.set(userId, new Map());
    }

    const subscribers = this.userSubscribers.get(userId)!;

    // 每 90 秒发送一次心跳，防止前端超时断开
    const heartbeatSubscription = new Subscription();
    const heartbeatTimer = setInterval(() => {
      try {
        this.logger.debug(`Sending heartbeat to ${userId}/${clientId}`);
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

    subscribers.set(clientId, {
      userId,
      subject,
      connectedAt: new Date(),
      clientId,
      heartbeatSubscription,
    });

    this.logger.debug(
      `User ${userId} client ${clientId} subscribed, total clients: ${subscribers.size}`,
    );

    // 发送连接成功事件
    subject.next({
      data: JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      }),
    } as MessageEvent);

    return subject.asObservable();
  }

  /**
   * 取消订阅
   */
  unsubscribe(userId: string, clientId: string): void {
    const subscribers = this.userSubscribers.get(userId);
    if (!subscribers) return;

    const subscriber = subscribers.get(clientId);
    if (subscriber) {
      subscriber.heartbeatSubscription?.unsubscribe();
      subscriber.subject.complete();
      subscribers.delete(clientId);
      this.logger.debug(
        `User ${userId} client ${clientId} unsubscribed, remaining: ${subscribers.size}`,
      );
    }

    if (subscribers.size === 0) {
      this.userSubscribers.delete(userId);
    }
  }

  /**
   * 监听内部 stream.started 事件，转发给 SSE 客户端
   */
  @OnEvent("stream.started")
  handleStreamStarted(event: StreamStartedEvent) {
    this.broadcastToUser(event.userId, toSessionEvent("stream_started", event));
  }

  /**
   * 监听内部 stream.finished 事件，转发给 SSE 客户端
   */
  @OnEvent("stream.finished")
  handleStreamFinished(event: StreamFinishedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("stream_finished", event),
    );
  }

  /**
   * 监听内部 session.created 事件，转发给 SSE 客户端
   */
  @OnEvent("session.created")
  handleSessionCreated(event: SessionCreatedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("session_created", event),
    );
  }

  /**
   * 监听内部 session.updated 事件，转发给 SSE 客户端
   */
  @OnEvent("session.updated")
  handleSessionUpdated(event: SessionUpdatedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("session_updated", event),
    );
  }

  /**
   * 监听内部 session.deleted 事件，转发给 SSE 客户端
   */
  @OnEvent("session.deleted")
  handleSessionDeleted(event: SessionDeletedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("session_deleted", event),
    );
  }

  /**
   * 监听内部 subagent.created 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.created")
  handleSubAgentCreated(event: SubAgentCreatedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("sub_agent_create", event),
    );
  }

  /**
   * 监听内部 subagent.closed 事件，转发给 SSE 客户端
   */
  @OnEvent("subagent.closed")
  handleSubAgentClosed(event: SubAgentClosedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("sub_agent_closed", event),
    );
  }

  /**
   * 监听内部 todo.updated 事件，转发给 SSE 客户端
   */
  @OnEvent("todo.updated")
  handleTodoUpdated(event: TodoUpdatedEvent) {
    this.broadcastToUser(
      event.userId,
      toSessionEvent("todo_updated", event),
    );
  }

  /**
   * 向指定用户的所有客户端广播事件
   */
  private broadcastToUser(userId: string, event: SessionEvent): void {
    const subscribers = this.userSubscribers.get(userId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const messageEvent: MessageEvent = {
      data: JSON.stringify(event),
    } as MessageEvent;

    for (const subscriber of subscribers.values()) {
      try {
        subscriber.subject.next(messageEvent);
      } catch (error) {
        this.logger.warn(
          `Failed to send event to ${userId}/${subscriber.clientId}, removing`,
        );
        this.unsubscribe(userId, subscriber.clientId);
      }
    }
  }

  /**
   * 获取用户在线客户端数量
   */
  getUserClientCount(userId: string): number {
    return this.userSubscribers.get(userId)?.size || 0;
  }

  onModuleDestroy() {
    for (const [userId, subscribers] of this.userSubscribers) {
      for (const [clientId, subscriber] of subscribers) {
        subscriber.subject.complete();
      }
      subscribers.clear();
    }
    this.userSubscribers.clear();
  }
}
