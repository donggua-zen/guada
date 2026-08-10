#!/usr/bin/env node
/**
 * 生成数据库迁移文件 + 重新生成 baseline
 *
 * 用法:
 *   npm run db:migrate:gen -- --name add_user_avatar
 *
 * 一次完成两件事:
 *   1. 生成增量迁移 SQL + TS 模板（给老用户升级）
 *   2. 重新生成 baseline.sql（给全新安装）
 *
 * 工作流:
 *   1. 修改 prisma/schema.prisma
 *   2. 运行此脚本
 *   3. 在 migrations/index.ts 注册迁移
 *   4. 如默认数据有变，更新 migrations/seed-data.ts
 *   5. 重启应用，MigrationRunner 自动执行迁移
 *
 * 注意: 需要本地数据库可访问（DATABASE_URL 已设置），
 *       且数据库已应用所有已有迁移（上次启动应用时已自动完成）。
 */

const { execSync } = require("child_process");
const { readdirSync, writeFileSync } = require("fs");
const { resolve, join } = require("path");

const backendRoot = resolve(__dirname, "..");
const migrationsDir = resolve(backendRoot, "src/common/database/migrations");
const baselineSqlPath = join(migrationsDir, "0001_baseline.sql");

// ─── 解析 --name 参数 ──────────────────────────────────

const args = process.argv.slice(2);
let name = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--name" && args[i + 1]) {
    name = args[i + 1];
    break;
  }
  if (args[i].startsWith("--name=")) {
    name = args[i].split("=")[1];
    break;
  }
}

if (!name) {
  console.error("Usage: npm run db:migrate:gen -- --name add_user_avatar");
  console.error("       npm run db:migrate:gen -- --name=fix_user_index");
  process.exit(1);
}

// snake_case / camelCase 转换
const snakeName = name.replace(/-/g, "_").replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
const camelName = snakeName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// ─── 1. 生成增量迁移 SQL ──────────────────────────────

const existingFiles = readdirSync(migrationsDir)
  .filter((f) => /^\d+_.*\.ts$/.test(f) && !f.startsWith("index."))
  .map((f) => parseInt(f.split("_")[0]))
  .sort((a, b) => a - b);

const nextId = (existingFiles[existingFiles.length - 1] || 0) + 1;
const paddedId = String(nextId).padStart(4, "0");

console.log(`\n[1/3] 生成增量迁移 "${snakeName}" (id: ${nextId})...\n`);

let sql;
try {
  sql = execSync(
    "npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script",
    {
      cwd: backendRoot,
      encoding: "utf-8",
    },
  );
} catch (e) {
  console.error("Failed to generate diff.");
  console.error("Make sure DATABASE_URL is set and the database is accessible.");
  console.error(e.stderr || e.message);
  process.exit(1);
}

// 清理 Prisma 版本提示等非 SQL 输出
sql = sql.trim();
if (!sql || sql.startsWith("No changes detected")) {
  console.log("No changes detected. The database schema is already up to date.");
  process.exit(0);
}

const sqlLines = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--") && !l.includes("┌"));
if (sqlLines.length === 0) {
  console.log("No SQL changes detected.");
  process.exit(0);
}

const cleanSql = sql
  .split("\n")
  .filter((l) => !l.includes("┌") && !l.includes("│") && !l.includes("└") && !l.includes("Update available"))
  .join("\n")
  .trim();

// 保存增量 SQL
const sqlFileName = `${paddedId}_${snakeName}.sql`;
const sqlFilePath = join(migrationsDir, sqlFileName);
writeFileSync(sqlFilePath, cleanSql + "\n");
console.log(`  ✓ 增量 SQL: src/common/database/migrations/${sqlFileName}`);

// 生成 TS 模板
const tsFileName = `${paddedId}_${snakeName}.ts`;
const tsFilePath = join(migrationsDir, tsFileName);
const tsContent = `import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { Migration } from "../migration.interface";

export const ${camelName}Migration: Migration = {
  id: ${nextId},
  name: "${snakeName}",
  description: "${snakeName}",

  up: async (db) => {
    const sqlPath = resolve(dirname(__filename), "${sqlFileName}");
    const sql = readFileSync(sqlPath, "utf-8");
    db.exec(sql);
  },
};
`;

writeFileSync(tsFilePath, tsContent);
console.log(`  ✓ 迁移模板: src/common/database/migrations/${tsFileName}`);

// ─── 2. 重新生成 baseline.sql ────────────────────────

console.log(`\n[2/3] 重新生成 baseline.sql...\n`);

try {
  const baselineSql = execSync(
    "npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script",
    {
      cwd: backendRoot,
      encoding: "utf-8",
    },
  );

  const cleanBaseline = baselineSql
    .split("\n")
    .filter((l) => !l.includes("┌") && !l.includes("│") && !l.includes("└") && !l.includes("Update available"))
    .join("\n")
    .trim();

  writeFileSync(baselineSqlPath, cleanBaseline + "\n");
  console.log(`  ✓ baseline: src/common/database/migrations/0001_baseline.sql`);
} catch (e) {
  console.error("  ✗ baseline 生成失败:", e.stderr || e.message);
  console.error("  可手动运行: npm run db:generate-baseline");
}

// ─── 3. 后续提示 ──────────────────────────────────────

console.log(`\n[3/3] 后续步骤:\n`);
console.log(`  1. 在 migrations/index.ts 注册:`);
console.log(`     import { ${camelName}Migration } from "./${paddedId}_${snakeName}";`);
console.log(`     // 追加到 allMigrations 数组`);
console.log(`  2. 如默认数据有变 → 更新 migrations/seed-data.ts`);
console.log(`  3. 重启应用，MigrationRunner 自动执行迁移`);
console.log("");
console.log("  Tip: 如需数据迁移逻辑，在 TS 文件的 up() 中添加 prisma 操作");
console.log("       如需回滚能力，添加可选的 down() 方法\n");
