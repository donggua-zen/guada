/**
 * 修复脚本：为现有的 bot_instance 记录设置 defaultCharacterId
 * 
 * 使用方法:
 *   npx ts-node src/scripts/fix-bot-instances.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import "dotenv/config";

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || "file:./data/ai_chat.db";
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function fixBotInstances() {
  console.log("开始修复 bot_instance 记录...\n");

  try {
    // 1. 查找所有 defaultCharacterId 为 NULL 的记录
    const botsWithoutCharacter = await prisma.botInstance.findMany({
      where: {
        defaultCharacterId: null,
      },
    });

    if (botsWithoutCharacter.length === 0) {
      console.log("没有需要修复的记录");
      return;
    }

    console.log(`找到 ${botsWithoutCharacter.length} 条需要修复的记录:\n`);
    botsWithoutCharacter.forEach(bot => {
      console.log(`  - ID: ${bot.id}, Name: ${bot.name}, Platform: ${bot.platform}`);
    });

    // 2. 获取一个可用的 character ID
    const firstCharacter = await prisma.character.findFirst({
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!firstCharacter) {
      console.error("错误: 数据库中没有任何角色，请先创建至少一个角色");
      process.exit(1);
    }

    console.log(`\n使用角色 ID: ${firstCharacter.id} (${firstCharacter.title})\n`);

    // 3. 更新所有记录
    let updatedCount = 0;
    for (const bot of botsWithoutCharacter) {
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: {
          defaultCharacterId: firstCharacter.id,
        },
      });
      updatedCount++;
      console.log(`  ✓ 已更新: ${bot.name}`);
    }

    console.log(`\n成功更新 ${updatedCount} 条记录`);
    console.log(`\n现在可以运行: npx prisma db push`);

  } catch (error) {
    console.error("修复失败:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

fixBotInstances().catch(console.error);
