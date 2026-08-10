import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "./prisma.service";
import { allMigrations } from "./migrations";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

/**
 * 迁移追踪表 DDL — 在 MigrationRunner 启动时执行，确保表存在。
 * 不作为 Migration 注册，是元基础设施。
 */
const MIGRATION_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS _app_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

/**
 * 数据库迁移运行器
 *
 * 在 NestJS 应用启动时（app.listen 之前）自动执行：
 *
 * 三种安装场景：
 * 1. 全新安装（无业务表）：执行 baseline（创建最新 schema + seed），
 *    然后标记所有已注册迁移为已应用（baseline 已包含所有结构变更）
 * 2. 0.5.2 旧版升级（有业务表但无 _app_migrations）：标记所有迁移为已应用
 * 3. 已迁移版本升级：按 id 顺序执行 pending 迁移
 *
 * 关键设计：baseline.sql 和 seed-data.ts 始终代表最新完整快照。
 * 全新安装一步到位，不需要走迁移链。增量迁移仅用于老用户升级。
 *
 * 运行时零 Prisma CLI 依赖，使用 better-sqlite3 直接执行 DDL。
 */
@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger("MigrationRunner");
  private readonly dbPath: string;
  private readonly dataDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const dbUrl =
      configService.get<string>("DATABASE_URL") || "file:./data/ai_chat.db";
    this.dbPath = dbUrl.replace(/^file:/, "");
    this.dataDir = path.dirname(this.dbPath);
  }

  async onModuleInit() {
    await this.run();
  }

  private async run(): Promise<void> {
    // 1. 确保数据目录存在
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // 2. 打开 DB（better-sqlite3 同步 API，用于 DDL + 迁移追踪）
    const db = new Database(this.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 60000");
    db.pragma("foreign_keys = ON");

    try {
      // 3. 确保迁移追踪表存在
      db.exec(MIGRATION_TABLE_DDL);

      // 4. 判断安装场景
      const migrationCount = (
        db
          .prepare("SELECT COUNT(*) as c FROM _app_migrations")
          .get() as { c: number }
      ).c;

      const hasSessionTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='session'",
        )
        .get();

      // 场景 1: 全新安装（无业务表 + 无迁移记录）
      if (migrationCount === 0 && !hasSessionTable) {
        await this.freshInstall(db);
        return;
      }

      // 场景 2: 0.5.2 旧版升级（有业务表 + 无迁移记录）
      if (migrationCount === 0 && hasSessionTable) {
        this.bootstrapLegacyInstall(db);
        return;
      }

      // 场景 3: 已迁移版本升级 — 执行 pending 迁移
      const appliedRows = db
        .prepare("SELECT id FROM _app_migrations ORDER BY id")
        .all() as { id: number }[];
      const appliedIds = new Set(appliedRows.map((r) => r.id));

      const pending = allMigrations
        .filter((m) => !appliedIds.has(m.id))
        .sort((a, b) => a.id - b.id);

      if (pending.length === 0) {
        this.logger.log("没有待执行的数据库迁移");
        return;
      }

      this.logger.log(`检测到 ${pending.length} 个待执行迁移`);

      // 迁移前备份
      this.backupDatabase(db);

      for (const migration of pending) {
        await this.executeMigration(db, migration);
      }

      this.logger.log(`数据库迁移完成，共执行 ${pending.length} 个迁移`);
    } finally {
      db.close();
    }
  }

  /**
   * 全新安装：执行 baseline 创建最新 schema + seed，然后标记所有迁移为已应用
   *
   * baseline.sql 始终代表最新完整 schema，seed-data.ts 始终代表最新默认数据。
   * 因此新安装一步到位，无需走迁移链。
   */
  private async freshInstall(db: Database.Database): Promise<void> {
    this.logger.log("检测到全新安装，执行基线迁移...");

    const baseline = allMigrations.find((m) => m.id === 1);
    if (!baseline) {
      throw new Error("基线迁移 (id=1) 未注册，无法执行全新安装");
    }

    // 执行 baseline：创建最新 schema + seed 默认数据
    await baseline.up(db, this.prisma as any);

    // 标记所有已注册迁移为已应用
    // baseline 已包含所有结构变更，seed-data 已包含所有数据变更
    const insertStmt = db.prepare(
      "INSERT INTO _app_migrations (id, name) VALUES (?, ?)",
    );
    const insertAll = db.transaction((migrations: typeof allMigrations) => {
      for (const m of migrations) {
        insertStmt.run(m.id, m.name);
      }
    });
    insertAll(allMigrations);

    this.logger.log(
      `全新安装完成，已标记 ${allMigrations.length} 个迁移为已应用`,
    );
  }

  /**
   * 引导旧版安装（0.5.2 db push 时代）
   *
   * 检测条件: _app_migrations 表为空，但业务表已存在。
   * 处理逻辑: 标记所有已注册迁移为已应用（schema 和数据已在 0.5.2 中就位）。
   */
  private bootstrapLegacyInstall(db: Database.Database): void {
    this.logger.log("检测到旧版数据库安装（0.5.2），执行引导迁移...");

    const insertStmt = db.prepare(
      "INSERT INTO _app_migrations (id, name) VALUES (?, ?)",
    );
    const insertAll = db.transaction((migrations: typeof allMigrations) => {
      for (const m of migrations) {
        insertStmt.run(m.id, m.name);
      }
    });
    insertAll(allMigrations);

    this.logger.log(
      `已标记 ${allMigrations.length} 个迁移为已应用（旧版 schema 已存在）`,
    );
  }

  private async executeMigration(
    db: Database.Database,
    migration: (typeof allMigrations)[number],
  ): Promise<void> {
    this.logger.log(
      `执行迁移 ${migration.id}: ${migration.name} — ${migration.description}`,
    );

    try {
      // 执行迁移逻辑
      await migration.up(db, this.prisma as any);

      // 记录迁移已应用
      db.prepare(
        "INSERT INTO _app_migrations (id, name) VALUES (?, ?)",
      ).run(migration.id, migration.name);

      this.logger.log(`迁移 ${migration.id}: ${migration.name} 完成`);
    } catch (error: any) {
      this.logger.error(
        `迁移 ${migration.id}: ${migration.name} 失败: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 回滚迁移（降级）
   *
   * 从最新已应用迁移开始逆序回滚，共回滚 count 个。
   * - 若迁移提供了 down 方法，执行 down 逻辑
   * - 若未提供 down，回退到备份恢复
   *
   * @param count 回滚的迁移数量，默认 1
   */
  async rollback(count: number = 1): Promise<void> {
    const db = new Database(this.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 60000");
    db.pragma("foreign_keys = ON");

    try {
      const appliedRows = db
        .prepare("SELECT id, name FROM _app_migrations ORDER BY id DESC")
        .all() as { id: number; name: string }[];

      if (appliedRows.length === 0) {
        this.logger.log("没有已应用的迁移可回滚");
        return;
      }

      const toRollback = appliedRows.slice(0, count);
      const migrationMap = new Map(allMigrations.map((m) => [m.id, m]));

      // 备份
      this.backupDatabase(db);

      for (const row of toRollback) {
        const migration = migrationMap.get(row.id);

        if (!migration) {
          this.logger.warn(
            `迁移 ${row.id}: ${row.name} 未在代码中找到，跳过回滚（仅删除记录）`,
          );
          db.prepare("DELETE FROM _app_migrations WHERE id = ?").run(row.id);
          continue;
        }

        if (!migration.down) {
          this.logger.warn(
            `迁移 ${row.id}: ${row.name} 未提供 down 方法，无法程序化回滚`,
          );
          this.logger.warn(
            `如需回滚，请手动恢复备份: ${this.dbPath}.bak.*`,
          );
          break;
        }

        this.logger.log(
          `回滚迁移 ${migration.id}: ${migration.name} — ${migration.description}`,
        );

        try {
          await migration.down(db, this.prisma as any);
          db.prepare("DELETE FROM _app_migrations WHERE id = ?").run(row.id);
          this.logger.log(`迁移 ${migration.id}: ${migration.name} 已回滚`);
        } catch (error: any) {
          this.logger.error(
            `回滚迁移 ${migration.id}: ${migration.name} 失败: ${error.message}`,
            error.stack,
          );
          throw error;
        }
      }
    } finally {
      db.close();
    }
  }

  private backupDatabase(db: Database.Database): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.dbPath}.bak.${timestamp}`;

    // WAL checkpoint 确保数据合并到主文件
    db.pragma("wal_checkpoint(TRUNCATE)");

    fs.copyFileSync(this.dbPath, backupPath);
    this.logger.log(`迁移前备份: ${backupPath}`);

    // 清理旧备份（保留 3 个）
    const dbBasename = path.basename(this.dbPath);
    const backups = fs
      .readdirSync(this.dataDir)
      .filter((f) => f.startsWith(dbBasename + ".bak."))
      .sort()
      .reverse();
    for (let i = 3; i < backups.length; i++) {
      fs.unlinkSync(path.join(this.dataDir, backups[i]));
    }
  }
}
