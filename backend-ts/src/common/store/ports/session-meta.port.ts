/**
 * 会话元信息端口（传输无关）
 *
 * 这是「会话行」的唯一权威读写面。任何驱动（SQLite / Postgres / HTTP 远端）
 * 只要实现本接口，领域层（SessionService / SubAgentManager / FileService …）
 * 就完全感知不到介质。
 *
 * 设计约束（对每个驱动都成立）：
 * 1. **全部 async**。不允许同步返回——网络后端不可能同步。
 * 2. **无 SQL 形状**。分页用 `{skip, limit}` + `total`；「未注册目录」用显式
 *    `WorkspaceScope`，不得内嵌跨表子查询语义。
 * 3. **无事务假设**。驱动可以自己用事务实现原子性，但接口不承诺跨方法事务。
 * 4. **无目录概念**。目录/文件的删除归 `SessionAssetPort`，本端口只删行。
 *
 * 幂等性要求：
 * - `deleteRows` 对不存在的 id 返回 0，不抛错。
 * - `update` 对不存在的 id 返回 null，不抛错。
 * - `updateLastActiveAt` 对不存在的 id 静默返回（与旧实现一致）。
 */
import type {
  CreateSessionInput,
  PagedSessionRows,
  SessionQueryFilter,
  SessionQueryPage,
  SessionRow,
  SessionSortKey,
} from './types';

export interface SessionMetaPort {
  /**
   * 启动期收敛（可选）。
   * SQLite 驱动在此做 schema 迁移与「孤儿/幽灵行」自愈（目录即会话的个人版语义）；
   * 数据库/HTTP 驱动通常无需实现。必须幂等，且可在任意时刻重复调用。
   */
  startup?(): Promise<void>;

  // ─── 读取 ───

  get(id: string): Promise<SessionRow | null>;
  has(id: string): Promise<boolean>;

  /** 全量过滤查询（无界；天然有界或需要完整清单的调用方使用） */
  query(
    filter: SessionQueryFilter,
    sort?: SessionSortKey,
  ): Promise<SessionRow[]>;

  /**
   * 分页查询：`rows` 与 `total` 必须来自同一快照
   * （SQL 驱动用同事务 COUNT，HTTP 驱动由服务端保证）。
   */
  queryPaged(
    filter: SessionQueryFilter,
    sort: SessionSortKey,
    page: SessionQueryPage,
  ): Promise<PagedSessionRows>;

  childrenOf(parentId: string): Promise<SessionRow[]>;
  /** 某父会话下活跃子会话数（排除已冻结 closedAt） */
  countByParentId(parentId: string): Promise<number>;
  /** 按 botId + externalId 查 bot 会话（幂等映射） */
  findByBotAndExternalId(
    botId: string,
    externalId: string,
  ): Promise<SessionRow | null>;
  /** `sessionType='web'` 的 id 清单（lastActiveAt desc），供内容搜索两阶段协议 */
  listWebSessionIds(includeArchived?: boolean): Promise<string[]>;
  getSessionType(id: string): Promise<string | null>;
  /** 按 id 批量取行（保持入参顺序，缺失项忽略） */
  getManyByIds(ids: string[]): Promise<SessionRow[]>;
  /** 未绑定模型的 web 主会话（启动回填用） */
  listWebSessionsWithMissingModel(): Promise<Array<{ id: string; agentId: string | null }>>;

  // ─── 写入 ───

  /** 创建会话行（缺 id 由驱动铸造；parentId 存在时驱动负责解析 rootId） */
  create(input: CreateSessionInput): Promise<SessionRow>;
  /** 部分更新（undefined 保持原值，null 显式置空）；未命中返回 null */
  update(id: string, patch: Partial<SessionRow>): Promise<SessionRow | null>;
  /** 仅刷新最后活跃时间（每条消息一次） */
  updateLastActiveAt(id: string): Promise<void>;
  /** 仅回填模型引用，不触碰 updatedAt / lastActiveAt（启动迁移用） */
  backfillModelId(id: string, modelId: string): Promise<void>;

  // ─── 删除 ───

  /** 按 id 批量删行（不碰磁盘/对象存储）；返回实际删除行数 */
  deleteRows(ids: string[]): Promise<number>;
  /** 批量把某分组的会话置为未分组；返回受影响行数 */
  clearGroup(groupId: string): Promise<number>;
}

/** SessionMetaPort 注入 token */
export const SESSION_META_PORT = 'SessionMetaPort';
