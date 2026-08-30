/**
 * 消息存储抽象 —— 业务存储的独立契约（不属于 chat 业务层）
 *
 * 设计目标：任意持久化后端（JSONL / SQLite / 其他）可随时切换，
 * 上层（SessionContext / Compression / Controller / Runner）只依赖本接口，
 * 通过 MESSAGE_STORE_TOKEN 注入，不感知具体实现。
 *
 * 三层模型：Turn（轮次外壳）→ Message（一次 LLM 调用/注入）→ ContentBlock[]（内容）。
 * - role 仅在 Message；kind 用于轮次种类；type 用于块内容形态。
 * - LLM 读 loadContext（扁平折叠态 → 可见 Message[]）；前端读事件页（领域事件原样，自折叠）。
 */
import type {
  Turn,
  Message,
  ContentBlock,
  FileRef,
  TokenUsage,
} from '../types/conversation.types';
import type { SessionMeta } from './types';

// ============================================================================
// 参数类型定义
// ============================================================================

/** LLM 上下文加载参数（存储层只做纯投影；模型能力相关变换由 chat 层 L1 管线完成） */
export interface ContextLoadParams {
  sessionId: string;
  /** 游标：只加载到此轮次为止（含该轮次） */
  anchorTurnId?: string;
  maxMessages?: number;
  keepReasoningContent?: boolean;
  lastCompactedTurnId?: string;
}

/** 轮次完成信息（usage/耗时/finishReason/error） */
export interface TurnFinish {
  usage: TokenUsage;
  /** 模型结束原因（stop / tool-calls / error / timeout / user_cancel 等，原样保留） */
  finishReason?: string;
  errorDetail?: unknown;
  modelName?: string;
}

/** 编辑轮次（版本切换 / 内容编辑） */
export interface TurnUpdate {
  currentVersionId?: string;
  content?: string;
  [key: string]: unknown;
}

/** 单块懒加载详情（工具调用参数+结果） */
export interface BlockDetail {
  blockId: string;
  turnId: string;
  block: ContentBlock;
}

// ============================================================================
// 消息存储统一接口
// ============================================================================

export interface IMessageStore {
  // ─── 读取 ───
  /** 懒加载：单块的工具调用详情 */
  getBlockDetails(sessionId: string, blockId: string): Promise<BlockDetail | null>;
  /** LLM 上下文：扁平消息 surface → 可见 Message[]（adapter 输入） */
  loadContext(params: ContextLoadParams): Promise<Message[]>;
  /** 该会话最后一条已落盘事件的 seq（广播/增量同步去重游标） */
  getLastProcessedSeq(sessionId: string): Promise<number>;

  // ─── 写入 ───
  /**
   * 开回合:写 turn/start(先于 user/message,对齐 DSH 回合定界)。
   * 返回回合 turnId,作为后续 appendMessages / finalizeTurn 的归属游标。
   * @param options.replaceTurnId 整轮次重答:先遮蔽旧轮次,再开新回合
   */
  beginTurn(
    sessionId: string,
    options?: {
      replaceTurnId?: string;
      preGenTurnId?: string;
    },
  ): Promise<string>;
  /**
   * 追加用户消息:写 user/message(后于 turn/start,归属由当前回合括号界定)。
   * 返回用户消息(三层 Message,供广播 user_message 事件与内存历史)。
   */
  addUserMessage(
    sessionId: string,
    content: string,
    files?: FileRef[],
    options?: {
      replaceTurnId?: string;
      knowledgeBaseIds?: string[];
      metadata?: Record<string, any>;
    },
  ): Promise<{ messageId: string; userMessage: Message }>;

  /** 追加一次 LLM 调用/注入（Message[]，含 ContentBlock[]） */
  appendMessages(sessionId: string, messages: Message[]): Promise<void>;
  /** 完成一个轮次外壳：写 usage/耗时/finishReason/error */
  finalizeTurn(
    sessionId: string,
    turnId: string,
    durationMs: number,
    finish: TurnFinish,
  ): Promise<void>;
  /** 编辑轮次：内容编辑（追加 message/prune 记录新内容） */
  updateTurn(
    sessionId: string,
    turnId: string,
    data: TurnUpdate,
  ): Promise<{ success: boolean }>;
  /** 删除轮次：删 user 外壳 → 其全部 assistant 版本遮蔽 */
  deleteTurn(sessionId: string, turnId: string): Promise<void>;
  /** 清空会话全部轮次 */
  clearSessionTurns(sessionId: string): Promise<void>;
  /** 批量导入轮次 */
  importTurns(sessionId: string, turns: Turn[]): Promise<{ imported: number }>;

  // ─── 压缩写入（统一 CompressionEngine 只经此读写，后端无关）───
  /** 一级压缩（裁剪）：只裁剪超长内容，不改可见性 */
  appendPrune(
    sessionId: string,
    data: {
      messageId: string;
      newContent: string;
      prunedBytes?: number;
      strategy?: string;
      /** 影子价格：被裁剪内容的估算 token 数 */
      prunedTokens?: number;
    },
  ): Promise<void>;
  /** 二级压缩（摘要）：遮蔽一批轮次 + 写摘要（compaction 括号事件） */
  appendCompact(
    sessionId: string,
    data: {
      shadowedMessageIds: string[];
      summary: string;
      summaryMessageId?: string;
      mode?: string;
      /** 摘要调用 usage（流式累积，对齐 DSH SummaryResult） */
      usage?: import('../types/stream-chunk.types').StreamUsage;
    },
  ): Promise<void>;

  // ─── 统一交互（审批/询问/迭代暂停共用 ask/* 事件溯源；无超时）───
  /** 交互请求事件（发起 ask 时写日志，审计源） */
  appendAskAsked(
    sessionId: string,
    data: import('./types').AskAskedData,
  ): Promise<void>;
  /** 交互应答事件（用户应答/取消后写日志；每次 asked 必有 answered） */
  appendAskAnswered(
    sessionId: string,
    data: import('./types').AskAnsweredData,
  ): Promise<void>;

  // ─── 会话生命周期 / 内部维护 ───
  /** 懒创建语义：会话不存在则创建存储（新会话/断点恢复前调用） */
  ensureSession(sessionId: string, meta?: Partial<SessionMeta>): Promise<void>;
  /**
   * 持久化维护钩子（写入后由上层 persist 调用，如 JSONL 分卷判断）。
   * 无此概念的后端可实现为 no-op。
   */
  maybeSplit(sessionId: string): Promise<void>;
}

// ============================================================================
// DI Token
// ============================================================================

/** IMessageStore 注入 token（接口无法按类型注入，必须显式 token） */
export const MESSAGE_STORE_TOKEN = 'IMessageStore';