/**
 * 兼容层：把旧的 `SessionMetaStore` 导入面转发到新的端口实现。
 *
 * 这是**过渡期的单一收口**，目的是让存量 import（`session-meta.store` 的
 * `SessionMeta`、`toRow`、`openMetaDb`、迁移助手、spec 里的 `new SessionMetaStore()`）
 * 一行不改也能编译；真正的新代码应直接从 `common/store` 取端口与类型。
 *
 * 删除条件：全部调用点改用 `SESSION_STORE_TOKEN` / 端口类型后即可整文件删除
 * （`grep -r "session-meta.store"` 应只剩本文件）。
 */
import { Injectable } from '@nestjs/common';

export {
  META_DB_FILE,
  SESSION_META_DB_VERSION,
  PROJECT_GROUPS_BOOTSTRAPPED_KEY,
  GENERAL_PROJECT_GROUP_ID,
  META_COLUMNS,
  buildDataJson,
  escapeLike,
  inspectOrphanLogContent,
  isPlainObject,
  openMetaDb,
  migrateMetaDbSchema,
  projectGroupFromRow,
  readMetaRow,
  replaceAllGroups,
  backfillRootIds,
  importSessionMetaRows,
  rowToMeta,
  sessionGroupFromRow,
  toISO,
  upsertMetaRow,
} from '../../common/store/drivers/sqlite/meta-schema';

export type {
  ProjectGroupRow as ProjectGroupMeta,
  SessionGroupRow as SessionGroupMeta,
  SessionRow as SessionMeta,
} from '../../common/store/ports/types';

export type {
  SessionQueryFilter,
  SessionQueryPage,
  SessionSortKey,
  PagedSessionRows as PagedQueryResult,
} from '../../common/store/ports/types';

/** 新建会话 id 前缀（统一铸造见 common/utils/id.util.ts） */
export { ID_PREFIXES } from '../../common/utils/id.util';

/**
 * 旧类名别名 —— 指向 SQLite 元信息驱动。
 *
 * 注意：本类**只**负责会话行，不再承担分组与目录分组的读写（那些已拆到
 * `SqliteGroupDriver`）。存量 spec 若只用行级 API 可直接沿用；一旦调分组
 * 方法，请改用 `SessionStoreFacade`。
 */
export { SqliteSessionMetaDriver as SessionMetaStore } from '../../common/store/drivers/sqlite/sqlite-session-meta.driver';

/**
 * 旧的 `toRow`：把 ISO 字符串行转成 Date 形状（兼容既有前端/调用方）。
 *
 * 端口层统一用 ISO 字符串；只有显式需要 `Date` 的调用点才走这里，
 * 让「介质无关」与「HTTP 线格式」不被 Date 实例污染。
 */
export function toRow(meta: Record<string, any>): Record<string, any> {
  return {
    ...meta,
    createdAt: new Date(meta.createdAt),
    updatedAt: new Date(meta.updatedAt),
    lastActiveAt: meta.lastActiveAt ? new Date(meta.lastActiveAt) : null,
    closedAt: meta.closedAt ? new Date(meta.closedAt) : null,
  };
}
