import type {
  ClientTerminalMessage,
  ServerTerminalMessage,
} from "@/types/terminal.types";
import { apiService } from "@/services/ApiService";

/** 终端事件监听器 */
export type TerminalEventListener = (msg: ServerTerminalMessage) => void;

export interface TerminalSocketOptions {
  terminalId?: string;
  /** 初始列数：随 URL 传给后端 spawn PTY，避免 PTY 以 80×24 默认值启动导致几何错位 */
  cols?: number;
  /** 初始行数：同上 */
  rows?: number;
  onTerminalId?: (terminalId: string) => void;
}

/**
 * 终端 WebSocket 服务（原生 WebSocket，双向通信）
 *
 * 协议：
 *  客户端 → 服务端：input / resize / close
 *  服务端 → 客户端：transcript / output / exit / error
 *
 * 自动重连（页面刷新/后端重启），最大重试 5 次。
 */
export class TerminalSocketService {
  private ws: WebSocket | null = null;
  private listeners: Set<TerminalEventListener> = new Set();
  private statusListeners: Set<(s: "connecting" | "open" | "closed") => void> =
    new Set();
  private reconnectAttempts = 0;
  private maxReconnect = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string | null = null;
  private shouldReconnect = true;
  private terminalId: string | undefined;
  private onTerminalId: ((terminalId: string) => void) | undefined;
  /** connect() 的固定参数（token/会话/初始几何）；URL 在每次 open 前按当前 terminalId 重建 */
  private connectParams: {
    token: string;
    sessionId: string;
    cols?: number;
    rows?: number;
  } | null = null;

  /**
   * 获取终端 WS URL（不含 query），区分 Electron(file:) 与 Web(http/https)
   *
   * Electron 下后端端口是**动态**的（打包版随机分配，只有 dev 恰好固定 3000），
   * 必须复用 ApiService 已解析的后端地址 —— 写死 localhost:3000 会让打包版终端连不上
   * （WS 打到空端口，后端日志里连一条终端连接都看不到）。
   */
  private getWsUrl(): string {
    if (typeof window === "undefined") return "";

    // Electron：从 ApiService 的 baseURL 推导（http://localhost:<动态端口>/api/v1）
    if (window.electronAPI !== undefined && apiService?.baseURL) {
      try {
        const base = new URL(apiService.baseURL, window.location.href);
        const proto = base.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${base.host}/api/v1/terminal/ws`;
      } catch {
        /* baseURL 异常：退回下面的默认分支 */
      }
    }

    if (window.location.protocol === "file:") {
      // Electron 但 baseURL 尚未就绪：保持默认端口，靠 connect() 的端口等待 + 自动重连兜底
      return "ws://localhost:3000/api/v1/terminal/ws";
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/api/v1/terminal/ws`;
  }

  connect(token: string, sessionId: string, options: TerminalSocketOptions = {}): void {
    this.shouldReconnect = true;
    this.terminalId = options.terminalId;
    this.onTerminalId = options.onTerminalId;
    this.connectParams = {
      token,
      sessionId,
      cols: options.cols,
      rows: options.rows,
    };
    // Electron 下端口解析是异步的：先确保 baseURL 就绪再建连，避免抢在默认 3000 上
    void apiService
      .ensureBackendUrlReady()
      .catch(() => {})
      .finally(() => {
        if (this.shouldReconnect) this.open();
      });
  }

  /**
   * 用**当前** terminalId 重建 WS URL（每次 open 前调用，不复用注册时的快照）。
   * 重连时必须重建：ready 帧可能已把 terminalId 换成新 id（例如后端重启后旧 id 已失效、
   * 服务端新建了终端并回填新 id），沿用旧 query 会拿已死的 id 反复请求 —— 服务端每次都
   * 走新建分支 spawn PTY，几次就把 3 个/会话的配额打满。
   */
  private buildUrl(): void {
    const p = this.connectParams;
    if (!p) {
      this.url = null;
      return;
    }
    const params = new URLSearchParams({ token: p.token, sessionId: p.sessionId });
    if (this.terminalId) params.set("terminalId", this.terminalId);
    // 初始几何：后端 spawn 时按此尺寸创建 PTY（仅新建时生效，恢复 orphan 时由 resize 消息同步）
    if (p.cols && p.cols > 0) params.set("cols", String(Math.floor(p.cols)));
    if (p.rows && p.rows > 0) params.set("rows", String(Math.floor(p.rows)));
    this.url = `${this.getWsUrl()}?${params.toString()}`;
  }

  private open(): void {
    this.buildUrl();
    if (!this.url) return;
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
    };

    ws.onmessage = (e) => {
      try {
        const msg: ServerTerminalMessage = JSON.parse(e.data);
        if (msg.type === "ready") {
          this.terminalId = msg.terminalId;
          this.onTerminalId?.(msg.terminalId);
        }
        this.emit(msg);
        // 退出/错误后停止重连
        if (msg.type === "exit") {
          this.shouldReconnect = false;
        }
      } catch {
        /* ignore 非 JSON 帧 */
      }
    };

    ws.onclose = () => {
      this.setStatus("closed");
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnect) {
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => this.open(), 1000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  /** 发送输入（原始文本） */
  input(text: string): void {
    this.send({ type: "input", text });
  }

  /** 发送 resize */
  resize(cols: number, rows: number): void {
    this.send({ type: "resize", cols, rows });
  }

  /** 关闭终端：通知后端销毁 PTY 并断开 WS */
  close(): void {
    this.shouldReconnect = false;
    // 发送 close 消息通知后端销毁 PTY
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "close" }));
    }
    this.disconnect();
  }

  /** 断开 WS（不通知后端，用于页面刷新/会话切换） */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: ClientTerminalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** 订阅终端消息 */
  onMessage(fn: TerminalEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 订阅连接状态 */
  onStatus(fn: (s: "connecting" | "open" | "closed") => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emit(msg: ServerTerminalMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  private setStatus(s: "connecting" | "open" | "closed"): void {
    for (const fn of this.statusListeners) fn(s);
  }
}

/** 单例 */
export const terminalSocket = new TerminalSocketService();
