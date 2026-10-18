/**
 * LLM 交互相关的统一类型定义
 */

import type {
  ContentBlock,
  Message,
} from "../../../common/types/conversation.types";
import type {
  ToolDefinition,
  ToolParameterProperty,
} from "../../tools/interfaces/tool-provider.interface";

// 统一流式词汇表（规范 chunk 协议，adapter → 循环 → SSE → 前端一套词表）
export type { StreamChunk, StreamChunkType, StreamUsage } from "../../../common/types/stream-chunk.types";

// 从 tools 模块重新导出工具类型
export { ToolDefinition, ToolParameterProperty } from "../../tools/interfaces/tool-provider.interface";

// ==================== 用量统计 ====================

/**
 * LLM 调用来源（用量统计维度）。
 *
 * 与 zcode 的 query_source 对齐；主对话之外的辅助调用必须在调用点声明 purpose，
 * 由 UsageService 映射到本枚举，避免全部落进 main_turn 污染来源分布。
 */
export type UsageSource =
  | "main_turn"
  | "subagent"
  | "compaction"
  | "session_title"
  | "commit_message"
  | "memory_sync"
  | "image_recognition"
  | "other";

/** 一次 LLM 调用的统计上下文（仅用于本地用量账本，不参与 wire 请求） */
export interface LLMUsageContext {
  sessionId?: string;
  turnId?: string;
  /** 逻辑请求 id：主回合传 assistant messageId，辅助调用可传 uuid */
  requestId?: string;
  /** 主回合 assistant 消息 id（回填去重用；辅助调用留空） */
  assistantMessageId?: string;
  /** 重试序号（agent 层每次重试 +1） */
  attemptIndex?: number;
  /** 显式来源；缺省由 purpose / sessionId 推导 */
  source?: UsageSource;
}

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
  /**
   * 档位生效时的 JSON merge patch（RFC 7386：null 删键、对象递归合并、数组替换）。
   * 由 LLMService 按条目 thinkingEffortsPatch 解析后下传；adapter 在请求体
   * 装配完成后整体应用（patch 优先于 thinkingFormat/字符串映射的拼装结果）。
   */
  thinkingPatch?: Record<string, any>;
  /**
   * true = 该 patch 来自拼法表达式（thinkingPatchExpr）：适配器跳过内置思考
   * 字段写入（thinkingFormat / 协议固定形状），思考字段完全由表达式输出决定。
   */
  thinkingPatchReplacesFormat?: boolean;
  /** 请求用途（对齐 DSH purpose）：adapter 可映射为传输元数据（如摘要调用标记） */
  purpose?: string;
  /** 用量统计上下文（不参与 wire 请求；缺省由 RequestContext / purpose 推导） */
  usageContext?: LLMUsageContext;
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

/**
 * 非流式补全结果。
 *
 * 旧实现只取 generator 的第一个 chunk（block_end），usage/finish 永远拿不到；
 * 这里改为排空后组装，既让标题生成能读到 content，也让用量采集拿到权威 usage。
 */
export interface LLMCompletionResult {
  blocks: ContentBlock[];
  content: string;
  usage?: import("../../../common/types/stream-chunk.types").StreamUsage;
  finishReason?: string;
}
