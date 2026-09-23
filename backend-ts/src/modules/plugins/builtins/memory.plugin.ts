import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_LINES,
  resolveMemoryDir,
  type MemoryScopeRef,
} from "../../../common/utils/memory-path.util";
import langZh from "./memory.lang.zh.json";
import langEn from "./memory.lang.en.json";

/**
 * 长期记忆插件（prompt-only：不提供专用工具）
 *
 * 记忆形态 = 一个 Markdown 索引 + 按需读取的明细文件，全部位于会话记忆目录：
 *   主会话  → <workspace>/.guada/memory/
 *   子智能体 → <workspace>/.guada/subagents/<sessionId>/memory/（完全隔离）
 *
 * MEMORY.md 是索引，只有它被注入上下文（前 INDEX_MAX_LINES 行）；明细文件由 AI
 * 用文件工具按需读取。索引与明细的写入也全部由 AI 用文件工具完成——格式、排序、
 * 瘦身都靠注入的维护指南约束，代码不做校验也不自动追加。
 *
 * 压缩前的记忆维护影子轮次见 chat/memory-sync.service.ts：它在记忆目录牢笼内
 * 复用文件工具（setToolScope("file") + setPathJail），不走独立记忆工具。
 */
@Injectable()
export class MemoryPlugin extends PluginBase {
  private readonly logger = new Logger(MemoryPlugin.name);

  /** 旧版布局（迁移用）：<guadaBase>/memory/factual.md 与 <guadaBase>/memos/*.md */
  private static readonly LEGACY_FACTUAL = "factual.md";
  private static readonly LEGACY_MEMOS_DIR = "memos";

  manifest = {
    id: "memory",
    name: "%memory.name%",
    description: "%memory.description%",
    version: "2.0.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);

    // ── 记忆能力包：只有提示词、没有工具。保留 toolkit id "memory" 使智能体层的
    //    启停（toolkits_deny/allow）与既有配置零迁移继续生效 ──
    const memoryKit = api.registerToolKit({
      id: "memory",
      name: "%memory.toolkitName%",
      description: "%memory.toolkitDescription%",
      loadMode: "eager",
    });

    // 长期记忆索引：随记忆能力包注入（智能体层禁用该包时一并隐藏）。
    // VOLATILE：内容随文件变化，排在提示词末尾，对前缀缓存影响最小
    memoryKit.registerPrompt({
      frequency: "VOLATILE",
      description: "长期记忆索引",
      content: async (context: PluginContext) => {
        try {
          return await this.buildMemoryPrompt(context);
        } catch (error: any) {
          this.logger.error("Memory prompt error: " + (error?.message || error));
          return "";
        }
      },
    });
  }

  // ── 路径 ──

  /** 会话身份投影（路径解析的输入） */
  private memoryScope(context?: PluginContext): MemoryScopeRef {
    const workspacePath = context?.session.workspacePath;
    if (!workspacePath) throw new Error("missing workspace directory");
    return {
      workspacePath,
      sessionId: context!.session.sessionId,
      sessionType: context?.session.sessionType,
    };
  }

  // ── 索引注入 ──

  private async buildMemoryPrompt(context?: PluginContext): Promise<string> {
    const memoryDir = resolveMemoryDir(this.memoryScope(context));
    await this.migrateLegacyLayout(memoryDir);

    const indexPath = path.join(memoryDir, MEMORY_INDEX_FILE);
    const raw = await this.readIfExists(indexPath);

    const lines = raw === null ? [] : raw.replace(/\r\n/g, "\n").split("\n");
    const visible = lines.slice(0, MEMORY_INDEX_MAX_LINES);
    const hiddenCount = lines.length - visible.length;

    const parts: string[] = [];
    parts.push("# Memory");
    parts.push("");
    parts.push("<memory-index>");
    parts.push(
      raw === null || raw.trim() === ""
        ? "(no memory index yet)"
        : visible.join("\n"),
    );
    if (hiddenCount > 0) {
      parts.push(
        `... index has ${lines.length} lines; only the first ${MEMORY_INDEX_MAX_LINES} are injected. Consolidate older entries (merge or drop them) so the important ones stay visible.`,
      );
    }
    parts.push("</memory-index>");
    parts.push("");
    parts.push(this.buildMaintenanceGuide(memoryDir));
    return parts.join("\n");
  }

  /**
   * 记忆维护指南：常驻注入（原 `memory` 工具的说明搬家到这里）。
   * 索引格式、排序与瘦身约定只在这里约束，代码不校验。
   */
  private buildMaintenanceGuide(memoryDir: string): string {
    return [
      "# Memory Maintenance",
      "",
      `Long-term memory lives in this session's memory directory: ${memoryDir}`,
      `\`${MEMORY_INDEX_FILE}\` is the index and the only file injected into your context (first ${MEMORY_INDEX_MAX_LINES} lines). Detail files hold the full content and are read on demand.`,
      "",
      "Rules:",
      "- One index entry per line: `[title](topic/file.md) — one-line summary`",
      "- Order entries by importance: the most load-bearing memories first",
      `- Keep the index under ${MEMORY_INDEX_MAX_LINES} lines. Lines beyond that are never injected, so consolidate (merge or drop) old entries instead of appending forever`,
      "- Put detail files in topic subdirectories you choose (e.g. `prefs/`, `feedback/`, `arch/`)",
      "- When the user asks you to remember something, or you learn a durable preference, environment fact or recurring correction, write a detail file and add its index entry with the file tools",
      "- Prefer updating an existing entry over adding a near-duplicate one",
      "- Do NOT store task progress, session results or TODO states in memory",
      "- Memory files go under the memory directory above (this is the prompt-specified location for `.guada` files)",
    ].join("\n");
  }

  // ── 旧版布局懒迁移（一次性、幂等、只复制不删除） ──

  /**
   * 旧布局（<guadaBase>/memory/factual.md + <guadaBase>/memos/*.md）→ 新布局
   * （<guadaBase>/memory/MEMORY.md + 明细文件）。仅在索引不存在时尝试一次；
   * 全程 best-effort：失败只记日志，不影响注入。
   */
  private async migrateLegacyLayout(memoryDir: string): Promise<void> {
    const indexPath = path.join(memoryDir, MEMORY_INDEX_FILE);
    try {
      await fs.access(indexPath);
      return; // 索引已在 → 迁移已完成或用户自建，不动
    } catch {
      /* 继续探测旧布局 */
    }

    const guadaBase = path.dirname(memoryDir);
    const legacyFactual = path.join(memoryDir, MemoryPlugin.LEGACY_FACTUAL);
    const legacyMemosDir = path.join(guadaBase, MemoryPlugin.LEGACY_MEMOS_DIR);

    const entries: string[] = [];

    // ① 旧 factual.md → 明细 notes/legacy_factual.md
    const factual = await this.readIfExists(legacyFactual);
    if (factual !== null && factual.trim() !== "") {
      const notesDir = path.join(memoryDir, "notes");
      await fs.mkdir(notesDir, { recursive: true });
      await this.copyIfAbsent(
        legacyFactual,
        path.join(notesDir, "legacy_factual.md"),
      );
      entries.push(
        "[历史事实记忆（迁移）](notes/legacy_factual.md) — 旧版 factual.md，待整理",
      );
    }

    // ② 旧 memos/*.md → 明细 memos/*.md（摘要留空，由 AI 后补）
    const memos = await this.listMarkdown(legacyMemosDir);
    if (memos.length > 0) {
      const memosDir = path.join(memoryDir, "memos");
      await fs.mkdir(memosDir, { recursive: true });
      for (const name of memos) {
        await this.copyIfAbsent(
          path.join(legacyMemosDir, name),
          path.join(memosDir, name),
        );
        entries.push(`[${name.replace(/\.md$/, "")}](memos/${name}) — `);
      }
    }

    if (entries.length === 0) return;

    const content = [
      "# 长期记忆索引",
      "",
      "<!-- 由旧版记忆布局迁移生成：格式待整理，重排条目后可删除本注释 -->",
      "",
      ...entries,
      "",
    ].join("\n");

    // wx：并发会话同时迁移时只让一方写入，另一方忽略
    try {
      await fs.writeFile(indexPath, content, { encoding: "utf-8", flag: "wx" });
      this.logger.log(
        `Migrated legacy memory into ${indexPath} (${entries.length} entries)`,
      );
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
  }

  private async readIfExists(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      this.logger.warn("Failed to read " + filePath + ": " + error.message);
      return null;
    }
  }

  private async listMarkdown(dir: string): Promise<string[]> {
    try {
      const files = await fs.readdir(dir);
      return files.filter((f) => f.endsWith(".md")).sort();
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      this.logger.warn("Failed to read " + dir + ": " + error.message);
      return [];
    }
  }

  /** 目标已存在则保留目标（不动用户/AI 已写的内容） */
  private async copyIfAbsent(source: string, target: string): Promise<void> {
    try {
      await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
