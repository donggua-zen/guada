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
// 细粒度 Token 统计：系统提示词 / 对话消息 / 工具定义
// （类型定义在 message-store.interface——持久化锚点与流事件共用同一形状）
// ============================================================================

export type { TokenBreakdown } from "../../common/persistence/message-store.interface";

export type { Message };
