/**
 * 备忘录功能测试脚本
 * 
 * 此脚本用于测试新添加的备忘录功能
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function testMemoFeatures() {
  console.log("=== 备忘录功能测试 ===\n");

  // 创建或获取一个测试用户
  let testUser = await prisma.user.findFirst({
    where: { email: "test@example.com" },
  });

  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        email: "test@example.com",
        phone: `138${Date.now().toString().slice(-8)}`,
        passwordHash: "$2b$10$dummy.hash.for.testing.purposes.only",
        nickname: "测试用户",
      },
    });
    console.log(`✓ 创建测试用户: ${testUser.id}\n`);
  } else {
    console.log(`✓ 使用现有测试用户: ${testUser.id}\n`);
  }

  // 创建一个测试会话
  const testSession = await prisma.session.create({
    data: {
      userId: testUser.id,
      title: "备忘录测试会话",
    },
  });

  console.log(`✓ 创建测试会话: ${testSession.id}\n`);

  try {
    // 测试1: 创建备忘录
    console.log("测试1: 创建备忘录");
    const memo1 = await prisma.memory.create({
      data: {
        sessionId: testSession.id,
        category: "memo",
        memoryType: "factual",
        content: "这是第一个测试备忘录的内容",
        tags: "测试备忘录1",
        importance: 5,
      },
    });
    console.log(`✓ 创建成功: ${memo1.tags}\n`);

    // 测试2: 创建第二个备忘录
    console.log("测试2: 创建第二个备忘录");
    const memo2 = await prisma.memory.create({
      data: {
        sessionId: testSession.id,
        category: "memo",
        memoryType: "factual",
        content: "这是第二个测试备忘录的内容",
        tags: "测试备忘录2",
        importance: 5,
      },
    });
    console.log(`✓ 创建成功: ${memo2.tags}\n`);

    // 测试3: 获取备忘录列表
    console.log("测试3: 获取备忘录列表");
    const memoList = await prisma.memory.findMany({
      where: {
        sessionId: testSession.id,
        category: "memo",
      },
      select: {
        tags: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    console.log(`✓ 找到 ${memoList.length} 个备忘录:`);
    memoList.forEach((memo, index) => {
      console.log(`  ${index + 1}. ${memo.tags}`);
    });
    console.log();

    // 测试4: 读取指定备忘录
    console.log("测试4: 读取指定备忘录");
    const readMemo = await prisma.memory.findFirst({
      where: {
        sessionId: testSession.id,
        category: "memo",
        tags: "测试备忘录1",
      },
    });
    if (readMemo) {
      console.log(`✓ 读取成功:`);
      console.log(`  标题: ${readMemo.tags}`);
      console.log(`  内容: ${readMemo.content}\n`);
    }

    // 测试5: 更新备忘录（覆盖模式）
    console.log("测试5: 更新备忘录（覆盖模式）");
    const updatedMemo = await prisma.memory.update({
      where: { id: memo1.id },
      data: {
        content: "这是更新后的内容（覆盖模式）",
        updatedAt: new Date(),
      },
    });
    console.log(`✓ 更新成功: ${updatedMemo.tags}\n`);

    // 测试6: 更新备忘录（追加模式）
    console.log("测试6: 更新备忘录（追加模式）");
    const appendedMemo = await prisma.memory.update({
      where: { id: memo2.id },
      data: {
        content: `${memo2.content}\n这是追加的内容`,
        updatedAt: new Date(),
      },
    });
    console.log(`✓ 追加成功: ${appendedMemo.tags}\n`);

    // 测试7: 删除备忘录
    console.log("测试7: 删除备忘录");
    await prisma.memory.delete({
      where: { id: memo2.id },
    });
    console.log(`✓ 删除成功: ${memo2.tags}\n`);

    // 测试8: 验证删除后的列表
    console.log("测试8: 验证删除后的列表");
    const remainingMemos = await prisma.memory.findMany({
      where: {
        sessionId: testSession.id,
        category: "memo",
      },
      select: {
        tags: true,
      },
    });
    console.log(`✓ 剩余 ${remainingMemos.length} 个备忘录:`);
    remainingMemos.forEach((memo, index) => {
      console.log(`  ${index + 1}. ${memo.tags}`);
    });
    console.log();

    console.log("=== 所有测试通过 ===");
  } catch (error: any) {
    console.error("❌ 测试失败:", error.message);
    throw error;
  } finally {
    // 清理测试数据
    console.log("\n清理测试数据...");
    await prisma.memory.deleteMany({
      where: {
        sessionId: testSession.id,
      },
    });
    await prisma.session.delete({
      where: { id: testSession.id },
    });
    console.log("✓ 清理完成");

    await prisma.$disconnect();
  }
}

// 运行测试
testMemoFeatures().catch((error) => {
  console.error("测试执行失败:", error);
  process.exit(1);
});
