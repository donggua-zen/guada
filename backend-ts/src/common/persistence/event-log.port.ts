/**
 * 消息事件日志端口（传输无关）
 *
 * 这是「会话事件流」的唯一介质面。旧 `PersistenceBackend` 的方法集（manifest /
 * 分卷 / torn-tail / snapshot / 活跃段）是 **JSONL 物理形状**，数据库与 HTTP
 * 无从实现——本端口把它收敛成「追加事件 + 读事件 + 可选维护能力」。
 *
 * ## 为什么 seq 由后端分配
 *
 * 旧实现由 `JsonlMessageService` 自己 `getNextSeq()`（读内存游标）后构造带 seq
 * 的事件再落盘。这在单进程单写者下成立，但一旦换成多实例数据库（企业版）或
 * 远端服务，两个写者会读到同一旧游标而分配出重复 seq——重复 seq 会被加载端
 * 连续性校验判为损坏，会话永久无法加载。
 *
 * 因此本端口的 `appendEvents` **接收不带 seq 的事件，返回带 seq 的定稿事件**：
 * - JSONL 驱动：内部维持「读活跃段末 seq + 进程内串行」的原有语义
 * - 数据库驱动：事务内 `SELECT MAX(seq)` + `INSERT ... RETURNING`
 * - HTTP 驱动：服务端分配后回传
 *
 * 调用方只依赖「返回值里的 seq 就是落盘真值」这一条，不再自己算。
 *
 * ## 可选能力
 *
 * `snapshot` 与 `maintenance` 是 **可选** 的：JSONL 靠它们做快照加速与 torn 尾
 * 修复；数据库/HTTP 驱动通常不实现（读全量 + 事务保证原子性即可）。
 * 调用方必须在缺失时优雅退化，不得假设它们存在。
 */
import type { BaseEvent } from '../persistence/types';

/** 待落盘事件：seq 由后端分配，因此入参不含 seq */
export type PendingEvent = Omit<BaseEvent, 'seq'>;

/**
 * 快照能力：把折叠态缓存到介质侧，避免每次冷加载全量重放。
 * 快照只是**加速**，任何时候都可以丢弃并从事件全量重建。
 */
export interface EventLogSnapshot {
  read(sessionId: string): Promise<{ snapshotSeq: number; state: unknown } | null>;
  write(sessionId: string, snapshotSeq: number, state: unknown): Promise<void>;
}

/**
 * 维护能力：介质专属的物理维护。
 *
 * - `compact`：把当前写入段归档、开新段（JSONL 分卷；数据库驱动可 no-op 或做分区）
 * - `repair`：扫描并定位 torn 尾。返回 `truncateTo` 时由调用方决定是否 `truncate`
 * - `truncate`：物理截断到指定位置（仅 `repair` 报告可修复时调用）
 */
export interface EventLogMaintenance {
  /** 达到体积阈值时的归档动作；无此概念的驱动不实现 */
  compact?(sessionId: string): Promise<void>;
  /**
   * 扫描活跃区，报告可修复的尾部损坏。
   * - `gap` 非空 = 硬损坏（seq 缺口/回退），调用方必须抛错拒绝加载
   * - `truncateTo` 非空 = 可修复 torn 尾，调用方可调用 `truncate`
   * 未实现 = 介质保证原子性，永远不会出现 torn 尾
   */
  repair?(
    sessionId: string,
  ): Promise<{
    events: BaseEvent[];
    truncateTo: number | null;
    gap: { expected: number; got: number } | null;
  }>;
  /** 截断到指定位置并同步内部状态（仅 `repair` 报告 truncateTo 后调用） */
  truncate?(
    sessionId: string,
    truncateTo: number,
    lastSeq: number,
    bytes: number,
  ): Promise<void>;
}

export interface MessageEventLog {
  /** 创建会话容器（幂等）；`title` 用于 session/init 的展示标题 */
  createSession(
    sessionId: string,
    meta?: { title?: string | null },
  ): Promise<void>;
  hasSession(sessionId: string): Promise<boolean>;
  /** 删除会话全部事件（幂等） */
  deleteSession(sessionId: string): Promise<void>;
  listSessionIds(): Promise<string[]>;

  /**
   * 追加一批事件，返回**带 seq 的定稿事件**（顺序与入参一致）。
   * 实现必须保证本批 seq 连续且不与既有事件冲突（原子性由介质自行保证）。
   * 空数组直接返回空数组。
   */
  appendEvents(sessionId: string, events: PendingEvent[]): Promise<BaseEvent[]>;

  /** 从 fromSeq（含）起读（缺省 0） */
  readEvents(sessionId: string, fromSeq?: number): Promise<BaseEvent[]>;
  /** 全量事件（seq 序原样） */
  getAllEvents(sessionId: string): Promise<BaseEvent[]>;
  /** 当前最后一条事件的 seq；空日志返回 -1 */
  tailSeq(sessionId: string): Promise<number>;

  /** 可选：快照加速 */
  snapshot?: EventLogSnapshot;
  /** 可选：物理维护 */
  maintenance?: EventLogMaintenance;
}

/** MessageEventLog 注入 token */
export const MESSAGE_EVENT_LOG = 'MessageEventLog';
