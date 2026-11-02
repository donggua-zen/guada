/**
 * 会话存储门面（`SESSION_STORE_TOKEN`）
 *
 * 领域层（SessionService / SubAgentManager / FileService / BotGateway …）只依赖
 * 本门面，不直接碰任何驱动。门面负责**跨端口的编配**——这类语义不该由某个
 * 驱动单独拥有，否则每个新驱动都要重写一遍：
 *
 * - 删除会话 = 删资产（附件/图片/workflow）→ 删行 → 删用量
 * - 创建会话 = 建行 → 建资产容器（目录先建是幽灵清理的判据）
 * - 分支克隆 = 拷资产 → 复制事件（由消息层负责）
 *
 * 所有方法都是 async：门面之下可能是网络后端，同步签名会把「内存镜像 +
 * 后台同步」这种一致性陷阱强加给每个驱动。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SESSION_META_PORT } from '../../common/store/ports/session-meta.port';
import type { SessionMetaPort } from '../../common/store/ports/session-meta.port';
import { SESSION_GROUP_PORT, PROJECT_GROUP_PORT } from '../../common/store/ports/group.port';
import type { ProjectGroupPort, SessionGroupPort } from '../../common/store/ports/group.port';
import { USAGE_PORT } from '../../common/store/ports/usage.port';
import type { UsagePort } from '../../common/store/ports/usage.port';
import type { SessionAssetPort } from '../../common/store/ports/types';
import type {
  CreateSessionInput,
  PagedSessionRows,
  ProjectGroupRow,
  SessionGroupRow,
  SessionQueryFilter,
  SessionQueryPage,
  SessionRow,
  SessionSortKey,
} from '../../common/store/ports/types';

/** 会话存储门面注入 token */
export const SESSION_STORE_TOKEN = 'SessionStore';

@Injectable()
export class SessionStoreFacade {
  private readonly logger = new Logger(SessionStoreFacade.name);

  constructor(
    @Inject(SESSION_META_PORT) private readonly meta: SessionMetaPort,
    @Inject(SESSION_GROUP_PORT) private readonly groups: SessionGroupPort,
    @Inject(PROJECT_GROUP_PORT) private readonly projectGroups: ProjectGroupPort,
    @Inject(USAGE_PORT) private readonly usage: UsagePort,
    @Inject('SessionAssetPort') private readonly assets: SessionAssetPort,
  ) {}

  // ============ 生命周期 ============

  /**
   * 启动收敛：驱动级 schema 迁移 + 自愈 + 用量孤儿清理。
   * 幂等；失败只记日志不阻塞启动（下次启动重试）。
   */
  async initialize(): Promise<void> {
    await this.meta.startup?.();
    await this.usage.startup?.();
  }

  // ============ 会话行（透传 meta 端口） ============

  get(id: string): Promise<SessionRow | null> {
    return this.meta.get(id);
  }

  /** 旧名别名：等价于 `get`（历史调用方用它表达「取原始行」） */
  getMeta(id: string): Promise<SessionRow | null> {
    return this.meta.get(id);
  }

  has(id: string): Promise<boolean> {
    return this.meta.has(id);
  }

  query(
    filter: SessionQueryFilter,
    sort?: SessionSortKey,
  ): Promise<SessionRow[]> {
    return this.meta.query(filter, sort);
  }

  queryPaged(
    filter: SessionQueryFilter,
    sort: SessionSortKey,
    page: SessionQueryPage,
  ): Promise<PagedSessionRows> {
    return this.meta.queryPaged(filter, sort, page);
  }

  childrenOf(parentId: string): Promise<SessionRow[]> {
    return this.meta.childrenOf(parentId);
  }

  countByParentId(parentId: string): Promise<number> {
    return this.meta.countByParentId(parentId);
  }

  findByBotAndExternalId(
    botId: string,
    externalId: string,
  ): Promise<SessionRow | null> {
    return this.meta.findByBotAndExternalId(botId, externalId);
  }

  listWebSessionIds(includeArchived = false): Promise<string[]> {
    return this.meta.listWebSessionIds(includeArchived);
  }

  getSessionType(id: string): Promise<string | null> {
    return this.meta.getSessionType(id);
  }

  getManyByIds(ids: string[]): Promise<SessionRow[]> {
    return this.meta.getManyByIds(ids);
  }

  listWebSessionsWithMissingModel(): Promise<
    Array<{ id: string; agentId: string | null }>
  > {
    return this.meta.listWebSessionsWithMissingModel();
  }

  update(id: string, patch: Partial<SessionRow>): Promise<SessionRow | null> {
    return this.meta.update(id, patch);
  }

  updateLastActiveAt(id: string): Promise<void> {
    return this.meta.updateLastActiveAt(id);
  }

  backfillModelId(id: string, modelId: string): Promise<void> {
    return this.meta.backfillModelId(id, modelId);
  }

  /**
   * 创建会话：**先建资产容器再插行**。
   *
   * 顺序不可颠倒：目录存在性是个人版「幽灵行清理」的判据（库有行而目录无 →
   * 下次启动删行）。先插行再建目录会在两次操作之间留下可被误清理的窗口。
   */
  async create(input: CreateSessionInput): Promise<SessionRow> {
    await this.meta.startup?.();
    const row = await this.meta.create(input);
    await this.assets.ensure(row.id);
    return row;
  }

  /**
   * 删除会话（编配三处清理）：
   * 1. 删资产容器（附件/图片/workflow 快照）
   * 2. 删会话行（用量行由 meta 驱动同库级联，或由 usage 端口单独清理）
   * 3. 删用量明细（跨库部署时 meta 驱动删不到，这里兜底）
   *
   * 任一步失败不影响其余步骤（幂等重试能收敛）；返回该会话此前是否存在。
   */
  async deleteSession(id: string): Promise<boolean> {
    const existed = await this.meta.has(id);
    await this.assets.remove(id);
    const removed = await this.meta.deleteRows([id]);
    await this.usage.deleteBySession(id).catch((error: any) => {
      this.logger.warn(
        `删除会话用量失败（session=${id}）：${error?.message ?? error}`,
      );
      return 0;
    });
    return existed || removed > 0;
  }

  /** 级联删除多个会话 */
  async deleteMany(ids: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      if (await this.deleteSession(id)) n += 1;
    }
    return n;
  }

  /** 级联删除某父会话下的全部子会话 */
  async deleteChildrenOf(parentId: string): Promise<number> {
    const children = await this.query({ parentId }, 'createdAsc');
    let n = 0;
    for (const meta of children) {
      if (await this.deleteSession(meta.id)) n += 1;
    }
    return n;
  }

  clearGroup(groupId: string): Promise<number> {
    return this.meta.clearGroup(groupId);
  }

  /** 拷贝会话资产（分支/克隆用；源不存在静默跳过） */
  copyAssets(fromSessionId: string, toSessionId: string): Promise<void> {
    return this.assets.copy(fromSessionId, toSessionId);
  }

  // ============ 会话分组（透传） ============

  listGroups(): Promise<SessionGroupRow[]> {
    return this.groups.list();
  }

  findGroupById(id: string): Promise<SessionGroupRow | null> {
    return this.groups.findById(id);
  }

  /** 旧名别名：`SessionGroupPort.create` */
  createGroup(input: {
    name: string;
    sortOrder?: number;
    icon?: string | null;
    data?: Record<string, any> | null;
  }): Promise<SessionGroupRow> {
    return this.groups.create(input);
  }

  /** 旧名别名：`SessionGroupPort.update` */
  updateGroup(
    id: string,
    patch: Partial<Pick<SessionGroupRow, 'name' | 'sortOrder' | 'icon' | 'data'>>,
  ): Promise<SessionGroupRow | null> {
    return this.groups.update(id, patch);
  }

  /** 旧名别名：`SessionGroupPort.delete` */
  deleteGroup(id: string): Promise<{ id: string }> {
    return this.groups.delete(id);
  }

  getMaxGroupSortOrder(): Promise<number> {
    return this.groups.getMaxSortOrder();
  }

  batchUpdateGroupSortOrder(
    updates: Array<{ id: string; sortOrder: number }>,
  ): Promise<SessionGroupRow[]> {
    return this.groups.batchUpdateSortOrder(updates);
  }

  // ============ 目录分组（透传） ============

  listProjectGroups(): Promise<ProjectGroupRow[]> {
    return this.projectGroups.listProjectGroups();
  }

  findProjectGroup(id: string): Promise<ProjectGroupRow | null> {
    return this.projectGroups.findProjectGroup(id);
  }

  findProjectGroupByKey(pathKey: string): Promise<ProjectGroupRow | null> {
    return this.projectGroups.findProjectGroupByKey(pathKey);
  }

  ensureProjectGroup(input: {
    path: string;
    pathKey?: string;
    name?: string;
    position?: number;
    prepend?: boolean;
  }): Promise<ProjectGroupRow> {
    return this.projectGroups.ensureProjectGroup(input);
  }

  updateProjectGroup(
    id: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<ProjectGroupRow | null> {
    return this.projectGroups.updateProjectGroup(id, patch);
  }

  reorderProjectGroups(ids: string[]): Promise<ProjectGroupRow[]> {
    return this.projectGroups.reorderProjectGroups(ids);
  }

  deleteProjectGroup(id: string): Promise<{ id: string }> {
    return this.projectGroups.deleteProjectGroup(id);
  }

  listGroupCandidates() {
    return this.projectGroups.listGroupCandidates();
  }

  isProjectGroupsBootstrapped(): Promise<boolean> {
    return this.projectGroups.isBootstrapped();
  }

  markProjectGroupsBootstrapped(at: string): Promise<void> {
    return this.projectGroups.markBootstrapped(at);
  }
}
