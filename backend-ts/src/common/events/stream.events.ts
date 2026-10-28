import { SessionEvent } from "../../modules/chat/session-events.service";
import type { UserQueueSnapshot } from "../../modules/chat/user-input-queue.service";

/**
 * 会话流状态改变事件（内部模块间使用）
 *
 * 事件名：stream.status_changed
 * 统一表达"会话是否在工作"的生命周期状态,取代旧 stream.started/stream.finished 两事件。
 * status=running 表示流开始;completed/user_cancel/error 表示流结束。
 */
export interface StreamStatusChangedEvent {
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
  content: string;
  source: Record<string, any>;
}

/**
 * 用户输入队列快照变化（内部模块间使用）
 *
 * 事件名：chat.user_queue_changed
 * payload 为全量快照；前端整块替换，不做增量。
 */
export interface UserQueueChangedEvent {
  sessionId: string;
  timestamp: string;
  source?: string;
  payload: UserQueueSnapshot;
}

/**
 * 待办更新事件（内部模块间使用）
 *
 * 事件名：todo.updated
 */
export interface TodoUpdatedEvent {
  sessionId: string;
  timestamp: string;
  source?: string;
}

/**
 * 机器人运行状态变化事件（内部模块间使用）
 *
 * 事件名：bot.status_changed
 *
 * BotInstanceManager 在生命周期状态迁移点发射（connecting/connected/reconnecting/
 * stopped/error）。前端据此即时更新侧栏状态点与 lastError，不必等会话列表轮询。
 */
export interface BotStatusChangedEvent {
  botId: string;
  timestamp: string;
  /** 管理器生命周期状态（BotRuntimeStatus：connecting/connected/reconnecting/stopped） */
  runtimeStatus: string;
  /** 持久化/UI 状态（running/connecting/stopped/error）；重连中不改写，避免与落盘值漂移 */
  status?: string;
  /** 重连耗尽落盘的错误信息（如 fetch failed），侧栏 tooltip 展示 */
  lastError?: string | null;
  /** 触发原因，便于排查：start/connect/disconnect/reconnect/cleanup/exhausted */
  reason?: string;
}

/**
 * 机器人配置变化事件（内部模块间使用）
 *
 * 事件名：bot.changed
 *
 * BotAdminService 在 create/update/delete/reorder 成功后发射，用于多窗口同步。
 */
export interface BotChangedEvent {
  /** 变更的机器人；reorder 这类批量动作可留空（前端收到即全量重拉） */
  botId?: string;
  timestamp: string;
  action: "created" | "updated" | "deleted" | "reordered";
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
    | UserQueueChangedEvent,
): SessionEvent {
  return {
    type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    source: event.source,
    payload: "payload" in event ? event.payload : undefined,
  };
}
