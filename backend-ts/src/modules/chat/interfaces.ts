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
  contextWindow: number; // 实际生效的上下文窗口（已考虑 maxTokensLimit 限制）
  triggerRatio: number;
  targetRatio: number;
  model?: any;
  summaryMode?: SummaryMode; // 摘要生成模式，默认为 MEMORY_SYNC
  chatModelName?: string; // 对话模型名称，用于 Token 计算
}

export interface MemoryConfig {
  maxMemoryLength?: number;
  compressionTriggerRatio?: number;
  compressionTargetRatio?: number;
  summaryMode?: 'disabled' | 'fast' | 'memory_sync'; // 摘要模式
  maxTokensLimit?: number;
}

// 压缩统计信息（便于扩展）
export interface CompressionStats {
  beforeTokenCount?: number;      // 压缩前的 Token 数
  afterTokenCount?: number;       // 压缩后的 Token 数
  beforeMessageCount?: number;    // 压缩前的消息数
  afterMessageCount?: number;     // 压缩后的消息数
}

export interface CompressionResult {
  messages: MessageRecord[];      // 纯对话消息,不含 system 角色
  summary?: string;                // 生成的摘要内容(如果执行了压缩)
  didCompress: boolean;
  strategy?: string;
  tokenCount?: number;
  compressionStats?: CompressionStats; // 压缩统计信息
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
// Layer 1a: 消息存储接口 —— 纯数据存取
// ============================================================================

export interface IMessageStore {
  loadMessages(params: MessageLoadParams): Promise<MessageRecord[]>;
  persistContent(records: MessageRecord[]): Promise<MessageRecord[]>;
  prepareAssistantResponse(
    sessionId: string,
    parentId: string,
    regenerationMode: string,
    turnsId: string,
    existingAssistantMessageId?: string,
  ): Promise<string>;
}

// ============================================================================
// Layer 1b: 压缩策略接口 —— 纯压缩算法+策略判断
// ============================================================================

export interface ICompressionStrategy {
  shouldCompress(messages: MessageRecord[], config: CompressionConfig, cachedTokenCount?: number): Promise<boolean>;
  execute(
    sessionId: string,
    messages: MessageRecord[],
    config: CompressionConfig,
    currentTokenCount?: number, // 当前缓存的 Token 数，避免重复计算
    onStage2?: () => Promise<void>, // 二级压缩（摘要/丢弃）前的回调
  ): Promise<CompressionResult>;
  getCheckpoint(sessionId: string): Promise<CompressionCheckpoint | null>;
  preprocess(
    rawMessages: MessageRecord[],
    checkpoint: CompressionCheckpoint,
  ): { messages: MessageRecord[]; summary?: string };
}

// ============================================================================
// DI Token — 从废弃的 conversation-context.factory 迁移至此
// ============================================================================

export const MESSAGE_STORE_TOKEN = "IMessageStore";
export const COMPRESSION_STRATEGY_TOKEN = "ICompressionStrategy";
