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
  /** 可选错误码(agent ≥0.5.1，如 invalid_cwd / exec_start_failed)：区分"agent 立即拒绝"与"传输失败" */
  code?: string;
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

/** 错误码:与 agent 端 rpc.go 的 code* 常量对齐(agent 明确拒绝,命令未启动) */
export const AGENT_ERROR_INVALID_CWD = "invalid_cwd";
export const AGENT_ERROR_EXEC_START_FAILED = "exec_start_failed";

/** 错误码:客户端侧传输类失败(命令是否启动未知,输出可能已落 agent 日志) */
export const RPC_ERROR_TIMEOUT = "rpc_timeout";
export const RPC_ERROR_WS_CLOSED = "ws_closed";
export const RPC_ERROR_AGENT_SHUTDOWN = "agent_shutdown";
export const RPC_ERROR_WS_SEND_FAILED = "ws_send_failed";

/**
 * 构造传输类错误:超时/断连/agent 退出时命令可能已在远端启动,
 * 输出可能落在 agent 日志文件里 —— 调用方可提示去查日志。
 * 与"agent 明确拒绝"(命令根本没启动、无日志可读)严格区分。
 */
export function transportError(message: string, code: string): Error {
  const err = new Error(message);
  (err as any).code = code;
  (err as any).transport = true;
  return err;
}

/**
 * 是否为传输类失败(超时/断连/agent 退出)。判定走显式标记,不做文案匹配。
 * 注意:agent 返回的业务错误(如 invalid_cwd)不是传输类——进程未启动,日志必然为空。
 */
export function isTransportError(e: any): boolean {
  return e?.transport === true;
}

/**
 * agent 端不认识该 RPC 方法（远端 agent 版本 < 0.5.0 在线）。
 * 调用方据此走降级路径（glob→find 模拟、readFileRange→downloadChunk、grep→shell grep）。
 */
export function isUnknownMethodError(e: any): boolean {
  return String(e?.message || e).startsWith("unknown method");
}

// ── 传输抽象 ──

/**
 * RPC 传输：把"消息收发 + 关闭通知"从具体通道中剥离，使同一套 RPC 语义
 * （请求/响应匹配、心跳判死、超时兜底、cancel、shutdown 推送）可用于多种通道。
 *
 * 实现：
 * - WsRpcTransport：WebSocket（SSH 部署链路 / devMode 直连）；
 * - StreamRpcTransport：子进程 stdio 管道（容器工作区，`docker exec -i ... --stdio`，
 *   见 rpc-stream-transport.ts）。
 */
export interface RpcTransport {
  /** 传输类型标签，用于错误文案（如 "WebSocket closed" / "stdio pipe closed"） */
  readonly label: string;
  /** 发送一条文本消息；cb 收到错误表示发送失败（消息可能未送达） */
  send(data: string, cb?: (err?: Error) => void): void;
  /** 主动关闭（必须触发 onClose 回调链，让挂起请求被 reject） */
  close(): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: () => void): void;
  /** 传输是否可用（ws OPEN / 子进程存活且管道可写） */
  isOpen(): boolean;
}

/** WebSocket 传输（SSH / devMode 直连的既有通道） */
export class WsRpcTransport implements RpcTransport {
  readonly label = "WebSocket";
  private readonly messageHandlers: Array<(raw: string) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];
  private closed = false;

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw: WebSocket.RawData) => {
      const text = raw.toString();
      for (const h of this.messageHandlers) h(text);
    });
    ws.on("close", () => {
      this.closed = true;
      for (const h of this.closeHandlers) h();
    });
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.ws.send(data, (err) => cb?.(err ?? undefined));
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }
}

export class RpcClient {
  private transport: RpcTransport;
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

  constructor(transport: RpcTransport, heartbeat?: HeartbeatOptions) {
    this.transport = transport;
    this.heartbeat = {
      intervalMs: heartbeat?.intervalMs ?? 60_000,
      deadlineMs: heartbeat?.deadlineMs ?? 180_000,
    };
    this.transport.onMessage((raw: string) => {
      // 任何消息到达都视为连接活跃(含心跳响应)
      this.lastActivity = Date.now();
      try {
        const msg = JSON.parse(raw);
        if (msg.id !== undefined) {
          // Response to a request
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              // agent 明确返回的错误(含可选错误码):命令未启动/操作被拒,不属传输类
              const err = new Error(msg.error);
              if (msg.code) (err as any).code = msg.code;
              pending.reject(err);
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
              reject(transportError("Agent shutting down", RPC_ERROR_AGENT_SHUTDOWN));
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

    this.transport.onClose(() => {
      this.connected = false;
      this.stopHeartbeat();
      for (const [, { reject }] of this.pending) {
        reject(
          transportError(`${this.transport.label} closed`, RPC_ERROR_WS_CLOSED),
        );
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
   * 注册断开回调:传输关闭时触发。
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
      this.transport.send(JSON.stringify(pingReq));
    } catch {
      /* 传输已关闭 */
    }
    // 2) 判死:超过 deadlineMs 无任何消息(含心跳响应)→ 主动断开
    //    触发 close → pending reject → onDisconnect → 上层清理缓存 + 下次调用自动重建
    if (Date.now() - this.lastActivity > this.heartbeat.deadlineMs) {
      try {
        this.transport.close();
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
          reject(
            transportError(
              `RPC timeout after ${timeoutMs}ms: ${method}`,
              RPC_ERROR_TIMEOUT,
            ),
          );
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
          this.transport.send(JSON.stringify(cancelReq));
        } catch {
          /* 传输可能已关闭,忽略 */
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

      this.transport.send(JSON.stringify(req), (err) => {
        if (err) {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          if (signal) signal.removeEventListener("abort", onAbort);
          // 发送失败 = 请求可能未送达,归入传输类(命令是否启动未知)
          const wrapped = transportError(
            String((err as any)?.message || err),
            RPC_ERROR_WS_SEND_FAILED,
          );
          reject(wrapped);
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
    this.transport.close();
  }
}
