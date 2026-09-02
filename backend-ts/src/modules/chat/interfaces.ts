import type { Message } from "../../common/types/conversation.types";

// ============================================================================
// 消息存储抽象已迁至 common/persistence/message-store.interface
// （存储为独立模块，不属 chat 业务层）。此处 re-export 仅为兼容存量 import，
// 新代码请直接从 common/persistence/message-store.interface 引入。
// ============================================================================

export type {
  IMessageStore,
  ContextLoadParams,
  TurnFinish,
  TurnUpdate,
} from "../../common/persistence/message-store.interface";
export { MESSAGE_STORE_TOKEN } from "../../common/persistence/message-store.interface";

// ============================================================================
// 细粒度 Token 统计：系统提示词 / 摘要 / 用户提示 / 对话消息 / 工具定义
// ============================================================================

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

export type { Message };
