/**
 * 数据库验证脚本
 * 
 * 用于验证种子数据是否正确导入
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import 'dotenv/config';

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function verifyData() {
  console.log('\n🔍 开始验证数据库...\n');

  try {
    // 1. 检查用户
    const users = await prisma.user.count();
    console.log(`👤 用户数量: ${users}`);
    
    if (users > 0) {
      const admin = await prisma.user.findFirst({
        where: { email: 'admin@dingd.cn' },
      });
      if (admin) {
        console.log(`   - 管理员: ${admin.nickname} (${admin.email})`);
      }
    }

    // 2. 检查模型提供商
    const providers = await prisma.modelProvider.count();
    console.log(`\n🏢 模型提供商数量: ${providers}`);
    
    if (providers > 0) {
      const providerList = await prisma.modelProvider.findMany();
      providerList.forEach((p) => {
        console.log(`   - ${p.name} (${p.provider})`);
      });
    }

    // 3. 检查模型
    const models = await prisma.model.count();
    console.log(`\n🤖 模型数量: ${models}`);
    
    if (models > 0) {
      const modelList = await prisma.model.findMany();
      modelList.forEach((m) => {
        console.log(`   - ${m.name} (${m.modelType})`);
      });
    }

    // 4. 检查角色
    const characters = await prisma.character.count();
    console.log(`\n🎭 角色数量: ${characters}`);
    
    if (characters > 0) {
      const characterList = await prisma.character.findMany();
      characterList.forEach((c) => {
        console.log(`   - ${c.title}`);
      });
    }

    // 5. 检查全局设置
    const settings = await prisma.globalSetting.count();
    console.log(`\n⚙️  全局设置数量: ${settings}`);
    
    if (settings > 0) {
      const settingList = await prisma.globalSetting.findMany();
      settingList.forEach((s) => {
        console.log(`   - ${s.key}: ${s.value}`);
      });
    }

    console.log('\n✅ 验证完成！\n');
  } catch (error) {
    console.error('\n❌ 验证失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyData();
