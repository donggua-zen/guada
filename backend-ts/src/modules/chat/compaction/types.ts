/**
 * 压缩能力契约（v1.3：压缩与会话彻底解耦）
 *
 * - CompactionConfig：合并后的压缩配置（会话侧负责设置合并，压缩侧只消费）
 * - CompactionDataSource：会话向压缩能力暴露的窄接口——压缩侧（CompactionService/协调器）
 *   只依赖此接口操作会话，ISessionContext 不再承载任何压缩方法（对齐 DSH：Session 无压缩语义）。
 *
 * 数据流：
 * - 引擎输入 = getHistory()（请求消息列表，与主请求逐字节一致，不含 prelude）
 * - 压缩后返回 = getHistory()（压缩写已在 appendPrune/appendCompact 内增量播种快照，O(Δ)）
 * - KV 前缀 = getSystemText() + getTools()（与主请求一致的 system/工具定义）
 * - 压缩后 surface = getHistory()（写路径已增量播种快照，O(1)）
 */
import type { Message } from '../../../common/types/conversation.types';
import type { ToolDefinition } from '../../tools/interfaces/tool-provider.interface';
import type { ModelConfig } from '../session-context';
import type { SummaryMode } from './compression-engine';

/** 合并后的压缩配置（档位折算产物；对齐 DSH thresholdRatio + retainRatio） */
export interface CompactionConfig {
  /** 压缩总开关（关闭档=false：自动/溢出路径旁路；缺省视为启用，向后兼容） */
  enabled?: boolean;
  /** 触发 = 验收线（默认 0.8；prune 后 < 0.8 即达标，不触发 LLM） */
  compressionTriggerRatio?: number;
  /** 压缩保留尾预算（默认 0.2；遮蔽区之外原样保留） */
  compressionRetainRatio?: number;
  /** 兼容遗留：旧"目标线"不再承担验收/保留语义，仅保留字段防配置破坏 */
  compressionTargetRatio?: number;
  summaryMode?: SummaryMode;
}

/** 微压缩写载荷（MicrocompactService 经 CompactionDataSource.appendPrune 落库；strategy 区分工具裁剪/思考剥离） */
export interface PruneWrite {
  messageId: string;
  newContent: string;
  prunedBytes?: number;
  strategy?: string;
  prunedTokens?: number;
}

/**
 * 压缩写入的 token 节省（按视图消息 index 归属）——供会话侧写压缩占用锚点时扣减。
 *
 * 背景：`getTokenCount` = provider 真值锚点 + 启发式增量。被裁剪/遮蔽的消息若位于
 * 该锚点**之前**，两个启发式项同额下降 → 锚点口径的总量恒定不变（裁剪白做）。
 * 会话侧据此对锚点做显式扣减，并记录配套的启发式总量（compaction/end.heuristicTokens），
 * 使压缩后的占用真实下降且可冷启动重建。
 */
export interface CompressionSaving {
  /** 视图消息 index（引擎方案条目 index；遮蔽区整体视为前缀，不在此列） */
  index: number;
  /** 启发式节省 token（原文估 − 压缩后估） */
  tokens: number;
}

/** 二级遮蔽写载荷（分界点 id + 条数；遮蔽必为头部连续前缀，不再离散 id 清单） */
export interface CompactWrite {
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
  shadowedEndId: string;
  /** 遮蔽消息条数（replayer O(1) 头删除、快照播种 splice 依据） */
  shadowedCount: number;
  summary: string;
  mode?: string;
  usage?: import('../../../common/types/stream-chunk.types').StreamUsage;
  /** 保留尾裁剪的节省清单（锚点之前的条目需显式扣减；遮蔽区由 shadowedTokens 结算） */
  savings?: readonly CompressionSaving[];
}

/** 压缩占用锚点写载荷（纯裁剪路径 compaction/end） */
export interface ContextAnchorWrite {
  /** 压缩前实测占用（压缩历史 before/after 对比） */
  beforeTokens?: number;
  /** 本次裁剪的节省清单（锚点之前的条目需显式扣减） */
  savings?: readonly CompressionSaving[];
}

/**
 * token 账目诊断（压缩排查专用；只读，不影响任何决策）。
 *
 * 用途：把三方口径在一行日志里对齐——
 * - 视图口径（viewTokens = perMessageTokens 求和，压缩边界与保留预算用它）
 * - 展示口径（total = getTokenCount()，环形指示器/usedTokens 用它，可能走锚点公式）
 * - 前缀口径（preludeTokens = 系统+工具+插件前缀）
 * `path`/`anchor`/`rejectedAnchor` 用于暴露"锚点被拒 → 静默退化为纯启发式"这类降级。
 */
export interface TokenDiagnostics {
  /** getTokenCount() 当前结果 */
  total: number;
  /** 本次取数命中的路径 */
  path: 'compaction_anchor' | 'usage_anchor' | 'heuristic';
  /** prelude（系统+工具+插件前缀）启发式 token */
  preludeTokens: number;
  /** 视图逐消息 token 之和（= perMessageTokens 求和） */
  viewTokens: number;
  /** 视图消息条数 */
  viewMessageCount: number;
  /** 快照前缀和末项（应等于 viewTokens） */
  prefixSumLast: number;
  /** 命中的 usage 锚点（若有） */
  anchor?: { model: string; promptTokens: number; messageIndex: number };
  /** 存在 usage 锚点但因模型不匹配被拒（退化为纯启发式的静默降级元凶） */
  rejectedAnchor?: { model: string; promptTokens: number; messageIndex: number };
}

/** 会话向压缩能力暴露的窄数据源接口 */
export interface CompactionDataSource {
  readonly sessionId: string;
  /** 原始对话历史（压缩引擎输入，与主请求逐字节一致，不含 system/插件提示） */
  getHistory(): Promise<Message[]>;
  /** 逐消息 token（与 getHistory() 同序；供压缩预算 O(1) 取值，避免逐条估算） */
  getPerMessageTokens(): Promise<number[]>;
  /** 会话模型配置（压缩模型解析的回退目标） */
  getModelConfig(): ModelConfig;
  /** 当前完整请求 token（全量：prelude + 可见视图，provider usage 锚点 + 启发式增量） */
  getTokenCount(): Promise<number>;
  /** 有效上下文窗口 */
  getEffectiveContextWindow(): number;
  /** 会话上下文统计聚合（占用 + 窗口 + 视图消息数 + 细分），压缩后广播事件统一取数 */
  getContextStats(): Promise<{
    usedTokens: number;
    effectiveContextWindow: number;
    messageCount: number;
    breakdown: import('../../../common/persistence/message-store.interface').TokenBreakdown;
  }>;
  /** 合并后的压缩配置 */
  getCompressionConfig(): CompactionConfig;
  /** KV 前缀：system 提示词文本（与主请求 envelope 一致） */
  getSystemText(): string;
  /** KV 前缀：工具定义（与主请求一致） */
  getTools(): ToolDefinition[];
  // ─── 压缩写（v1.4：写路径与读路径同层解耦，引擎不再直插持久化）───
  /** 微压缩写入（工具结果裁剪 / 思考剥离）：落库 + 快照 revision 推进（惰性全量重建） */
  appendPrune(data: PruneWrite): Promise<void>;
  /** 二级遮蔽写入：落库 + 快照增量播种（splice view 前 shadowedCount 条为摘要节点）。
   *  @returns 摘要消息 id + 写入后版本号 */
  appendCompact(
    data: CompactWrite,
  ): Promise<{ summaryMessageId: string; endSeq: number }>;
  /** 微压缩（无括号）路径的上下文占用锚点：写一条独立 compaction/end 携带当前占用
   *  （compacted 路径的锚点已由 appendCompact 的 compaction/end 承载）。MicrocompactService 生效后调用。
   *  @param opts.beforeTokens 压缩前实测占用；opts.savings 本次裁剪/剥离节省（锚点之前者被显式扣减，
   *         否则 provider 锚点会抵消裁剪收益 → 占用不降） */
  recordContextAnchor?(opts?: ContextAnchorWrite): Promise<void>;
  /** token 账目诊断（压缩排查专用；只读）。返回三方口径中间量，见 TokenDiagnostics。 */
  getTokenDiagnostics?(): Promise<TokenDiagnostics>;
}