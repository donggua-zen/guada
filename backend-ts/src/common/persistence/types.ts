/**
 * JSONL 持久化 — 事件类型与基础接口
 * 对齐 DSH 语义的分层事件模型（回合制）：
 *   turn/start + turn/finish（回合：一次输入 = 用户 + 助手，一对一轮回）
 *   user/message + assistant/message + tool/result（消息级三事件，对齐 DSH，内容平铺内嵌）
 *   turn/delete（删除本轮对话 = 按回合 id 遮蔽整个轮次；整轮次重答 = turn/delete 旧轮次 + 正常回答流程）
 *   message/prune（内容裁剪）、compaction/start + summary + end（压缩括号）
 * 回放产出扁平消息 surface（MessageNode IS-A Message，带 seq/turnId 归属标签）。
 */

import type {
  Message,
  ContentBlock,
  FileRef,
  TokenUsage,
} from '../types/conversation.types';

// ─── 事件类型 ───

export type EventType =
  | 'session/init'
  | 'session/rotate'
  | 'envelope'
  | 'turn/start'
  | 'turn/resume'
  | 'turn/finish'
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
  | 'turn/delete'
  | 'message/prune'
  | 'compaction/start'
  | 'compaction/summary'
  | 'compaction/end'
  | 'command/run'
  | 'command/done'
  | 'message/meta'
  | 'ask/asked'
  | 'ask/answered'
  | 'workflow/event';

// ─── 基础事件 ───

export interface BaseEvent {
  type: EventType;
  seq: number;
  time: number; // Unix 毫秒
  data: Record<string, unknown>;
}

// ─── 回合级事件（turn/start + turn/finish）───

/**
 * 创建回合外壳（一次输入回合：用户 + 助手，一对一）。
 */
export interface TurnCreateData {
  turnId: string;
  /** 回合种类（统一 'turn'） */
  kind: 'turn';
  metadata?: Record<string, unknown> | null;
}

/**
 * 续传回合:断点恢复(resume)时重开既有回合括号。
 * 不新建外壳(目标回合已存在),仅把重放游标 currentTurnId 指回目标回合,
 * 使续传落库的 assistant/message、tool/result 正确归入该回合。
 */
export interface TurnResumeData {
  turnId: string;
}

/**
 * 回合完成：usage / finishReason / 耗时 / 模型 / 异常。
 * 由 finalizeTurn 写入。消费方：
 * - 后端 LLM 视图（replayer）：折叠态为纯扁平 surface，不维护 Turn 外壳，
 *   本事件仅作回合边界（清游标），不消费 data 字段。
 * - 前端展示（事件页 + streamProjector 自折叠）：turn/finish → turn_end chunk，
 *   totalDurationMs 写入前端 turn.metadata 用于耗时展示；刷新重放同源。
 */
export interface TurnFinishData {
  turnId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens: number;
  /** 模型结束原因（stop / tool-calls / error / timeout / user_cancel 等） */
  finishReason?: string;
  /** 整轮耗时 ms */
  totalDurationMs?: number;
  /** 异常详情（若有） */
  errorDetail?: unknown;
  /** 所用模型 */
  modelName?: string;
  /** 回合结束后当前完整请求 token（envelope + 可见视图；前端上下文占用的持久化锚点） */
  usedTokens?: number;
  /** 有效上下文窗口（与 usedTokens 配套） */
  effectiveContextWindow?: number;
}

// ─── 消息级三事件（对齐 DSH：user/message、assistant/message、tool/result）───

/**
 * user/message：用户消息（一次写入）。
 * kind 区分逻辑归属：
 *   - kind='user' ：用户真实输入（回合锚点）
 *   - kind='model'：自动注入的系统提示/图片（metadata.hidden 标记）
 * role 由事件名隐含为 'user'。
 */
export interface UserMessageData {
  messageId: string;
  /** 逻辑归属（user=真实用户 / model=模型工作流注入） */
  kind: 'user' | 'model';
  /**
   * 原生内容块（统一格式：所有 user/message 事件 content 均存 ContentBlock[]，
   * 不再有 content 字符串 / files 附件平铺——旧格式需经 scripts/rebuild-sessions-from-db.ts 重建）。
   */
  blocks: import('../types/conversation.types').ContentBlock[];
  /**
   * 显式消息来源（队列投递等结构化入站消息写入）。
   * 折叠时优先采用；缺省由 kind 推导（kind='model' → source.plugin）。
   */
  source?: import('../types/conversation.types').MessageSource;
  metadata?: Record<string, unknown> | null;
}

/**
 * assistant/message：助手消息（一次 LLM 调用产出，一次写入）。
 * role 由事件名隐含为 'assistant'，kind 恒为 'model'。
 * content 原生存储 ContentBlock[]（text/reasoning/tool-call 判别联合），
 * 与内存/SSE 结构一致，零转换；旧平铺格式（content 字符串 + reasoningContent/toolCalls）
 * 已废弃，不兼容读取。
 * 归属由 turn/start ~ turn/finish 括号界定，无需 turnId。
 */
export interface AssistantMessageData {
  messageId: string;
  /** 内容块（原生判别联合，与三层 Message.content 同构） */
  content: ContentBlock[];
  files?: MessageFile[];
  metadata?: Record<string, unknown> | null;
}

/**
 * tool/result：工具结果（一次写入）。
 * role 由事件名隐含为 'tool'，kind 恒为 'model'。
 * 归属由 turn/start ~ turn/finish 括号界定，无需 turnId。
 */
export interface ToolResultData {
  messageId: string;
  /** 关联的工具调用 id */
  toolCallId: string;
  /** 工具名 */
  name?: string;
  content: string;
  /** 工具结果是否异常 */
  isError?: boolean;
  /** UI 渲染元数据（不进 LLM 上下文），来自 tool-result 块 */
  meta?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

// ─── 文件元数据（内嵌于消息）───

/**
 * 文件元数据（self-contained）。
 * 物理文件在磁盘（如 ~/.guada/file_stores/...），事件内嵌完整元数据。
 */
export interface MessageFile {
  fileId: string;
  fileName: string;
  displayName: string;
  fileSize: number;
  fileType: string;
  fileExtension: string;
  url?: string;            // 相对存储路径
  previewUrl?: string;
  contentHash?: string;
}

// ─── 删除 / 裁剪 ───

/**
 * 删除本轮对话：按回合 id 遮蔽整个轮次（用户 + 助手一并隐藏）。
 * append-only：标记不可见，不物理删除。
 */
export interface TurnDeleteData {
  /** 要删除的回合 id（本轮对话整轮遮蔽） */
  turnId: string;
}

/**
 * 内容裁剪（一级压缩）：只裁剪超长内容，不改变可见性。
 */
export interface MessagePruneData {
  messageId: string;          // 目标消息
  newContent: string;         // 裁剪后内容
  prunedBytes: number;        // 裁剪掉的字节数
  strategy: string;           // 策略，如 head_tail_500
  /** 影子价格：被裁剪内容的估算 token 数（供 token 计量消费方减去被遮蔽价格，对齐 DSH compaction/prune） */
  prunedTokens?: number;
}

// ─── 压缩（括号式，对齐 DSH compaction/*）───

export interface CompactionStartData {
  sourceCommandId?: string;
}

export interface CompactionSummaryData {
  /** 遮蔽末位（分界点）消息 id——前端标记"已压缩"的唯一依据 */
  shadowedEndId?: string;
  /** 遮蔽消息条数（replayer O(1) 头删除用） */
  shadowedCount?: number;
  /** 旧格式：被遮蔽消息的离散 id 清单（防御回退，新写入不再产生） */
  shadowedMessageIds?: string[];
  summary: string;                // 摘要文本
  summaryMessageId: string;       // 摘要作为一条消息
  /** 摘要调用 usage（流式累积，对齐 DSH SummaryResult 记录调用 envelope） */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    [key: string]: unknown;
  };
}

export interface CompactionEndData {
  sourceCommandId?: string;
}

// ─── 命令执行(事件类消息,对齐 DSH command/run + command/done)───
// 由 command/run 开启、command/done 收尾。S0 起不再折叠进 ReplayState.messages
// （command 事件对 LLM 视图无意义），仅落盘供事件页读盘独立折叠展示。
// 注:当前项目尚无命令执行来源(MCP 的 command 仅是 stdio 配置),此类型为预留机制。

export interface CommandRunData {
  commandId: string;
  /** 命令名(如 /plan、/compact) */
  name: string;
  /** 命令参数 */
  args?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface CommandDoneData {
  commandId: string;
  /** 执行结果 kind(success / error / rejected) */
  kind: 'success' | 'error' | 'rejected';
  /** 结果文本 */
  text?: string;
  /** 关联的源事件 seq(可选) */
  sourceEventSeq?: number;
  metadata?: Record<string, unknown> | null;
}

// ─── 统一交互（审批/询问/迭代暂停共用，对齐 DSH user-questions；无超时）───

/** 交互请求事件：工具/引擎发起 ask（挂起等待用户应答） */
export interface AskAskedData {
  /** 临时凭证 id（uuid，发起时生成；前端应答回传匹配等待者） */
  requestId: string;
  /** 卡片分类：approval=审批（ask 特例）/ ask=询问 / continue=迭代暂停继续 */
  kind: import("../types/ask.types").AskKind;
  title?: string;
  questions: import("../types/ask.types").AskQuestion[];
}

/** 交互应答事件：用户已应答（每次 asked 必有 answered；用户停止时标 cancelled） */
export interface AskAnsweredData {
  requestId: string;
  answers?: import("../types/ask.types").AskAnswerItem[];
  cancelled?: boolean;
}

// ─── 回放产物（扁平消息 surface，对齐 DSH）───

/**
 * 回合级元数据（展示链路从事件流即时收集 collectTurnMeta 的产物，不进入折叠态；
 * 供展示链路装配三层回合壳）。
 * turn/start 建 {startSeq}、turn/finish 填、turn/delete 删。
 */
export interface TurnMeta {
  /** turn/start 事件 seq（展示链路回合排序锚点） */
  startSeq: number;
  /** turn/start 事件携带的原始元数据（importTurns 等透传；展示链路合并进回合壳） */
  startMetadata?: Record<string, unknown>;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
    totalTokens: number;
  };
  totalDurationMs?: number;
  modelName?: string;
  errorDetail?: unknown;
}

/** 扁平 surface 节点：Message + 归属/排序标签（IS-A Message，可直接当 Message 用） */
export interface MessageNode extends Message {
  /** 节点 seq（对齐 DSH surface 节点；增量回扫/排序用） */
  seq: number;
  /** 归属回合（turn/delete 定位用；无宿主事件的独立节点 = null） */
  turnId: string | null;
}

/** 回放状态：纯扁平消息 surface（LLM 折叠态——零 turn 结构） */
export interface ReplayState {
  /** 全部消息节点（seq 序），替代三层 turns */
  messages: MessageNode[];
  /**
   * 当前回合游标：turn/start 设置、turn/finish 清除。
   * turn/start ~ turn/finish 括号内的消息事件归入该回合（消息事件不带 turnId）。
   */
  currentTurnId: string | null;
  /** 当前生效 envelope */
  envelope: Envelope | null;
  lastProcessedSeq: number;
  /**
   * 未闭合 compaction/start 的 seq（锁语义审计，对齐 DSH 日志锁）。
   * 本项目 compaction 括号事件为原子批量写入 + torn-tail 修复，正常不会出现孤儿括号；
   * 此字段仅用于诊断检测（不改变折叠行为）。
   */
  openCompactionSeq?: number | null;
}

export interface Envelope {
  reason: string;
  system?: string;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  model?: string;
  provider?: string;
}

// ─── 分卷元数据 ───

export interface SegmentMeta {
  file: string;
  startSeq: number;
  endSeq: number | null;
  status: 'active' | 'archived';
  compactedAt?: string;
  /** 段累计写入字节(append 时累加,分卷判断依据) */
  bytes?: number;
}

export interface Manifest {
  sessionId: string;
  version: number;
  createdAt: string;
  segments: SegmentMeta[];
  compactionBoundaries: Array<{ seq: number }>;
  /** 最近状态快照引用(恢复基准;seq 仅用于校验衔接,不用于跳读) */
  snapshot?: {
    file: string;
    /** 快照对应的分卷边界 seq(= 分卷时旧段最后一条 seq) */
    seq: number;
  };
}

// ─── 持久化后端接口 ───

/**
 * 物理持久化后端抽象（文件 / 数据库等，与业务存储 IMessageStore 解耦）。
 * JsonlBackend 为当前唯一实现；未来新增后端实现本接口并注册进 PersistenceModule 即可。
 */
export interface PersistenceBackend {
  createSession(sessionId: string, meta?: Partial<SessionMeta>): Promise<void>;
  getSession(sessionId: string): Promise<SessionMeta | null>;
  appendEvent(sessionId: string, event: BaseEvent): Promise<void>;
  appendEvents(sessionId: string, events: BaseEvent[]): Promise<void>;
  readEvents(sessionId: string, fromSeq?: number): Promise<BaseEvent[]>;
  getAllEvents(sessionId: string): Promise<BaseEvent[]>;
  splitSegment(sessionId: string): Promise<void>;
  readManifest(sessionId: string): Promise<Manifest>;
  writeManifest(sessionId: string, manifest: Manifest): Promise<void>;
  hasSession(sessionId: string): Promise<boolean>;
  /** 删除整个会话（含全部分卷） */
  deleteSession(sessionId: string): Promise<void>;
  /** 列出全部已建会话 id */
  listSessionIds(): Promise<string[]>;
  /** 写状态快照（原子；恢复时快照 + 跨卷增量，快照 seq 用于衔接校验与增量起点） */
  writeSnapshot(sessionId: string, snapshotSeq: number, state: unknown): Promise<void>;
  /** 读状态快照；无快照返回 null（回退全量重放） */
  readSnapshot(
    sessionId: string,
  ): Promise<{ snapshotSeq: number; state: unknown } | null>;
  /**
   * 从指定 seq 起读跨卷增量事件（含首条）。
   * 按 manifest 段 startSeq/endSeq 定位 fromSeq 所在段，段内定位后连同后续所有段返回；
   * 支持 fromSeq 落在分卷边界（= 下一段首条）与活跃段（endSeq=null）场景。
   * 恢复路径：快照 + readEventsFrom(snapshotSeq + 1)。
   * 严格性：seq 缺口（parse 成功但跳号）与归档段坏行 → 抛 CorruptSessionLogError；
   * 活跃段末尾坏行（torn 尾）→ 忽略坏行及其后（调用方可在冷加载时修复）。
   */
  readEventsFrom(sessionId: string, fromSeq: number): Promise<BaseEvent[]>;
  /**
   * 物理截断活跃段到指定字节偏移（修复 torn 尾后调用），并同步内存活跃段状态。
   * 仅允许在无活跃写入的冷加载路径使用。
   */
  truncateActiveSegment(
    sessionId: string,
    truncateTo: number,
    lastSeq: number,
    bytes: number,
  ): Promise<void>;
  /**
   * 扫描活跃段（供冷加载修复用）：返回事件 + torn 截断点 + seq 缺口信息。
   * gap 非空 = 硬损坏（调用方应抛 CorruptSessionLogError）；truncateTo 非空 = 可修复 torn 尾。
   */
  scanActiveSegment(
    sessionId: string,
  ): Promise<{
    events: BaseEvent[];
    truncateTo: number | null;
    gap: { expected: number; got: number } | null;
  }>;
  /** 读活跃段全部事件（旧恢复路径，保留兼容） */
  readActiveSegmentEvents(sessionId: string): Promise<BaseEvent[]>;
  /** 活跃段信息（分卷判断依据：bytes 超阈值触发分卷） */
  getActiveSegmentInfo(
    sessionId: string,
  ): Promise<{ file: string; endSeq: number | null; bytes: number } | null>;
  /** 记录一次连接压实（达到阈值后自动分卷） */
  recordCompaction(sessionId: string): Promise<void>;
}

/** PersistenceBackend 注入 token（接口无法按类型注入，必须显式 token） */
export const PERSISTENCE_BACKEND_TOKEN = 'PersistenceBackend';

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: string;
}

// ─── 常量 ───

export const SEGMENT_COMPACTION_COUNT = 5; // 每 5 次压缩分新卷

/** 活跃段最大字节数:累计写入超过后分卷(新日志写新文件) */
export const SEGMENT_MAX_BYTES = 20 * 1024 * 1024; // 20MB

// 有序消息 id（ULID 基座）见 common/utils/ordered-id.util.ts：
// messageId = m_<ULID>（普通消息）/ c_<ULID>（压缩检查点，ASCII 'c' < 'm' → 恒排序在所有消息之前）

// 兼容重导出（避免破坏既有导入路径）
export type { Message, ContentBlock, FileRef, TokenUsage };
