import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { PrismaService } from "../../../common/database/prisma.service";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";

@Injectable()
export class MemoryToolProvider implements IToolProvider {
  private readonly logger = new Logger(MemoryToolProvider.name);
  public readonly namespace = "memory";

  constructor(private prisma: PrismaService) { }

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "edit",
      description: "Upsert 长期记忆（按类型编辑或自动创建）",
      parameters: {
        type: "object",
        properties: {
          memory_type: {
            type: "string",
            enum: ["factual", "soul"],
            description: "长期记忆类型",
          },
          content: { type: "string", description: "记忆内容" },
          write_mode: {
            type: "string",
            enum: ["append", "overwrite"],
            description: "写入模式：追加或覆盖",
          },
        },
        required: ["memory_type", "content"],
      },
    },
    {
      name: "create_or_update",
      description:
        "创建或更新备忘录。如果标题已存在则根据 write_mode 决定覆盖或追加，否则创建新备忘录。标题最大64字符。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            maxLength: 64,
            description: "备忘录标题（唯一标识，最大64字符）",
          },
          content: { type: "string", description: "备忘录内容" },
          write_mode: {
            type: "string",
            enum: ["append", "overwrite"],
            description: "写入模式：追加或覆盖（仅在标题已存在时生效）",
            default: "overwrite",
          },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "delete",
      description: "通过标题删除指定的备忘录",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            maxLength: 64,
            description: "要删除的备忘录标题",
          },
        },
        required: ["title"],
      },
    },
    {
      name: "read",
      description: "通过标题阅读指定的备忘录内容",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            maxLength: 64,
            description: "要阅读的备忘录标题",
          },
        },
        required: ["title"],
      },
    },
  ];

  async getTools(enabled?: boolean | string[]): Promise<any[]> {
    if (enabled === false) return [];
    
    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter(tool => enabled.includes(tool.name));
    }
    
    // true 或未指定：返回所有工具
    return this.toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    const handlers: Record<
      string,
      (args: any, ctx?: Record<string, any>) => Promise<string>
    > = {
      edit: this.handleLongTermEdit.bind(this),
      create_or_update: this.handleMemoCreateOrUpdate.bind(this),
      delete: this.handleMemoDelete.bind(this),
      read: this.handleMemoRead.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }
    
    // 使用传入的 context 参数
    return await handler(request.arguments, context);
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      // 从上下文中获取 session_id
      const sessionId = context?.session_id;
      if (!sessionId) {
        this.logger.warn('getPrompt: 无法获取 session_id，返回空提示词');
        return "";
      }

      // 获取所有长期记忆（不限制数量）
      const longTermMemories = await this.getLongTermMemories(sessionId);

      // 获取所有备忘录目录
      const memoList = await this.getMemoList(sessionId);

      const promptParts: string[] = [];

      // ========== 第一部分：长期记忆注入 ==========

      promptParts.push("# 重要记忆");

      // 按类型分组展示
      const factualMemories = longTermMemories.filter(
        (m) => m.memoryType === "factual",
      );
      const soulMemories = longTermMemories.filter(
        (m) => m.memoryType === "soul",
      );

      promptParts.push("\n## 事实性记忆 (FACTUAL)");
      promptParts.push(
        "这些是核心事实知识库，包括用户偏好、重要决策、项目状态等关键信息：",
      );
      promptParts.push("<factual-memory>");
      if (factualMemories.length > 0) {
        factualMemories.forEach((memory, index) => {
          promptParts.push(`${index + 1}. ${memory.content}`);
        });
      } else {
        promptParts.push("目前没有事实性记忆");
      }
      promptParts.push("</factual-memory>");

      promptParts.push("\n## 人格定义 (SOUL)");
      promptParts.push("这些定义了 AI 的角色定位、语言风格和行为规则：");
      promptParts.push("<soul-memory>");
      if (soulMemories.length > 0) {
        soulMemories.forEach((memory, index) => {
          promptParts.push(`${index + 1}. ${memory.content}`);
        });
      } else {
        promptParts.push("目前没有人格定义记忆");
      }
      promptParts.push("</soul-memory>");

      // ========== 第二部分：备忘录目录注入 ==========
      promptParts.push("\n# 备忘录目录");
      promptParts.push("以下是你可访问的备忘录列表，可通过标题读取具体内容：");
      promptParts.push("<memo-list>");
      if (memoList.length > 0) {
        memoList.forEach((memo, index) => {
          promptParts.push(`${index + 1}. ${memo.title}`);
        });
      } else {
        promptParts.push("目前没有备忘录");
      }
      promptParts.push("</memo-list>");

      // ========== 第三部分：工具使用说明 ==========
      promptParts.push("\n# 记忆工具使用说明");
      const toolInstructions = `
你拥有以下记忆管理工具，需要根据信息的重要性和使用频率选择合适的存储方式：

## 一、长期记忆 vs 备忘录的选择原则

### 长期记忆 (memory__edit)
**核心特征**: 全局性、高频使用、需要时刻记住的信息

**适用场景**:
- **用户偏好与兴趣**: 语言偏好、主题喜好、沟通风格等
- **当前项目进展**: 正在进行的项目状态、关键节点、下一步计划
- **待办事项**: 需要持续跟踪的任务清单（会频繁提及）
- **AI 行为规则**: 角色设定、回复风格、特殊要求等
- **核心事实**: 用户的基本信息、重要决策、关键约定

**特点**:
- 每次对话都会自动注入到提示词中
- AI 会时刻记住这些信息
- 适合少量但极其重要的信息
- 分为 factual（事实性）和 soul（人格定义）两类

**使用建议**:
1. **精简内容**: 只保存最关键的信息，避免冗余
2. **及时更新**: 当信息变化时立即更新，保持准确性
3. **结构化表达**: 使用清晰的格式，如列表、关键词等
4. **定期整理**: 合并相似内容，删除过时信息
5. **⚠️ 覆盖前整合**: 使用覆盖模式修改已有内容时，必须先读取并整合原有内容，避免丢失重要信息。除非确实要清空旧记忆，否则应使用追加模式或先整合再覆盖

### 备忘录 (memory__*)
**核心特征**: AI 专属记忆空间、详细记录、按需查阅、用户不可见

**重要说明**:
- **这是你的私有记忆工具**，用于存储和管理你的工作笔记、经验总结等信息
- **用户无法直接查看备忘录内容**，只有通过你主动读取并引用时，用户才能得知相关信息

**适用场景**:
- **经验总结**: 技术笔记、最佳实践、踩坑记录
- **重要事件**: 会议纪要、讨论要点、决策过程
- **详细的个人信息**: 完整的项目文档、详细的需求说明
- **命令备忘**: 常用命令、配置示例、代码片段
- **参考资料**: 链接集合、资源列表、学习路径
- **临时记录**: 待整理的想法、草稿、中间状态

**特点**:
- 只在提示词中显示标题目录
- 需要时通过标题读取具体内容
- 可以创建多条，无数量限制
- 适合存储详细但不需要时刻记住的信息

**使用建议**:
1. **标题清晰**: 标题应能准确反映内容，便于查找
2. **内容完整**: 可以保存较详细的内容，不必过度精简
3. **合理分类**: 相关主题可以使用相似的标题前缀，如 "项目A-需求"、"项目A-进度"
4. **及时清理**: 过时的备忘录应及时删除
5. **⚠️ 覆盖前整合**: 使用覆盖模式修改已有备忘录时，必须先读取并整合原有内容，避免丢失重要信息。除非确实要清空旧内容，否则应使用追加模式或先整合再覆盖

## 二、实际使用示例

场景1 - 用户偏好:
当用户说"我喜欢用中文交流，希望回答简洁一些"时
应该写入长期记忆(factual)，内容为: "用户偏好：中文交流，简洁风格"

场景2 - 项目进展:
当用户说"我们正在开发一个聊天应用，目前完成了登录功能"时
应该写入长期记忆(factual)，内容为: "当前项目：聊天应用，进度：登录功能已完成"

场景3 - 技术笔记:
当用户说"帮我记录一下 Docker 的常用命令"时
应该创建备忘录，标题为: "Docker常用命令"，保存完整的命令列表

场景4 - 会议纪要:
当对话中讨论了项目需求后
应该创建备忘录，标题为: "2024-01-15 项目需求会议"，保存详细的会议记录

场景5 - 待办事项:
当用户说"记得提醒我明天要提交报告"时
应该写入长期记忆(factual)，内容为: "待办：明天提交报告"

## 三、最佳实践

1. **优先使用长期记忆**: 对于核心信息，优先使用长期记忆，如果过长，可以存入备忘录并将标题记在长期记忆
2. **备忘录作为补充**: 详细信息、参考资料或者过长的记忆使用备忘录
3. **保持长期记忆精简**: 长期记忆应该像"便签"一样简洁
4. **备忘录可以详细**: 备忘录可以保存完整的内容
5. **定期维护**: 定期检查并更新/清理过时的记忆
6. **避免重复**: 相同信息不要同时保存在长期记忆和备忘录中
`;
      promptParts.push(toolInstructions);

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取记忆提示词失败：${error.message}`);
      return "";
    }
  }

  getMetadata(): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "记忆管理",
      description: "允许 AI 读写长期记忆和备忘录，实现持久化记忆功能",
      isMcp: false,
    };
  }

  private async getLongTermMemories(sessionId: string): Promise<any[]> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: {
          sessionId,
          category: "long_term",
        },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      });

      return memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        memoryType: memory.memoryType,
        importance: memory.importance,
        createdAt: memory.createdAt,
      }));
    } catch (error: any) {
      this.logger.error(`获取长期记忆失败：${error.message}`);
      return [];
    }
  }

  private async handleLongTermView(args: any, context?: Record<string, any>): Promise<string> {
    const sessionId = context?.session_id;
    if (!sessionId) {
      return "❌ 错误：无法获取会话 ID";
    }

    const memories = await this.prisma.memory.findMany({
      where: {
        sessionId,
        category: "long_term",
        memoryType: args.memory_type,
      },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    });

    if (memories.length === 0) {
      return `❌ 未找到${args.memory_type}类型的长期记忆`;
    }

    return memories.map((m, i) => `${i + 1}. ${m.content}`).join("\n");
  }

  private async handleLongTermEdit(args: any, context?: Record<string, any>): Promise<string> {
    const sessionId = context?.session_id;
    if (!sessionId) {
      return "❌ 错误：无法获取会话 ID";
    }

    const existing = await this.prisma.memory.findFirst({
      where: {
        sessionId,
        category: "long_term",
        memoryType: args.memory_type,
      },
    });

    const writeMode = args.write_mode || "append";
    let finalContent = args.content;

    if (existing && writeMode === "append") {
      finalContent = `${existing.content}\n${args.content}`;
      await this.prisma.memory.update({
        where: { id: existing.id },
        data: { content: finalContent },
      });
    } else {
      // 先查询是否存在
      const existing = await this.prisma.memory.findFirst({
        where: {
          sessionId,
          category: "long_term",
          memoryType: args.memory_type,
        },
      });

      if (existing) {
        await this.prisma.memory.update({
          where: { id: existing.id },
          data: { content: finalContent },
        });
      } else {
        await this.prisma.memory.create({
          data: {
            sessionId,
            category: "long_term",
            memoryType: args.memory_type,
            content: finalContent,
            importance: 5,
          },
        });
      }
    }

    return `✓ 长期记忆已${writeMode === "append" ? "追加" : "覆盖"}`;
  }

  /**
   * 获取备忘录列表（仅返回标题）
   */
  private async getMemoList(sessionId: string): Promise<Array<{ title: string }>> {
    try {
      const memos = await this.prisma.memory.findMany({
        where: {
          sessionId,
          category: "memo",
        },
        select: {
          tags: true, // tags 字段存储标题
        },
        orderBy: { createdAt: "desc" },
      });

      return memos
        .filter((memo) => memo.tags) // 过滤掉没有标题的记录
        .map((memo) => ({ title: memo.tags! }));
    } catch (error: any) {
      this.logger.error(`获取备忘录列表失败：${error.message}`);
      return [];
    }
  }

  /**
   * 创建或更新备忘录
   */
  private async handleMemoCreateOrUpdate(args: any, context?: Record<string, any>): Promise<string> {
    // 从上下文中获取 session_id
    const sessionId = context?.session_id;
    if (!sessionId) {
      return "❌ 错误：无法获取会话 ID";
    }

    const { title, content, write_mode } = args;

    // 验证标题长度
    if (!title || typeof title !== "string") {
      return "❌ 错误：标题不能为空";
    }
    if (title.length > 64) {
      return "❌ 错误：标题长度不能超过64字符";
    }

    // 验证内容
    if (!content || typeof content !== "string") {
      return "❌ 错误：内容不能为空";
    }

    const writeMode = write_mode || "overwrite";

    try {
      // 查找是否已存在相同标题的备忘录
      const existing = await this.prisma.memory.findFirst({
        where: {
          sessionId,
          category: "memo",
          tags: title, // tags 字段存储标题
        },
      });

      if (existing) {
        // 已存在，根据写入模式处理
        let finalContent = content;
        if (writeMode === "append") {
          finalContent = `${existing.content}\n${content}`;
        }

        await this.prisma.memory.update({
          where: { id: existing.id },
          data: {
            content: finalContent,
            updatedAt: new Date(),
          },
        });

        return `✓ 备忘录「${title}」已${writeMode === "append" ? "追加" : "更新"}`;
      } else {
        // 不存在，创建新备忘录
        await this.prisma.memory.create({
          data: {
            sessionId,
            category: "memo",
            memoryType: "factual", // 备忘录使用 factual 类型
            content: content,
            tags: title, // 将标题存储在 tags 字段
            importance: 5,
          },
        });

        return `✓ 备忘录「${title}」已创建`;
      }
    } catch (error: any) {
      this.logger.error(`创建/更新备忘录失败：${error.message}`);
      return `❌ 错误：${error.message}`;
    }
  }

  /**
   * 删除备忘录
   */
  private async handleMemoDelete(args: any, context?: Record<string, any>): Promise<string> {
    const sessionId = context?.session_id;
    if (!sessionId) {
      return "❌ 错误：无法获取会话 ID";
    }

    const { title } = args;

    // 验证标题
    if (!title || typeof title !== "string") {
      return "❌ 错误：标题不能为空";
    }

    try {
      // 查找要删除的备忘录
      const existing = await this.prisma.memory.findFirst({
        where: {
          sessionId,
          category: "memo",
          tags: title,
        },
      });

      if (!existing) {
        return `❌ 未找到标题为「${title}」的备忘录`;
      }

      // 删除备忘录
      await this.prisma.memory.delete({
        where: { id: existing.id },
      });

      return `✓ 备忘录「${title}」已删除`;
    } catch (error: any) {
      this.logger.error(`删除备忘录失败：${error.message}`);
      return `❌ 错误：${error.message}`;
    }
  }

  /**
   * 读取备忘录
   */
  private async handleMemoRead(args: any, context?: Record<string, any>): Promise<string> {
    const sessionId = context?.session_id;
    if (!sessionId) {
      return "❌ 错误：无法获取会话 ID";
    }

    const { title } = args;

    // 验证标题
    if (!title || typeof title !== "string") {
      return "❌ 错误：标题不能为空";
    }

    try {
      // 查找指定的备忘录
      const memo = await this.prisma.memory.findFirst({
        where: {
          sessionId,
          category: "memo",
          tags: title,
        },
      });

      if (!memo) {
        return `❌ 未找到标题为「${title}」的备忘录`;
      }

      // 返回备忘录内容
      return `📝 备忘录「${title}」：\n\n${memo.content}`;
    } catch (error: any) {
      this.logger.error(`读取备忘录失败：${error.message}`);
      return `❌ 错误：${error.message}`;
    }
  }
}
