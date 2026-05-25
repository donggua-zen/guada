import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Subject, Observable, Subscription } from "rxjs";
import { MessageEvent } from "@nestjs/common";

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
  | "user_message_created";

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
  private readonly userSubscribers = new Map<string, Map<string, UserEventSubscriber>>();

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

    // 每 30 秒发送一次心跳，防止前端超时断开
    const heartbeatSubscription = new Subscription();
    const heartbeatTimer = setInterval(() => {
      try {
        this.logger.debug(
          `Sending heartbeat to ${userId}/${clientId}`,
        );
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
    }, 30000);
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
   * 向指定用户的所有客户端广播事件
   */
  broadcastToUser(userId: string, event: SessionEvent): void {
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
