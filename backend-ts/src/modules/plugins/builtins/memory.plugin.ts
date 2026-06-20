import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { EventBusService } from "../../../common/events/event-bus.service";
import { PluginApi } from "../api/plugin-api";

interface MemoryIndex {
  factual?: string;
  soul?: string;
  memos: Array<{ title: string; content: string }>;
  lastUpdated: Date;
}

interface CacheItem {
  index: MemoryIndex;
  lastAccessed: Date;
  promptContent: string;
}

@Injectable()
export class MemoryPlugin extends PluginBase {
  private readonly logger = new Logger(MemoryPlugin.name);
  private readonly cache = new Map<string, CacheItem>();
  private readonly MAX_CACHE_SIZE = 10;

  manifest = {
    id: "memory",
    name: "记忆管理",
    description: "记忆索引管理与缓存同步工具",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private readonly eventBus: EventBusService) {
    super();
  }

  @OnEvent("memory.pre_compress")
  handleMemoryCompressed(payload: { sessionId: string }) {
    if (this.cache.has(payload.sessionId)) {
      this.cache.delete(payload.sessionId);
      this.logger.debug(
        `Memory cache invalidated for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    api.registerPrompt({
      frequency: "REGULAR",
      description: "记忆管理指南",
      toolSet: "memory",
      content: (context: PluginContext) => {
        const memoryRoot =
          context?.sessionType === "sub_agent"
            ? `.guada/subagents/${context.sessionId}`
            : ".guada";

        return [
          "# 记忆管理指南",
          "",
          `你应该主动发现并记录你认为有价值的内容，使用文件工具集管理你的记忆。文件位于工作目录的 \`${memoryRoot}/\` 子目录中。`,
          "",
          "## 记忆文件结构",
          "",
          "```",
          `${memoryRoot}/`,
          "├── memory/",
          "│   ├── factual.md          # 事实性记忆（用户偏好、项目状态、待办事项）",
          "│   └── soul.md             # 人格定义（角色设定、回复风格）",
          "└── memos/              # 备忘录目录",
          "    ├── 标题1.md",
          "    ├── 标题2.md",
          "    └── ...",
          "```",
          "",
          "## 使用规范",
          "",
          "### 1. 长期记忆 vs 备忘录的选择原则",
          "",
          "**长期记忆**（factual.md / soul.md）：",
          "- **核心特征**：全局性、高频使用、需要时刻记住的信息",
          "- **适用场景**：",
          "  - 用户偏好与兴趣（语言偏好、主题喜好、沟通风格）",
          "  - 当前项目进展（正在进行的项目状态、关键节点）",
          "  - 待办事项（需要持续跟踪的任务清单）",
          "  - AI 行为规则（角色设定、回复风格、特殊要求）",
          "- **特点**：每次对话都会自动注入，你会刻看到这些信息",
          "",
          "**备忘录**（memos/*.md）：",
          "- **核心特征**：AI 专属记忆空间、详细记录、按需查阅、用户不可见",
          "- **适用场景**：",
          "  - 经验总结（技术笔记、最佳实践、踩坑记录）",
          "  - 重要事件（会议纪要、讨论要点、决策过程）",
          "  - 详细的个人信息（完整的项目文档、详细的需求说明）",
          "  - 命令备忘（常用命令、配置示例、代码片段）",
          "  - 参考资料（链接集合、资源列表、学习路径）",
          "- **特点**：只显示标题目录，需要时通过标题读取具体内容",
          "",
          "### 2. 文件名规范",
          "",
          "- 长期记忆固定为 `factual.md` 和 `soul.md`",
          "- 备忘录文件名应清晰反映内容，如 `Docker常用命令.md`、`2024-01-15_项目需求会议.md`",
          '- 避免使用特殊字符：`<>:"/\\\\|?*`',
          "",
          "### 3. 实际使用示例",
          "",
          "**场景1 - 用户偏好**：",
          '当用户说"我喜欢用中文交流，希望回答简洁一些"时',
          `应该写入 \`${memoryRoot}/memory/factual.md\`，内容为：`,
          "```",
          "用户偏好：中文交流，简洁风格",
          "```",
          "",
          "**场景2 - 项目进展**：",
          '当用户说"我们正在开发一个聊天应用，目前完成了登录功能"时',
          `应该写入 \`${memoryRoot}/memory/factual.md\`，内容为：`,
          "```",
          "当前项目：聊天应用，进度：登录功能已完成",
          "```",
          "",
          "**场景3 - 技术笔记**：",
          '当用户说"帮我记录一下 Docker 的常用命令"时',
          `应该创建备忘录 \`${memoryRoot}/memos/Docker常用命令.md\`，保存完整的命令列表`,
          "",
          "**场景4 - 会议纪要**：",
          "当对话中讨论了项目需求后",
          `应该创建备忘录 \`${memoryRoot}/memos/2024-01-15_项目需求会议.md\`，保存详细的会议记录`,
          "",
          "### 4. 重要提醒",
          "",
          "1. **优先使用长期记忆**：对于核心信息，优先使用 factual.md 或 soul.md",
          "2. **备忘录作为补充**：详细信息、参考资料或者过长的记忆使用备忘录",
          '3. **保持长期记忆精简**：长期记忆应该像"便签"一样简洁',
          "4. **避免重复读取**：已经载入上下文或提示词的记忆内容不需要重复读取",
          "5. **自主判断**：根据记忆类型自主判断需要保存的位置",
        ].join("\n");
      },
    });

    api.registerToolSet({
      name: "memory",
      activator: "当用户明确要求你记住某事或者你认为有重要内容需要记忆请使用此工具集",
      loadMode: "lazy",
    });

    api.registerPrompt({
      frequency: "VOLATILE",
      description: "用户长期记忆内容",
      content: async (context: PluginContext) => {
        const sessionId = context.sessionId;
        if (!sessionId) return "";

        const cached = this.cache.get(sessionId);
        if (cached) {
          cached.lastAccessed = new Date();
          return cached.promptContent;
        }

        try {
          const index = await this.rebuildIndexForSession(sessionId);
          const promptContent = this.buildMemoryPrompt(index);
          this.updateCache(sessionId, index, promptContent);
          return promptContent;
        } catch (error: any) {
          this.logger.debug(
            `Memory not available for session ${sessionId}: ${error.message}`,
          );
          return "";
        }
      },
    });
  }

  private async rebuildIndexForSession(
    sessionId: string,
  ): Promise<MemoryIndex> {
    const filePath = path.join(
      process.cwd(),
      "data",
      "memory",
      `${sessionId}.json`,
    );
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      return {
        factual: parsed.factual,
        soul: parsed.soul,
        memos: parsed.memos || [],
        lastUpdated: new Date(parsed.lastUpdated),
      };
    } catch {
      return { memos: [], lastUpdated: new Date() };
    }
  }

  private buildMemoryPrompt(index: MemoryIndex): string {
    const parts: string[] = [];
    parts.push("# 记忆存储");
    if (index.factual) {
      parts.push("");
      parts.push("## 事实性记忆（长期有效）");
      parts.push(index.factual);
    } else {
      parts.push("当前没有事实性记忆");
    }
    if (index.memos && index.memos.length > 0) {
      parts.push("");
      parts.push("## 备忘录");
      for (const memo of index.memos) {
        parts.push(`- **${memo.title}**: ${memo.content}`);
      }
    } else {
      parts.push("当前没有备忘录");
    }
    parts.push("");
    parts.push(`最后更新: ${index.lastUpdated.toLocaleString("zh-CN")}`);
    return parts.join("\n");
  }

  private updateCache(
    sessionId: string,
    index: MemoryIndex,
    promptContent: string,
  ): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) this.evictLRU();
    this.cache.set(sessionId, {
      index,
      lastAccessed: new Date(),
      promptContent,
    });
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Date.now();
    for (const [id, item] of this.cache) {
      if (item.lastAccessed.getTime() < oldestTime) {
        oldestTime = item.lastAccessed.getTime();
        oldest = id;
      }
    }
    if (oldest) this.cache.delete(oldest);
  }
}
