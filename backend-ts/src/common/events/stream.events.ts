import { SessionEvent } from "../../modules/chat/session-events.service";

/**
 * 会话流状态改变事件（内部模块间使用）
 *
 * 事件名：stream.status_changed
 * 统一表达"会话是否在工作"的生命周期状态,取代旧 stream.started/stream.finished 两事件。
 * status=running 表示流开始;completed/user_cancel/error 表示流结束。
 */
export interface StreamStatusChangedEvent {
  /** @deprecated 单账户模型下无意义；保留字段仅为兼容既有订阅方 */
  userId?: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    status: "running" | "completed" | "user_cancel" | "error";
    // running 时
    messageId?: string;
    replaceTurnId?: string | null;
    session?: any;
    // 结束态时
    reason?: "completed" | "user_cancel" | "error";
    workspacePath?: string;
    sessionType?: string;
    error?: string;
    /** 流类型：chat=对话回合；maintenance=维护任务（手动压缩伪流）。缺省按 chat 处理 */
    kind?: "chat" | "maintenance";
  };
}

/**
 * 会话创建事件（内部模块间使用）
 *
 * 事件名：session.created
 */
export interface SessionCreatedEvent {
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
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
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
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
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
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
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
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
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: {
    subSessionId: string;
    /** 停止原因（对齐 SubAgentStopReason：completed/aborted/error/max_tokens/refusal/closed） */
    stopReason?: string;
    /** 结果摘要（截断 200 字符；仅 one_shot 自动清理时携带） */
    content?: string;
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
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
  content: string;
  source: Record<string, any>;
}

/**
 * 待办更新事件（内部模块间使用）
 *
 * 事件名：todo.updated
 */
export interface TodoUpdatedEvent {
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
  sessionId: string;
  timestamp: string;
  source?: string;
}

/**
 * 后台进程列表变化事件（内部模块间使用）
 *
 * 事件名：process.changed
 * 由 ProcessManagerService 在进程转后台/结束/移除时发射，
 * 前端 OverviewPanel 收到后重新拉取运行中进程列表。
 */
export interface ProcessChangedEvent {
  /** @deprecated 单账户模型下无意义 */
  userId?: string;
  sessionId: string;
  timestamp: string;
  source?: string;
}

/**
 * 将内部事件转换为 SSE 事件格式
 */
export function toSessionEvent(
  type: SessionEvent["type"],
  event:
    | StreamStatusChangedEvent
    | SessionCreatedEvent
    | SessionUpdatedEvent
    | SessionDeletedEvent
    | SubAgentCreatedEvent
    | SubAgentClosedEvent
    | TodoUpdatedEvent
    | ProcessChangedEvent,
): SessionEvent {
  return {
    type,
    userId: event.userId,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    source: event.source,
    payload: "payload" in event ? event.payload : undefined,
  };
}
