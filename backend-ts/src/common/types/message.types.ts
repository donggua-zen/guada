/**
 * 消息结构相关的统一类型定义
 */

// ==================== 消息结构 ====================

/**
 * 消息内容片段（支持多模态）
 */
export interface MessagePart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

/**
 * 工具调用项（系统内部通用格式）
 */
export interface ToolCallItem {
  id: string;
  index?: number;
  type: "function";
  name: string;
  arguments: string; // JSON 字符串
}

/**
 * 统一的对话消息记录
 */
export interface MessageRecord {
  messageId?: string; // 原始消息 ID，用于追踪压缩分界点
  contentId?: string; // 内容 ID
  turnsId?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessagePart[];
  reasoningContent?: string;
  toolCalls?: ToolCallItem[];
  toolCallId?: string; // 当 role 为 'tool' 时使用
  name?: string; // 当 role 为 'tool' 时使用，对应调用的函数名
  metadata?: Partial<Record<"referencedKbs" | "thinkingDurationMs" | "modelName" | "usage" | "finishReason" | "error", any>> | undefined;
  // usage?: any;
  // finishReason?: string;
  // error?: string;
  // toolCallsResponse?: { toolCallId: string; name: string; content: string }[];
}
