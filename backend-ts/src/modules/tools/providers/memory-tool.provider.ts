import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";
import { WorkspaceService } from "../../../common/services/workspace.service";

/**
 * 记忆索引数据结构
 */
interface MemoryIndex {
  factual?: string; // 事实性记忆内容
  soul?: string; // 人格定义内容
  memos: Array<{ title: string; content: string }>; // 备忘录列表
  lastUpdated: Date; // 最后更新时间
  fileMtimes: Record<string, number>; // 关键文件的最后修改时间戳
}

/**
 * LRU 缓存项
 */
interface CacheItem {
  index: MemoryIndex;
  lastAccessed: Date;
}

@Injectable()
export class MemoryToolProvider implements IToolProvider {
  private readonly logger = new Logger(MemoryToolProvider.name);
  public readonly namespace = "memory";

  // LRU 缓存：sessionId -> CacheItem
  private readonly cache = new Map<string, CacheItem>();

  // 最大缓存会话数
  private readonly MAX_CACHE_SIZE = 10;

  private readonly toolsConfig: InternalToolDefinition[] = [];

  constructor(private workspaceService: WorkspaceService) { }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    if (enabled === false) return [];

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter(tool => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有工具
    return this.toolsConfig;
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    return JSON.stringify({ success: true, message: "Memory provider is now auto-syncing." });
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    const promptParts: string[] = [];

    promptParts.push("# 记忆管理指南");
    promptParts.push("");
    promptParts.push("你应该主动发现并记录你认为有价值的内容，使用文件工具集管理你的记忆。文件位于工作目录的 `memory/` 子目录中。");
    promptParts.push("");
    promptParts.push("## 记忆文件结构");
    promptParts.push("");
    promptParts.push("```");
    promptParts.push("memory/");
    promptParts.push("├── factual.md          # 事实性记忆（用户偏好、项目状态、待办事项）");
    promptParts.push("├── soul.md             # 人格定义（角色设定、回复风格）");
    promptParts.push("└── memos/              # 备忘录目录");
    promptParts.push("    ├── 标题1.md");
    promptParts.push("    ├── 标题2.md");
    promptParts.push("    └── ...");
    promptParts.push("```");
    promptParts.push("");
    promptParts.push("## 使用规范");
    promptParts.push("");
    promptParts.push("### 1. 长期记忆 vs 备忘录的选择原则");
    promptParts.push("");
    promptParts.push("**长期记忆**（factual.md / soul.md）：");
    promptParts.push("- **核心特征**：全局性、高频使用、需要时刻记住的信息");
    promptParts.push("- **适用场景**：");
    promptParts.push("  - 用户偏好与兴趣（语言偏好、主题喜好、沟通风格）");
    promptParts.push("  - 当前项目进展（正在进行的项目状态、关键节点）");
    promptParts.push("  - 待办事项（需要持续跟踪的任务清单）");
    promptParts.push("  - AI 行为规则（角色设定、回复风格、特殊要求）");
    promptParts.push("- **特点**：每次对话都会自动注入，你会刻看到这些信息");
    promptParts.push("");
    promptParts.push("**备忘录**（memos/*.md）：");
    promptParts.push("- **核心特征**：AI 专属记忆空间、详细记录、按需查阅、用户不可见");
    promptParts.push("- **适用场景**：");
    promptParts.push("  - 经验总结（技术笔记、最佳实践、踩坑记录）");
    promptParts.push("  - 重要事件（会议纪要、讨论要点、决策过程）");
    promptParts.push("  - 详细的个人信息（完整的项目文档、详细的需求说明）");
    promptParts.push("  - 命令备忘（常用命令、配置示例、代码片段）");
    promptParts.push("  - 参考资料（链接集合、资源列表、学习路径）");
    promptParts.push("- **特点**：只显示标题目录，需要时通过标题读取具体内容");
    promptParts.push("");
    promptParts.push("### 2. 文件名规范");
    promptParts.push("");
    promptParts.push("- 长期记忆固定为 `factual.md` 和 `soul.md`");
    promptParts.push("- 备忘录文件名应清晰反映内容，如 `Docker常用命令.md`、`2024-01-15_项目需求会议.md`");
    promptParts.push("- 避免使用特殊字符：`<>:\"/\\|?*`");
    promptParts.push("");
    promptParts.push("### 3. 实际使用示例");
    promptParts.push("");
    promptParts.push("**场景1 - 用户偏好**：");
    promptParts.push("当用户说\"我喜欢用中文交流，希望回答简洁一些\"时");
    promptParts.push("应该写入 `memory/factual.md`，内容为：");
    promptParts.push("```");
    promptParts.push("用户偏好：中文交流，简洁风格");
    promptParts.push("```");
    promptParts.push("");
    promptParts.push("**场景2 - 项目进展**：");
    promptParts.push("当用户说\"我们正在开发一个聊天应用，目前完成了登录功能\"时");
    promptParts.push("应该写入 `memory/factual.md`，内容为：");
    promptParts.push("```");
    promptParts.push("当前项目：聊天应用，进度：登录功能已完成");
    promptParts.push("```");
    promptParts.push("");
    promptParts.push("**场景3 - 技术笔记**：");
    promptParts.push("当用户说\"帮我记录一下 Docker 的常用命令\"时");
    promptParts.push("应该创建备忘录 `memory/memos/Docker常用命令.md`，保存完整的命令列表");
    promptParts.push("");
    promptParts.push("**场景4 - 会议纪要**：");
    promptParts.push("当对话中讨论了项目需求后");
    promptParts.push("应该创建备忘录 `memory/memos/2024-01-15_项目需求会议.md`，保存详细的会议记录");
    promptParts.push("");
    promptParts.push("### 4. 重要提醒");
    promptParts.push("");
    promptParts.push("1. **优先使用长期记忆**：对于核心信息，优先使用 factual.md 或 soul.md");
    promptParts.push("2. **备忘录作为补充**：详细信息、参考资料或者过长的记忆使用备忘录");
    promptParts.push("3. **保持长期记忆精简**：长期记忆应该像\"便签\"一样简洁");
    promptParts.push("4. **避免重复读取**：已经载入上下文或提示词的记忆内容不需要重复读取");
    promptParts.push("5. **自主判断**：根据记忆类型自主判断需要保存的位置");
    promptParts.push("");

    return promptParts.join("\n");
  }

  async getPersistentPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const sessionId = context?.sessionId;
      if (!sessionId) {
        return "";
      }

      const workspaceDir = this.workspaceService.getWorkspaceDir(sessionId);
      const memoryDir = path.join(workspaceDir, 'memory');

      // 1. 获取当前磁盘上的文件状态
      const currentMtimes = await this.getFileMtimes(memoryDir);

      // 2. 检查缓存是否需要更新
      const cacheItem = this.cache.get(sessionId);
      let needsRebuild = false;

      if (!cacheItem) {
        needsRebuild = true;
      } else {
        // 比对文件修改时间
        for (const [file, mtime] of Object.entries(currentMtimes)) {
          if (cacheItem.index.fileMtimes[file] !== mtime) {
            needsRebuild = true;
            break;
          }
        }
      }

      // 3. 如果需要重建，则自动执行
      if (needsRebuild) {
        this.logger.debug(`Auto-rebuilding memory index for session ${sessionId}`);
        await this.rebuildIndexForSession(sessionId, currentMtimes);
      } else {
        // 更新访问时间
        cacheItem.lastAccessed = new Date();
      }

      // 4. 从缓存生成提示词
      const finalCache = this.cache.get(sessionId);
      if (!finalCache) return "";

      const { index } = finalCache;
      const promptParts: string[] = [];

      // ========== 第一部分：长期记忆注入 ==========
      promptParts.push("# 记忆");

      promptParts.push("\n## 事实性记忆 (memory/factual.md)");
      promptParts.push("这些是核心事实知识库，包括用户偏好、重要决策、项目状态等关键信息：");
      promptParts.push("<factual-memory>");
      if (index.factual) {
        promptParts.push(index.factual);
      } else {
        promptParts.push("目前没有事实性记忆");
      }
      promptParts.push("</factual-memory>");

      promptParts.push("\n## 人格定义 (memory/soul.md)");
      promptParts.push("这些定义了 AI 的角色定位、语言风格和行为规则：");
      promptParts.push("<soul-memory>");
      if (index.soul) {
        promptParts.push(index.soul);
      } else {
        promptParts.push("目前没有人格定义记忆");
      }
      promptParts.push("</soul-memory>");

      // ========== 第二部分：备忘录目录注入 ==========
      promptParts.push("\n# 备忘录目录 (memory/memos/*.md)");
      promptParts.push("以下是你可访问的备忘录列表，可通过标题读取具体内容：");
      promptParts.push("<memo-list>");
      if (index.memos.length > 0) {
        index.memos.forEach((memo, idx) => {
          promptParts.push(`${idx + 1}. ${memo.title}`);
        });
      } else {
        promptParts.push("目前没有备忘录");
      }
      promptParts.push("</memo-list>");

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取持续注入提示词失败：${error.message}`);
      return "";
    }
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "记忆索引管理工具，用于同步文件系统的记忆数据到内存缓存";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "记忆管理",
      description: "记忆索引管理与缓存同步工具",
      isMcp: false,
      loadMode: "eager",
    };
  }

  /**
   * 获取关键记忆文件的最后修改时间戳
   */
  private async getFileMtimes(memoryDir: string): Promise<Record<string, number>> {
    const mtimes: Record<string, number> = {};
    const filesToCheck = ['factual.md', 'soul.md'];
      
    for (const file of filesToCheck) {
      try {
        const stats = await fs.stat(path.join(memoryDir, file));
        mtimes[file] = stats.mtimeMs;
      } catch (error: any) {
        // 文件不存在则忽略
      }
    }
  
    // 检查 memos 目录的整体状态
    try {
      const memosDir = path.join(memoryDir, 'memos');
      const stats = await fs.stat(memosDir);
      mtimes['memos_dir'] = stats.mtimeMs; 
    } catch (error: any) {}
  
    return mtimes;
  }
  
  /**
   * 为指定会话重建索引（从文件系统读取到内存缓存）
   */
  private async rebuildIndexForSession(sessionId: string, preFetchedMtimes?: Record<string, number>): Promise<void> {
    const workspaceDir = this.workspaceService.getWorkspaceDir(sessionId);
    const memoryDir = path.join(workspaceDir, 'memory');
    const memosDir = path.join(memoryDir, 'memos');
  
    const index: MemoryIndex = {
      factual: undefined,
      soul: undefined,
      memos: [],
      lastUpdated: new Date(),
      fileMtimes: preFetchedMtimes || {},
    };
  
    // 如果没传签名，重新获取一次以确保准确性
    if (!preFetchedMtimes) {
      index.fileMtimes = await this.getFileMtimes(memoryDir);
    }
  
    // 读取长期记忆
    try {
      const factualPath = path.join(memoryDir, 'factual.md');
      index.factual = await fs.readFile(factualPath, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Failed to read factual.md: ${error.message}`);
      }
    }
  
    try {
      const soulPath = path.join(memoryDir, 'soul.md');
      index.soul = await fs.readFile(soulPath, 'utf-8');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Failed to read soul.md: ${error.message}`);
      }
    }
  
    // 读取备忘录
    try {
      await fs.access(memosDir);
      const files = await fs.readdir(memosDir);
      const memoFiles = files.filter(f => f.endsWith('.md'));
  
      for (const file of memoFiles) {
        const title = file.replace('.md', '');
        const filePath = path.join(memosDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
  
        index.memos.push({ title, content });
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Failed to read memos directory: ${error.message}`);
      }
    }
  
    // 更新缓存（LRU 淘汰）
    this.updateCache(sessionId, index);
  
    this.logger.log(`Rebuilt memory index for session ${sessionId}: ${index.memos.length} memos`);
  }

  /**
   * 更新缓存（带 LRU 淘汰）
   */
  private updateCache(sessionId: string, index: MemoryIndex): void {
    // 如果缓存已满且是新会话，淘汰最久未访问的
    if (!this.cache.has(sessionId) && this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    // 更新或添加缓存项
    this.cache.set(sessionId, {
      index,
      lastAccessed: new Date(),
    });
  }

  /**
   * LRU 淘汰：移除最久未访问的缓存项
   */
  private evictLRU(): void {
    let oldestSessionId: string | null = null;
    let oldestTime = new Date();

    for (const [sessionId, cacheItem] of this.cache.entries()) {
      if (cacheItem.lastAccessed < oldestTime) {
        oldestTime = cacheItem.lastAccessed;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      this.cache.delete(oldestSessionId);
      this.logger.debug(`Evicted LRU cache for session: ${oldestSessionId}`);
    }
  }
}
