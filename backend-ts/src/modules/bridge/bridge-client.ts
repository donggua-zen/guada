/**
 * Backend ↔ Electron 通用通信客户端
 *
 * 使用 Named Pipe (Windows) / Unix Domain Socket (Unix) 连接 Electron 进程。
 * 协议：JSON Line-Delimited。
 *
 * 用法：
 *   const result = await bridgeClient.request("browser_navigate", { url: "..." });
 *   bridgeClient.emit("port_ready", { port: 3000 });
 *   bridgeClient.on("some_event", (data) => { ... });
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import * as net from "net";
import { EventEmitter } from "events";

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (r: any) => void;
  timeout: NodeJS.Timeout;
}

@Injectable()
export class BridgeClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BridgeClient.name);
  private socket: net.Socket | null = null;
  private connected = false;
  private authenticated = false;
  private pipePath = "";
  private token = "";
  private buffer = "";
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private eventEmitter = new EventEmitter();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 15000;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  onModuleInit() {
    this.pipePath = process.env.GUADA_BRIDGE_PATH || "";
    this.token = process.env.GUADA_BRIDGE_TOKEN || "";

    if (!this.pipePath) {
      this.logger.warn("GUADA_BRIDGE_PATH not set, BridgeClient disabled");
      this.readyResolve();
      return;
    }

    this.connect();
  }

  onModuleDestroy() {
    // 取消重连定时器，防止 app.close() 期间反复创建新 socket
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 销毁当前 socket
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  /**
   * 等待连接就绪
   */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * 连接 Electron BridgeServer
   */
  private connect(): void {
    this.logger.log(`Connecting to bridge: ${this.pipePath}`);

    this.socket = net.connect(this.pipePath);

    this.socket.on("connect", () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.logger.log("Bridge socket connected, authenticating...");

      // 发送鉴权消息
      this.send({ type: "auth", token: this.token });

      // 服务端不回确认消息，连接成功即视为就绪
      if (!this.authenticated) {
        this.authenticated = true;
        this.readyResolve();
        this.logger.log("Bridge authenticated and ready");
      }
    });

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch (err) {
          this.logger.error("Failed to parse bridge message:", err);
        }
      }
    });

    this.socket.on("close", () => {
      this.connected = false;
      this.authenticated = false;
      this.logger.warn("Bridge socket closed");
      this.scheduleReconnect();
    });

    this.socket.on("error", (err) => {
      this.logger.error("Bridge socket error:", err.message);
      // close 事件会触发重连
    });
  }

  /**
   * 自动重连，指数退避
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    this.logger.log(`Reconnecting in ${Math.round(delay)}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * 处理来自 Electron 的消息
   */
  private handleMessage(msg: any): void {
    if (msg.type === "response") {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (msg.type === "event") {
      // 首条鉴权成功后 Electron 可能不发确认，用连接成功即视为 authenticated
      if (!this.authenticated) {
        this.authenticated = true;
        this.readyResolve();
        this.logger.log("Bridge authenticated and ready");
      }
      this.eventEmitter.emit(msg.event, msg.data);
    }
  }

  /**
   * 发送请求并等待响应
   */
  async request(method: string, params: any, abortSignal?: AbortSignal): Promise<any> {
    if (!this.connected || !this.socket) {
      throw new Error("Bridge not connected");
    }

    const id = String(++this.requestCounter);

    // 超时内 reject 需要引用
    let reject!: (r: any) => void;
    const promise = new Promise<any>((resolve, rj) => {
      reject = rj;
      this.pending.set(id, { resolve, reject: rj, timeout: null as any });
    });

    // 超时定时器
    const timeout = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`Bridge request timeout: ${method}`));
    }, 120000);
    // 更新 pending 中的 timeout 引用
    this.pending.get(id)!.timeout = timeout;

    // abort 支持
    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeout);
        this.pending.delete(id);
        throw new Error(`Aborted: ${method}`);
      }
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timeout);
        if (this.pending.delete(id)) {
          reject(new Error(`Aborted: ${method}`));
        }
      }, { once: true });
    }

    this.send({ type: "request", id, method, params });
    return promise;
  }

  /**
   * 发送事件（单向，无需响应）
   */
  emit(event: string, data: any): void {
    if (!this.connected || !this.socket) {
      this.logger.warn(`Cannot emit "${event}": bridge not connected`);
      return;
    }
    this.send({ type: "event", event, data });
  }

  /**
   * 监听事件
   */
  on(event: string, callback: (data: any) => void): void {
    this.eventEmitter.on(event, callback);
  }

  /**
   * 底层发送
   */
  private send(msg: any): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(JSON.stringify(msg) + "\n");
    }
  }
}
