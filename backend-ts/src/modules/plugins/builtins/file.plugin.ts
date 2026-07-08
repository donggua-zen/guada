import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
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
      description:
        "读取指定路径的文本文件内容，支持按行或按字符分页。读取到硬上限（20KB）时自动截断，返回 next 参数供继续读取。",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe("要读取的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        encoding: z
          .string()
          .optional()
          .describe("文件编码，如 utf-8、gbk，默认自动检测"),
        unit: z
          .enum(["line", "char"])
          .optional()
          .describe(
            "偏移单位：line=按行读取（默认），char=按字符读取。当 truncated=true 时使用返回的 next.unit 继续",
          ),
        offset: z
          .number()
          .int()
          .optional()
          .describe(
            "起始位置（行号或字符偏移），负数表示从末尾倒数（如 -10 最后 10 行），默认 0",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "读取数量：unit=line 时最多读取行数（默认 200），unit=char 时最多读取字符数（默认 20000）",
          ),
      }),
      execute: async (args, ctx) => {
        const { file_path, encoding, unit = "line", offset = 0, limit } = args;
        if (!file_path) throw new Error("文件路径不能为空");

        const resolvedPath = this.resolvePath(file_path, ctx);
        this.logger.log(
          `读取文件: ${file_path}, unit=${unit}, offset=${offset}, limit=${limit}`,
        );

        const raw = await fs.readFile(resolvedPath, {
          encoding: (encoding || "utf-8") as BufferEncoding,
        });

        const totalChars = raw.length;
        const lines = raw.split("\n");
        const totalLines = lines.length;
        const MAX_BYTES = 20 * 1024;
        let content = "";

        if (unit === "char") {
          // 按字符读取
          const charLimit = limit ?? 20000;
          content = raw.substring(offset, offset + charLimit);
          const charsRead = content.length;
          const truncated = offset + charLimit < totalChars;
          const result: any = {
            content,
            truncated,
            total_lines: totalLines,
            total_chars: totalChars,
          };
          if (truncated) {
            result.next = {
              unit: "char",
              offset: offset + charLimit,
              limit: charLimit,
            };
          }
          return result;
        }

        // 按行读取
        const lineLimit = limit ?? 200;
        const effectiveOffset =
          offset < 0 ? Math.max(0, totalLines + offset) : offset;
        const startLine = Math.min(effectiveOffset, totalLines);

        // 计算起始行的原始字符位置
        let nextCharOffset = 0;
        for (let i = 0; i < startLine; i++) {
          nextCharOffset += lines[i].length + 1; // +1 换行符
        }

        let endLine = startLine;
        let charsRead = 0;
        let truncatedByBytes = false;

        for (let i = startLine; i < totalLines; i++) {
          if (i - startLine >= lineLimit) {
            endLine = i;
            break;
          }
          const line = lines[i];
          const ln = line + (i < totalLines - 1 ? "\n" : "");
          if (charsRead + ln.length > MAX_BYTES) {
            const avail = MAX_BYTES - charsRead;
            content += ln.substring(0, avail);
            charsRead += avail;
            endLine = i;
            truncatedByBytes = true;
            break;
          }
          content += ln;
          charsRead += ln.length;
          endLine = i + 1;
        }
        nextCharOffset += charsRead;

        const hasMoreLines = endLine < totalLines;
        const truncated = hasMoreLines || truncatedByBytes;
        const result: any = {
          content,
          truncated,
          total_lines: totalLines,
          total_chars: totalChars,
        };
        if (truncated) {
          if (truncatedByBytes) {
            result.next = {
              unit: "char",
              offset: nextCharOffset,
              limit: 20000,
            };
          } else {
            result.next = { unit: "line", offset: endLine, limit: lineLimit };
          }
        }
        return result;
      },
      display: { action: "读取文件", argsKey: "file_path", icon: "read" },
    });

    api.registerTool({
      name: "glob",
      description:
        "使用 glob 模式搜索文件（如 **/*.ts、*.json、src/**/*.css）。返回扁平文件列表，支持深度控制和结果数限制。",
      inputSchema: z.object({
        pattern: z.string().describe("glob 模式，如 **/*.ts、*.json、src/**/*"),
        directory: z.string().optional().describe("基准目录，默认当前工作目录"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("最多返回的文件数，默认 100"),
        depth: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("递归深度，0=当前目录，不传=不限"),
      }),
      execute: async (args, ctx) => {
        const { pattern, directory, limit = 100, depth } = args;
        if (!pattern) throw new Error("pattern 不能为空");

        const basePath = directory
          ? this.resolvePath(directory, ctx)
          : ctx?.session.workspacePath || process.cwd();

        // fast-glob deep 语义：1=当前目录, 2=一级, ... N=N-1级
        const deep = depth !== undefined ? depth + 1 : undefined;

        const files = await fg(pattern, {
          cwd: basePath,
          deep,
          onlyFiles: true,
          dot: false,
          absolute: false,
        });

        const result = limit ? files.slice(0, limit) : files;
        const total = files.length;
        const truncated = total > result.length;

        return {
          pattern,
          directory: basePath,
          total,
          truncated,
          files: result,
        };
      },
      display: { action: "搜索文件", argsKey: "pattern", icon: "search" },
    });

    api.registerTool({
      name: "write",
      description: "将内容全量写入指定文件，自动创建目录。",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe("要写入的文件路径，可以是绝对路径或相对工作目录的相对路径"),
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
        await fs.writeFile(resolvedPath, content, {
          encoding: encoding as BufferEncoding,
        });
        return {
          success: true,
          message: `文件已写入：${resolvedPath}，共 ${content.length} 字符`,
          file_path: resolvedPath,
        };
      },
      display: { action: "写入文件", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "edit",
      description:
        "在文件中查找并替换指定文本。old_text 必须精确匹配原文中的一段连续文本。局部编辑优先使用此工具",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe("要编辑的文件路径，可以是绝对路径或相对工作目录的相对路径"),
        old_text: z
          .string()
          .describe("要被替换的旧文本，必须精确匹配原文中的一段连续文本"),
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
        const content = await fs.readFile(resolvedPath, {
          encoding: encoding as BufferEncoding,
        });
        if (old_text === new_text) {
          return {
            success: true,
            message: `文件 ${resolvedPath} 无变更（old === new）`,
            file_path: resolvedPath,
            replace_count: 1,
          };
        }

        // 统一换行后匹配（解决 CRLF/LF 不匹配问题）
        const normContent = content.replace(/\r\n/g, "\n");
        const normOld = old_text.replace(/\r\n/g, "\n");
        const idx = normContent.indexOf(normOld);
        if (idx === -1) {
          throw new Error(`未找到匹配文本: ${old_text}`);
        }

        // 替换后统一恢复原文件的行尾风格
        const hasCRLF = content.includes("\r\n");
        const normResult = normContent.replace(normOld, new_text);
        const modified = hasCRLF
          ? normResult.replace(/\n/g, "\r\n")
          : normResult;

        await fs.writeFile(resolvedPath, modified, {
          encoding: encoding as BufferEncoding,
        });
        return {
          success: true,
          message: `文件 ${resolvedPath} 已修改`,
          file_path: resolvedPath,
          replace_count: 1,
        };
      },
      display: { action: "替换文本", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "delete",
      description:
        "删除文件或目录（递归删除所有内容）。此操作不可恢复，请谨慎使用！",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "要删除的文件或目录路径，可以是绝对路径或相对工作目录的相对路径",
          ),
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
          return {
            success: true,
            message: `文件已删除：${resolvedPath}`,
            path: resolvedPath,
          };
        } else if (stats.isDirectory()) {
          await fs.rm(resolvedPath, { recursive: true, force: true });
          return {
            success: true,
            message: `目录已删除：${resolvedPath}`,
            path: resolvedPath,
          };
        }
        throw new Error(`${resolvedPath} 不是有效的文件或目录`);
      },
      display: { action: "删除文件", argsKey: "path", icon: "edit" },
      dangerLevel: "critical",
    });

    api.registerTool({
      name: "grep",
      description:
        "搜索文件内容。支持单文件或递归搜索目录（自动跳过 node_modules/.git）。pattern 全小写时不区分大小写，含大写字母时区分。",
      inputSchema: z.object({
        pattern: z.string().describe("正则表达式"),
        path: z
          .string()
          .optional()
          .describe("目标文件或目录路径，默认工作目录。传入目录时自动递归搜索"),
        context: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("匹配行上下文行数，默认 3"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("最多返回的匹配行数，默认 50"),
      }),
      execute: async (args, ctx) => {
        const {
          pattern,
          path: targetPath,
          context = 3,
          max_results = 50,
        } = args;
        if (!pattern) throw new Error("pattern 不能为空");

        const basePath = targetPath
          ? this.resolvePath(targetPath, ctx)
          : ctx?.session.workspacePath || process.cwd();
        const stat = await fs.stat(basePath);

        // 相对路径的基准目录（搜索结果返回相对路径，节省 tokens）
        const relativeRoot = stat.isFile() ? path.dirname(basePath) : basePath;

        const files: string[] = [];
        if (stat.isFile()) {
          files.push(basePath);
        } else if (stat.isDirectory()) {
          const entries = await fg("**/*", {
            cwd: basePath,
            onlyFiles: true,
            dot: false,
          });
          files.push(...entries.map((e) => path.join(basePath, e)));
        }

        // smart-case：全小写自动不区分，含大写区分
        const flags = pattern === pattern.toLowerCase() ? "gi" : "g";
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, flags);
        } catch {
          throw new Error(`无效正则: ${pattern}`);
        }

        const fileResults: any[] = [];
        let total = 0;

        for (const fp of files) {
          try {
            const content = await fs.readFile(fp, "utf-8");
            const lines = content.replace(/\r\n/g, "\n").split("\n");
            const matchRows: any[] = [];

            for (
              let i = 0;
              i < lines.length && matchRows.length < max_results;
              i++
            ) {
              regex.lastIndex = 0;
              const m = regex.exec(lines[i]);
              if (m) {
                const matchIdx = m.index;
                const matchLen = m[0].length;
                const ctxLen = 50;
                const cStart = Math.max(0, matchIdx - ctxLen);
                const cEnd = Math.min(
                  lines[i].length,
                  matchIdx + matchLen + ctxLen,
                );
                matchRows.push({
                  line: i + 1,
                  content: lines[i].substring(cStart, cEnd),
                });
              }
            }
            if (matchRows.length > 0) {
              fileResults.push({
                file: path.relative(relativeRoot, fp),
                matched_lines: matchRows.length,
                matches: matchRows,
              });
              total += matchRows.length;
            }
          } catch {
            continue;
          }
        }

        return {
          total_matches: total,
          matched_files: fileResults.length,
          files: fileResults,
        };
      },
      display: { action: "搜索", argsKey: "pattern", icon: "search" },
    });

    api.registerPrompt({
      frequency: "STATIC",
      description: "当前会话工作目录和安全路径说明",
      content: (ctx: PluginContext) => {
        if (!ctx.session.workspacePath) return "";
        return [
          "# 当前会话工作目录",
          `\`${ctx.session.workspacePath}\``,
          "",
          "**重要说明**：",
          "1. 你编写的所有脚本、临时文件、生成的数据等都应该存放在上述工作目录中。",
          "2. **默认路径规则**：所有文件操作工具在处理相对路径时，都会自动以该工作目录为基准。",
          "   除非用户明确指定了其他绝对路径，否则请始终使用相对路径。",
          "3. .guada 为特殊目录，只允许存放提示词中指定文件，项目文件、脚本等禁止放在.guada目录下",
        ].join("\n");
      },
    });
  }

  private resolvePath(filePath: string, context?: PluginContext): string {
    return this.workspaceService.resolveFilePath(
      filePath,
      context?.session.workspacePath,
    );
  }

  private validateWritePath(filePath: string, context?: PluginContext): void {
    const resolved = this.resolvePath(filePath, context);
    const extra = context?.session.workspacePath
      ? [context.session.workspacePath]
      : [];
    this.workspaceService.validateWritePath(resolved, extra);

    // memory_only 作用域：只允许操作 memory/ 和 memos/ 目录
    if (context?.session?.getRunMode?.() === "memory") {
      const allowedPrefixes =
        context.session.sessionType === "sub_agent"
          ? [
              `.guada/subagents/${context.session.sessionId}/memory/`,
              `.guada/subagents/${context.session.sessionId}/memos/`,
            ]
          : [`.guada/memory/`, `.guada/memos/`];

      const normalizedPath = resolved.replace(/\\/g, "/");
      const isAllowed = allowedPrefixes.some((prefix) =>
        normalizedPath.includes(prefix),
      );
      if (!isAllowed) {
        throw new Error(`memory_only 模式下只允许操作 memory/ 和 memos/ 目录`);
      }
    }
  }
}
