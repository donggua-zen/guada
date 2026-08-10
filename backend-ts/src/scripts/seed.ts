/**
 * 数据库种子脚本（开发工具）
 *
 * 用于开发环境快速重置数据库并导入默认数据。
 * 生产环境的首次初始化由后端 MigrationRunner 自动完成，不需要此脚本。
 *
 * 使用方法:
 *   npm run db:seed           # 交互式，需要确认
 *   npm run db:seed --force   # 强制模式，无需确认
 */

// 在 Electron 生产环境中，确保加载正确的原生模块
if (process.env.NODE_MODULES_PATH) {
  const Module = require("module");
  Module.globalPaths.unshift(process.env.NODE_MODULES_PATH);
}

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import "dotenv/config";
import { seedDefaultData } from "../common/database/migrations/seed-data";

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
const dbPath = databaseUrl.replace(/^file:/, "");
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

// 颜色输出工具
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logSuccess(message: string) {
  log(`${message}`, colors.green);
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message: string) {
  log(`${message}`, colors.red);
}

function logSection(title: string) {
  log("\n" + "=".repeat(60), colors.cyan);
  log(title, colors.cyan);
  log("=".repeat(60) + "\n", colors.cyan);
}

/**
 * 重置数据库并导入种子数据
 */
async function seedDatabase(force: boolean = false) {
  logSection("数据库种子初始化工具");
  logInfo(`时间：${new Date().toISOString()}`);
  logSection("");

  // 警告提示（仅开发环境且非强制模式下）
  const isProduction = process.env.NODE_ENV === "production";
  if (!force && !isProduction) {
    console.log("\n⚠️  警告：此操作将执行以下动作：");
    console.log("   1. 删除现有数据库文件（不可恢复！）");
    console.log("   2. 从 baseline SQL 重新创建表结构");
    console.log("   3. 导入默认测试数据");
    console.log("\n确保你已经备份了重要数据！\n");

    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      readline.question("是否继续？请输入 'yes' 确认：", (input: string) => {
        readline.close();
        resolve(input);
      });
    });

    if (answer.toLowerCase() !== "yes") {
      logInfo("用户取消操作");
      process.exit(0);
    }

    console.log("\n开始执行...\n");
  }

  try {
    // 步骤 1: 删除旧数据库文件
    logSection("步骤 1: 删除旧数据库文件");
    for (const ext of ["", "-wal", "-shm"]) {
      const filePath = dbPath + ext;
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        logInfo(`已删除: ${filePath}`);
      }
    }

    // 步骤 2: 从 baseline SQL 创建表结构
    logSection("步骤 2: 创建表结构");
    const sqlPath = resolve(__dirname, "../common/database/migrations/0001_baseline.sql");
    if (!existsSync(sqlPath)) {
      throw new Error(`Baseline SQL 文件不存在: ${sqlPath}`);
    }
    const sql = readFileSync(sqlPath, "utf-8");
    const db = new Database(dbPath);
    db.exec(sql);
    db.close();
    logSuccess("表结构创建成功");

    // 步骤 3: 导入默认数据
    logSection("步骤 3: 导入默认测试数据");
    await seedDefaultData(prisma);

    logSection("数据库种子初始化完成！");
    log("\n默认登录信息:", colors.green);
    log("  用户名：guada", colors.green);
    log("  密码：guada", colors.green);
    log("\n" + "=".repeat(60) + "\n", colors.cyan);
  } catch (error) {
    logSection("种子初始化失败");
    logError(
      `错误详情：${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    logInfo("数据库连接已关闭");
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  await seedDatabase(force);
}

// 执行
main().catch((error) => {
  logError(`未捕获的错误：${error.message}`);
  console.error(error);
  process.exit(1);
});
