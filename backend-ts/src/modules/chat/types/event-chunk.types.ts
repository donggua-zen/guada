/**
 * 会话流内事件（判别联合）
 *
 * 两层结构与全局事件体系对应：
 * - 回合级事件（turn_start/turn_end/turn_delete）：只描述回合生命周期，
 *   绝不携带任何 Message 字段（messageId/content/content 等一律禁止）
 * - 消息级事件（StreamChunk 直通 + user_message/tool_calls_response）：
 *   携带 messageId 关联所属 assistant 消息，消息内容完全由这一层承载
 *
 * 传输层信封：WireStreamEvent = SessionStreamEvent & { sessionId?, prevSeq? }
 * （chat-runner 注入 prevSeq 续传游标，session-events 注入 sessionId 后经 SSE 下发）
 */

import type { StreamChunk, StreamUsage } from "../../../common/types/stream-chunk.types";
import type { TokenBreakdown } from "../../../common/persistence/message-store.interface";

// ==================== 回合级事件 ====================

/** 会话上下文统计（环形指示器 + 视图消息数 + breakdown 细分）。
 *  由"占用稳定点"（每轮 turn_end / 每次压缩落库）构造，前端免 REST 直接消费。 */
export interface ContextStatsPayload {
  /** 当前完整请求 token（provider 真值锚点 + tiktoken 增量） */
  usedTokens: number;
  /** 有效上下文窗口 */
  effectiveContextWindow: number;
  /** 可见视图消息数 */
  messageCount?: number;
  /** 细分 token（三项真值；旧锚点数据缺省） */
  breakdown?: TokenBreakdown;
}

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
   * 整轮耗时 ms（= finalizeTurn 落库的 loopDuration，与 turn/finish 事件同值）。
   * 前端写入 turn.metadata.totalDurationMs，供结束后与刷新重放的耗时展示。
   */
  totalDurationMs?: number;
  /**
   * 会话上下文统计（占用 + 窗口 + 视图消息数 + breakdown 细分）。
   * 前端用于更新上下文使用率环形指示器与细分面板，无需发起 REST 请求重建上下文。
   */
  contextStats?: ContextStatsPayload;
}

/** 回合删除（重答）：从视图直接移除该回合 */
export interface TurnDeleteEvent {
  type: "turn_delete";
  turnId: string;
}

// ==================== 消息级事件 ====================

/** 用户消息入库广播（携带三层 userMessage 对象） */
export interface UserMessageEvent {
  type: "user_message";
  messageId?: string;
  turnId?: string;
  userMessage: any;
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
    meta?: Record<string, any>;
  }>;
}

/** 上下文压缩开始（引擎级：压缩是同步阻塞操作，期间前端可展示"压缩中"） */
export interface CompressionStartEvent {
  type: "compression_start";
  /** 压缩触发方式：auto（token 压力）/ manual（用户手动）/ overflow（上下文溢出恢复） */
  reason?: "auto" | "manual" | "overflow";
  /** 压缩层级：micro=微压缩（本地工具结果裁剪 + 思考剥离）/ llm=摘要压缩；缺省视为 llm（旧事件兼容） */
  tier?: "micro" | "llm";
  message?: string;
}

/** 上下文压缩失败（引擎级：压缩异常时通知前端） */
export interface CompressionErrorEvent {
  type: "compression_error";
  error?: string;
  message?: string;
  /** true = 用户中止（维护流 abort）；false/缺省 = 真失败。前端据此决定提示形态 */
  cancelled?: boolean;
}

/** 上下文压缩结束（引擎级：任何一次压缩运行成功后广播；compacted 与纯裁剪都发）。
 *  携带压缩后占用（contextStats）——前端据此即时更新环形指示器，无需 REST；
 *  同时携带本次结果（裁剪条数/是否压缩/跳过原因），避免"压缩一闪而过却看不出做了什么"。 */
export interface CompressionEndEvent {
  type: "compression_end";
  /** 压缩触发方式：auto（token 压力）/ manual（用户手动）/ overflow（上下文溢出恢复） */
  reason?: "auto" | "manual" | "overflow";
  /** 压缩层级：micro=微压缩（本地）/ llm=摘要压缩；缺省视为 llm（旧事件兼容） */
  tier?: "micro" | "llm";
  /** 压缩后当前完整请求 token + 窗口（envelope + 可见视图；与 turn_end.contextStats 同构） */
  contextStats?: ContextStatsPayload;
  /** 本次写入的工具结果裁剪事件数（微压缩） */
  pruneEvents?: number;
  /** 本次剥离思考的消息数（微压缩） */
  thinkingStrippedCount?: number;
  /** 是否发生二级压缩（遮蔽 + 摘要/丢弃）；false 时为微压缩或空跑 */
  compacted?: boolean;
  /** 遮蔽消息条数（compacted 时 > 0） */
  shadowedCount?: number;
  /** 未压缩原因（compacted=false 时给出；见 CompressionSkipReason） */
  skipReason?: string;
}

/**
 * 压缩完成（引擎级：压缩落库后广播遮蔽信息）。
 * 与瞬态 compression_start/error 的区别：这是"压缩结果"事件，携带被遮蔽信息与摘要——
 * 前端据此标记"已压缩"消息 + 生成压缩占位（in-turn → 回合内 event 消息；out-of-turn → 独立 event 回合）。
 * 来源：live（协调器压缩成功后经 sessionContext.publishStream 直发）与 replay 页（compaction/start+summary+end 重建）。
 * 遮蔽表示：分界点消息 id（shadowedEndId，一个值）+ 条数（shadowedCount）；旧格式 shadowedMessageIds 保留为防御回退。
 */
export interface CompactionSummaryEvent {
  type: "compaction_summary";
  /** 宿主回合（压缩发生时正在进行的回合；无宿主=括号外压缩） */
  turnId?: string;
  /** 摘要消息 id（占位标识） */
  messageId?: string;
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
  shadowedEndId?: string;
  /** 遮蔽消息条数（折叠计数依据） */
  shadowedCount?: number;
  /** 旧格式：被遮蔽（压缩）的消息 id 清单（防御回退，新写入不再产生） */
  shadowedMessageIds?: string[];
  /** 摘要文本 */
  summary: string;
  /** 压缩后当前完整请求 token + 窗口（前端即时更新环形指示器，无需 REST） */
  contextStats?: ContextStatsPayload;
}

/**
 * 统一人机交互（审批 / 询问共用一个闭环，见 common/types/ask.types.ts）。
 * 与审计事件 ask/asked 的区别：这是流内 UI 信号（eventBuffer 可重放 + SSE 直投），
 * ask/asked 是落日志的持久化审计（JSONL）。
 * 无超时：等待只有三种终结——用户应答、用户停止（abort）、重启丢表（404）。
 * 对齐 DSH：sessionId 是唯一会话锚点，无回合/消息锚点。
 * （类型本体定义于 common/types/ask.types.ts，此处并入流事件联合。）
 */
export type { AskRequestedEvent, AskResolvedEvent } from "../../../common/types/ask.types";
import type {
  AskRequestedEvent,
  AskResolvedEvent,
} from "../../../common/types/ask.types";

/**
 * Workflow 编排进度事件（引擎级直发：workflow_run 工具执行期间的实时进度）。
 * event 载荷 = WorkflowEventData（runId + run 内 seq 为前端幂等去重的排序键）。
 * 进度不落 JSONL：前端概览面板以 REST 快照（sessions/:id/workflow/runs）为基线、
 * 本流事件为实时增量，喂同一 reducer 收敛。
 */
export interface WorkflowEvent {
  type: "workflow_event";
  event: import("../../workflow/workflow.types").WorkflowEventData;
}

/**
 * 子代理已创建：把"哪次工具调用派生出了哪个子会话"告知前端，供工具行提供打开面板入口。
 *
 * 为什么走流通道（进 eventBuffer）而不是只靠工具结果的 meta.link：
 * 前台 subagent_spawn 会阻塞到子代理跑完，这段时间工具结果尚未落库、meta.link 还不存在，
 * 客户端若在此时刷新就再也拿不到关联键（subagent.created 是全局广播、不随建连重放）。
 * 流事件随 SSE 建连重放回来，正好覆盖这段窗口；回合结束 eventBuffer 销毁时，工具结果
 * 已落库，meta.link 接手——两者互补，不重复。
 */
export interface SubAgentLinkEvent {
  type: "subagent_link";
  /** 派生子代理的那次工具调用 id（前端据此定位工具行） */
  toolCallId: string;
  subSessionId: string;
  /** 子代理名称，仅用于展示 */
  name?: string;
}

/**
 * 消息级流事件 = 规范 StreamChunk 直通 + 消息关联字段。
 * block_start/text_delta/reasoning_delta/tool_call_delta/block_end/usage/finish
 * 全部按 messageId 归属到同一条 assistant 消息（消息 id = messageId，与落库一致）。
 */
/**
 * 计划模式变更（协作状态，正交于安全档位）。
 *
 * 事实源是 session.settings.planEnabled（持久化）；本事件是流内 UI 信号，用于驱动
 * 前端指示器与多窗口同步。用户从界面开关时前端已自知，但仍会收到本帧以统一路径；
 * 模型经 ExitPlanMode 审批通过后关闭时，本帧是前端唯一的知情渠道。
 */
export interface PlanModeChangedEvent {
  type: "plan_mode_changed";
  planEnabled: boolean;
  previousPlanEnabled: boolean;
  /** 变更来源：user=界面开关 / tool=ExitPlanMode 审批通过 */
  source: "user" | "tool";
  /** source='tool' 时的关联工具调用 id */
  toolCallId?: string;
}

export type MessageChunkEvent = StreamChunk & {
  /** 所属 assistant 消息 id（= 落库消息 id） */
  messageId: string;
  /** 所属回合外壳 id */
  turnId?: string;
};

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
  | PlanModeChangedEvent
  | MessageChunkEvent;

/** 传输层事件（chat-runner 注入 prevSeq；session-events 信封注入 sessionId；publish 盖戳 streamSeq/streamBootId） */
export type WireStreamEvent = SessionStreamEvent & {
  sessionId?: string;
  /** 续传游标：广播那一刻该会话最后一条已入库事件的 seq（先入库后发事件的契约下精确） */
  prevSeq?: number;
  /** 幂等序号：每会话单调递增（SessionStreamManager.publish 唯一盖戳点；前端重放去重游标） */
  streamSeq?: number;
  /** 后端进程启动标识：重启后 streamSeq 归零，前端据此重置幂等游标 */
  streamBootId?: string;
};