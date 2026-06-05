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
  payload?: Record<string, any>;
  source?: string;
}

/**
 * 会话事件监听器
 */
type EventListener = (event: SessionEvent) => void;

/**
 * 用户级会话事件服务
 *
 * 通过 SSE 长连接接收后端推送的会话事件，替代轮询机制。
 * 支持自动重连、多监听器注册。
 */
import { EventSourcePolyfill } from "event-source-polyfill";
import { getClientId } from "@/utils/clientId";

export class SessionEventsService {
  private eventSource: EventSourcePolyfill | null = null;
  private listeners: Map<SessionEventType | "*", Set<EventListener>> = new Map();
  private clientId: string;
  constructor(private getBaseURL: () => string) {
    // 使用全局客户端标识（localStorage 持久化，刷新页面保持不变）
    this.clientId = getClientId();
  }

  /**
   * 生成客户端 ID（用于标识当前浏览器标签页）
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * 连接到事件流
   * 后端通过 token 解析 userId，前端无需传递
   */
  connect(): void {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    this.startConnection();
  }

  private startConnection(): void {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const url = `${this.getBaseURL()}/events/sessions`;

    this.eventSource = new EventSourcePolyfill(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Id": this.clientId,
      },
      heartbeatTimeout: 180000,
    });

    this.eventSource.onopen = () => {
      console.log("[SessionEvents] SSE 连接已建立");
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SessionEvent;
        this.handleEvent(data);
      } catch (error) {
        console.error("[SessionEvents] 解析事件失败:", error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error("[SessionEvents] SSE 连接错误:", error);
    };
  }

  /**
   * 处理接收到的 SSE 事件
   */
  private handleEvent(event: SessionEvent): void {
    // 广播给所有注册的监听器
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[SessionEvents] 监听器执行失败 (${event.type}):`, error);
        }
      }
    }

    // 同时广播给通配符监听器（监听所有事件）
    const allListeners = this.listeners.get("*");
    if (allListeners) {
      for (const listener of allListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("[SessionEvents] 通配符监听器执行失败:", error);
        }
      }
    }
  }

  /**
   * 注册事件监听器
   * @returns 取消订阅函数
   */
  on(eventType: SessionEventType | "*", listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // 返回取消订阅函数
    return () => {
      const set = this.listeners.get(eventType);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(eventType);
        }
      }
    };
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}
