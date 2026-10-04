/**
 * 会话流内事件（判别联合）—— 前端本地定义
 *
 * 与后端 backend-ts/src/modules/chat/types/event-chunk.types.ts 逐字段同构
 * （命名/判别字面量/字段结构一致）——SSE 流协议的事件载体。
 *
 * 两层结构：
 * - 回合级事件（turn_start/turn_resume/turn_end/turn_delete）：只描述回合生命周期，
 *   绝不携带任何 Message 字段（messageId/content 等一律禁止）
 * - 消息级事件（StreamChunk 直通 + user_message/tool_calls_response）：
 *   携带 messageId 关联所属 assistant 消息，消息内容完全由这一层承载
 *
 * 传输层信封：WireStreamEvent = SessionStreamEvent & { sessionId?, prevSeq? }
 * （chat-runner 注入 prevSeq 续传游标，session-events 注入 sessionId 后经 SSE 下发）
 *
 * 迁移说明：将来做前后端共享包时，本文件整体搬入 packages/shared/src/stream/，
 * 消费方 import 路径从 "@/types/stream" 改为 "@guada/shared" 即可（零成本迁移）。
 */

import type { StreamChunk, StreamUsage } from "./stream-chunk.types";
import type { ContentBlock } from "./content-block.types";

// ==================== 回合级事件 ====================

/** 回合开始（正常流）：只携带回合外壳信息 */
export interface TurnStartEvent {
  type: "turn_start";
  turnId: string;
  modelName?: string;
}

/** 回合结束：回合级收尾信号（finishReason/error/usage/耗时/contextStats），不带消息内容 */
export interface TurnEndEvent {
  type: "turn_end";
  /** 收尾回合外壳 id（前端据此精确复位回合工作态） */
  turnId?: string;
  finishReason?: string;
  error?: string;
  usage?: StreamUsage;
  /**
   * 整轮耗时 ms（后端 finalizeTurn 落库于 turn/finish 事件，SSE 同步广播）。
   * 写入 turn.metadata.totalDurationMs，供结束后的耗时展示与刷新重放复用。
   */
  totalDurationMs?: number;
  /** 会话上下文统计（前端用于更新上下文使用率环形指示器） */
  contextStats?: {
    usedTokens: number;
    effectiveContextWindow: number;
  };
  /**
   * 回合模型名：live 广播不带此字段；由领域事件 turn/finish 映射而来的 turn_end 会带上
   * （折叠器统一按可选字段读取）。
   */
  modelName?: string;
}

/** 回合删除（重答）：从视图直接移除该回合 */
export interface TurnDeleteEvent {
  type: "turn_delete";
  turnId: string;
}

// ==================== 消息级事件 ====================

/**
 * 后端三层 Message 的线上镜像（user_message 广播载荷）。
 * 与 types/message.ts 的展示型 Message 不同层：content 是 ContentBlock[]（后端块协议）。
 */
export interface WireMessage {
  id: string;
  /** 与前端 MessageRole 同域：system 消息不进流广播 */
  role: "user" | "assistant" | "tool" | "event";
  kind?: "user" | "model";
  /** 消息来源（判断"是不是人说的话"的单一真相） */
  source?: { kind: string; [key: string]: unknown };
  metadata: Record<string, unknown>;
  content: ContentBlock[];
  /** Unix 毫秒时间戳（replayer 从事件 time 还原） */
  createdAt?: number;
}

/** 用户消息入库广播（携带三层 userMessage 对象） */
export interface UserMessageEvent {
  type: "user_message";
  messageId?: string;
  turnId?: string;
  userMessage: WireMessage;
}

/** LLM 流重试信号（引擎级，非模型输出）——轮次级瞬态，前端挂 turn.state.retry（不落库） */
export interface RetryEvent {
  type: "retry";
  /** 所属回合外壳 id（retry 是回合级瞬态，与 isWorking 同层） */
  turnId?: string;
  /** 重试原因分类：timeout / rate_limited / network_error */
  retryReason: "timeout" | "rate_limited" | "network_error";
  /** 当前重试次数（1-based） */
  retryAttempt: number;
  /** 最大重试次数 */
  retryMaxAttempts: number;
  /** 等待毫秒数 */
  retryDelayMs: number;
  message?: string;
}

/** 工具执行结果汇总（引擎级：一轮工具执行完成后整体下发）。
 *  每个条目携带独立 tool 结果消息 id（= 入库 tool/result.messageId，独立于含调用的 assistant 消息）；
 *  关联键是 toolCallId（对齐回放 tool/result 语义），不依赖 messageId。 */
export interface ToolCallsResponseEvent {
  type: "tool_calls_response";
  turnId?: string;
  toolCallsResponse: Array<{
    /** 独立 tool 结果消息 id（与持久化 tool/result.messageId 一致） */
    messageId?: string;
    name: string;
    content: string;
    toolCallId: string;
    outcome?: "success" | "error" | "rejected";
    /** UI 渲染元数据（仅前端消费，不进 LLM 上下文），来自工具返回的 meta */
    meta?: Record<string, unknown>;
  }>;
}

/** 上下文压缩开始（引擎级：压缩是同步阻塞操作，期间前端可展示"压缩中"） */
export interface CompressionStartEvent {
  type: "compression_start";
  /** 压缩触发方式：auto（token 压力）/ manual（用户手动）/ overflow（上下文溢出恢复） */
  reason?: "auto" | "manual" | "overflow";
  message?: string;
}

/** 上下文压缩失败（引擎级：压缩异常时通知前端） */
export interface CompressionErrorEvent {
  type: "compression_error";
  error?: string;
  message?: string;
  /** true = 用户中止（维护流 abort）；false/缺省 = 真失败。据此决定提示形态 */
  cancelled?: boolean;
}

/** 上下文压缩结束（引擎级：任何一次压缩运行成功后广播；compacted 与纯裁剪都发）。
 *  携带压缩后占用（contextStats）——前端据此即时更新环形指示器，无需 REST。 */
export interface CompressionEndEvent {
  type: "compression_end";
  /** 压缩触发方式：auto（token 压力）/ manual（用户手动）/ overflow（上下文溢出恢复） */
  reason?: "auto" | "manual" | "overflow";
  /** 压缩后当前完整请求 token + 窗口（与 turn_end.contextStats 同构） */
  contextStats?: {
    usedTokens: number;
    effectiveContextWindow: number;
  };
}

/**
 * 压缩完成（引擎级：压缩落库后广播遮蔽信息）。
 * 与瞬态 compression_start/error 的区别：这是"压缩结果"事件，携带被遮蔽信息与摘要——
 * 前端据此标记"已压缩"消息 + 生成压缩占位（in-turn → 回合内 event 消息；out-of-turn → 独立 event 回合）。
 * 来源：live（协调器压缩成功后 emitStream）与事件页（compaction/summary 重建）。
 * 遮蔽表示：分界点消息 id（shadowedEndId，一个值）+ 条数（shadowedCount）；旧格式 shadowedMessageIds 保留为防御回退。
 */
export interface CompactionSummaryEvent {
  type: "compaction_summary";
  /** 摘要消息 id（占位标识） */
  messageId?: string;
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
  shadowedEndId?: string;
  /** 遮蔽消息条数（折叠计数依据） */
  shadowedCount?: number;
  /** 旧格式：被遮蔽（压缩）的消息 id 清单（防御回退） */
  shadowedMessageIds?: string[];
  /** 摘要文本 */
  summary: string;
  /** 压缩后当前完整请求 token + 窗口（前端即时更新环形指示器，无需 REST） */
  contextStats?: {
    usedTokens: number;
    effectiveContextWindow: number;
  };
}

/**
 * 统一人机交互（审批 / 询问 / 迭代暂停继续共用一个闭环）。
 * 与后端 ask/asked 审计事件的区别：这是流内 UI 信号（eventBuffer 可重放 + SSE 直投）。
 * 无超时：等待只有三种终结——用户应答、用户停止（abort）、重启丢表（404）。
 * 与后端 common/types/ask.types.ts 逐字段同构。
 */
export interface AskOption {
  /** 选项文本（即答案值） */
  label: string;
  description?: string;
}

export interface AskQuestion {
  /** 稳定 id，答案按 id 回显 */
  id: string;
  question: string;
  /** 支撑文本（审批场景 = 命令/理由详情） */
  detail?: string;
  /** 选项列表（A/B/C… 按序渲染） */
  options: AskOption[];
  /** 缺省单选；true = 多选 */
  multiSelect?: boolean;
}

export interface AskAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export type AskKind = "approval" | "ask" | "continue";

export interface AskRequestedEvent {
  type: "ask_requested";
  /** 临时凭证（uuid），应答回传匹配等待者 */
  requestId: string;
  kind: AskKind;
  /** 卡片标题（如"进行文档处理"） */
  title?: string;
  toolCallId?: string;
  toolName?: string;
  questions: AskQuestion[];
}

export interface AskResolvedEvent {
  type: "ask_resolved";
  requestId: string;
  outcome: "answered" | "cancelled";
}

/**
 * 消息级流事件 = 规范 StreamChunk 直通 + 消息关联字段。
 * block_start/text_delta/reasoning_delta/tool_call_delta/block_end/usage/finish
 * 全部按 messageId 归属到同一条 assistant 消息（消息 id = messageId，与落库一致）。
 */
export type MessageChunkEvent = StreamChunk & {
  /** 所属 assistant 消息 id（= 落库消息 id） */
  messageId: string;
  /** 所属回合外壳 id */
  turnId?: string;
};

// ==================== Workflow 编排进度 ====================

/**
 * Workflow 编排进度事件（与后端 event-chunk.types.ts 同构）。
 * 与领域事件 workflow/event（事件页回放）双通道喂 streamProjector 同一 reducer。
 */
export interface WorkflowEvent {
  type: "workflow_event";
  event: import("./workflow.types").WorkflowEventData;
}

/**
 * 子代理已创建（与后端 event-chunk.types.ts 同构）：工具调用 ↔ 子会话的关联键。
 * 它比工具结果早到——前台 spawn 阻塞期间工具结果尚未落库，只有这条流事件能建立关联；
 * 走流通道（进 eventBuffer）故随 SSE 建连重放回来，刷新不丢。
 */
export interface SubAgentLinkEvent {
  type: "subagent_link";
  /** 派生子代理的那次工具调用 id */
  toolCallId: string;
  subSessionId: string;
  /** 子代理名称，仅用于展示 */
  name?: string;
}

// ==================== 联合 ====================

export type SessionStreamEvent =
  | TurnStartEvent
  | TurnEndEvent
  | TurnDeleteEvent
  | UserMessageEvent
  | RetryEvent
  | ToolCallsResponseEvent
  | CompressionStartEvent
  | CompressionErrorEvent
  | CompressionEndEvent
  | CompactionSummaryEvent
  | AskRequestedEvent
  | AskResolvedEvent
  | WorkflowEvent
  | SubAgentLinkEvent
  | MessageChunkEvent;

/** 传输层事件（chat-runner 注入 prevSeq；session-events 信封注入 sessionId；publish 盖戳 streamSeq/streamBootId） */
export type WireStreamEvent = SessionStreamEvent & {
  sessionId?: string;
  prevSeq?: number;
  /** 幂等序号：每会话单调递增（后端 publish 唯一盖戳点；hub 入口重放去重游标） */
  streamSeq?: number;
  /** 后端进程启动标识：重启后 streamSeq 归零，hub 据此重置幂等游标 */
  streamBootId?: string;
};