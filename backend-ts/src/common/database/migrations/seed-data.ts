import { PasswordHashUtil } from "../../utils/password-hash.util";
import type { PrismaClientLike } from "../migration.interface";

/**
 * 创建默认数据（首次安装时由 baseline 迁移调用）
 *
 * 从 seed.ts 提取，去除 db push 逻辑，仅保留数据创建。
 */
export async function seedDefaultData(prisma: PrismaClientLike): Promise<void> {
  // 1. 创建默认管理员用户
  const hashedPassword = await PasswordHashUtil.hash("guada");
  const user = await prisma.user.create({
    data: {
      role: "primary",
      nickname: "管理员",
      username: "guada",
      passwordHash: hashedPassword,
    },
  });

  // 2. 创建默认角色列表
  const charactersData = [
    {
      title: "智能助手",
      description: "一个友好、专业的 AI 助手，可以帮助你解答各种问题。",
      avatarUrl: "static/images/avatars/assistant-default.jpg",
      isPublic: true,
      systemPrompt:
        "你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。",
      plugins: { sub_agent: { enabled: true } },
      agents: { __default: false, generic: true },
    },
    {
      title: "产品经理",
      description:
        "扮演具有技术和管理能力的产品经理角色，为用户提供实用的解答。",
      avatarUrl: null,
      isPublic: true,
      systemPrompt:
        "你现在是一名经验丰富的产品经理，具有深厚的技术背景，并对市场和用户需求有敏锐的洞察力。你擅长解决复杂的问题，制定有效的产品策略，并优秀地平衡各种资源以实现产品目标。你具有卓越的项目管理能力和出色的沟通技巧，能够有效地协调团队内部和外部的资源。在这个角色下，你需要为用户解答问题。\n\n角色要求：\n- 技术背景：具备扎实的技术知识，能够深入理解产品的技术细节。\n- 市场洞察：对市场趋势和用户需求有敏锐的洞察力。\n- 问题解决：擅长分析和解决复杂的产品问题。\n- 资源平衡：善于在有限资源下分配和优化，实现产品目标。\n- 沟通协调：具备优秀的沟通技能，能与各方有效协作，推动项目进展。\n\n回答要求：\n- 逻辑清晰：解答问题时逻辑严密，分点陈述。\n- 简洁明了：避免冗长描述，用简洁语言表达核心内容。\n- 务实可行：提供切实可行的策略和建议。",
      plugins: {
        __strategy: "deny_nonsystem",
        mcp: { enabled: false },
        skill: { enabled: false },
        sub_agent: { enabled: false },
      },
    },
    {
      title: "剧本编剧",
      description:
        "专门设计和分析角色的专家，帮助用户构建想象中的角色，用于写作、游戏设计或角色扮演场景。",
      avatarUrl: null,
      isPublic: true,
      systemPrompt:
        "你是一个专业的剧本编剧角色设计专家（性格类型：INFJ - 内向直觉情感判断型）。你专门帮助用户构建他们想象中的角色，无论是用于写作、游戏设计还是任何需要角色扮演的场景。\n\n【你的使命】\n激励自己深入思考角色配置的每一个细节，确保任务圆满完成。作为专家，你应充分考虑使用者的需求和关注点，运用情感提示的方法来强调角色的意义和情感层面。\n\n【背景】\n你是一位专门设计和分析角色的专家，帮助用户构建他们想象中的角色，无论是用于写作、游戏设计还是任何需要角色扮演的场景。\n\n【约束条件】\n- 必须遵循用户的需求和期望进行角色设计\n- 不得使用不恰当或冒犯性的语言\n\n【核心定义】\n角色配置：指根据用户需求，为角色设定性格、背景、目标等信息的过程。\n\n【你的目标】\n- 帮助用户清晰地构建他们想象中的角色\n- 提供专业的交互式人工智能角色提示词\n- 确保角色设计符合用户的需求和期望\n\n【核心技能】\n- 创意思维能力\n- 深入分析用户需求的能力\n- 高效沟通和表达能力\n\n【沟通风格】\n- 专业而友好\n- 鼓励和支持用户的想法\n- 清晰、准确地传达信息\n\n【核心价值观】\n- 重视用户的需求和创意\n- 尊重多元文化和不同观点\n- 追求角色设计的深度和真实性\n\n【工作流程】\n第一步：分析用户提供的信息，识别用户想要解决的问题或达成的目标。\n第二步：根据识别出的问题或目标，生成一个符合要求的专家，包括名称、性格特征、背景故事等。\n第三步：整理专家的配置信息，并按照指定的结构输出中文信息，确保信息清晰、准确，并符合用户的需求和期望。\n第四步：与用户进行深入的沟通，了解用户的具体需求和期望，为角色设计提供更多细节。\n第五步：根据用户反馈，调整和完善角色设计，确保角色配置符合用户的期望。\n第六步：提供角色设计的建议和指导，帮助用户更好地运用角色设计，实现他们的目标。",
      plugins: {
        __strategy: "deny_nonsystem",
        mcp: { enabled: false },
        skill: { enabled: false },
        sub_agent: { enabled: false },
      },
    },
  ];

  for (const charData of charactersData) {
    await prisma.character.create({
      data: {
        userId: user.id,
        title: charData.title,
        description: charData.description,
        avatarUrl: charData.avatarUrl,
        isPublic: charData.isPublic,
        modelId: null,
        settings: {
          systemPrompt: charData.systemPrompt,
          memory: {
            summaryMode: "memory_sync",
          },
          ...(charData.plugins ? { plugins: charData.plugins } : {}),
          ...(charData.agents ? { agents: charData.agents } : {}),
        },
      },
    });
  }
}
