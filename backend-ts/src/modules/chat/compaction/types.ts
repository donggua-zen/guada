/**
 * 压缩能力契约（v1.3：压缩与会话彻底解耦）
 *
 * - CompactionConfig：合并后的压缩配置（会话侧负责设置合并，压缩侧只消费）
 * - CompactionDataSource：会话向压缩能力暴露的窄接口——压缩侧（CompactionService/协调器）
 *   只依赖此接口操作会话，ISessionContext 不再承载任何压缩方法（对齐 DSH：Session 无压缩语义）。
 *
 * 数据流：
 * - 引擎输入 = getHistory()（请求消息列表，与主请求逐字节一致，不含 prelude）
 * - 压缩后返回 = getMessages()（含 prelude 的完整请求列表，供调用方直接发 LLM）
 * - KV 前缀 = getPrelude() + getTools()（与主请求一致的 prelude/工具定义）
 * - 会话状态恢复 = refreshAfterCompaction()（缓存失效+重载，属会话职责，不可外包）
 */
import type { Message } from '../../../common/types/conversation.types';
import type { ToolDefinition } from '../../tools/interfaces/tool-provider.interface';
import type { ModelConfig } from '../session-context';
import type { SummaryMode } from '../compression-engine';

/** 合并后的压缩配置（trigger/target/summaryMode） */
export interface CompactionConfig {
  compressionTriggerRatio?: number;
  compressionTargetRatio?: number;
  summaryMode?: SummaryMode;
}

/** 会话向压缩能力暴露的窄数据源接口 */
export interface CompactionDataSource {
  readonly sessionId: string;
  /** 完整请求列表（含 prelude，供调用方直接发 LLM） */
  getMessages(): Promise<Message[]>;
  /** 原始对话历史（压缩引擎输入，与主请求逐字节一致，不含 prelude） */
  getHistory(): Promise<Message[]>;
  /** 会话模型配置（压缩模型解析的回退目标） */
  getModelConfig(): ModelConfig;
  /** 当前完整请求 token（全量：prelude + 可见视图，provider usage 锚点 + 启发式增量） */
  getTokenCount(): Promise<number>;
  /** 有效上下文窗口 */
  getEffectiveContextWindow(): number;
  /** 合并后的压缩配置 */
  getCompressionConfig(): CompactionConfig;
  /** KV 前缀：会话 prelude（确保会话状态已加载） */
  getPrelude(): Promise<Message[]>;
  /** KV 前缀：工具定义（与主请求一致） */
  getTools(): ToolDefinition[];
  /** 压缩后会话状态恢复（缓存失效+重载），返回含 prelude 的刷新后请求列表 */
  refreshAfterCompaction(): Promise<Message[]>;
}