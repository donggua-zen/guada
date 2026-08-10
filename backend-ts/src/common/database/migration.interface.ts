import type Database from "better-sqlite3";

/**
 * PrismaClient 最小接口约束
 *
 * 迁移文件使用此类型进行数据操作，避免直接依赖生成的 Prisma Client 类型。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaClientLike = { [key: string]: any };

/**
 * 数据库迁移定义
 *
 * 每个 Migration 代表一次原子性的数据库变更，可以是：
 * - 纯 DDL（CREATE TABLE / ALTER TABLE / CREATE INDEX）— 通过 SQL 文件执行
 * - 纯数据迁移（UPDATE / DELETE / INSERT）— 通过 Prisma 执行
 * - 混合迁移（先改结构再迁移数据）
 *
 * 迁移按 id 升序执行，每个迁移执行后记录到 `_app_migrations` 表。
 *
 * 降级（rollback）：通过 `down` 方法实现，从最新迁移开始逆序回滚。
 * 若迁移未提供 `down`，则回退到备份恢复（最近一次 .bak 文件）。
 */
export interface Migration {
  /** 迁移 ID，全局唯一且递增 */
  id: number;
  /** 迁移名称（snake_case），存储到 _app_migrations.name */
  name: string;
  /** 人类可读描述，仅用于日志 */
  description: string;

  /**
   * 执行迁移逻辑（升级方向）。
   *
   * @param db - better-sqlite3 Database 实例（同步 API），用于 DDL 和原始 SQL
   * @param prisma - PrismaClient 实例（异步 API），用于类型安全的数据 CRUD
   */
  up: (db: Database.Database, prisma: PrismaClientLike) => Promise<void>;

  /**
   * 回滚迁移逻辑（降级方向）。可选。
   *
   * 提供此方法后，可通过 `npm run db:rollback` 逆序回滚迁移。
   * 未提供时，回滚将退回到备份文件恢复。
   *
   * 注意：SQLite 对 DDL 回滚支持有限（如 DROP COLUMN 在旧版本不可用），
   * 复杂结构回滚建议依赖备份恢复而非手写 down。
   */
  down?: (db: Database.Database, prisma: PrismaClientLike) => Promise<void>;
}
