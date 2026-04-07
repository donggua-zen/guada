/**
 * 数据库种子脚本
 * 
 * 用于初始化默认测试数据，包括：
 * - 默认管理员用户
 * - 默认模型提供商和模型
 * - 默认角色（Character）
 * - 全局设置
 * 
 * 使用方法:
 *   npm run db:seed           # 交互式，需要确认
 *   npm run db:seed --force   # 强制模式，无需确认
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as bcrypt from 'bcrypt';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

// 颜色输出工具
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logSuccess(message: string) {
  log(`✅ ${message}`, colors.green);
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message: string) {
  log(`❌ ${message}`, colors.red);
}

function logSection(title: string) {
  log('\n' + '='.repeat(60), colors.cyan);
  log(title, colors.cyan);
  log('='.repeat(60) + '\n', colors.cyan);
}

/**
 * 创建默认管理员用户
 */
async function createDefaultUser() {
  logInfo('正在创建默认管理员用户...');

  const hashedPassword = await bcrypt.hash('123456', 10);

  const user = await prisma.user.create({
    data: {
      role: 'primary',
      nickname: '管理员',
      phone: '13800138000',
      email: 'admin@dingd.cn',
      passwordHash: hashedPassword,
    },
  });

  logSuccess(`已创建管理员用户：${user.email} / 123456`);
  return user;
}

/**
 * 创建默认模型提供商
 */
async function createModelProvider(userId: string) {
  logInfo('正在创建模型提供商...');

  // 从环境变量读取 API Key，如果未设置则使用默认值
  const apiKey = process.env.SILICONFLOW_API_KEY || 'sk-ccdjtlfjhfrkyhcsiijmwahhxaqnfplyaesoqigjvbizbmsy';

  // ✅ 调试日志
  logInfo(`API Key length: ${apiKey.length}`);
  logInfo(`API Key preview: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);

  const provider = await prisma.modelProvider.create({
    data: {
      userId,
      name: '硅基流动',
      provider: 'siliconflow',
      apiUrl: 'https://api.siliconflow.cn/v1/',
      apiKey: apiKey,
    },
  });

  logSuccess(`已创建模型提供商：${provider.name}`);
  return provider;
}

/**
 * 创建默认模型列表
 */
async function createModels(providerId: string) {
  logInfo('正在创建默认模型...');

  const modelsData = [
    {
      modelName: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      modelType: 'text',
      maxTokens: 128000,
      maxOutputTokens: 4096,
      features: ['thinking', 'tools'],
    },
    {
      modelName: 'Qwen/Qwen3-Embedding-8B',
      name: 'Qwen3 Embedding 8B',
      modelType: 'embedding',
      maxTokens: 32000,
      maxOutputTokens: null,
      features: ['embedding'],
    },
  ];

  const createdModels = [];
  for (const modelData of modelsData) {
    const model = await prisma.model.create({
      data: {
        name: modelData.name,
        providerId,
        modelName: modelData.modelName,
        modelType: modelData.modelType,
        maxTokens: modelData.maxTokens,
        maxOutputTokens: modelData.maxOutputTokens,
        features: modelData.features,
      },
    });
    createdModels.push(model);
    logSuccess(`已创建模型：${model.name} (${model.modelName})`);
  }

  return createdModels;
}

/**
 * 创建示例角色
 */
async function createCharacter(userId: string, modelId: string) {
  logInfo('正在创建示例角色...');

  const character = await prisma.character.create({
    data: {
      userId,
      title: '智能助手',
      description: '一个友好、专业的 AI 助手，可以帮助你解答各种问题。',
      avatarUrl: '/static/avatars/default.png',
      isPublic: true,
      modelId,
      settings: {
        systemPrompt: '你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。',
        modelTemperature: 0.7,
        maxMemoryLength: 20,
      },
    },
  });

  logSuccess(`已创建示例角色：${character.title}`);
  return character;
}

/**
 * 创建全局设置
 */
async function createGlobalSettings(chatModelId: string) {
  logInfo('正在创建全局设置...');

  const settingsData = [
    {
      key: 'default_chat_model',
      value: chatModelId,
      valueType: 'str',
      description: '默认聊天模型 ID',
      category: 'model',
    },
    {
      key: 'max_upload_size_mb',
      value: '10',
      valueType: 'int',
      description: '最大上传文件大小（MB）',
      category: 'system',
    },
    {
      key: 'allowed_file_types',
      value: '["txt", "pdf", "docx", "md", "json"]',
      valueType: 'json',
      description: '允许上传的文件类型',
      category: 'system',
    },
  ];

  for (const settingData of settingsData) {
    await prisma.globalSetting.create({
      data: settingData,
    });
  }

  logSuccess('已创建全局设置');
}

/**
 * 导入所有默认测试数据
 */
async function importDefaultData() {
  logSection('步骤 2: 导入默认测试数据');

  try {
    // 1. 创建管理员用户
    const adminUser = await createDefaultUser();

    // 2. 创建模型提供商
    const provider = await createModelProvider(adminUser.id);

    // 3. 创建模型
    const models = await createModels(provider.id);

    // 找到第一个文本模型（用于聊天）
    const chatModel = models.find((m) => m.modelType === 'text');
    if (!chatModel) {
      throw new Error('未找到文本模型');
    }

    // 4. 创建示例角色
    await createCharacter(adminUser.id, chatModel.id);

    // 5. 创建全局设置
    await createGlobalSettings(chatModel.id);

    logSuccess('所有默认数据导入完成');
  } catch (error) {
    logError(`导入默认数据失败：${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 重置数据库并导入种子数据
 */
async function seedDatabase(force: boolean = false) {
  logSection('数据库种子初始化工具');
  logInfo(`时间：${new Date().toISOString()}`);
  logSection('');

  // 警告提示
  if (!force) {
    console.log('\n⚠️  警告：此操作将执行以下动作：');
    console.log('   1. 清空数据库中所有现有数据（不可恢复！）');
    console.log('   2. 重新创建所有表结构');
    console.log('   3. 导入默认测试数据');
    console.log('\n📌 确保你已经备份了重要数据！\n');

    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      readline.question("是否继续？请输入 'yes' 确认：", (input: string) => {
        readline.close();
        resolve(input);
      });
    });

    if (answer.toLowerCase() !== 'yes') {
      logInfo('用户取消操作');
      process.exit(0);
    }

    console.log('\n开始执行...\n');
  }

  try {
    // 步骤 1: 重置数据库
    logSection('步骤 1: 重置数据库');
    logInfo('正在执行 prisma db push --force-reset...');

    // 使用 Prisma CLI 重置数据库
    const { execSync } = require('child_process');
    try {
      execSync('npx prisma db push --force-reset --accept-data-loss', {
        stdio: 'inherit',
        cwd: resolve(__dirname, '../..'),
      });
      logSuccess('数据库重置成功');
    } catch (error) {
      logError('数据库重置失败，请确保 Prisma schema 正确');
      throw error;
    }

    // 步骤 2: 导入默认数据
    await importDefaultData();

    logSection('数据库种子初始化完成！');
    log('\n🎉 默认登录信息:', colors.green);
    log('  邮箱：admin@dingd.cn', colors.green);
    log('  密码：123456', colors.green);
    log('\n' + '='.repeat(60) + '\n', colors.cyan);
  } catch (error) {
    logSection('❌ 种子初始化失败');
    logError(`错误详情：${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    logInfo('数据库连接已关闭');
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  await seedDatabase(force);
}

// 执行
main().catch((error) => {
  logError(`未捕获的错误：${error.message}`);
  console.error(error);
  process.exit(1);
});
