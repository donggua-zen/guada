/**
 * Electron ↔ Backend 通用通信服务
 *
 * 使用 Named Pipe (Windows) / Unix Domain Socket (Unix) 替代 IPC + TCP 双模式。
 * 协议：JSON Line-Delimited（每行一条 JSON 消息，\n 分隔）。
 *
 * 消息类型：
 *   { type: "auth", token: "..." }              — 后端连接后首条鉴权消息
 *   { type: "request", id, method, params }     — 请求（后端 → Electron）
 *   { type: "response", id, result?, error? }   — 响应（Electron → 后端）
 *   { type: "event", event, data }              — 事件（双向）
 */

import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";

export interface BridgeMessage {
  type: "auth" | "request" | "response" | "event";
  [key: string]: any;
}

type MethodHandler = (params: any, method: string) => Promise<any>;
type EventCallback = (data: any) => void;

/**
 * 生成跨平台的 pipe/socket 路径
 */
export function generatePipePath(): string {
  const id = crypto.randomBytes(8).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\guada-${id}`;
  }
  return path.join(os.tmpdir(), `guada-${id}.sock`);
}

/**
 * 生成临时鉴权 token
 */
export function generateBridgeToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export class BridgeServer {
  private server: net.Server | null = null;
  private pipePath: string;
  private token: string;
  private handlers = new Map<string, MethodHandler>();
  private defaultHandler: MethodHandler | null = null;
  private eventListeners = new Map<string, Set<EventCallback>>();
  private connections = new Set<net.Socket>();

  constructor(pipePath: string, token: string) {
    this.pipePath = pipePath;
    this.token = token;
  }

  /**
   * 启动 Bridge 服务
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Unix: 清理可能残留的旧 socket 文件
      if (process.platform !== "win32") {
        try {
          const fs = require("fs");
          if (fs.existsSync(this.pipePath)) {
            fs.unlinkSync(this.pipePath);
          }
        } catch {
          // ignore
        }
      }

      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        log.error("BridgeServer error:", err);
        reject(err);
      });

      this.server.listen(this.pipePath, () => {
        log.info(`BridgeServer listening on ${this.pipePath}`);
        resolve();
      });
    });
  }

  /**
   * 停止 Bridge 服务
   */
  async stop(): Promise<void> {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Unix: 清理 socket 文件
    if (process.platform !== "win32") {
      try {
        const fs = require("fs");
        if (fs.existsSync(this.pipePath)) {
          fs.unlinkSync(this.pipePath);
        }
      } catch {
        // ignore
      }
    }

    log.info("BridgeServer stopped");
  }

  /**
   * 注册方法处理器
   */
  registerHandler(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * 注册默认处理器（未匹配到特定 method 时调用）
   */
  registerDefaultHandler(handler: MethodHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * 向所有已鉴权连接广播事件
   */
  broadcast(event: string, data: any): void {
    const msg = JSON.stringify({ type: "event", event, data }) + "\n";
    for (const socket of this.connections) {
      if (!socket.destroyed) {
        socket.write(msg);
      }
    }
  }

  /**
   * 监听来自后端的事件
   */
  onEvent(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * 处理新连接
   */
  private handleConnection(socket: net.Socket): void {
    let authenticated = false;
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留最后不完整的行

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg: BridgeMessage = JSON.parse(line);
          if (!authenticated) {
            if (msg.type === "auth" && msg.token === this.token) {
              authenticated = true;
              this.connections.add(socket);
              log.info("BridgeServer: client authenticated");
            } else {
              log.warn("BridgeServer: auth failed, closing connection");
              socket.destroy();
              return;
            }
          } else {
            this.handleMessage(msg, socket);
          }
        } catch (err) {
          log.error("BridgeServer: failed to parse message:", err);
        }
      }
    });

    socket.on("close", () => {
      this.connections.delete(socket);
      if (authenticated) {
        log.info("BridgeServer: client disconnected");
      }
    });

    socket.on("error", (err) => {
      log.error("BridgeServer: socket error:", err.message);
      this.connections.delete(socket);
    });
  }

  /**
   * 处理已鉴权的消息
   */
  private async handleMessage(msg: BridgeMessage, socket: net.Socket): Promise<void> {
    if (msg.type === "request") {
      const { id, method, params } = msg;
      const handler = this.handlers.get(method) || this.defaultHandler;
      if (!handler) {
        this.send(socket, { type: "response", id, error: `Unknown method: ${method}` });
        return;
      }
      try {
        const result = await handler(params, method);
        this.send(socket, { type: "response", id, result });
      } catch (err: any) {
        this.send(socket, { type: "response", id, error: err.message });
      }
    } else if (msg.type === "event") {
      const listeners = this.eventListeners.get(msg.event);
      if (listeners) {
        for (const cb of listeners) {
          try {
            cb(msg.data);
          } catch (err) {
            log.error("BridgeServer: event listener error:", err);
          }
        }
      }
    }
  }

  /**
   * 发送消息到指定 socket
   */
  private send(socket: net.Socket, msg: any): void {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(msg) + "\n");
    }
  }
}
