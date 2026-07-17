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
        "Read the content of a text file at the specified path, supports pagination by line or by character. Automatically truncates at a hard limit (20KB) and appends continuation parameters when truncated. NOTE: line numbers are prepended by the tool (e.g. '     1\\t') and are NOT part of the original file content.",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe(
            "Path to the file to read, can be an absolute path or a relative path relative to the working directory",
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            "File encoding, e.g., utf-8, gbk; auto-detected by default",
          ),
        unit: z
          .enum(["line", "char"])
          .optional()
          .describe(
            "Offset unit: line=read by line (default), char=read by character. When truncated=true, use the returned next.unit to continue",
          ),
        offset: z
          .number()
          .int()
          .optional()
          .describe(
            "Starting position (line number or character offset); negative values count from the end (e.g., -10 = last 10 lines), default 0",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Number to read: when unit=line, max lines to read (default 200); when unit=char, max characters to read (default 20000)",
          ),
      }),
      execute: async (args, ctx) => {
        const { file_path, encoding, unit = "line", offset = 0, limit } = args;
        if (!file_path) throw new Error("File path cannot be empty");

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

        if (unit === "char") {
          // 按字符读取
          const charLimit = limit ?? 20000;
          const content = raw.substring(offset, offset + charLimit);
          const truncated = offset + charLimit < totalChars;

          // 计算起始行号
          const startLineNumber = raw.substring(0, offset).split("\n").length;
          const contentLines = content.split("\n");
          const endLineNumber = startLineNumber + contentLines.length - 1;
          const padWidth = String(endLineNumber).length;
          const formattedLines = contentLines.map((line, i) => {
            const num = String(startLineNumber + i).padStart(padWidth, " ");
            return `${num}\t${line}`;
          });
          let result = formattedLines.join("\n");

          if (truncated) {
            result += `\n(Text truncated at 20KB. To continue: unit=char, offset=${offset + charLimit}, limit=${charLimit})`;
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
        let partialLine: string | null = null;

        for (let i = startLine; i < totalLines; i++) {
          if (i - startLine >= lineLimit) {
            endLine = i;
            break;
          }
          const line = lines[i];
          const ln = line + (i < totalLines - 1 ? "\n" : "");
          if (charsRead + ln.length > MAX_BYTES) {
            const avail = MAX_BYTES - charsRead;
            partialLine = line.substring(0, avail);
            endLine = i;
            truncatedByBytes = true;
            break;
          }
          charsRead += ln.length;
          endLine = i + 1;
        }
        nextCharOffset += charsRead;

        const hasMoreLines = endLine < totalLines;

        // 拼接行号
        const padWidth = String(Math.max(endLine, 1)).length;
        const formattedLines: string[] = [];
        for (let i = startLine; i < endLine; i++) {
          const num = String(i + 1).padStart(padWidth, " ");
          formattedLines.push(`${num}\t|${lines[i]}`);
        }
        if (partialLine !== null) {
          const num = String(endLine + 1).padStart(padWidth, " ");
          formattedLines.push(`${num}\t|${partialLine}`);
        }
        let result = formattedLines.join("\n");

        if (truncatedByBytes) {
          result += `\n(Text truncated at 20KB. To continue: unit=char, offset=${nextCharOffset}, limit=20000)`;
        } else if (hasMoreLines) {
          const remaining = totalLines - endLine;
          result += `\n(${remaining} more lines remain. To continue: unit=line, offset=${endLine}, limit=${lineLimit})`;
        }
        return result;
      },
      display: { action: "读取文件", argsKey: "file_path", icon: "read" },
      dangerLevel: "safe",
    });

    api.registerTool({
      name: "glob",
      description:
        "Search for files using a glob pattern (e.g., **/*.ts, *.json, src/**/*.css). Returns a flat file list. Supports depth control and result limits.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe("Glob pattern, e.g., **/*.ts, *.json, src/**/*"),
        directory: z
          .string()
          .optional()
          .describe(
            "Base directory, defaults to the current working directory",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of files to return, default 100"),
        depth: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Recursion depth: 0=current directory only, omit=unlimited",
          ),
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

        let output = `${total} files found:`;
        for (const f of result) {
          output += `\n                 ${f}`;
        }
        if (total > result.length) {
          output += `\n(Results truncated, ${total - result.length} more files omitted.)`;
        }
        


































































































































        return output;
      },
      display: { action: "搜索文件", argsKey: "pattern", icon: "search" },
      dangerLevel: "safe",
    });

    api.registerTool({
      name: "write",
      description:
        "Write content to the specified file in full, automatically creating directories.",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe(
            "Path to the file to write, can be an absolute path or a relative path relative to the working directory",
          ),
        content: z.string().describe("File content to write"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding, default utf-8"),
      }),
      execute: async (args, ctx) => {
        const { file_path, content, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("file_path is required");
        const resolvedPath = this.resolvePath(file_path, ctx);
        this.validateWritePath(file_path, ctx);
        this.logger.log(`写入文件: ${file_path}`);
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, content, {
          encoding: encoding as BufferEncoding,
        });
        return `File written: ${resolvedPath} (${content.length} chars)`;
      },
      display: { action: "写入文件", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "edit",
      description:
        "Find and replace specified text in a file. old_text must exactly match a contiguous segment in the original file. Prefer this tool for partial edits.",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe(
            "Path to the file to edit, can be an absolute path or a relative path relative to the working directory",
          ),
        old_text: z
          .string()
          .describe(
            "The old text to be replaced; must exactly match a contiguous segment in the original file",
          ),
        new_text: z.string().describe("The new text to replace with"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding, default utf-8"),
      }),
      execute: async (args, ctx) => {
        const { file_path, old_text, new_text, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("file_path is required");
        if (!old_text) throw new Error("old_text is required");
        if (new_text === undefined) throw new Error("new_text is required");
        const resolvedPath = this.resolvePath(file_path, ctx);
        this.validateWritePath(file_path, ctx);
        this.logger.log(`编辑文件: ${file_path}`);
        const content = await fs.readFile(resolvedPath, {
          encoding: encoding as BufferEncoding,
        });
        if (old_text === new_text) {
          return `File ${resolvedPath} unchanged`;
        }

        // 统一换行后匹配（解决 CRLF/LF 不匹配问题）
        const normContent = content.replace(/\r\n/g, "\n");
        const normOld = old_text.replace(/\r\n/g, "\n");
        const idx = normContent.indexOf(normOld);
        if (idx === -1) {
          throw new Error(`No match text found: ${old_text}`);
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
        return `File ${resolvedPath} modified (1 replacement)`;
      },
      display: { action: "替换文本", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
      name: "delete",
      description:
        "Delete a file or directory (recursively deletes all contents). This operation cannot be undone — use with caution!",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Path to the file or directory to delete, can be an absolute path or a relative path relative to the working directory",
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
          return `File deleted: ${resolvedPath}`;
        } else if (stats.isDirectory()) {
          await fs.rm(resolvedPath, { recursive: true, force: true });
          return `Directory deleted: ${resolvedPath}`;
        }
        throw new Error(`${resolvedPath} is not a valid file or directory`);
      },
      display: { action: "删除文件", argsKey: "path", icon: "edit" },
      dangerLevel: "critical",
    });

    api.registerTool({
      name: "grep",
      description:
        "Search file contents. Supports single-file or recursive directory search (automatically skips node_modules/.git). When pattern is all lowercase, the search is case-insensitive; when it contains uppercase letters, it is case-sensitive.",
      inputSchema: z.object({
        pattern: z.string().describe("Regex pattern"),
        path: z
          .string()
          .optional()
          .describe(
            "Target file or directory path, defaults to the working directory. If a directory is given, it will be searched recursively",
          ),
        context: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Number of context lines around each match, default 3"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of matching lines to return, default 50"),
      }),
      execute: async (args, ctx) => {
        const {
          pattern,
          path: targetPath,
          context = 3,
          max_results = 50,
        } = args;
        if (!pattern) throw new Error("pattern is required");

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
          throw new Error(`Invalid regex pattern: ${pattern}`);
        }

        const outputLines: string[] = [];
        let total = 0;

        for (const fp of files) {
          try {
            const content = await fs.readFile(fp, "utf-8");
            const lines = content.replace(/\r\n/g, "\n").split("\n");
            const relPath = path.relative(relativeRoot, fp);
            let fileMatchCount = 0;

            for (
              let i = 0;
              i < lines.length && fileMatchCount < max_results;
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
                const snippet = lines[i].substring(cStart, cEnd).trim();
                const funcName = this.findEnclosingFunction(lines, i);
                const funcSuffix = funcName ? `    ← in ${funcName}()` : "";
                outputLines.push(
                  `${relPath}:${i + 1}: ${snippet}${funcSuffix}`,
                );
                fileMatchCount++;
                total++;
              }
            }
          } catch {
            continue;
          }
        }

        if (outputLines.length === 0) {
          return "No matches found.";
        }
        




















































































































































































































































        return outputLines.join("\n");
      },
      display: { action: "搜索", argsKey: "pattern", icon: "search" },
      dangerLevel: "safe",
    });

    api.registerPrompt({
      frequency: "STATIC",
      description: "当前会话工作目录和安全路径说明",
      content: (ctx: PluginContext) => {
        if (!ctx.session.workspacePath) return "";
        return [
          "# Working Directory:",
          `${ctx.session.workspacePath}`,
          "",
          "**Important Notes**:",
          "1. All scripts, temporary files, generated data, etc. should be stored in the working directory above.",
          "2. **Default Path Rule**: All file operation tools automatically use the working directory as the base when handling relative paths.",
          "   Always use relative paths unless the user explicitly specifies an absolute path.",
          "3. .guada is a special directory — only store files specified in prompts here. Project files, scripts, etc. must not be placed under .guada.",
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
        throw new Error(
          `memory_only mode only allows memory/ and memos/ directories`,
        );
      }
    }
  }

  private findEnclosingFunction(
    lines: string[],
    lineIndex: number,
  ): string | null {
    const patterns: RegExp[] = [
      /\bfunction\s+(\w+)\s*\(/, // JS/TS: function foo()
      /\bclass\s+(\w+)\b/, // class Foo
      /\bdef\s+(\w+)\s*\(/, // Python: def foo()
      /\bfn\s+(\w+)\s*\(/, // Rust: fn foo()
      /\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/, // Go: func foo() or func (r *T) foo()
      /\b(?:impl|struct|enum|trait|interface)\s+(\w+)\b/, // Rust/TS: impl Foo, struct Foo
      /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/, // JS/TS arrow
    ];

    for (let i = lineIndex; i >= 0; i--) {
      const line = lines[i];
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (m) return m[1];
      }
    }
    return null;
  }
}
