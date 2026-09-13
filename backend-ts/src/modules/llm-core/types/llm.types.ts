/**
 * LLM 交互相关的统一类型定义
 */

import type { Message } from "../../../common/types/conversation.types";
import type {
  ToolDefinition,
  ToolParameterProperty,
} from "../../tools/interfaces/tool-provider.interface";

// 统一流式词汇表（规范 chunk 协议，adapter → 循环 → SSE → 前端一套词表）
export type { StreamChunk, StreamChunkType, StreamUsage } from "../../../common/types/stream-chunk.types";

// 从 tools 模块重新导出工具类型
export { ToolDefinition, ToolParameterProperty } from "../../tools/interfaces/tool-provider.interface";

// ==================== 适配器接口与参数 ====================

export interface LLMCompletionParams {
  model: string;
  /**
   * 系统提示词文本（envelope，与对话历史分离——对齐 DSH LlmCallConfig.system）。
   * 协议槽位由 adapter 映射：OpenAI 数组首条 / Anthropic 独立字段 / Gemini systemInstruction。
   */
  system?: string;
  /** 三层 Message[]（role + source + ContentBlock[]）；纯对话历史（surface），不含 system；adapter 自行按块转各自 wire */
  messages: Message[];
  temperature?: number;
  topP?: number; // 原 top_p
  frequencyPenalty?: number; // 原 frequency_penalty
  maxTokens?: number; // 原 max_tokens
  tools?: ToolDefinition[];
  thinkingEffort?: string; // 思考强度级别（中立词表：none/minimal/low/medium/high/xhigh/max，legacy 'on'）
  /** 请求用途（对齐 DSH purpose）：adapter 可映射为传输元数据（如摘要调用标记） */
  purpose?: string;
  extraBody?: Record<string, any>;
  abortSignal?: AbortSignal;
  providerConfig?: any;
  /** 模型能力声明（由会话层从 modelConfig 派生）：adapter 据此做 fail-loud 断言 */
  modelCapabilities?: {
    supportsImageInput?: boolean;
  };
  stream?: boolean;
  timeout?: number;
}
