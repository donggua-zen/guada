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

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (raw: WebSocket.RawData) => {
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
          const handler = this.pushHandlers.get(msg.event);
          if (handler) handler(msg.data);
        }
      } catch (err) {
        // ignore parse errors
      }
    });

    this.ws.on("close", () => {
      this.connected = false;
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
  }

  call<T = any>(method: string, params?: any, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `r${++this.msgId}`;
      this.pending.set(id, { resolve, reject });
      const req: RPCRequest = { id, method, params };

      // abort 支持:调用方取消时移除 pending、以 AbortError 拒绝,
      // 并通知远端 agent 终止对应前台命令(requestId = 本次 call 的 id)
      const onAbort = () => {
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
          this.pending.delete(id);
          reject(new DOMException("RPC call aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        // 请求完成时清理监听
        const origReject = reject;
        reject = (e: any) => {
          signal.removeEventListener("abort", onAbort);
          origReject(e);
        };
      }

      this.ws.send(JSON.stringify(req), (err) => {
        if (err) {
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
    this.ws.close();
  }
}
