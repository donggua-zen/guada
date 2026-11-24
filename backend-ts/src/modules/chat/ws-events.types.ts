/**
 * 实时事件 WebSocket 协议（前后端共用的形状说明）。
 *
 * 替代原先的两条 SSE（会话流 + workspace 流）：一条物理 WebSocket，
 * 客户端用 watch/unwatch 声明关注哪些会话，服务端按会话裁剪内容帧；
 * 跨会话信号（审批/询问、workflow 进度、压缩失败）仍广播。
 */
import type { SessionEvent } from "./session-events.service";
import type { UnifiedEvent } from "../../common/events/unified-event.types";
import type { FileChangeEvent } from "../../common/services/workspace-watcher.service";

/** WS 端点（挂在 HTTP server 上，路径含全局前缀） */
export const WS_EVENTS_PATH = "/api/v1/events/ws";
/** 握手子协议：客户端在 Sec-WebSocket-Protocol 里同时给出协议名与 bearer token */
export const WS_EVENTS_PROTOCOL = "guada.events.v1";
export const WS_BEARER_PROTOCOL_PREFIX = "bearer.";

export type WsWatchScope = "file" | "git";

export type WsClientMessage =
  | { kind: "watch"; sessionIds: string[] }
  | { kind: "unwatch"; sessionIds: string[] }
  | {
      kind: "open";
      requestId: string;
      sessionId: string;
      turns?: number;
      beforeSeq?: number;
    }
  | {
      kind: "workspace/watch";
      sessionId: string;
      scopes: WsWatchScope[];
      enabled?: boolean;
    }
  | { kind: "ping"; ts?: number };

export interface WsEventMessage {
  kind: "event";
  /** UnifiedEvent（stream/*）或裸 SessionEvent */
  data: UnifiedEvent | SessionEvent;
}

export interface WsWorkspaceMessage {
  kind: "workspace";
  data: FileChangeEvent;
}

export interface WsSnapshotMessage {
  kind: "snapshot";
  requestId: string;
  payload: {
    requestId: string;
    sessionId: string;
    events: unknown[];
    endSeq: number;
    nextBeforeSeq: number | null;
    hasMore: boolean;
    tail: unknown[];
    bootId: string;
    error?: string;
  };
}

export interface WsAckMessage {
  kind: "ack";
  requestId: string;
  ok: boolean;
  reason?: string;
}

export type WsServerMessage =
  | { kind: "ready"; connectionId: string; protocol: string }
  | WsEventMessage
  | WsWorkspaceMessage
  | WsSnapshotMessage
  | WsAckMessage
  | { kind: "pong"; ts?: number };
