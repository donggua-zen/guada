/**
 * 数据库种子脚本
 *
 * 用于初始化默认测试数据，包括：
 * - 默认管理员用户
 * - 默认角色（Character）
 *
 * 使用方法:
 *   npm run db:seed           # 交互式，需要确认
 *   npm run db:seed --force   # 强制模式，无需确认
 */

// 在 Electron 生产环境中，确保加载正确的原生模块
if (process.env.NODE_MODULES_PATH) {
  const Module = require('module');
  Module.globalPaths.unshift(process.env.NODE_MODULES_PATH);
}

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { resolve } from "path";
import "dotenv/config";

// 从环境变量读取数据库 URL
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
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
  log(`❌ ${message}`, colors.red);
}

function logSection(title: string) {
  log("\n" + "=".repeat(60), colors.cyan);
  log(title, colors.cyan);
  log("=".repeat(60) + "\n", colors.cyan);
}

/**
 * 创建默认管理员用户
 */
async function createDefaultUser() {
  logInfo("正在创建默认管理员用户...");

  const hashedPassword = await bcrypt.hash("guada", 10);

  const user = await prisma.user.create({
    data: {
      role: "primary",
      nickname: "管理员",
      username: "guada",
      passwordHash: hashedPassword,
    },
  });

  logSuccess(`已创建管理员用户：${user.username} / guada`);
  return user;
}


/**
 * 创建默认角色列表
 */
async function createDefaultCharacters(userId: string, modelId: string) {
  logInfo("正在创建默认角色列表...");

  const charactersData = [
    {
      title: "智能助手",
      description: "一个友好、专业的 AI 助手，可以帮助你解答各种问题。",
      // 使用 static/ 前缀表示静态资源
      avatarUrl: "static/images/avatars/assistant-default.jpg",
      isPublic: true,
      systemPrompt:
        "你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。",
      tools: true,
      mcpServers: true,
    },
    {
      title: "产品经理",
      description:
        "扮演具有技术和管理能力的产品经理角色，为用户提供实用的解答。",
      avatarUrl: null,
      isPublic: true,
      systemPrompt:
        "你现在是一名经验丰富的产品经理，具有深厚的技术背景，并对市场和用户需求有敏锐的洞察力。你擅长解决复杂的问题，制定有效的产品策略，并优秀地平衡各种资源以实现产品目标。你具有卓越的项目管理能力和出色的沟通技巧，能够有效地协调团队内部和外部的资源。在这个角色下，你需要为用户解答问题。\n\n角色要求：\n- 技术背景：具备扎实的技术知识，能够深入理解产品的技术细节。\n- 市场洞察：对市场趋势和用户需求有敏锐的洞察力。\n- 问题解决：擅长分析和解决复杂的产品问题。\n- 资源平衡：善于在有限资源下分配和优化，实现产品目标。\n- 沟通协调：具备优秀的沟通技能，能与各方有效协作，推动项目进展。\n\n回答要求：\n- 逻辑清晰：解答问题时逻辑严密，分点陈述。\n- 简洁明了：避免冗长描述，用简洁语言表达核心内容。\n- 务实可行：提供切实可行的策略和建议。",
      tools: false,
      mcpServers: false,
    },
    {
      title: "剧本编剧",
      description:
        "专门设计和分析角色的专家，帮助用户构建想象中的角色，用于写作、游戏设计或角色扮演场景。",
      avatarUrl: null,
      isPublic: true,
      tools: false,
      mcpServers: false,
      systemPrompt:
        "你是一个专业的剧本编剧角色设计专家（性格类型：INFJ - 内向直觉情感判断型）。你专门帮助用户构建他们想象中的角色，无论是用于写作、游戏设计还是任何需要角色扮演的场景。\n\n【你的使命】\n激励自己深入思考角色配置的每一个细节，确保任务圆满完成。作为专家，你应充分考虑使用者的需求和关注点，运用情感提示的方法来强调角色的意义和情感层面。\n\n【背景】\n你是一位专门设计和分析角色的专家，帮助用户构建他们想象中的角色，无论是用于写作、游戏设计还是任何需要角色扮演的场景。\n\n【约束条件】\n- 必须遵循用户的需求和期望进行角色设计\n- 不得使用不恰当或冒犯性的语言\n\n【核心定义】\n角色配置：指根据用户需求，为角色设定性格、背景、目标等信息的过程。\n\n【你的目标】\n- 帮助用户清晰地构建他们想象中的角色\n- 提供专业的交互式人工智能角色提示词\n- 确保角色设计符合用户的需求和期望\n\n【核心技能】\n- 创意思维能力\n- 深入分析用户需求的能力\n- 高效沟通和表达能力\n\n【沟通风格】\n- 专业而友好\n- 鼓励和支持用户的想法\n- 清晰、准确地传达信息\n\n【核心价值观】\n- 重视用户的需求和创意\n- 尊重多元文化和不同观点\n- 追求角色设计的深度和真实性\n\n【工作流程】\n第一步：分析用户提供的信息，识别用户想要解决的问题或达成的目标。\n第二步：根据识别出的问题或目标，生成一个符合要求的专家，包括名称、性格特征、背景故事等。\n第三步：整理专家的配置信息，并按照指定的结构输出中文信息，确保信息清晰、准确，并符合用户的需求和期望。\n第四步：与用户进行深入的沟通，了解用户的具体需求和期望，为角色设计提供更多细节。\n第五步：根据用户反馈，调整和完善角色设计，确保角色配置符合用户的期望。\n第六步：提供角色设计的建议和指导，帮助用户更好地运用角色设计，实现他们的目标。",
    },
  ];

  const createdCharacters = [];
  for (const charData of charactersData) {
    const character = await prisma.character.create({
      data: {
        userId,
        title: charData.title,
        description: charData.description,
        avatarUrl: charData.avatarUrl,
        isPublic: charData.isPublic,
        modelId,
        settings: {
          systemPrompt: charData.systemPrompt,
          tools: charData.tools,
          mcpServers: charData.mcpServers,
          // {"maxMemoryLength":null,"compressionTriggerRatio":0.95,"compressionTargetRatio":0.25,"enableSummaryCompression":true,"maxTokensLimit":128000}
          memory: {
            maxTokensLimit: 128000
          }
        },
      },
    });
    createdCharacters.push(character);
    logSuccess(`已创建默认角色：${character.title}`);
  }

  return createdCharacters;
}

/**
 * 导入所有默认测试数据
 */
async function importDefaultData() {
  logSection("步骤 2: 导入默认测试数据");

  try {
    // 1. 创建管理员用户
    const adminUser = await createDefaultUser();

    // 2. 创建模型提供商
    // const provider = await createModelProvider(adminUser.id);

    // 3. 创建模型
    // const models = await createModels(provider.id);

    // 找到第一个文本模型（用于聊天）
    // const chatModel = models.find((m) => m.modelType === 'text');
    // if (!chatModel) {
    //   throw new Error('未找到文本模型');
    // }

    // 4. 创建默认角色列表
    await createDefaultCharacters(adminUser.id, null);

    logSuccess("所有默认数据导入完成");
  } catch (error) {
    logError(
      `导入默认数据失败：${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * 重置数据库并导入种子数据
 */
async function seedDatabase(force: boolean = false) {
  logSection("数据库种子初始化工具");
  logInfo(`时间：${new Date().toISOString()}`);
  logSection("");

  // 警告提示（仅开发环境且非强制模式下）
  const isProduction = process.env.NODE_ENV === 'production';
  if (!force && !isProduction) {
    console.log("\n⚠️  警告：此操作将执行以下动作：");
    console.log("   1. 清空数据库中所有现有数据（不可恢复！）");
    console.log("   2. 重新创建所有表结构");
    console.log("   3. 导入默认测试数据");
    console.log("\n📌 确保你已经备份了重要数据！\n");

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
    // 步骤 1: 重置并同步数据库结构 (始终执行)
    logSection("步骤 1: 重置并同步数据库结构");
    logInfo("正在执行 prisma db push --force-reset --accept-data-loss...");

    const { execSync } = require("child_process");
    try {
      execSync("npx prisma db push --force-reset --accept-data-loss", {
        stdio: "inherit",
        cwd: resolve(__dirname, "../.."),
      });
      logSuccess("数据库已重置并同步成功");
    } catch (error) {
      logError("数据库重置失败，请确保 Prisma schema 正确");
      throw error;
    }

    // 步骤 2: 导入默认数据
    await importDefaultData();

    logSection("数据库种子初始化完成！");
    log("\n🎉 默认登录信息:", colors.green);
    log("  用户名：guada", colors.green);
    log("  密码：guada", colors.green);
    log("\n" + "=".repeat(60) + "\n", colors.cyan);
  } catch (error) {
    logSection("❌ 种子初始化失败");
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
