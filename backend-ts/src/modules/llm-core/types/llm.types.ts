/**
 * LLM 交互相关的统一类型定义
 */

// 从公共类型导入消息结构相关类型
import { MessagePart, ToolCallItem, MessageRecord } from "../../../common/types/message.types";

// 重新导出这些类型以保持向后兼容
export { MessagePart, ToolCallItem, MessageRecord };

// ==================== 工具定义结构 ====================

/**
 * 工具参数属性定义
 */
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: any[];
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  items?: ToolParameterProperty;
  default?: any;
  maxLength?: number; // 字符串最大长度限制
}

/**
 * 系统内部使用的扁平化工具定义（不带 function 包装层）
 */
export interface InternalToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

// ==================== 适配器接口与参数 ====================

export interface LLMCompletionParams {
  model: string;
  messages: MessageRecord[];
  temperature?: number;
  topP?: number; // 原 top_p
  frequencyPenalty?: number; // 原 frequency_penalty
  maxTokens?: number; // 原 max_tokens
  tools?: InternalToolDefinition[];
  thinkingEffort?: string; // 思考强度级别：'off' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
  extraBody?: Record<string, any>;
  abortSignal?: AbortSignal;
  providerConfig?: any;
  stream?: boolean;
  timeout?: number;
}

export interface LLMResponseChunk {
  content?: string | null;
  reasoningContent?: string | null;
  finishReason?: string | null;
  toolCalls?: ToolCallItem[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
