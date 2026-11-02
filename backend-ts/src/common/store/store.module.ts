/**
 * 存储模块（全局）：装配端口 → 驱动 → 门面
 *
 * 这一层是「换存储后端」的唯一接线点：
 * - 核心发货 `sqlite`（会话行/分组/目录分组/用量）+ `jsonl`（事件日志）
 * - 企业包在自己的入口先 `registerStoreDriver(...)`，再引入本模块；
 *   本模块按 `GUADA_STORE_DRIVER*` 环境变量解析已注册的工厂
 *
 * 依赖方向单向：核心不出现企业包名，企业包依赖核心。
 */
import { Global, Module, Logger } from '@nestjs/common';

import { SESSION_META_PORT } from './ports/session-meta.port';
import type { SessionMetaPort } from './ports/session-meta.port';
import {
  PROJECT_GROUP_PORT,
  SESSION_GROUP_PORT,
} from './ports/group.port';
import type { ProjectGroupPort, SessionGroupPort } from './ports/group.port';
import { USAGE_PORT } from './ports/usage.port';
import type { UsagePort } from './ports/usage.port';
import type { SessionAssetPort } from './ports/types';
import { SESSION_ASSET_PORT } from './ports/types';
import { createStoreDriver, resolveStoreDriverName } from './driver-registry';
import { SqliteSessionMetaDriver } from './drivers/sqlite/sqlite-session-meta.driver';
import { SqliteGroupDriver } from './drivers/sqlite/sqlite-group.driver';
import { FsSessionAssetDriver } from './drivers/fs/fs-session-asset.driver';
import { SessionStoreFacade, SESSION_STORE_TOKEN } from '../../modules/chat/session-store.facade';
import { UsageStore } from '../../modules/usage/usage.store';

const logger = new Logger('StoreModule');

@Global()
@Module({
  providers: [
    // 内置驱动：既是默认实现，也是 `createStoreDriver` 的 fallback。
    // 介质要分清：前三个与 UsageStore 走 `_meta.db`（sqlite），
    // FsSessionAssetDriver 是纯文件系统（不碰 SQLite）。
    SqliteSessionMetaDriver,
    SqliteGroupDriver,
    FsSessionAssetDriver,
    UsageStore,

    {
      provide: SESSION_META_PORT,
      inject: [SqliteSessionMetaDriver],
      useFactory: (sqlite: SqliteSessionMetaDriver): SessionMetaPort =>
        createStoreDriver<SessionMetaPort>('sessions', () => sqlite),
    },
    {
      provide: SESSION_GROUP_PORT,
      inject: [SqliteGroupDriver],
      useFactory: (sqlite: SqliteGroupDriver): SessionGroupPort =>
        createStoreDriver<SessionGroupPort>('sessions', () => sqlite),
    },
    {
      provide: PROJECT_GROUP_PORT,
      inject: [SqliteGroupDriver],
      useFactory: (sqlite: SqliteGroupDriver): ProjectGroupPort =>
        createStoreDriver<ProjectGroupPort>('sessions', () => sqlite),
    },
    {
      provide: SESSION_ASSET_PORT,
      // 资产单独成域：企业版通常是「关系库存元信息 + 对象存储存附件」，
      // 与 sessions 域介质不同，不能共用一个驱动实例。
      inject: [FsSessionAssetDriver],
      useFactory: (fsDriver: FsSessionAssetDriver): SessionAssetPort =>
        createStoreDriver<SessionAssetPort>('assets', () => fsDriver),
    },
    {
      provide: USAGE_PORT,
      inject: [UsageStore],
      useFactory: (sqlite: UsageStore): UsagePort =>
        createStoreDriver<UsagePort>('usage', () => sqlite),
    },

    {
      provide: SESSION_STORE_TOKEN,
      inject: [
        SESSION_META_PORT,
        SESSION_GROUP_PORT,
        PROJECT_GROUP_PORT,
        USAGE_PORT,
        SESSION_ASSET_PORT,
      ],
      useFactory: (
        meta: SessionMetaPort,
        groups: SessionGroupPort,
        projectGroups: ProjectGroupPort,
        usage: UsagePort,
        assets: SessionAssetPort,
      ) => new SessionStoreFacade(meta, groups, projectGroups, usage, assets),
    },
  ],
  exports: [
    SESSION_STORE_TOKEN,
    SESSION_META_PORT,
    SESSION_GROUP_PORT,
    PROJECT_GROUP_PORT,
    SESSION_ASSET_PORT,
    USAGE_PORT,
  ],
})
export class StoreModule {
  constructor() {
    // 只报本模块装配的域：messages 属 PersistenceModule，由它自己报，
    // 避免「日志说 postgres、实际走 JSONL」这类误导。
    logger.log(
      `存储驱动 sessions=${resolveStoreDriverName('sessions')} ` +
        `assets=${resolveStoreDriverName('assets')} ` +
        `usage=${resolveStoreDriverName('usage')}`,
    );
  }
}
