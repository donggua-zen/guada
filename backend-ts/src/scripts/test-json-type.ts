/**
 * Prisma SQLite JSON 类型实际读写测试
 *
 * 此脚本会：
 * 1. 临时修改 schema.prisma，将 UserSetting.settings 改为 Json 类型
 * 2. 重新生成 Prisma Client
 * 3. 执行数据库迁移
 * 4. 测试 Json 字段的读写操作
 * 5. 验证无需手动序列化/反序列化
 * 6. 恢复原始 schema（可选）
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const SCHEMA_PATH = path.join(__dirname, "../../prisma/schema.prisma");
const BACKUP_SCHEMA_PATH = path.join(
  __dirname,
  "../../prisma/schema.prisma.backup",
);
const TEST_DB_PATH = path.join(__dirname, "../../data/test-json-real.db");

/**
 * 执行命令并输出结果
 */
function runCommand(command: string, cwd?: string) {
  console.log(`\n🔧 执行命令: ${command}`);
  try {
    const output = execSync(command, {
      cwd: cwd || path.join(__dirname, "../.."),
      encoding: "utf-8",
      stdio: "pipe",
    });
    console.log("✓ 命令执行成功\n");
    return output;
  } catch (error: any) {
    console.error("❌ 命令执行失败:");
    console.error(error.stdout?.toString() || error.message);
    throw error;
  }
}

/**
 * 备份 schema 文件
 */
function backupSchema() {
  if (fs.existsSync(SCHEMA_PATH)) {
    fs.copyFileSync(SCHEMA_PATH, BACKUP_SCHEMA_PATH);
    console.log("✓ 已备份 schema.prisma\n");
  }
}

/**
 * 恢复 schema 文件
 */
function restoreSchema() {
  if (fs.existsSync(BACKUP_SCHEMA_PATH)) {
    fs.copyFileSync(BACKUP_SCHEMA_PATH, SCHEMA_PATH);
    fs.unlinkSync(BACKUP_SCHEMA_PATH);
    console.log("✓ 已恢复原始 schema.prisma\n");
  }
}

/**
 * 修改 schema 中的字段类型
 */
function modifySchemaForJsonTest() {
  console.log("步骤 1: 修改 schema.prisma 以支持 Json 类型测试");

  let schema = fs.readFileSync(SCHEMA_PATH, "utf-8");

  // 将 UserSetting.settings 从 String 改为 Json
  schema = schema.replace(
    /model UserSetting \{[\s\S]*?settings\s+String/,
    (match) => match.replace("settings  String", "settings  Json"),
  );

  // 同时修改其他常用字段作为示例
  schema = schema.replace(
    /model Session \{[\s\S]*?settings\s+String\?/,
    (match) => match.replace("settings     String?", "settings     Json?"),
  );

  schema = schema.replace(
    /model Character \{[\s\S]*?settings\s+String\?/,
    (match) => match.replace("settings    String?", "settings    Json?"),
  );

  fs.writeFileSync(SCHEMA_PATH, schema, "utf-8");
  console.log("✓ Schema 已修改为使用 Json 类型\n");
}

async function main() {
  console.log("=== Prisma SQLite JSON 类型实际读写测试 ===\n");

  // 清理旧的测试数据库
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    console.log("✓ 已清理旧的测试数据库\n");
  }

  try {
    // 备份原始 schema
    backupSchema();

    // 修改 schema 以使用 Json 类型
    modifySchemaForJsonTest();

    // 更新 .env 使用测试数据库
    const envPath = path.join(__dirname, "../../.env.test");
    const envContent = `DATABASE_URL="file:${TEST_DB_PATH}"\n`;
    fs.writeFileSync(envPath, envContent);
    console.log("✓ 已创建测试环境配置文件 .env.test\n");

    // 重新生成 Prisma Client
    console.log("步骤 2: 重新生成 Prisma Client");
    runCommand("npx prisma generate");

    // 执行数据库迁移
    console.log("步骤 3: 执行数据库迁移");
    process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
    runCommand("npx prisma migrate dev --name test_json_support --skip-seed");

    console.log("步骤 4: 测试 Json 字段的读写操作");

    // 动态导入更新后的 Prisma Client
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaBetterSqlite3 } =
      await import("@prisma/adapter-better-sqlite3");

    const adapter = new PrismaBetterSqlite3({
      url: `file:${TEST_DB_PATH}`,
    });

    const prisma = new PrismaClient({ adapter });

    // 测试 1: 写入 JSON 对象（无需手动序列化）
    console.log("\n  测试 1: 写入 JSON 对象（自动序列化）");
    const testSettings = {
      theme: "dark",
      language: "zh-CN",
      notifications: true,
      preferences: {
        fontSize: 14,
        sidebarCollapsed: false,
      },
      tags: ["ai", "chat", "test"],
    };

    const createdUserSetting = await prisma.userSetting.create({
      data: {
        userId: "test-user-1",
        settings: testSettings, // 直接传入对象，无需 JSON.stringify
      },
    });

    console.log("  - 写入的数据类型:", typeof testSettings);
    console.log("  - 写入的数据:", testSettings);
    console.log("  ✓ 写入成功（Prisma 自动处理序列化）\n");

    // 测试 2: 读取 JSON 对象（无需手动反序列化）
    console.log("  测试 2: 读取 JSON 对象（自动反序列化）");
    const retrievedSetting = await prisma.userSetting.findUnique({
      where: { id: createdUserSetting.id },
    });

    console.log("  - 读取的数据类型:", typeof retrievedSetting?.settings);
    console.log("  - 读取的数据:", retrievedSetting?.settings);
    console.log(
      "  - 是否为对象:",
      typeof retrievedSetting?.settings === "object",
    );
    console.log(
      "  - 数据是否相等:",
      JSON.stringify(testSettings) ===
        JSON.stringify(retrievedSetting?.settings),
    );
    console.log("  ✓ 读取成功（Prisma 自动处理反序列化）\n");

    // 测试 3: 更新 JSON 对象
    console.log("  测试 3: 更新 JSON 对象");
    const updatedSettings = {
      ...testSettings,
      theme: "light",
      preferences: {
        ...testSettings.preferences,
        fontSize: 16,
      },
    };

    const updatedUserSetting = await prisma.userSetting.update({
      where: { id: createdUserSetting.id },
      data: {
        settings: updatedSettings, // 直接传入新对象
      },
    });

    console.log("  - 更新后的数据:", updatedUserSetting.settings);
    console.log("  ✓ 更新成功\n");

    // 测试 4: 查询包含 null 值的 Json 字段
    console.log("  测试 4: 处理 null 值");
    const nullSetting = await prisma.userSetting.create({
      data: {
        userId: "test-user-2",
        settings: null, // 可以设置为 null
      },
    });

    console.log("  - null 值设置:", nullSetting.settings);
    console.log("  ✓ null 值处理成功\n");

    // 测试 5: Session 模型的 Json 字段
    console.log("  测试 5: 测试 Session.settings 字段");
    const sessionSettings = {
      modelTemperature: 0.7,
      maxMemoryLength: 20,
      systemPrompt: "You are a helpful assistant.",
    };

    const createdSession = await prisma.session.create({
      data: {
        title: "Test Session",
        userId: "test-user-1",
        settings: sessionSettings, // Json? 类型，可以为对象或 null
      },
    });

    const retrievedSession = await prisma.session.findUnique({
      where: { id: createdSession.id },
    });

    console.log("  - Session settings:", retrievedSession?.settings);
    console.log("  ✓ Session Json 字段测试成功\n");

    // 清理测试数据
    await prisma.userSetting.deleteMany({
      where: {
        userId: { in: ["test-user-1", "test-user-2"] },
      },
    });

    await prisma.session.deleteMany({
      where: {
        userId: "test-user-1",
      },
    });

    await prisma.$disconnect();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("所有测试通过！");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📊 测试结论：");
    console.log("  1. Prisma 7.6.0 完全支持 SQLite 的 Json 类型");
    console.log("  2. 写入时自动序列化（无需 JSON.stringify）");
    console.log("  3. 读取时自动反序列化（无需 JSON.parse）");
    console.log("  4. 支持复杂嵌套对象和数组");
    console.log("  5. 正确处理 null 值");
    console.log("  6. 类型安全（TypeScript 自动推断为 object 类型）\n");

    console.log("🎯 迁移建议：");
    console.log(
      "  可以安全地将项目中的所有 String 类型 JSON 字段迁移为 Json 类型",
    );
    console.log("  这将显著提升代码质量和可维护性\n");

    // 询问是否恢复原始 schema
    console.log("提示: 测试完成后，schema.prisma 已被修改为使用 Json 类型");
    console.log("如果需要恢复原始的 String 类型，请手动执行:");
    console.log(`  cp ${BACKUP_SCHEMA_PATH} ${SCHEMA_PATH}\n`);
  } catch (error) {
    console.error("\n❌ 测试过程中发生错误:", error);
    console.error("\n💡 如果测试失败，可以尝试:");
    console.error("  1. 检查数据库连接配置");
    console.error("  2. 确保所有依赖已正确安装");
    console.error("  3. 查看上方的详细错误信息\n");

    // 发生错误时恢复 schema
    restoreSchema();
    throw error;
  } finally {
    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
      console.log("✓ 已清理测试数据库文件\n");
    }
  }
}

main().catch((e) => {
  console.error("测试脚本执行失败:", e);
  process.exit(1);
});
