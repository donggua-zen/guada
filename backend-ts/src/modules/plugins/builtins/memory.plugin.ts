import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { EventBusService } from "../../../common/events/event-bus.service";
import { PluginApi } from "../api/plugin-api";

interface MemoryIndex {
  factual?: string;
  memos: Array<{ title: string; content: string; mtimeMs: number }>;
  lastUpdated: Date;
}

interface CacheItem {
  index: MemoryIndex;
  lastAccessed: Date;
  promptContent: string;
  totalChars: number;
  limit: number;
}

@Injectable()
export class MemoryPlugin extends PluginBase {
  private readonly logger = new Logger(MemoryPlugin.name);
  private readonly cache = new Map<string, CacheItem>();
  private readonly MAX_CACHE_SIZE = 10;
  private readonly MEMORY_LIMIT = 3000;

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

  @OnEvent("memory.compacted")
  handleMemoryCompressed(payload: { sessionId: string }) {
    if (this.cache.has(payload.sessionId)) {
      this.cache.delete(payload.sessionId);
      this.logger.debug(
        `Memory cache invalidated for session ${payload.sessionId} after compression`,
      );
    }
  }

  async onLoad(api: PluginApi) {
    // 长期记忆内容：插件级，每次对话都注入（AI 需要知道记住了什么）
    api.registerPrompt({
      frequency: "VOLATILE",
      description: "长期记忆内容",
      content: async (context: PluginContext) => {
        try {
          const sessionId = context?.session.sessionId;
          if (!sessionId) return "";
          const workspaceDir = context?.session.workspacePath;
          if (!workspaceDir) {
            this.logger.warn(
              "No workspace path provided for session " + sessionId,
            );
            return "";
          }
          const cacheItem = this.cache.get(sessionId);
          if (cacheItem) {
            cacheItem.lastAccessed = new Date();
            return cacheItem.promptContent;
          }
          this.logger.debug(
            "Memory cache miss for session " +
              sessionId +
              ", rebuilding from disk",
          );
          let memoryDir: string;
          let memosDir: string;
          if (context?.session.sessionType === "sub_agent") {
            const subDir = path.join(
              workspaceDir,
              ".guada",
              "subagents",
              sessionId,
            );
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
          this.logger.error(
            "Memory prompt error: " + (error?.message || error),
          );
          return "";
        }
      },
    });

    // 记忆管理指南：工具包级，懒加载，需要时才看说明
    const memoryKit = api.registerToolKit({
      id: "memory",
      name: "记忆管理",
      loadMode: "lazy",
      activator: "用户主动要求记住某事的时候请阅读此说明",
      handler: async (ctx) => {
        return { loadMode: "lazy" as const };
      },
    });

    memoryKit.registerPrompt({
      frequency: "REGULAR",
      description: "记忆管理指南",
      content: (context: PluginContext) => {
        return `
# 记忆管理指南

主动发现有价值的内容，使用 \`memory\` 工具管理记忆。

## 存储原则

**事实记忆 (factual)** — 长期保持紧凑，聚焦于将来仍然重要的事实：
- 用户偏好、环境细节、工具怪癖、稳定的约定
- 优先保存能减少用户未来纠正次数的事情——最有价值的记忆是那种能防止用户不得不再次纠正或提醒你的记忆
- 用户偏好和反复出现的修正，比过程性的任务细节更重要
- **不要保存**：任务进度、会话结果、已完成的工作日志、临时的 TODO 状态
- 事实记忆只保存**结论**

**备忘录 (memos)** — 需要长期记住但不需要时刻注入的长内容：
- 如会议纪要、技术笔记、完整需求文档
- 仅显示标题在上下文中，按需读取

## 使用示例
- 保存偏好 → \`memory action=append target=factual content="用户偏好：..."\`
- 修正记忆 → \`memory action=replace target=factual old_text="旧" content="新"\`
- 搜索记事本 → \`memory action=search pattern="关键词"\`
- 新增笔记 → \`memory action=append target=memo memo_title="标题" content="详细内容"\`
- 删除笔记 → \`memory action=replace target=memo memo_title="旧标题"\`（content 留空即删除）`;
      },
    });

    // ── memory 工具 ──
    api.registerTool({
      name: "memory",
      description: `编辑长期记忆：追加/替换/删除事实记忆或记事本。修改不会立即刷新上下文，等待记忆压缩后自动同步。`,
      inputSchema: z.object({
        action: z.enum(["append", "replace", "search"]),
        target: z
          .enum(["factual", "memo"])
          .describe("factual=事实记忆, memo=记事本"),
        content: z
          .string()
          .optional()
          .describe("写入内容，replace 时为空/空字符串则视为删除 old_text"),
        old_text: z
          .string()
          .optional()
          .describe("replace 时定位的旧文本，需精确匹配原文"),
        memo_title: z
          .string()
          .optional()
          .describe("target=memo 时的备忘录标题（不含 .md）"),
        pattern: z
          .string()
          .optional()
          .describe("search 时的正则表达式，固定搜索 memos 目录"),
      }),
      execute: async (args, ctx) => {
        return this.handleMemoryEdit(args, ctx);
      },
      display: { action: "编辑记忆", argsKey: "action", icon: "generic" },
    });
  }

  // ── memory 操作函数 ──

  private async handleMemoryEdit(
    args: Record<string, any>,
    ctx: PluginContext,
  ): Promise<any> {
    const { action, target, content, old_text, memo_title, pattern } = args;
    this.logger.log(`memory: ${action} / ${target}`);
    try {
      let result: any;
      switch (action) {
        case "append":
          result = await this.memoryAppend(target, content, memo_title, ctx);
          break;
        case "replace":
          result = await this.memoryReplace(
            target,
            old_text,
            content,
            memo_title,
            ctx,
          );
          break;
        case "search":
          return await this.memorySearch(pattern, ctx);
        default:
          return { success: false, message: `unknown action: ${action}` };
      }
      // 写入操作后附加容量信息（仅事实记忆受影响）
      if (result?.success && target === "factual") {
        const cap = await this.calculateMemoryCapacity(ctx);
        result.memory_capacity = `${cap.percent}% — ${cap.used}/${cap.limit} chars`;
        if (cap.overLimit) {
          result.warning = `Memory full (${cap.percent}%), write succeeded but cannot display. Use 'memory replace' to compress old entries.`;
        }
      }
      return result;
    } catch (e: any) {
      this.logger.error(`memory failed: ${e.message}`);
      return { success: false, message: e.message || "memory operation failed" };
    }
  }

  private async memoryAppend(
    target: "factual" | "memo",
    content: string,
    memoTitle: string | undefined,
    ctx: PluginContext,
  ): Promise<{ success: boolean; message: string }> {
    if (!content) throw new Error("content cannot be empty");
    if (target === "memo" && !memoTitle)
      throw new Error("memo_title required for memo target");

    const filePath = this.resolveMemoryPath(target, ctx, memoTitle);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let existing = "";
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    const toWrite = existing
      ? existing.trimEnd() + "\n" + content + "\n"
      : content + "\n";
    await fs.writeFile(filePath, toWrite, "utf-8");

    const label = target === "memo" ? `note ${memoTitle}` : "factual";
    return {
      success: true,
      message: `${label} appended, ${content.length} chars`,
    };
  }

  private async memoryReplace(
    target: "factual" | "memo",
    oldText: string,
    newContent: string | undefined | null,
    memoTitle: string | undefined,
    ctx: PluginContext,
  ): Promise<{ success: boolean; message: string }> {
    if (!oldText) throw new Error("old_text cannot be empty");
    if (target === "memo" && !memoTitle)
      throw new Error("memo_title required for memo target");

    // content 为空或 null → 视为删除操作
    const isDelete =
      newContent === undefined || newContent === null || newContent === "";
    const replaceWith = isDelete ? "" : newContent;

    const filePath = this.resolveMemoryPath(target, ctx, memoTitle);
    const existing = await fs.readFile(filePath, "utf-8");
    const normContent = existing.replace(/\r\n/g, "\n");
    const normOld = oldText.replace(/\r\n/g, "\n");
    const idx = normContent.indexOf(normOld);
    if (idx === -1) throw new Error(`text not found: ${oldText}`);

    const hasCRLF = existing.includes("\r\n");
    const normResult = normContent.replace(normOld, replaceWith);
    const modified = hasCRLF ? normResult.replace(/\n/g, "\r\n") : normResult;
    await fs.writeFile(filePath, modified, "utf-8");

    const label = target === "memo" ? `note ${memoTitle}` : "factual";
    const actionLabel = isDelete ? "deleted" : "replaced, 1 occurrence";
    return { success: true, message: `${label} ${actionLabel}` };
  }

  private async memorySearch(
    pattern: string,
    ctx: PluginContext,
  ): Promise<any> {
    if (!pattern) throw new Error("pattern is required");

    const workspaceDir = ctx?.session.workspacePath;
    if (!workspaceDir) throw new Error("workspace path required");

    const memosDir =
      ctx?.session.sessionType === "sub_agent"
        ? path.join(
            workspaceDir,
            ".guada",
            "subagents",
            ctx.session.sessionId,
            "memos",
          )
        : path.join(workspaceDir, ".guada", "memos");

    const ctxLines = 3;
    const maxResultsLimit = 30;

    const isCaseSensitive = /[A-Z]/.test(pattern);
    const flags = isCaseSensitive ? "gm" : "gim";
    const regex = new RegExp(pattern, flags);

    let files: string[];
    try {
      files = await fs.readdir(memosDir);
    } catch {
      return { success: true, pattern, files: [], total: 0 };
    }

    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const results: Array<{
      file: string;
      lines: Array<{ line: number; content: string }>;
    }> = [];

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(memosDir, file), "utf-8");
      const lines = content.split("\n");
      const fileMatches: Array<{ line: number; content: string }> = [];

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          regex.lastIndex = 0;
          // 上下文行
          const start = Math.max(0, i - ctxLines);
          const end = Math.min(lines.length, i + ctxLines + 1);
          for (let j = start; j < end; j++) {
            const prefix = j === i ? "→" : " ";
            fileMatches.push({ line: j + 1, content: `${prefix} ${lines[j]}` });
          }
          fileMatches.push({ line: -1, content: "---" });
        }
      }

      if (fileMatches.length > 0) {
        results.push({ file, lines: fileMatches });
        if (results.length >= maxResultsLimit) break;
      }
    }

    return {
      success: true,
      pattern,
      total: results.length,
      files: results,
    };
  }

  private resolveMemoryPath(
    target: "factual" | "memo",
    ctx: PluginContext,
    memoTitle?: string,
  ): string {
    const workspaceDir = ctx?.session.workspacePath;
    if (!workspaceDir) throw new Error("缺少工作目录");

    const root =
      ctx?.session.sessionType === "sub_agent"
        ? path.join(workspaceDir, ".guada", "subagents", ctx.session.sessionId)
        : workspaceDir;

    if (target === "memo") {
      if (!memoTitle) throw new Error("memo_title required for memo target");
      return path.join(root, ".guada", "memos", `${memoTitle}.md`);
    }
    return path.join(root, ".guada", "memory", "factual.md");
  }

  // ── 缓存管理 ──

  private async rebuildIndexForSession(
    sessionId: string,
    memoryDir: string,
    memosDir: string,
  ): Promise<void> {
    const index: MemoryIndex = {
      factual: undefined,
      memos: [],
      lastUpdated: new Date(),
    };

    try {
      const factualPath = path.join(memoryDir, "factual.md");
      index.factual = await fs.readFile(factualPath, "utf-8");
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to read factual.md: " + error.message);
      }
    }

    try {
      await fs.access(memosDir);
      const files = await fs.readdir(memosDir);
      const memoFiles = files.filter((f) => f.endsWith(".md"));

      for (const file of memoFiles) {
        const title = file.replace(".md", "");
        const fPath = path.join(memosDir, file);
        const content = await fs.readFile(fPath, "utf-8");
        let mtimeMs = 0;
        try {
          const stat = await fs.stat(fPath);
          mtimeMs = stat.mtimeMs;
        } catch {
          /* 忽略 */
        }
        index.memos.push({ title, content, mtimeMs });
      }

      // 按修改时间倒序（最新在前）
      index.memos.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to read memos directory: " + error.message);
      }
    }

    // 计算事实记忆字符数（容量限制仅针对 factual）
    const totalChars = (index.factual || "").length;

    const promptContent = this.buildMemoryPrompt(index, totalChars);
    this.updateCache(
      sessionId,
      index,
      promptContent,
      totalChars,
      this.MEMORY_LIMIT,
    );

    this.logger.log(
      "Rebuilt memory index for session " +
        sessionId +
        ": " +
        index.memos.length +
        " memos",
    );
  }

  private buildMemoryPrompt(index: MemoryIndex, totalChars: number): string {
    const promptParts: string[] = [];
    const MAX_MEMOS = 20;

    promptParts.push("# 记忆");

    const factualOverLimit = totalChars > this.MEMORY_LIMIT;

    promptParts.push("\n## 事实性记忆");
    promptParts.push("<factual-memory>");
    if (index.factual) {
      if (factualOverLimit) {
        promptParts.push(index.factual.substring(0, this.MEMORY_LIMIT));
        promptParts.push(
          "\n⚠️ **事实记忆已达容量上限**（3K），部分内容无法显示。请使用 `memory replace` 整理压缩旧记忆腾出空间。",
        );
      } else {
        promptParts.push(index.factual);
      }
    } else {
      promptParts.push("目前没有事实性记忆");
    }
    promptParts.push("</factual-memory>");

    promptParts.push("\n# 备忘录目录");
    promptParts.push("<memo-list>");
    if (index.memos.length > 0) {
      const shownMemos = index.memos.slice(0, MAX_MEMOS);
      const hiddenCount = index.memos.length - shownMemos.length;
      shownMemos.forEach((memo, idx) => {
        promptParts.push(`${idx + 1}. ${memo.title}`);
      });
      if (hiddenCount > 0) {
        promptParts.push(
          `... 另有 ${hiddenCount} 条记录被隐藏（共 ${index.memos.length} 条）`,
        );
      }
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
    totalChars: number,
    limit: number,
  ): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) this.evictLRU();
    this.cache.set(sessionId, {
      index,
      lastAccessed: new Date(),
      promptContent,
      totalChars,
      limit,
    });
  }

  private async calculateMemoryCapacity(ctx: PluginContext): Promise<{
    used: number;
    limit: number;
    percent: number;
    overLimit: boolean;
  }> {
    const workspaceDir = ctx?.session.workspacePath;
    if (!workspaceDir)
      return {
        used: 0,
        limit: this.MEMORY_LIMIT,
        percent: 0,
        overLimit: false,
      };

    const root =
      ctx?.session.sessionType === "sub_agent"
        ? path.join(workspaceDir, ".guada", "subagents", ctx.session.sessionId)
        : workspaceDir;

    let used = 0;
    const factualPath = path.join(root, ".guada", "memory", "factual.md");
    try {
      const content = await fs.readFile(factualPath, "utf-8");
      used += content.length;
    } catch {
      /* 文件不存在则忽略 */
    }

    const memosDir = path.join(root, ".guada", "memos");
    try {
      const files = await fs.readdir(memosDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await fs.readFile(path.join(memosDir, file), "utf-8");
        used += content.length;
      }
    } catch {
      /* 目录不存在则忽略 */
    }

    const percent = Math.round((used / this.MEMORY_LIMIT) * 100);
    return {
      used,
      limit: this.MEMORY_LIMIT,
      percent,
      overLimit: used > this.MEMORY_LIMIT,
    };
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
