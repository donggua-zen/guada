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
  thinkingEffort?: string; // 思考强度级别：'off' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
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
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
