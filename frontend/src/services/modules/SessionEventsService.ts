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
  | "queues_snapshot"
  | "bot_status_changed"
  | "bot_changed";

/**
 * 会话事件
 */
export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  // 各事件类型的载荷形状互不相同且为后端开放字典（useSessionEvents 等消费方按需深读
  // payload.session/status 等），无法收敛为 Record<string, unknown> 而不改动范围外消费方
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 白名单：动态边界，见上方说明
  payload?: Record<string, any>;
  source?: string;
}

/**
 * 会话事件监听器
 */
type SessionEventListener = (event: SessionEvent) => void;

/** EventSource.CLOSED（不依赖全局 EventSource，便于单测） */
const READY_STATE_CLOSED = 2;

/** 页面隐藏超过该时长后恢复可见，主动重建连接（手机息屏/切后台后连接可能已半开） */
const RESUME_RECONNECT_AFTER_HIDDEN_MS = 15_000;
/** 超过该时长没有任何字节（后端心跳 90s）判定连接假死 */
const STALE_ACTIVITY_MS = 150_000;
/** 可见状态下的假死巡检间隔 */
const WATCHDOG_INTERVAL_MS = 30_000;
/** polyfill 放弃重试（CLOSED）后的手动重连退避 */
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
/** 连续恢复事件（visibility + online 同时触发）去抖 */
const RECONNECT_MIN_INTERVAL_MS = 1_000;

/**
 * 用户级会话事件服务
 *
 * 通过 SSE 长连接接收后端推送的会话事件，替代轮询机制。
 *
 * 连接监督（移动端息屏恢复的关键）：
 * - 页面恢复可见 / 网络恢复 / bfcache 恢复时主动检查并重建连接；
 * - 30s 巡检：连接 CLOSED 或长时间无任何消息（假死）时重建；
 * - polyfill 因非 200（如 token 过期 401）进入 CLOSED 后不会自行重试，
 *   这里按退避手动重连，并通知上层做鉴权兜底。
 */
import { EventSourcePolyfill } from "event-source-polyfill";
import { getClientId } from "@/utils/clientId";
import { streamEventHub } from "./StreamEventHub";

export class SessionEventsService {
  private eventSource: EventSourcePolyfill | null = null;
  /** （重）建连监听器（补拉挂起状态用） */
  private readonly connectListeners = new Set<() => void>();
  /** 连接被判死（polyfill CLOSED，常见于 401/HTTP 错误）时通知上层 */
  private readonly fatalListeners = new Set<() => void>();
  private listeners: Map<SessionEventType | "*", Set<SessionEventListener>> =
    new Map();
  private clientId: string;

  /** 是否处于期望连接状态（disconnect 后为 false，阻止定时器复活连接） */
  private active = false;
  /** 最后一次收到任何字节的时间（含心跳） */
  private lastActivityAt = 0;
  /** 页面进入隐藏的时刻 */
  private hiddenAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  private lastReconnectAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleInstalled = false;

  private readonly handleVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }
    const hiddenFor = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = null;
    if (hiddenFor > RESUME_RECONNECT_AFTER_HIDDEN_MS || this.isConnectionDown()) {
      this.reconnect(`resume after hidden ${Math.round(hiddenFor / 1000)}s`);
    }
  };

  private readonly handleOnline = (): void => {
    if (this.isConnectionDown() || this.isStale()) {
      this.reconnect("network online");
    }
  };

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    if (event.persisted || this.isConnectionDown()) {
      this.reconnect("pageshow");
    }
  };

  private readonly runWatchdog = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return; // 后台时定时器本就会被节流，恢复可见时另有钩子
    }
    if (this.isConnectionDown()) {
      this.reconnect("watchdog: connection down");
      return;
    }
    if (this.isStale()) {
      this.reconnect("watchdog: no activity");
    }
  };

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

  /** （重）建连监听（返回取消订阅函数） */
  onConnected(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  /** 连接被判死（polyfill 不再重试）时通知；用于触发一次鉴权校验 */
  onConnectionFatal(listener: () => void): () => void {
    this.fatalListeners.add(listener);
    return () => this.fatalListeners.delete(listener);
  }

  /**
   * 连接到事件流
   * 后端通过 token 鉴权，前端无需传递身份信息
   */
  connect(): void {
    this.active = true;
    this.installLifecycleHandlers();
    // 注意：不能调用 disconnect()——它会清空业务监听器
    const previous = this.eventSource;
    this.eventSource = null;
    if (previous) {
      try {
        previous.close();
      } catch {
        /* 已关闭 */
      }
    }
    this.startConnection();
  }

  /** 主动重建连接（保留业务监听器） */
  reconnect(reason: string): void {
    if (!this.active) return;
    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_MIN_INTERVAL_MS) return;
    this.lastReconnectAt = now;

    console.log(`[SessionEvents] 重建 SSE 连接: ${reason}`);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const previous = this.eventSource;
    this.eventSource = null;
    if (previous) {
      try {
        previous.close();
      } catch {
        /* 已关闭 */
      }
    }
    this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    this.startConnection();
  }

  private startConnection(): void {
    if (!this.active) return;

    const token =
      localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const url = `${this.getBaseURL()}/events/sessions`;

    const source = new EventSourcePolyfill(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Client-Id": this.clientId,
      },
      heartbeatTimeout: 180000,
    });
    this.eventSource = source;

    source.onopen = () => {
      if (this.eventSource !== source) return;
      this.lastActivityAt = Date.now();
      this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
      console.log("[SessionEvents] SSE 连接已建立");
      // （重）建连通知：订阅方据此补拉状态（如挂起中的交互卡——ask_requested 是流帧，
      // 刷新/丢帧后拿不到，历史重放又刻意不重建）。只补写、不清空，同进程重连安全。
      for (const listener of this.connectListeners) {
        try {
          listener();
        } catch (error) {
          console.error("[SessionEvents] onConnected 监听器失败:", error);
        }
      }
    };

    source.onmessage = (event) => {
      if (this.eventSource !== source) return;
      this.lastActivityAt = Date.now();
      try {
        const data = JSON.parse(event.data);
        // 合并后:流式事件(UnifiedEvent,method 以 stream/ 开头)路由到 StreamEventHub
        if (data?.method && typeof data.method === "string" && data.method.startsWith("stream/")) {
          streamEventHub.route({
            ...(data.payload || {}),
            sessionId: data.payload?.sessionId,
          });
          return;
        }
        this.handleEvent(data as SessionEvent);
      } catch (error) {
        console.error("[SessionEvents] 解析事件失败:", error);
      }
    };

    source.onerror = (error) => {
      if (this.eventSource !== source) return;
      console.error("[SessionEvents] SSE 连接错误:", error);
      // polyfill 对网络错误会自行退避重连（readyState=CONNECTING）；
      // 只有 CLOSED（非 200，如 401/403）才需要应用层接管，否则永久失联。
      if (source.readyState === READY_STATE_CLOSED) {
        this.notifyFatal();
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.active) return;
      this.reconnect("scheduled retry");
    }, delay);
  }

  private notifyFatal(): void {
    for (const listener of this.fatalListeners) {
      try {
        listener();
      } catch (error) {
        console.error("[SessionEvents] fatal 监听器失败:", error);
      }
    }
  }

  private isConnectionDown(): boolean {
    if (!this.eventSource) return true;
    const state = this.eventSource.readyState;
    return state === READY_STATE_CLOSED;
  }

  private isStale(): boolean {
    return (
      this.lastActivityAt > 0 &&
      Date.now() - this.lastActivityAt > STALE_ACTIVITY_MS
    );
  }

  private installLifecycleHandlers(): void {
    if (this.lifecycleInstalled || typeof window === "undefined") return;
    this.lifecycleInstalled = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("pageshow", this.handlePageShow);
    this.watchdogTimer = setInterval(this.runWatchdog, WATCHDOG_INTERVAL_MS);
  }

  private removeLifecycleHandlers(): void {
    if (!this.lifecycleInstalled) return;
    this.lifecycleInstalled = false;
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("pageshow", this.handlePageShow);
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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
          console.error(
            `[SessionEvents] 监听器执行失败 (${event.type}):`,
            error,
          );
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
  on(eventType: SessionEventType | "*", listener: SessionEventListener): () => void {
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
    this.active = false;
    this.removeLifecycleHandlers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.lastActivityAt = 0;
    this.hiddenAt = null;
    this.listeners.clear();
  }
}
