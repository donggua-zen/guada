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
import type { BaseEvent, SessionMeta } from './types';

// ============================================================================
// 参数类型定义
// ============================================================================

/** LLM 上下文加载参数（存储层只做纯投影；模型能力相关变换由 chat 层 L1 管线完成） */
export interface ContextLoadParams {
  sessionId: string;
  /** 只取最近 N 条（会话标题生成等用途）；缺省返回全部 */
  maxMessages?: number;
  /** 是否保留 reasoning 内容（思考模式） */
  keepReasoningContent?: boolean;
}

/** 细分 Token 统计（三项真值：压缩摘要折叠进 history） */
export interface TokenBreakdown {
  /** 系统提示词（智能体 base + 插件 eager 提示词） */
  systemPrompt: number;
  /** user/assistant 对话消息（含被折叠的压缩摘要） */
  history: number;
  /** 工具定义（tool definitions） */
  tools: number;
}

/** 轮次完成信息（usage/耗时/finishReason/error） */
export interface TurnFinish {
  usage: TokenUsage;
  /** 模型结束原因（stop / tool-calls / error / timeout / user_cancel 等，原样保留） */
  finishReason?: string;
  errorDetail?: unknown;
  modelName?: string;
  /** 回合结束后当前完整请求 token（envelope + 可见视图；前端上下文占用的持久化锚点） */
  usedTokens?: number;
  /** 有效上下文窗口（与 usedTokens 配套） */
  effectiveContextWindow?: number;
  /** 可见视图消息数（与 usedTokens 配套） */
  messageCount?: number;
  /** 细分 token（与 usedTokens 配套；旧数据缺省） */
  breakdown?: TokenBreakdown;
}

/** 编辑轮次（版本切换 / 内容编辑） */
export interface TurnUpdate {
  currentVersionId?: string;
  content?: string;
  [key: string]: unknown;
}

/** 单块懒加载详情（工具调用参数+结果） */
// ============================================================================
// 消息存储统一接口
// ============================================================================

export interface IMessageStore {
  // ─── 读取 ───
  /** 懒加载：单块的工具调用详情 */
  /** LLM 上下文：扁平消息 surface → 可见 Message[]（adapter 输入） */
  loadContext(params: ContextLoadParams): Promise<Message[]>;
  /** 该会话最后一条已落盘事件的 seq（广播/增量同步去重游标） */
  getLastProcessedSeq(sessionId: string): Promise<number>;

  // ─── 写入 ───
  // 版本号契约：revision 由写入方在写入时随返回值原子给出（本批次最后事件的 seq），
  // 消费方绝不事后查询 getLastProcessedSeq——写入与查询之间的并发写会让
  // "事后查询的 revision"假领先于消费方持有的视图（静默丢消息）。

  /**
   * 开回合:写 turn/start(先于 user/message,对齐 DSH 回合定界)。
   * @param options.replaceTurnId 整轮次重答:先遮蔽旧轮次,再开新回合
   * @param options.modelName 回合模型名（随 turn/start 落库，使在途回合被历史页重建时
   *   即携带模型名——否则流式中打开会话只能等 turn/finish 才能显示模型）
   */
  beginTurn(
    sessionId: string,
    options?: {
      replaceTurnId?: string;
      preGenTurnId?: string;
      modelName?: string;
    },
  ): Promise<{ turnId: string; revision: number }>;
  /**
   * 追加用户消息:写 user/message(后于 turn/start,归属由当前回合括号界定)。
   * 返回用户消息(三层 Message,供广播 user_message 事件)与写入后版本号。
   * @param options.blocks 原生内容块（S2：结构化入站消息，存在时优先于 content/files 构造）
   * @param options.source 显式消息来源（P4b：队列投递写入；缺省折叠时按 kind 推导）
   */
  addUserMessage(
    sessionId: string,
    content: string,
    files?: FileRef[],
    options?: {
      replaceTurnId?: string;
      metadata?: Record<string, any>;
      blocks?: import('../types/conversation.types').ContentBlock[];
      /** 注入块（system 提示 / KB 引用等）：追加在统一 blocks 尾部，落库为同一条消息 */
      injectedBlocks?: import('../types/conversation.types').ContentBlock[];
      source?: import('../types/conversation.types').MessageSource;
    },
  ): Promise<{ messageId: string; userMessage: Message; revision: number }>;

  /**
   * 追加一次 LLM 调用/注入（Message[]，含 ContentBlock[]）。
   * @returns added = 本次实际折叠出的权威节点（fold 后对象），供调用方 O(k) 增量复用；
   *          revision = 写入后版本号（写入时确定）。
   */
  appendMessages(
    sessionId: string,
    messages: Message[],
  ): Promise<{ added: Message[]; revision: number }>;
  /** 完成一个轮次外壳：写 usage/耗时/finishReason/error。@returns 写入后版本号 */
  finalizeTurn(
    sessionId: string,
    turnId: string,
    durationMs: number,
    finish: TurnFinish,
  ): Promise<number>;
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
  /** 批量导入轮次（重建/导入路径）。
   *  @param opts.effectiveContextWindow 会话模型的有效上下文窗口——传入时 turn/finish 携带
   *    上下文占用锚点（usedTokens 取回合 usage 的 provider 报告值），供前端逆向扫描免 REST */
  importTurns(
    sessionId: string,
    turns: Turn[],
    opts?: { effectiveContextWindow?: number },
  ): Promise<{ imported: number }>;

  // ─── 分支/克隆（原始事件迁移）───
  /** 读取会话全量领域事件（seq 序原样，不折叠；分支/克隆等迁移路径用） */
  getAllEvents(sessionId: string): Promise<BaseEvent[]>;
  /**
   * 批量导入原始事件（分支/克隆路径）：事件原样重放写入（type/data/time 保留，仅重编 seq）。
   * 与 importTurns（Turn[] → 三事件合成）互补：压缩、遮蔽、命令/提问事件卡片等
   * 非回合事件原样保留，回放后与源会话对应时刻的状态一致。
   * 调用方须先 ensureSession（session/init seq=0 已写入），本方法从下一空闲 seq 起重编。
   */
  importEvents(sessionId: string, events: BaseEvent[]): Promise<{ imported: number }>;

  // ─── 压缩写入（统一 CompressionEngine 只经此读写，后端无关）───
  /** 一级压缩（裁剪）：只裁剪超长内容，不改可见性。@returns 写入后版本号（revision） */
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
  ): Promise<number>;
  /** 二级压缩（摘要）：遮蔽头部连续前缀 + 写摘要（compaction 括号事件）。
   *  @returns 摘要消息 id + 写入后版本号 + 折叠后的摘要节点（供快照播种） */
  appendCompact(
    sessionId: string,
    data: {
      /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
      shadowedEndId: string;
      /** 遮蔽消息条数 */
      shadowedCount: number;
      summary: string;
      summaryMessageId?: string;
      mode?: string;
      /** 摘要调用 usage（流式累积，对齐 DSH SummaryResult） */
      usage?: import('../types/stream-chunk.types').StreamUsage;
      /** 压缩后完整请求 token（compaction/end 携带，前端上下文占用锚点） */
      usedTokens?: number;
      /** 有效上下文窗口（与 usedTokens 配套） */
      effectiveContextWindow?: number;
      /** 可见视图消息数（与 usedTokens 配套） */
      messageCount?: number;
      /** 细分 token（与 usedTokens 配套） */
      breakdown?: TokenBreakdown;
      /** 压缩前实测占用（压缩历史 before/after 对比） */
      beforeTokens?: number;
    },
  ): Promise<{
    summaryMessageId: string;
    endSeq: number;
    summaryNode: Message | null;
  }>;
  /** 纯裁剪（无括号）压缩路径的上下文占用锚点：写一条独立 compaction/end（无 start/summary）。
   *  replayer 对无 start 的 end 无害（仅清 openCompactionSeq）；前端忽略 compaction/end。
   *  @returns 写入后版本号 */
  recordContextAnchor(
    sessionId: string,
    data: {
      usedTokens: number;
      effectiveContextWindow: number;
      messageCount?: number;
      breakdown?: TokenBreakdown;
      beforeTokens?: number;
    },
  ): Promise<number>;

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