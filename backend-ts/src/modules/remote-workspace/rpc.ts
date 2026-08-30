/**
 * JSON-RPC client over WebSocket.
 *
 * Protocol:
 * - Request:  { id, method, params }
 * - Response: { id, result?, error? }
 * - Push:     { event, data }
 */

import WebSocket from "ws";

export interface RPCRequest {
  id: string;
  method: string;
  params?: any;
}

export interface RPCResponse {
  id: string;
  result?: any;
  error?: string;
}

export interface PushEvent {
  event: string;
  data: any;
}

/** 心跳配置:intervalMs 心跳间隔,deadlineMs 超过该时长无任何消息即判死 */
export interface HeartbeatOptions {
  intervalMs?: number;
  deadlineMs?: number;
}

export class RpcClient {
  private ws: WebSocket;
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private pushHandlers = new Map<string, (data: any) => void>();
  private msgId = 0;
  private connected = false;
  private disconnectHandlers: Array<() => void> = [];
  private heartbeat: { intervalMs: number; deadlineMs: number };
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = 0;

  constructor(ws: WebSocket, heartbeat?: HeartbeatOptions) {
    this.ws = ws;
    this.heartbeat = {
      intervalMs: heartbeat?.intervalMs ?? 60_000,
      deadlineMs: heartbeat?.deadlineMs ?? 180_000,
    };
    this.ws.on("message", (raw: WebSocket.RawData) => {
      // 任何消息到达都视为连接活跃(含心跳响应)
      this.lastActivity = Date.now();
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== undefined) {
          // Response to a request
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
        } else if (msg.event !== undefined) {
          // Push event
          if (msg.event === "shutdown") {
            // agent 进程退出前广播:立即拒绝所有挂起请求并通知断开,
            // 避免"agent 被信号杀死"时对未完成请求无限等待
            for (const [, { reject }] of this.pending) {
              reject(new Error("Agent shutting down"));
            }
            this.pending.clear();
            for (const handler of this.disconnectHandlers) {
              try {
                handler();
              } catch {}
            }
            return;
          }
          const handler = this.pushHandlers.get(msg.event);
          if (handler) handler(msg.data);
        }
      } catch (err) {
        // ignore parse errors
      }
    });

    this.ws.on("close", () => {
      this.connected = false;
      this.stopHeartbeat();
      for (const [, { reject }] of this.pending) {
        reject(new Error("WebSocket closed"));
      }
      this.pending.clear();
      // 通知断开(供上层清理缓存/重建连接)
      for (const handler of this.disconnectHandlers) {
        try {
          handler();
        } catch {}
      }
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * 注册断开回调:WebSocket 关闭时触发。
   * 用于上层(RemoteAgentManager)清理失效缓存,使下次调用自动重建连接。
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  setConnected(): void {
    this.connected = true;
    this.startHeartbeat();
  }

  /** 启动心跳:定时发 ping 探测 + 检查超时判死(半开连接检测) */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.lastActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.heartbeat.intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private checkHeartbeat(): void {
    // 1) 发心跳 ping(不挂 pending,响应到达会更新 lastActivity)
    try {
      const pingReq: RPCRequest = { id: `hb-${++this.msgId}`, method: "ping" };
      this.ws.send(JSON.stringify(pingReq));
    } catch {
      /* ws 已关闭 */
    }
    // 2) 判死:超过 deadlineMs 无任何消息(含心跳响应)→ 主动断开
    //    触发 close → pending reject → onDisconnect → 上层清理缓存 + 下次调用自动重建
    if (Date.now() - this.lastActivity > this.heartbeat.deadlineMs) {
      try {
        this.ws.close();
      } catch {}
    }
  }

  call<T = any>(
    method: string,
    params?: any,
    signal?: AbortSignal,
    timeoutMs?: number,
    requestId?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // 支持调用方自定义 requestId(用于 abort/超时后可预测的日志路径)
      const id = requestId || `r${++this.msgId}`;
      this.pending.set(id, { resolve, reject });
      const req: RPCRequest = { id, method, params };

      // 超时兜底:响应未达时主动失败,避免无限挂起(如命令早完成但响应丢失)
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(new Error(`RPC timeout after ${timeoutMs}ms: ${method}`));
        }, timeoutMs);
      }

      // abort 支持:调用方取消时移除 pending、以 AbortError 拒绝,
      // 并通知远端 agent 终止对应前台命令(requestId = 本次 call 的 id)
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(new DOMException("RPC call aborted", "AbortError"));
        try {
          const cancelReq: RPCRequest = {
            id: `cancel-${id}`,
            method: "cancel",
            params: { requestId: id },
          };
          this.ws.send(JSON.stringify(cancelReq));
        } catch {
          /* ws 可能已关闭,忽略 */
        }
      };
      if (signal) {
        if (signal.aborted) {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          reject(new DOMException("RPC call aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        // 请求完成时清理监听
        const origReject = reject;
        reject = (e: any) => {
          if (timer) clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          origReject(e);
        };
      }

      this.ws.send(JSON.stringify(req), (err) => {
        if (err) {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        }
      });
    });
  }

  onPush(event: string, handler: (data: any) => void): void {
    this.pushHandlers.set(event, handler);
  }

  offPush(event: string): void {
    this.pushHandlers.delete(event);
  }

  close(): void {
    this.stopHeartbeat();
    this.ws.close();
  }
}
