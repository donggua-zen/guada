/**
 * 统一事件信封(参考 DSH 的 method+payload 分层)
 *
 * 设计要点:
 * - sessionId 不在信封上,下放到 payload 帧内:会话级帧带、全局帧不带
 * - method 作事件域判别器(命名空间前缀),前端按前缀路由
 * - payload 宽槽 + 业务层按 method 二次解析,扩展不改信封
 * - id 参考 DSH rpcId:会话级事件作续传/去重游标;应答类事件可 echo
 */

/** 事件域判别器:stream/* 流式、session/* 会话状态、subagent/* 子代理、host/* 宿主级全局 */
export const EVENT_METHOD = {
  // ---- 流式事件(带 sessionId) ----
  // 回合级
  STREAM_TURN_START: "stream/turn_start",
  STREAM_TURN_END: "stream/turn_end",
  STREAM_TURN_DELETE: "stream/turn_delete",
  STREAM_USER_MESSAGE: "stream/user_message",
  STREAM_RETRY: "stream/retry",
  STREAM_TOOL_CALLS_RESPONSE: "stream/tool_calls_response",
  // 消息级(规范 StreamChunk 直通,method 与 chunk.type 一一对应)
  STREAM_BLOCK_START: "stream/block_start",
  STREAM_TEXT_DELTA: "stream/text_delta",
  STREAM_REASONING_DELTA: "stream/reasoning_delta",
  STREAM_TOOL_CALL_DELTA: "stream/tool_call_delta",
  STREAM_BLOCK_END: "stream/block_end",
  STREAM_USAGE: "stream/usage",
  STREAM_FINISH: "stream/finish",
  // 引擎级附属
  STREAM_COMPRESSION_START: "stream/compression_start",
  STREAM_COMPRESSION_ERROR: "stream/compression_error",
  STREAM_COMPRESSION_END: "stream/compression_end",
  STREAM_COMPACTION_SUMMARY: "stream/compaction_summary",
  STREAM_ASK_REQUESTED: "stream/ask_requested",
  STREAM_ASK_RESOLVED: "stream/ask_resolved",

  // ---- 会话状态事件(带 sessionId) ----
  SESSION_CREATED: "session/created",
  SESSION_DELETED: "session/deleted",
  SESSION_RENAMED: "session/renamed",
  SESSION_UPDATED: "session/updated",
  SESSION_STREAM_STATUS_CHANGED: "session/stream_status_changed",
  SESSION_USER_MESSAGE_CREATED: "session/user_message_created",
  SESSION_TODO_UPDATED: "session/todo_updated",

  // ---- 子代理事件(带 sessionId) ----
  SUBAGENT_CREATED: "subagent/created",
  SUBAGENT_CLOSED: "subagent/closed",

  // ---- 宿主级全局事件(可无 sessionId) ----
  HOST_PLUGINS_CHANGED: "host/plugins_changed",

  // ---- 心跳 ----
  HEARTBEAT: "heartbeat",
} as const;

export type EventMethod = (typeof EVENT_METHOD)[keyof typeof EVENT_METHOD];

/**
 * 统一事件信封
 *
 * @template P payload 具体类型(默认宽槽,业务层按 method 二次解析)
 */
export interface UnifiedEvent<P = Record<string, any>> {
  /** 事件 ID(参考 DSH rpcId):会话级事件作续传/去重游标;全局事件为一次性 token */
  id: string;
  /** 事件域判别器 */
  method: EventMethod;
  /** 事件时间戳 */
  timestamp: string;
  /** 发起者 clientId(多窗口过滤自身事件,沿用现有 source 语义) */
  source?: string;
  /** 宽槽负载:sessionId 在帧内,全局帧不带 */
  payload: P & { sessionId?: string };
}

/** 生成统一事件信封(纯推送) */
export function createUnifiedEvent<P extends Record<string, any>>(
  method: EventMethod,
  payload: P & { sessionId?: string },
  source?: string,
): UnifiedEvent<P> {
  return {
    id: generateEventId(),
    method,
    timestamp: new Date().toISOString(),
    source,
    payload,
  };
}

/** 事件 ID:rpcId 语义,前缀+随机串 */
export function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
