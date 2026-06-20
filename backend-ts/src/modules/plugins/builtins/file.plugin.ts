import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { PluginApi } from "../api/plugin-api";
import { z } from "zod";

@Injectable()
export class FilePlugin extends PluginBase {
  private readonly logger = new Logger(FilePlugin.name);

  manifest = {
    id: "file",
    name: "文件工具",
    description: "读写、编辑、搜索、删除文件和目录",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private workspaceService: WorkspaceService) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerTool({
      name: "read",
      description: "读取指定路径的文本文件内容，支持按行和字符分页。",
      inputSchema: z.object({
        file_path: z.string().describe("要读取的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        encoding: z.string().optional().describe("文件编码，如 utf-8、gbk，默认自动检测"),
        offset: z.number().int().min(0).optional().describe("起始读取行号，从 0 开始"),
        skip_chars: z.number().int().min(0).optional().describe("跳过开头的字符数"),
        limit: z.number().int().min(-1).optional().describe("最多读取行数，-1 表示不限制"),
        max_chars: z.number().int().min(1).optional().describe("最多读取字符数"),
      }),
      execute: async (args, ctx) => {
        const { file_path, encoding, offset, skip_chars, limit, max_chars } = args;
        if (!file_path) throw new Error("文件路径不能为空");

        const resolvedPath = this.resolvePath(file_path, ctx);
        this.logger.log(`读取文件: ${file_path}`);
        const stats = await fs.stat(resolvedPath);
        if (!stats.isFile()) throw new Error(`${resolvedPath} 不是一个文件`);

        const maxSize = 10 * 1024 * 1024;
        if (stats.size > maxSize)
          throw new Error(`文件过大（${(stats.size / 1024 / 1024).toFixed(2)}MB），超过限制`);

        const raw = await fs.readFile(resolvedPath, { encoding: (encoding || "utf-8") as BufferEncoding });

        const lines = raw.split("\n");
        const totalLines = lines.length;
        const MAX_LINES = 500;
        const MAX_BYTES = 20 * 1024;
        const actualLimit = Math.min(limit === -1 ? MAX_LINES : limit ?? MAX_LINES, MAX_LINES);
        const startLine = Math.max(0, Math.min(offset ?? 0, totalLines));
        let selected = "",
          chars = 0,
          endLine = startLine,
          skip = skip_chars ?? 0;

        for (let i = startLine; i < totalLines; i++) {
          if (i - startLine >= actualLimit) { endLine = i; break; }
          let line = lines[i];
          if (i === startLine && skip > 0) line = line.substring(skip);
          const ln = line + (i < totalLines - 1 ? "\n" : "");
          if (chars + ln.length > MAX_BYTES) {
            const avail = MAX_BYTES - chars;
            if (avail > 0) selected += ln.substring(0, avail);
            chars += avail;
            endLine = i;
            break;
          }
          selected += ln;
          chars += ln.length;
          endLine = i;
        }

        const hasMore = endLine < totalLines - 1 || chars >= MAX_BYTES;
        return JSON.stringify({
          content: selected,
          file_path: resolvedPath,
          chars_read: selected.length,
          total_chars: raw.length,
          start_line: startLine,
          end_line: endLine,
          total_lines: totalLines,
          lines_read: endLine - startLine,
          next_offset: hasMore ? endLine : undefined,
          next_skip_chars:
            hasMore && chars >= MAX_BYTES
              ? lines[endLine]?.length - (selected.split("\n").pop()?.length || 0)
              : 0,
        });
      },
      display: { action: "读取文件", argsKey: "file_path", icon: "read" },
    });

    api.registerTool({
      name: "list",
      description: "列出指定目录下的文件和子目录，支持递归深度控制。",
      inputSchema: z.object({
        path: z.string().describe("要列出的目录路径，可以是绝对路径或相对工作目录的相对路径"),
        depth: z.number().int().min(0).max(3).optional().describe("递归深度，0=仅当前目录，默认 1，最大 3"),
      }),
      execute: async (args, ctx) => {
        const { path: dirPath, depth = 1 } = args;
        if (!dirPath) throw new Error("目录路径不能为空");
        const resolvedPath = this.resolvePath(dirPath, ctx);
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) throw new Error(`${resolvedPath} 不是一个目录`);

        const readDir = async (p: string, d: number): Promise<any[]> => {
          const items: any[] = [];
          const entries = await fs.readdir(p, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(p, entry.name);
            const relativePath = path.relative(ctx?.workspacePath || "", fullPath).replace(/\\/g, "/");
            if (entry.isDirectory()) {
              const children = d > 1 ? await readDir(fullPath, d - 1) : [];
              items.push({ name: entry.name, type: "directory", path: relativePath, children });
            } else {
              items.push({ name: entry.name, type: "file", path: relativePath });
            }
          }
          return items;
        };

        const items = await readDir(resolvedPath, Math.min(depth, 3));
        return JSON.stringify({ path: resolvedPath, items, total: items.length });
      },
      display: { action: "列出目录", argsKey: "path", icon: "search" },
    });

    api.registerTool({
      name: "write",
      description: "将内容全量写入指定文件，自动创建目录。",
      inputSchema: z.object({
        file_path: z.string().describe("要写入的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        content: z.string().describe("要写入的文件内容"),
        encoding: z.string().optional().describe("文件编码，默认 utf-8"),
      }),
      execute: async (args, ctx) => {
        const { file_path, content, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("文件路径不能为空");
        const resolvedPath = this.resolvePath(file_path, ctx);
        this.validateWritePath(file_path, ctx);
        this.logger.log(`写入文件: ${file_path}`);
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, content, { encoding: encoding as BufferEncoding });
        return `文件已写入：${resolvedPath}，共 ${content.length} 字符`;
      },
      display: { action: "写入文件", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "edit",
      description: "在文件中查找并替换指定文本。old_text 必须精确匹配原文中的一段连续文本。",
      inputSchema: z.object({
        file_path: z.string().describe("要编辑的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        old_text: z.string().describe("要被替换的旧文本，必须精确匹配原文中的一段连续文本"),
        new_text: z.string().describe("替换后的新文本"),
        encoding: z.string().optional().describe("文件编码，默认 utf-8"),
      }),
      execute: async (args, ctx) => {
        const { file_path, old_text, new_text, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("文件路径不能为空");
        if (!old_text) throw new Error("old_text 不能为空");
        if (new_text === undefined) throw new Error("new_text 不能为空");
        const resolvedPath = this.resolvePath(file_path, ctx);
        this.validateWritePath(file_path, ctx);
        this.logger.log(`编辑文件: ${file_path}`);
        const content = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });
        let modified: string;
        let actualCount = 0;
        if (old_text === new_text) {
          modified = content;
        } else {
          const parts = content.split(old_text);
          actualCount = parts.length - 1;
          if (actualCount === 0) throw new Error(`未找到匹配文本: ${old_text}`);
          modified = parts.join(new_text);
        }
        await fs.writeFile(resolvedPath, modified, { encoding: encoding as BufferEncoding });
        return `文件 ${resolvedPath} 已修改，共替换 ${actualCount} 处`;
      },
      display: { action: "替换文本", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "delete",
      description: "删除文件或目录（递归删除所有内容）。此操作不可恢复，请谨慎使用！",
      inputSchema: z.object({
        path: z.string().describe("要删除的文件或目录路径，可以是绝对路径或相对工作目录的相对路径"),
      }),
      execute: async (args, ctx) => {
        const { path: targetPath } = args;
        if (!targetPath) throw new Error("路径不能为空");
        const resolvedPath = this.resolvePath(targetPath, ctx);
        this.validateWritePath(targetPath, ctx);
        this.logger.log(`删除文件/目录: ${targetPath} -> ${resolvedPath}`);
        const stats = await fs.stat(resolvedPath);
        if (stats.isFile()) {
          await fs.unlink(resolvedPath);
          return `文件已删除：${resolvedPath}`;
        } else if (stats.isDirectory()) {
          await fs.rm(resolvedPath, { recursive: true, force: true });
          return `目录已删除：${resolvedPath}`;
        }
        throw new Error(`${resolvedPath} 不是有效的文件或目录`);
      },
      display: { action: "删除文件", argsKey: "path", icon: "edit" },
      dangerLevel: "critical",
    });

    api.registerTool({
      name: "grep",
      description: "使用正则表达式搜索文件内容，返回匹配的行及其行号。适合查找特定模式或关键词。",
      inputSchema: z.object({
        regex: z.string().describe("要搜索的正则表达式模式"),
        path: z.string().describe("要搜索的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        case_sensitive: z.boolean().optional().describe("是否区分大小写，默认不区分"),
        max_matches: z.number().int().min(1).optional().describe("最多返回的匹配行数，默认 100"),
      }),
      execute: async (args, ctx) => {
        const { regex: pattern, path: targetPath, case_sensitive = false, max_matches = 100 } = args;
        if (!pattern) throw new Error("正则表达式不能为空");
        if (!targetPath) throw new Error("文件路径不能为空");
        const resolvedPath = this.resolvePath(targetPath, ctx);
        const content = await fs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");
        const flags = case_sensitive ? "g" : "gi";
        let regex: RegExp;
        try { regex = new RegExp(pattern, flags); }
        catch { throw new Error(`无效正则: ${pattern}`); }
        const matches: Array<{ line: number; content: string; matchCount: number }> = [];
        let total = 0;
        for (let i = 0; i < lines.length && matches.length < max_matches; i++) {
          const lm = lines[i].match(regex);
          if (lm) {
            total += lm.length;
            matches.push({ line: i, content: lines[i].substring(0, 200), matchCount: lm.length });
          }
        }
        return JSON.stringify({ file_path: resolvedPath, pattern, total_matches: total, matched_lines: matches.length, matches });
      },
      display: { action: "搜索文件内容", argsKey: "regex", icon: "search" },
    });

    api.registerPrompt({
      frequency: "STATIC",
      description: "当前会话工作目录和安全路径说明",
      content: (ctx: PluginContext) => {
        if (!ctx.workspacePath) return "";
        return [
          "# 当前会话工作目录",
          `\`${ctx.workspacePath}\``,
          "",
          "**重要说明**：",
          "1. 你编写的所有脚本、临时文件、生成的数据等都应该存放在上述工作目录中。",
          "2. **默认路径规则**：所有文件操作工具在处理相对路径时，都会自动以该工作目录为基准。",
          "   除非用户明确指定了其他绝对路径，否则请始终使用相对路径。",
          "3. .guada 为特殊目录，只允许存放提示词中指定文件，项目文件、脚本等禁止放在.guada目录下",
        ].join("\n");
      },
    });

    api.registerPrompt({
      frequency: "STATIC",
      description: "文件操作工具使用说明",
      content: [
        "# 文件操作工具使用说明",
        "",
        "**重要提醒**：",
        "1. 文件读写类操作优先使用文件工具集而不是命令行",
        "2. 对于超大文件，请使用分页读取功能，避免一次性加载过多内容",
        "",
        "本插件提供以下操作：",
        "- read：读取文件内容（支持分页）",
        "- list：列出目录内容（支持递归）",
        "- write：写入文件（自动创建目录）",
        "- edit：查找替换文本",
        "- delete：删除文件/目录",
        "- grep：正则搜索文件内容",
      ].join("\n"),
    });
  }

  private resolvePath(filePath: string, context?: PluginContext): string {
    return this.workspaceService.resolveFilePath(filePath, context?.workspacePath);
  }

  private validateWritePath(filePath: string, context?: PluginContext): void {
    const resolved = this.resolvePath(filePath, context);
    const extra = context?.workspacePath ? [context.workspacePath] : [];
    this.workspaceService.validateWritePath(resolved, extra);
  }
}
