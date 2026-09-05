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

/** 合并后的压缩配置（trigger/retain/summaryMode；对齐 DSH thresholdRatio + retainRatio） */
export interface CompactionConfig {
  /** 触发 = 验收线（默认 0.8；prune 后 < 0.8 即达标，不触发 LLM） */
  compressionTriggerRatio?: number;
  /** 压缩保留尾预算（默认 0.2；遮蔽区之外原样保留） */
  compressionRetainRatio?: number;
  /** 兼容遗留：旧"目标线"不再承担验收/保留语义，仅保留字段防配置破坏 */
  compressionTargetRatio?: number;
  summaryMode?: SummaryMode;
}

/** 一级裁剪写载荷（引擎经 CompactionDataSource.appendPrune 落库） */
export interface PruneWrite {
  messageId: string;
  newContent: string;
  prunedBytes?: number;
  strategy?: string;
  prunedTokens?: number;
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
  /** 一级裁剪写入：落库 + 快照/块级 token 精确失效 */
  appendPrune(data: PruneWrite): Promise<void>;
  /** 二级遮蔽写入：落库 + 快照增量播种（splice view 前 shadowedCount 条为摘要节点）。
   *  @returns 摘要消息 id + 写入后版本号 */
  appendCompact(
    data: CompactWrite,
  ): Promise<{ summaryMessageId: string; endSeq: number }>;
  /** 纯裁剪（无括号）压缩路径的上下文占用锚点：写一条独立 compaction/end 携带当前占用
   *  （compacted 路径的锚点已由 appendCompact 的 compaction/end 承载）。服务层在 prune-only 后调用。 */
  recordContextAnchor?(): Promise<void>;
}