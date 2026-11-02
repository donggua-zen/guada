/**
 * 会话分组端口 + 目录分组端口（传输无关）
 *
 * 两个分组域形状相同但语义不同，刻意拆成两个端口：
 * - **会话分组**（session_groups）：用户手工建的「文件夹」，成员关系是
 *   `session.groupId`，删除分组必须同时解绑成员（否则留下悬空 groupId）。
 * - **目录分组**（project_groups）：按工作目录自动/手工注册，成员关系是
 *   **派生的**（`session.workspaceKey === group.pathKey`），删分组不回写会话。
 *
 * 把两者混在一个端口里，驱动实现很容易在「删分组要不要回写会话」上出错。
 */
import type {
  ProjectGroupCandidate,
  ProjectGroupRow,
  SessionGroupRow,
} from './types';

export interface SessionGroupPort {
  /** 分组列表（按 sortOrder 升序） */
  list(): Promise<SessionGroupRow[]>;
  findById(id: string): Promise<SessionGroupRow | null>;
  /** 新建分组（id 由驱动铸造） */
  create(input: {
    name: string;
    sortOrder?: number;
    icon?: string | null;
    data?: Record<string, any> | null;
  }): Promise<SessionGroupRow>;
  update(
    id: string,
    patch: Partial<Pick<SessionGroupRow, 'name' | 'sortOrder' | 'icon' | 'data'>>,
  ): Promise<SessionGroupRow | null>;
  /** 删除分组并解绑该组会话（成员置为未分组）。返回被删分组 id */
  delete(id: string): Promise<{ id: string }>;
  /** 当前最大 sortOrder（新建分组排在最后） */
  getMaxSortOrder(): Promise<number>;
  /** 批量更新排序，返回受影响的分组行 */
  batchUpdateSortOrder(
    updates: Array<{ id: string; sortOrder: number }>,
  ): Promise<SessionGroupRow[]>;
}

/**
 * 目录分组端口。
 *
 * 方法名带 `ProjectGroup` 前缀是刻意的：同一个驱动类可以同时实现本端口与
 * `SessionGroupPort`，两者都有 `list/findById/update/delete` 语义但返回不同形状，
 * 无前缀会导致 TS 方法签名冲突。前缀同时让调用点一眼看出操作的是哪一类分组。
 */
export interface ProjectGroupPort {
  /** 目录分组列表（按 position 升序；tiebreak 用 id 保证渲染稳定） */
  listProjectGroups(): Promise<ProjectGroupRow[]>;
  findProjectGroup(id: string): Promise<ProjectGroupRow | null>;
  findProjectGroupByKey(pathKey: string): Promise<ProjectGroupRow | null>;
  /**
   * 注册目录（幂等）：同 pathKey 已存在时原样返回，**不覆盖**用户改过的名字。
   *
   * position 缺省：`prepend !== false` 时插到最前（新建会话/手动注册），
   * 否则排到末尾（启动期注册会显式传 position）。
   */
  ensureProjectGroup(input: {
    path: string;
    pathKey?: string;
    name?: string;
    position?: number;
    prepend?: boolean;
  }): Promise<ProjectGroupRow>;
  /** 更新显示名和/或图标；两个字段都未传时返回 null */
  updateProjectGroup(
    id: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<ProjectGroupRow | null>;
  /** 拖拽排序：要求传入完整 id 集合（缺项/未知项直接拒绝） */
  reorderProjectGroups(ids: string[]): Promise<ProjectGroupRow[]>;
  /** 取消注册：只删分组行，不修改任何会话 */
  deleteProjectGroup(id: string): Promise<{ id: string }>;

  // ─── 启动期一次性注册（替代旧实现里直接开库写 SQL 的脚手架）───

  /**
   * 侧栏可见会话按工作目录归并出的候选目录（`workspaceKey` 非空、
   * `sessionType='web'`、未归档），按最近活跃降序。启动期注册的输入。
   */
  listGroupCandidates(): Promise<ProjectGroupCandidate[]>;
  /** 一次性注册标记是否已写入 */
  isBootstrapped(): Promise<boolean>;
  /** 写入一次性注册标记 */
  markBootstrapped(at: string): Promise<void>;
}

/** SessionGroupPort 注入 token */
export const SESSION_GROUP_PORT = 'SessionGroupPort';
/** ProjectGroupPort 注入 token */
export const PROJECT_GROUP_PORT = 'ProjectGroupPort';
