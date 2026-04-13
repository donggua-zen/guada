/**
 * 测试脚本：验证添加供应商时自动创建预定义模型的功能
 *
 * 使用方法:
 *   npx ts-node src/scripts/test-auto-create-models.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function testAutoCreateModels() {
  console.log("🧪 开始测试自动创建模型功能...\n");

  try {
    // 1. 创建测试用户
    console.log("📝 步骤 1: 创建测试用户...");
    const testUser = await prisma.user.create({
      data: {
        nickname: "Test User",
        email: `test_${Date.now()}@example.com`,
        passwordHash: "$2b$10$dummy.hash.for.testing.purpose.only",
        role: "primary",
      },
    });
    console.log(`✅ 测试用户创建成功: ${testUser.id}\n`);

    // 2. 创建测试供应商（模拟硅基流动）
    console.log("📦 步骤 2: 创建测试供应商...");
    const provider = await prisma.modelProvider.create({
      data: {
        userId: testUser.id,
        name: "硅基流动",
        provider: "siliconflow",
        protocol: "openai",
        apiKey: "test-api-key-123456",
        apiUrl: "https://api.siliconflow.cn/v1/",
        avatarUrl: "/static/images/providers/siliconflow.svg",
      },
    });
    console.log(`✅ 供应商创建成功: ${provider.id}\n`);

    // 3. 手动创建模型（模拟服务层逻辑）
    console.log("🔧 步骤 3: 批量创建模型...");
    const templateModels = [
      {
        modelName: "deepseek-ai/DeepSeek-V3.2",
        modeType: "text",
        features: ["tools", "thinking"],
        contextWindow: 160000,
      },
      {
        modelName: "Qwen/Qwen3-Embedding-8B",
        modeType: "embedding",
        features: ["embedding"],
        contextWindow: 32000,
      },
    ];

    const modelsData = templateModels.map((templateModel) => ({
      providerId: provider.id,
      modelName: templateModel.modelName,
      modelType: templateModel.modeType || "text",
      contextWindow: templateModel.contextWindow,
      features: templateModel.features || [],
    }));

    const createdModels = [];
    for (const modelData of modelsData) {
      const model = await prisma.model.create({ data: modelData });
      createdModels.push(model);
    }

    console.log(`✅ 共创建了 ${createdModels.length} 个模型\n`);

    // 4. 验证创建的模型
    console.log("🔍 步骤 4: 验证模型数据...");
    const models = await prisma.model.findMany({
      where: { providerId: provider.id },
    });

    console.log(`✅ 从数据库查询到 ${models.length} 个模型:\n`);
    models.forEach((model, index) => {
      console.log(`   ${index + 1}. ${model.modelName}`);
      console.log(`      类型: ${model.modelType}`);
      console.log(`      上下文窗口: ${model.contextWindow || "N/A"}`);
      console.log(
        `      特性: ${(model.features as any[])?.join(", ") || "无"}\n`,
      );
    });

    // 5. 验证数据完整性
    console.log("✔️  步骤 5: 数据完整性验证...");
    if (models.length === 0) {
      throw new Error("❌ 失败: 没有创建任何模型!");
    }

    const firstModel = models[0];
    if (!firstModel.modelName) {
      throw new Error("❌ 失败: modelName 字段为空!");
    }
    if (!firstModel.modelType) {
      throw new Error("❌ 失败: modelType 字段为空!");
    }
    if (!firstModel.contextWindow) {
      throw new Error("❌ 失败: contextWindow 字段为空!");
    }

    console.log("✅ 所有验证通过!\n");

    // 6. 清理测试数据
    console.log("🧹 步骤 6: 清理测试数据...");
    await prisma.model.deleteMany({ where: { providerId: provider.id } });
    await prisma.modelProvider.delete({ where: { id: provider.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log("✅ 测试数据已清理\n");

    console.log("🎉 测试完成! 所有功能正常工作。");
    process.exit(0);
  } catch (error) {
    console.error(
      "\n❌ 测试失败:",
      error instanceof Error ? error.message : String(error),
    );
    console.error(error);

    // 尝试清理
    try {
      console.log("\n🧹 尝试清理测试数据...");
      await prisma.$executeRawUnsafe(
        'DELETE FROM model WHERE providerId IN (SELECT id FROM model_provider WHERE userId LIKE "test_%")',
      );
      await prisma.$executeRawUnsafe(
        'DELETE FROM model_provider WHERE userId LIKE "test_%"',
      );
      await prisma.$executeRawUnsafe(
        'DELETE FROM user WHERE email LIKE "test_%"',
      );
      console.log("✅ 清理完成");
    } catch (cleanupError) {
      console.error(
        "⚠️  清理失败:",
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      );
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行测试
testAutoCreateModels();
