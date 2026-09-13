/**
 * 修复脚本：为现有的 bot_instance 记录设置 defaultCharacterId
 * 
 * 使用方法:
 *   npx ts-node src/scripts/fix-bot-instances.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as fsp from "fs/promises";
import * as path from "path";
import "dotenv/config";
import { AGENT_FILE, resolveAgentsDir } from "../modules/characters/character-file.store";
import { parseAgentMarkdown } from "../modules/characters/character-file.mapper";

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

    // 2. 取一个可用的角色目录（权威来源 agents/<id>/AGENT.md）
    const agentsDir = resolveAgentsDir();
    const dirs = (await fsp.readdir(agentsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    if (dirs.length === 0) {
      console.error("错误: 没有找到任何角色，请先创建至少一个角色");
      process.exit(1);
    }
    const firstCharacterId = dirs[0];
    const firstCharacter = await fsp.readFile(
      path.join(agentsDir, firstCharacterId, AGENT_FILE),
      "utf8",
    );
    const firstCharacterName =
      parseAgentMarkdown(firstCharacter, firstCharacterId).name;

    console.log(`\n使用角色 ID: ${firstCharacterId} (${firstCharacterName})\n`);

    // 3. 更新所有记录
    let updatedCount = 0;
    for (const bot of botsWithoutCharacter) {
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: {
          defaultCharacterId: firstCharacterId,
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
