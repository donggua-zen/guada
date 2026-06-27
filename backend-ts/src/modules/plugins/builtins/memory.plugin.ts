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
          '- 避免使用特殊字符：`<>:"/\\|?*`',
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
      description: "长期记忆内容",
      content: async (context: PluginContext) => {
        try {
          const sessionId = context?.sessionId;
          if (!sessionId) return "";

          const workspaceDir = context?.workspacePath;
          if (!workspaceDir) {
            this.logger.warn("No workspace path provided for session " + sessionId);
            return "";
          }

          const cacheItem = this.cache.get(sessionId);
          if (cacheItem) {
            cacheItem.lastAccessed = new Date();
            return cacheItem.promptContent;
          }

          this.logger.debug("Memory cache miss for session " + sessionId + ", rebuilding from disk");

          let memoryDir: string;
          let memosDir: string;
          if (context?.sessionType === "sub_agent") {
            const subDir = path.join(workspaceDir, ".guada", "subagents", sessionId);
            memoryDir = path.join(subDir, "memory");
            memosDir = path.join(subDir, "memos");
          } else {
            memoryDir = path.join(workspaceDir, ".guada", "memory");
            memosDir = path.join(workspaceDir, ".guada", "memos");
          }

          await this.rebuildIndexForSession(sessionId, memoryDir, memosDir);

          const updated = this.cache.get(sessionId);
          return updated?.promptContent || "";
        } catch (error: any) {
          this.logger.error("Memory prompt error: " + (error?.message || error));
          return "";
        }
      },
    });




  }

  private async rebuildIndexForSession(
    sessionId: string,
    memoryDir: string,
    memosDir: string,
  ): Promise<void> {
    const index: MemoryIndex = {
      factual: undefined,
      soul: undefined,
      memos: [],
      lastUpdated: new Date(),
    };

    // 读取长期记忆
    try {
      const factualPath = path.join(memoryDir, "factual.md");
      index.factual = await fs.readFile(factualPath, "utf-8");
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to read factual.md: " + error.message);
      }
    }

    try {
      const soulPath = path.join(memoryDir, "soul.md");
      index.soul = await fs.readFile(soulPath, "utf-8");
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to read soul.md: " + error.message);
      }
    }

    // 读取备忘录
    try {
      await fs.access(memosDir);
      const files = await fs.readdir(memosDir);
      const memoFiles = files.filter((f) => f.endsWith(".md"));

      for (const file of memoFiles) {
        const title = file.replace(".md", "");
        const fPath = path.join(memosDir, file);
        const content = await fs.readFile(fPath, "utf-8");
        index.memos.push({ title, content });
      }
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to read memos directory: " + error.message);
      }
    }

    // 生成提示词内容并更新缓存
    const promptContent = this.buildMemoryPrompt(index);
    this.updateCache(sessionId, index, promptContent);

    this.logger.log("Rebuilt memory index for session " + sessionId + ": " + index.memos.length + " memos");
  }

  private buildMemoryPrompt(index: MemoryIndex): string {
    const promptParts: string[] = [];

    // ========== 第一部分：长期记忆注入 ==========
    promptParts.push("# 记忆");

    promptParts.push("\n## 事实性记忆 (.guada/memory/factual.md)");
    promptParts.push("<factual-memory>");
    if (index.factual) {
      promptParts.push(index.factual);
    } else {
      promptParts.push("目前没有事实性记忆");
    }
    promptParts.push("</factual-memory>");

    promptParts.push("\n## 人格定义 (.guada/memory/soul.md)");
    promptParts.push("<soul-memory>");
    if (index.soul) {
      promptParts.push(index.soul);
    } else {
      promptParts.push("目前没有人格定义记忆");
    }
    promptParts.push("</soul-memory>");

    // ========== 第二部分：备忘录目录注入 ==========
    promptParts.push("\n# 备忘录目录 (.guada/memos/*.md)");
    promptParts.push("<memo-list>");
    if (index.memos.length > 0) {
      index.memos.forEach((memo, idx) => {
        promptParts.push((idx + 1) + ". " + memo.title);
      });
    } else {
      promptParts.push("目前没有备忘录");
    }
    promptParts.push("</memo-list>");

    return promptParts.join("\n");
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
