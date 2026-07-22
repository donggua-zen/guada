import { MessageRecord } from "../llm-core/types/llm.types";
import { SummaryMode } from "./compression-engine";

// ============================================================================
// 参数类型定义
// ============================================================================

export interface MessageLoadParams {
  sessionId: string;
  // userId: string;
  userMessageId?: string;
  maxMessages?: number;
  supportsImageInput?: boolean;
  keepReasoningContent?: boolean;
  lastCompactedMessageId?: string;
  lastCompactedContentId?: string;
}

export interface CompressionConfig {
  /** 压缩目标 Token 数（压缩后历史应不超过此值） */
  targetTokens: number;
  model?: any;
  summaryMode?: SummaryMode; // 摘要生成模式，默认为 MEMORY_SYNC
  chatModelName?: string; // 对话模型名称，用于 Token 计算
}

export interface MemoryConfig {
  compressionTriggerRatio?: number;
  compressionTargetRatio?: number;
  summaryMode?: 'disabled' | 'fast' | 'memory_sync'; // 摘要模式
}

// 压缩统计信息（便于扩展）
export interface CompressionStats {
  beforeTokenCount?: number;      // 压缩前的 Token 数
  afterTokenCount?: number;       // 压缩后的 Token 数
  beforeMessageCount?: number;    // 压缩前的消息数
  afterMessageCount?: number;     // 压缩后的消息数
}

/** 细粒度 Token 统计：系统提示词 / 摘要 / 用户提示 / 对话消息 / 工具定义 */
export interface TokenBreakdown {
  systemPrompt: number;   // base + plugins tokens
  summary: number;        // summary 内容（含包裹标记）的 tokens
  userPrompt: number;     // user 内容（含包裹标记）的 tokens
  history: number;        // user/assistant 对话消息 tokens
  tools: number;          // 工具定义（tool definitions）的 tokens
}

/** 计算 TokenBreakdown 的总和 */
export function calcTotalTokens(b: TokenBreakdown): number {
  return b.systemPrompt + b.summary + b.userPrompt + b.history + b.tools;
}

export interface CompressionResult {
  messages: MessageRecord[];      // 纯对话消息,不含 system 角色
  summary?: string;                // 生成的摘要内容(如果执行了压缩)
  didCompress: boolean;
  strategy?: string;
  tokenCount?: number;
  compressionStats?: CompressionStats; // 压缩统计信息
  checkpoint?: CompressionCheckpoint;  // 本次压缩后最新的断点（可缓存复用，避免重复查库）
}

export interface CompressionCheckpoint {
  lastCompactedMessageId?: string;
  lastCompactedContentId?: string;
  lastPrunedContentId?: string; // 物理裁剪边界 ID
  pruningMetadata?: Record<string, any>;
  summaryContent?: string;
  cleaningStrategy?: string;
}

export interface AssistantResponsePrepResult {
  responseMessageId: string;
}

// ============================================================================
// 压缩策略接口 —— 纯压缩算法+策略判断
// ============================================================================

export interface ICompressionStrategy {
  execute(
    sessionId: string,
    messages: MessageRecord[],
    config: CompressionConfig,
    tokenBreakdown?: TokenBreakdown,   // 细粒度 Token 统计，替代 currentTokenCount
    onBeforeCompaction?: () => Promise<void>,    // 二级压缩（摘要/丢弃）前的回调
    checkpoint?: CompressionCheckpoint | null, // 已加载的断点，避免内部重复查库
  ): Promise<CompressionResult>;
  getCheckpoint(sessionId: string): Promise<CompressionCheckpoint | null>;
  preprocess(
    rawMessages: MessageRecord[],
    checkpoint: CompressionCheckpoint,
  ): { messages: MessageRecord[]; summary?: string };
}

// ============================================================================
// DI Token
// ============================================================================

export const COMPRESSION_STRATEGY_TOKEN = "ICompressionStrategy";
