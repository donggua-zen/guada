/**
 * 测试用的存储组合件：把 SQLite 的三个驱动拼成一个「旧 SessionMetaStore 形状」的对象。
 *
 * 为什么需要它：改造前的 spec 直接 `new SessionMetaStore()` 后既调行级 API
 * （`create/get/query`）又调分组 API（`listProjectGroups/ensureProjectGroup`）——
 * 那是「一个类三合一」的旧形态。拆分后这三类能力分别落在 meta/group/asset 驱动上，
 * 生产环境由 `SessionStoreFacade` 组合；测试里用本助手做同样的事，
 * 避免每个 spec 重复拼装。
 *
 * 只用于测试：生产代码请注入 `SESSION_STORE_TOKEN`。
 */
import { assertValidId } from '../../common/utils/session-path.util';
import type { SessionMetaPort } from '../../common/store/ports/session-meta.port';
import type {
  ProjectGroupPort,
  SessionGroupPort,
} from '../../common/store/ports/group.port';
import type {
  SessionAssetPort,
  SessionGroupRow,
  SessionRow,
} from '../../common/store/ports/types';
import { SqliteSessionMetaDriver } from '../../common/store/drivers/sqlite/sqlite-session-meta.driver';
import { SqliteGroupDriver } from '../../common/store/drivers/sqlite/sqlite-group.driver';
import { FsSessionAssetDriver } from '../../common/store/drivers/fs/fs-session-asset.driver';

/**
 * 合并后的实例类型：既有行级 API，也有分组/资产 API。
 *
 * 用显式交叉而非 `typeof 驱动A & typeof 驱动B`：三个驱动各有私有字段
 * （`sessionsRoot` 等），TS 会把私有成员冲突的交叉类型塌成 `never`。
 */
export type TestSessionStore = SessionMetaPort &
  SessionGroupPort &
  ProjectGroupPort &
  SessionAssetPort & {
    onModuleDestroy(): void;
    /** 旧类名兼容：等价于端口的 `startup()` */
    initialize(): Promise<void>;
    // ─── 旧 SessionMetaStore 方法名别名（与 SessionStoreFacade 一致）───
    /** 旧语义：未命中返回 `undefined`（端口返回 `null`） */
    getMeta(id: string): Promise<SessionRow | undefined>;
    listGroups(): Promise<SessionGroupRow[]>;
    /** 旧语义：未命中返回 `undefined`（端口返回 `null`） */
    findGroupById(id: string): Promise<SessionGroupRow | undefined>;
    createGroup(input: {
      name: string;
      sortOrder?: number;
      icon?: string | null;
      data?: Record<string, any> | null;
    }): Promise<SessionGroupRow>;
    updateGroup(
      id: string,
      patch: Partial<Pick<SessionGroupRow, 'name' | 'sortOrder' | 'icon' | 'data'>>,
    ): Promise<SessionGroupRow | undefined>;
    deleteGroup(id: string): Promise<{ id: string }>;
    getMaxGroupSortOrder(): Promise<number>;
    batchUpdateGroupSortOrder(
      updates: Array<{ id: string; sortOrder: number }>,
    ): Promise<SessionGroupRow[]>;
    /** 分支克隆：只拷资产子目录（与 SessionStoreFacade 同名） */
    copyAssets(fromSessionId: string, toSessionId: string): Promise<void>;
    /** 旧语义：删资产 + 删行（含非法 id 校验） */
    deleteSession(id: string): Promise<boolean>;
    deleteMany(ids: string[]): Promise<number>;
    deleteChildrenOf(parentId: string): Promise<number>;
  };

/**
 * 构造测试用存储。
 *
 * 三个驱动各自懒开同一个 `_meta.db` 文件（better-sqlite3 允许多连接）。
 * 注意：方法一律绑定到**各自驱动实例**（而不是合并对象），因此连接始终开在
 * 驱动自己的 `db` 字段上——关闭时必须逐个驱动关，不能在合并对象上找 `db`。
 */
export function createTestSessionStore(): TestSessionStore {
  const meta = new SqliteSessionMetaDriver();
  const groups = new SqliteGroupDriver();
  const assets = new FsSessionAssetDriver();

  // 以 meta 为原型基座（行级 API 占多数），再挂分组/资产方法。
  // 关键：meta 的方法必须**绑定到 meta 实例**——驱动内部用 `this.db` 持有连接，
  // 若方法在 merged 上以 `this=merged` 调用，连接会挂到 merged 自己身上，
  // onModuleDestroy 关不掉（Windows 下临时目录随后 rm 会 EPERM）。
  const merged = Object.create(meta) as TestSessionStore;
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(meta))) {
    if (key === 'constructor') continue;
    (merged as any)[key] = (meta as any)[key].bind(meta);
  }
  for (const source of [groups, assets]) {
    for (const key of Object.getOwnPropertyNames(
      Object.getPrototypeOf(source),
    )) {
      if (key === 'constructor') continue;
      if (key in merged) continue;
      (merged as any)[key] = (source as any)[key].bind(source);
    }
  }

  // 生命周期收口：三个驱动的连接都要关。
  // 必须显式逐个关闭：merged 自身不持有 db 字段，只在各驱动实例上。
  (merged as any).onModuleDestroy = () => {
    (meta as any).onModuleDestroy?.();
    (groups as any).onModuleDestroy?.();
    // asset 驱动无连接，无需关闭
  };

  // 旧类名兼容：spec 普遍调 initialize()
  (merged as any).initialize = () => meta.startup();

  // 旧类名兼容别名（与 SessionStoreFacade 保持一致）
  (merged as any).getMeta = async (id: string) =>
    (await meta.get(id)) ?? undefined;
  (merged as any).listGroups = () => groups.list();
  // 旧 API 用 undefined 表达未命中；端口用 null
  (merged as any).findGroupById = async (id: string) =>
    (await groups.findById(id)) ?? undefined;
  (merged as any).createGroup = (input: any) => groups.create(input);
  (merged as any).updateGroup = async (id: string, patch: any) =>
    (await groups.update(id, patch)) ?? undefined;
  (merged as any).deleteGroup = (id: string) => groups.delete(id);
  (merged as any).getMaxGroupSortOrder = () => groups.getMaxSortOrder();
  (merged as any).batchUpdateGroupSortOrder = (updates: any) =>
    groups.batchUpdateSortOrder(updates);

  // 分支克隆走资产端口（只拷 images/previews/workflows，不复制事件日志）
  (merged as any).copyAssets = (from: string, to: string) => assets.copy(from, to);

  // 旧名：deleteSession 会同时清资产（旧实现是「校验 id → 整目录 rm → 删行」）
  (merged as any).deleteSession = async (id: string) => {
    // 旧实现的第一道防线：非法 id（`..`/分隔符/保留字）必须挡在整目录删除之前
    assertValidId(id);
    const existed = await meta.has(id);
    await assets.remove(id);
    await meta.deleteRows([id]);
    return existed;
  };
  (merged as any).deleteMany = async (ids: string[]) => {
    let n = 0;
    for (const id of ids) {
      if (await (merged as any).deleteSession(id)) n += 1;
    }
    return n;
  };
  (merged as any).deleteChildrenOf = async (parentId: string) => {
    const children = await meta.childrenOf(parentId);
    let n = 0;
    for (const child of children) {
      if (await (merged as any).deleteSession(child.id)) n += 1;
    }
    return n;
  };

  return merged;
}
