/**
 * 实时事件客户端（WebSocket）。
 *
 * 一条物理连接承载：会话流帧（stream/*）、会话/宿主事件、workspace 文件事件、
 * 带内历史快照（open → snapshot）。客户端用 watch/unwatch 声明关注的会话，
 * 服务端只下发这些会话的内容帧；跨会话信号（ask/workflow/压缩失败）仍全局广播。
 *
 * 连接监督与旧 SSE 版一致：可见性/网络恢复触发重连、30s watchdog、150s 无活动判死、
 * 指数退避 2s→30s；重连成功后重放 watch 集合。
 */
import { getClientId } from "@/utils/clientId";
import { streamEventHub } from "./StreamEventHub";

export type SessionEventType =
  | "connected"
  | "session_snapshot"
  | "session_created"
  | "session_deleted"
  | "session_cleared"
  | "session_renamed"
  | "session_updated"
  | "stream_status_changed"
  | "user_message_created"
  | "sub_agent_create"
  | "sub_agent_ended"
  | "todo_updated"
  | "goal_updated"
  | "jobs_snapshot"
  | "plugins_changed"
  | "queue_updated"
  | "queues_snapshot"
  | "bot_status_changed"
  | "bot_changed"
  | "scheduler_task_finished";

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  payload?: Record<string, any>;
  source?: string;
}

export type SessionEventListener = (event: SessionEvent) => void;

/** 服务端握手子协议（与 backend ws-events.types.ts 对齐） */
const WS_EVENTS_PROTOCOL = "guada.events.v1";
const WS_BEARER_PREFIX = "bearer.";

const RESUME_RECONNECT_AFTER_HIDDEN_MS = 15_000;
const STALE_ACTIVITY_MS = 150_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MIN_INTERVAL_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;

export class SessionEventsService {
  private ws: WebSocket | null = null;
  private active = false;
  /** 子协议被代理剥离后的兜底：token 改走 query（只尝试一次） */
  private useQueryToken = false;
  /** 握手完成（收到 ready）后才算可接收快照 */
  private ready = false;
  private clientId: string;
  private lastActivityAt = 0;
  private hiddenAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
  private lastReconnectAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleInstalled = false;

  private readonly connectListeners = new Set<() => void>();
  private readonly fatalListeners = new Set<() => void>();
  private readonly workspaceListeners = new Set<(event: any) => void>();
  private listeners: Map<SessionEventType | "*", Set<SessionEventListener>> = new Map();
  private readonly deliveredTerminalIds = new Map<string, string>();

  /** 本连接关注（期望接收内容帧）的会话；重连后重放 */
  private readonly desiredSessions = new Set<string>();

  /** 等待中的带内快照（requestId → waiter） */
  private readonly snapshotWaiters = new Map<
    string,
    {
      resolve: (payload: Record<string, any>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private readonly handleVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }
    const hiddenFor = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = null;
    if (hiddenFor > RESUME_RECONNECT_AFTER_HIDDEN_MS || !this.isConnected()) {
      this.reconnect(`resume after hidden ${Math.round(hiddenFor / 1000)}s`);
    }
  };

  private readonly handleOnline = (): void => {
    if (!this.isConnected() || this.isStale()) {
      this.reconnect("network online");
    }
  };

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    if (event.persisted || !this.isConnected()) {
      this.reconnect("pageshow");
    }
  };

  private readonly runWatchdog = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (!this.isConnected()) {
      this.reconnect("watchdog: connection down");
      return;
    }
    if (this.isStale()) {
      this.reconnect("watchdog: no activity");
    }
  };

  constructor(private getBaseURL: () => string) {
    this.clientId = getClientId();
  }

  getClientId(): string {
    return this.clientId;
  }

  /** 已连接且握手完成（可发送 open 请求） */
  isConnected(): boolean {
    return (
      this.ready &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  // ── 生命周期 ──

  connect(): void {
    this.active = true;
    this.installLifecycleHandlers();
    // 幂等：重复 connect（HMR/重复挂载）先关闭旧 socket，避免双连接
    this.closeSocket();
    this.startConnection();
  }

  /** 主动重建连接（保留业务监听器） */
  reconnect(reason: string): void {
    if (!this.active) return;
    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_MIN_INTERVAL_MS) return;
    this.lastReconnectAt = now;

    console.log(`[SessionEvents] 重建 WS 连接: ${reason}`);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    this.startConnection();
  }

  disconnect(): void {
    this.active = false;
    this.removeLifecycleHandlers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.lastActivityAt = 0;
    this.hiddenAt = null;
    this.deliveredTerminalIds.clear();
    for (const waiter of this.snapshotWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("session events disconnected"));
    }
    this.snapshotWaiters.clear();
    this.listeners.clear();
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* 已关闭 */
      }
    }
  }

  private startConnection(): void {
    if (!this.active) return;

    const token =
      localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    const url = this.buildSocketUrl();
    const protocols =
      token && !this.useQueryToken
        ? [WS_EVENTS_PROTOCOL, `${WS_BEARER_PREFIX}${token}`]
        : [WS_EVENTS_PROTOCOL];

    const ws = new WebSocket(url, protocols);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastActivityAt = Date.now();
      // 真正的可用性以服务端 ready 帧为准（鉴权在握手阶段完成）
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastActivityAt = Date.now();
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handleServerMessage(message);
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      console.error("[SessionEvents] WS 连接错误");
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      // 4401 = 未授权：交由鉴权流程处理，同时按退避重试（token 可能刷新）
      if (event.code === 4401) this.notifyFatal();

      // 子协议握手失败（400/1006）→ 一次性回退到 query token 重试
      const token =
        localStorage.getItem("token") || sessionStorage.getItem("token") || "";
      if (!this.ready && !this.useQueryToken && token) {
        this.useQueryToken = true;
        setTimeout(() => {
          if (this.active && !this.ws) this.startConnection();
        }, 0);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private buildSocketUrl(): string {
    const rawBase = this.getBaseURL() || "/api/v1";
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const url = new URL(
      rawBase.endsWith("/") ? rawBase : `${rawBase}/`,
      origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/events/ws`;
    url.searchParams.set("clientId", this.clientId);
    if (this.useQueryToken) {
      const token =
        localStorage.getItem("token") || sessionStorage.getItem("token") || "";
      if (token) url.searchParams.set("token", token);
    }
    return url.toString();
  }

  private handleServerMessage(message: any): void {
    switch (message?.kind) {
      case "ready":
        this.ready = true;
        this.lastActivityAt = Date.now();
        this.reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
        console.log("[SessionEvents] WS 连接已建立");
        this.replayWatchSet();
        for (const listener of this.connectListeners) {
          try {
            listener();
          } catch (error) {
            console.error("[SessionEvents] onConnected 监听器失败:", error);
          }
        }
        return;
      case "event":
        this.routeEvent(message.data);
        return;
      case "workspace":
        for (const listener of this.workspaceListeners) {
          try {
            listener(message.data);
          } catch (error) {
            console.error("[SessionEvents] workspace 监听器失败:", error);
          }
        }
        return;
      case "snapshot":
        this.settleSnapshot(message);
        return;
      case "ack":
        this.settleAck(message);
        return;
      case "pong":
        return;
      default:
        return;
    }
  }

  private routeEvent(data: any): void {
    if (!data || typeof data !== "object") return;
    if (typeof data.method === "string" && data.method.startsWith("stream/")) {
      streamEventHub.route({
        ...(data.payload || {}),
        sessionId: data.payload?.sessionId,
      });
      return;
    }
    this.handleEvent(data as SessionEvent);
  }

  /** 处理接收到的会话事件（与旧 SSE 版一致：终态入口去重 + 类型分发） */
  private handleEvent(event: SessionEvent): void {
    if (event.type === "session_snapshot") {
      this.settleSnapshot({ ...event.payload, __legacy: true });
    }
    if (event.type === "stream_status_changed") {
      const status = event.payload?.status;
      const terminalId = event.payload?.terminalId;
      if (
        status !== "running" &&
        typeof terminalId === "string" &&
        terminalId.length > 0
      ) {
        if (this.deliveredTerminalIds.get(event.sessionId) === terminalId) {
          return;
        }
        this.deliveredTerminalIds.set(event.sessionId, terminalId);
      }
    }

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
    const allListeners = this.listeners.get("*");
    if (allListeners) {
      for (const listener of allListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("[SessionEvents] 通配符监听器失败:", error);
        }
      }
    }
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
      this.startConnection();
    }, delay);
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
    this.lifecycleInstalled = false;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("pageshow", this.handlePageShow);
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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

  // ── 监听器 ──

  on(
    eventType: SessionEventType | "*",
    callback: SessionEventListener,
  ): () => void {
    if (!this.listeners.has(eventType)) this.listeners.set(eventType, new Set());
    this.listeners.get(eventType)!.add(callback);
    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  onConnected(listener: () => void): () => void {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onConnectionFatal(listener: () => void): () => void {
    this.fatalListeners.add(listener);
    return () => this.fatalListeners.delete(listener);
  }

  onWorkspaceEvent(listener: (event: any) => void): () => void {
    this.workspaceListeners.add(listener);
    return () => this.workspaceListeners.delete(listener);
  }

  // ── watch / 快照 ──

  /** 声明关注某会话（内容帧只下发给关注者）；重连后自动重放 */
  watchSession(sessionId: string): void {
    if (!sessionId || this.desiredSessions.has(sessionId)) return;
    this.desiredSessions.add(sessionId);
    this.send({ kind: "watch", sessionIds: [sessionId] });
  }

  unwatchSession(sessionId: string): void {
    if (!this.desiredSessions.delete(sessionId)) return;
    this.send({ kind: "unwatch", sessionIds: [sessionId] });
  }

  private replayWatchSet(): void {
    if (this.desiredSessions.size === 0) return;
    this.send({ kind: "watch", sessionIds: [...this.desiredSessions] });
  }

  private send(message: unknown): void {
    if (!this.isConnected()) return;
    try {
      this.ws!.send(JSON.stringify(message));
    } catch {
      /* 断线时忽略，重连后由 replayWatchSet 补齐 */
    }
  }

  /** workspace 控制面：设置某会话的订阅范围 */
  setWorkspaceWatch(
    sessionId: string,
    scopes: string[],
    enabled = true,
  ): void {
    this.send({ kind: "workspace/watch", sessionId, scopes, enabled });
  }

  /**
   * 带内历史快照：发送 open，等待 snapshot 帧（超时/被 ack 拒绝则 reject）。
   */
  requestOpen(
    sessionId: string,
    options: { requestId: string; turns?: number; beforeSeq?: number },
    timeoutMs = SNAPSHOT_TIMEOUT_MS,
  ): Promise<Record<string, any>> {
    const { requestId } = options;
    const wait = this.waitForSnapshot(requestId, timeoutMs);
    try {
      this.send({
        kind: "open",
        requestId,
        sessionId,
        turns: options.turns,
        beforeSeq: options.beforeSeq,
      });
    } catch (error) {
      this.cancelSnapshotWait(requestId);
      throw error;
    }
    return wait;
  }

  waitUntilConnected(timeoutMs = 5_000): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let off = (): void => {};
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error("SSE_NOT_CONNECTED"));
      }, timeoutMs);
      off = this.onConnected(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }

  waitForSnapshot<T = Record<string, any>>(
    requestId: string,
    timeoutMs = SNAPSHOT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.snapshotWaiters.delete(requestId);
        reject(new Error("session snapshot timeout"));
      }, timeoutMs);
      this.snapshotWaiters.set(requestId, {
        resolve: resolve as (payload: Record<string, any>) => void,
        reject,
        timer,
      });
    });
  }

  cancelSnapshotWait(requestId: string): void {
    const waiter = this.snapshotWaiters.get(requestId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.snapshotWaiters.delete(requestId);
  }

  private settleSnapshot(message: any): void {
    const requestId = message?.requestId ?? message?.payload?.requestId;
    if (typeof requestId !== "string") return;
    const waiter = this.snapshotWaiters.get(requestId);
    if (!waiter) return;
    this.snapshotWaiters.delete(requestId);
    clearTimeout(waiter.timer);
    const payload = message.payload ?? message;
    const error = payload?.error;
    if (typeof error === "string" && error.length > 0) {
      waiter.reject(new Error(error));
      return;
    }
    waiter.resolve(payload);
  }

  private settleAck(message: any): void {
    if (message?.ok !== false) return;
    const requestId = message?.requestId;
    if (typeof requestId !== "string") return;
    const waiter = this.snapshotWaiters.get(requestId);
    if (!waiter) return;
    this.snapshotWaiters.delete(requestId);
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message.reason || "open rejected"));
  }
}
