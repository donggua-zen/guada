import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";
import { seedDefaultData } from "./seed-data";

/**
 * 基线迁移 — 创建完整数据库 schema + 默认数据
 *
 * - 新安装: 执行 0001_baseline.sql 创建所有表，然后执行 seed 创建默认数据
 * - 旧版 0.5.2 升级: 由 MigrationRunner.bootstrapLegacyInstall() 标记为已应用，跳过执行
 */
export const baselineMigration: Migration = {
  id: 1,
  name: "baseline",
  description: "初始基线 — 创建所有表结构 + 默认数据",

  up: async (db, prisma) => {
    // 1. 执行 DDL（从构建时生成的 SQL 文件）
    const sqlPath = resolve(dirname(__filename), "0001_baseline.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);

    // 2. 执行 seed（创建默认管理员用户 + 角色）
    await seedDefaultData(prisma);
  },
};
