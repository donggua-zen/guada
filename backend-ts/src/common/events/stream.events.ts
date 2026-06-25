import { SessionEvent } from "../../modules/chat/session-events.service";

/**
 * 流式输出开始事件（内部模块间使用）
 *
 * 事件名：stream.started
 */
export interface StreamStartedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    messageId?: string;
    replaceMessageId?: string | null;
    session?: any;
  };
}

/**
 * 流式输出完成事件（内部模块间使用）
 *
 * 事件名：stream.finished
 */
export interface StreamFinishedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    reason: "completed" | "user_cancel" | "error";
    workspacePath?: string;
    sessionType?: string;
    error?: string;
  };
}

/**
 * 会话创建事件（内部模块间使用）
 *
 * 事件名：session.created
 */
export interface SessionCreatedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    session: any;
  };
}

/**
 * 会话更新事件（内部模块间使用）
 *
 * 事件名：session.updated
 */
export interface SessionUpdatedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    session: any;
  };
}

/**
 * 会话删除事件（内部模块间使用）
 *
 * 事件名：session.deleted
 */
export interface SessionDeletedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload?: Record<string, any>;
}

/**
 * 子 Agent 创建事件（内部模块间使用）
 *
 * 事件名：subagent.created
 */
export interface SubAgentCreatedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    subSessionId: string;
    name: string;
    mode: string;
    session: any;
  };
}

/**
 * 子 Agent 关闭事件（内部模块间使用）
 *
 * 事件名：subagent.closed
 */
export interface SubAgentClosedEvent {
  userId: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    subSessionId: string;
  };
}

/**
 * 通用消息投递事件（内部模块间使用）
 *
 * 事件名：session.message.enqueue
 * 投递者自行构建完整消息内容，监听者只负责转发到会话消息队列。
 */
export interface EnqueueMessageEvent {
  sessionId: string;
  userId: string;
  content: string;
  source: Record<string, any>;
}

/**
 * 将内部事件转换为 SSE 事件格式
 */
export function toSessionEvent(
  type: SessionEvent["type"],
  event:
    | StreamStartedEvent
    | StreamFinishedEvent
    | SessionCreatedEvent
    | SessionUpdatedEvent
    | SessionDeletedEvent
    | SubAgentCreatedEvent
    | SubAgentClosedEvent,
): SessionEvent {
  return {
    type,
    userId: event.userId,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    source: event.source,
    payload: event.payload,
  };
}
