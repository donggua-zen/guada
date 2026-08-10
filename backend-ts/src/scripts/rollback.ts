/**
 * 数据库迁移回滚脚本
 *
 * 用法:
 *   npm run db:rollback                # 回滚最后 1 个迁移
 *   npm run db:rollback -- --count 3   # 回滚最后 3 个迁移
 *
 * 前提:
 *   - 应用未在运行（避免数据库锁冲突）
 *   - DATABASE_URL 已设置
 *
 * 注意:
 *   - 回滚前会自动备份
 *   - 若迁移未提供 down 方法，将提示手动恢复备份
 *   - 回滚后需使用旧版本代码启动应用，否则 MigrationRunner 会重新执行迁移
 */

if (process.env.NODE_MODULES_PATH) {
  const Module = require("module");
  Module.globalPaths.unshift(process.env.NODE_MODULES_PATH);
}

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { MigrationRunner } from "../common/database/migration-runner.service";
import { PrismaService } from "../common/database/prisma.service";
import "dotenv/config";

async function main() {
  const args = process.argv.slice(2);
  let count = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      break;
    }
    if (args[i].startsWith("--count=")) {
      count = parseInt(args[i].split("=")[1], 10);
      break;
    }
  }

  if (isNaN(count) || count < 1) {
    console.error("Invalid count. Must be a positive integer.");
    process.exit(1);
  }

  console.log(`Preparing to rollback ${count} migration(s)...`);
  console.log("⚠️  Make sure the application is NOT running.\n");

  // 创建 NestJS 应用以获取依赖注入
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn"],
  });

  try {
    // 先连接 Prisma
    const prisma = app.get(PrismaService);
    await prisma.$connect();

    // 执行回滚
    const runner = app.get(MigrationRunner);
    await runner.rollback(count);

    console.log("\n✅ Rollback complete.");
    console.log(
      "⚠️  You must now run the OLD version of the application,",
    );
    console.log(
      "    otherwise MigrationRunner will re-apply the rolled-back migrations.",
    );
  } catch (error: any) {
    console.error("\n❌ Rollback failed:", error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

main();
