/**
 * LLM 交互相关的统一类型定义
 */

// 从公共类型导入消息结构相关类型
import {
  MessagePart,
  ToolCallItem,
  MessageRecord,
} from "../../../common/types/message.types";
import {
  ToolDefinition,
  ToolParameterProperty,
} from "../../tools/interfaces/tool-provider.interface";

// 重新导出这些类型以保持向后兼容
export { MessagePart, ToolCallItem, MessageRecord };

// 从 tools 模块重新导出工具类型
export { ToolDefinition, ToolParameterProperty };

// 向后兼容别名
/** @deprecated 使用 ToolDefinition 替代 */
export type InternalToolDefinition = ToolDefinition;

// ==================== 适配器接口与参数 ====================

export interface LLMCompletionParams {
  model: string;
  messages: MessageRecord[];
  temperature?: number;
  topP?: number; // 原 top_p
  frequencyPenalty?: number; // 原 frequency_penalty
  maxTokens?: number; // 原 max_tokens
  tools?: ToolDefinition[];
  thinkingEffort?: string; // 思考强度级别：'none' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
  extraBody?: Record<string, any>;
  abortSignal?: AbortSignal;
  providerConfig?: any;
  stream?: boolean;
  timeout?: number;
}

export interface LLMResponseChunk {
  /**
   * 显式事件类型（适配器层直接标记，避免下游靠字段推断）
   * - text: 普通文本增量
   * - think: 推理/思考内容增量
   * - tool_call: 工具调用（含增量参数）
   * - finish: 流结束，携带完整累积数据 + usage
   */
  type?: 'text' | 'think' | 'tool_call' | 'finish';
  content?: string | null;
  reasoningContent?: string | null;
  finishReason?: string | null;
  toolCalls?: ToolCallItem[];
  contentId?: string;
  /** Anthropic extended thinking signature，用于多轮思考连续性回传 */
  signature?: string;
  /** Anthropic redacted thinking data（display=omitted 时的加密思考内容） */
  redactedData?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /**
     * 各供应商缓存相关 token 数（私有扩展，非所有供应商都有）
     * - OpenAI Chat/Response: read = prompt_tokens_details.cached_tokens
     * - DeepSeek: read = prompt_cache_hit_tokens, missed = prompt_cache_miss_tokens
     * - Anthropic: read = cache_read_input_tokens, written = cache_creation_input_tokens
     * - Gemini: read = usage_metadata.cachedContentTokenCount
     */
    cachedTokens?: {
      /** 从缓存读取的 token 数（缓存命中） */
      read?: number;
      /** 写入缓存的 token 数（首次创建缓存，Anthropic 特有） */
      written?: number;
      /** 缓存未命中的 token 数（DeepSeek 特有） */
      missed?: number;
    };
  };
}
