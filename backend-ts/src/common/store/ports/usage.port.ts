/**
 * 用量账本端口（传输无关）
 *
 * 旧实现把 `model_usage` 与 `sessions` 放在同一个 SQLite 文件里，聚合查询直接
 * `LEFT JOIN sessions` 取标题/类型。这假设了「同库同进程」，数据库分库或 HTTP
 * 后端都会失效。
 *
 * 端口因此**禁止 JOIN**：`UsageSessionRow` 只回 `sessionId` 与用量列，
 * 标题/会话类型由 `UsageService` 经 `SessionMetaPort.getManyByIds` 二次补齐。
 * 多一次往返换来跨介质一致，是值得的。
 */
import type {
  ModelUsageRecordInput,
  UsageQueryInput,
  UsageQueryRows,
} from '../../../modules/usage/usage.types';

export interface UsagePort {
  /** 启动期收敛（可选）：删除会话已不存在的孤儿用量行 */
  startup?(): Promise<void>;

  /**
   * 写入一条模型调用明细。
   * @param options.ignoreExisting 回填场景：已存在同一 (assistantMessageId, attemptIndex)
   *        时保留线上记录，避免回填覆盖实时真值。
   */
  record(
    input: ModelUsageRecordInput,
    options?: { ignoreExisting?: boolean },
  ): boolean | Promise<boolean>;

  /** 删除某会话的全部用量明细；返回删除行数 */
  deleteBySession(sessionId: string): Promise<number>;
  /** 清空全部用量明细；返回删除行数 */
  clearAll(): Promise<number>;
  /** 删除会话已不存在的孤儿行；返回删除行数 */
  pruneOrphans(): Promise<number>;
  /** 聚合查询（`sessions` 行只含 sessionId 与用量列，标题由调用方补齐） */
  query(input: UsageQueryInput): Promise<UsageQueryRows>;
}

/** UsagePort 注入 token */
export const USAGE_PORT = 'UsagePort';
