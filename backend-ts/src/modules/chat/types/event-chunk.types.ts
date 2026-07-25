import { ToolCallItem } from "../../llm-core/types/llm.types";

/**
 * Token 使用量统计
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Agent 引擎对外输出的统一事件块
 *
 * 通过 type 字段区分不同事件类型，各类型对应的字段按需填充。
 */
export interface EventChunk {
  // ===== 事件类型 =====
  type:
    | "create"
    | "update"
    | "text"
    | "think"
    | "tool_call"
    | "tool_calls_response"
    | "finish"
    | "user_message";

  // ===== 消息标识（create / update / text / think / tool_call / tool_calls_response / finish）=====
  messageId?: string;
  turnsId?: string;
  contentId?: string;
  parentId?: string;
  requestId?: string;

  // ===== 模型信息（create / update）=====
  modelName?: string;

  // ===== 内容（text / think / finish）=====
  content?: string;
  reasoningContent?: string;

  // ===== 工具调用（tool_call）=====
  toolCalls?: ToolCallItem[];

  // ===== 工具调用响应（tool_calls_response）=====
  toolCallsResponse?: Array<{
    name: string;
    content: string;
    toolCallId: string;
  }>;

  // ===== 完成信息（finish）=====
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;
  message?: string;
  progress?: {
    completedIterations: number;
    maxIterations: number;
  };

  /**
   * 会话上下文统计（finish 事件携带）
   * 前端用于更新上下文使用率环形指示器，避免流式结束后再发起 REST 请求重建上下文。
   * 仅包含轻量字段；详细 breakdown 仍由 REST /token-stats 端点按需获取。
   */
  contextStats?: {
    usedTokens: number;
    effectiveContextWindow: number;
  };

  // ===== 用户消息（user_message）=====
  userMessage?: any;
}
