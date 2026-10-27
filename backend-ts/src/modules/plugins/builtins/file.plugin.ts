import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { AskService } from "../../../common/services/ask.service";
import { PolicyRulesService } from "../../../common/services/policy-rules.service";
import { writeApprovalMemory } from "../../../common/services/write-approval-memory";
import { PluginApi } from "../api/plugin-api";
import { safeSubstring, safeTruncate } from "../../../common/utils/string.utils";
import {
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_SOFT_BYTES,
  MEMORY_INDEX_SOFT_LINES,
  countIndexLines,
  isIndexOverHardCap,
  isIndexOverSoftCap,
  resolveMemoryDir,
  resolveMemoryIndexPath,
} from "../../../common/utils/memory-path.util";
import {
  WorkspaceToolRouter,
  workspaceParamField,
  type RemoteToolTarget,
} from "../../remote-workspace/workspace-router";
import { z } from "zod";
import langZh from "./file.lang.zh.json";
import langEn from "./file.lang.en.json";

/** edit 匹配结果：成功 / 未找到 / 多处匹配 */
type EditTransformResult =
  | { kind: "ok"; content: string; replacements: number; firstLine: number }
  | { kind: "not_found" }
  | { kind: "multiple"; count: number };

/**
 * 去掉 read 输出每行的行号前缀（`  12\t`）。
 * 只用于精确匹配失败后的 fallback；没有行号前缀时原样返回。
 */
function stripReadLinePrefixes(text: string): string {
  let changed = false;
  const stripped = text.split("\n").map((line) => {
    const next = line.replace(/^[ \t]*\d+\t/, "");
    if (next !== line) changed = true;
    return next;
  });
  return changed ? stripped.join("\n") : text;
}

/** 统计非重叠出现次数（与 replace/replaceAll 的语义一致） */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

@Injectable()
export class FilePlugin extends PluginBase {
  private readonly logger = new Logger(FilePlugin.name);

  private static readonly IGNORE_PATTERNS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/.nuxt/**",
    "**/.output/**",
    "**/coverage/**",
  ];

  // 已知文本扩展名：直接统计行数，无需 NUL 探测
  private static readonly TEXT_EXTENSIONS = new Set([
    "txt", "md", "markdown", "mdx", "json", "jsonc", "json5",
    "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
    "vue", "svelte", "astro", "html", "htm", "xml", "svg",
    "css", "scss", "sass", "less", "styl",
    "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties",
    "sh", "bash", "zsh", "bat", "cmd", "ps1", "fish",
    "sql", "graphql", "gql", "proto", "prisma",
    "java", "kt", "kts", "go", "rs", "c", "h", "cpp", "hpp", "cc", "hh", "cs",
    "php", "rb", "pl", "pm", "lua", "r", "swift", "scala", "clj", "cljs",
    "ex", "exs", "erl", "hs", "dart", "zig", "vim", "jl", "nix", "tf", "tfvars",
    "log", "csv", "tsv", "diff", "patch", "lock", "gradle", "dockerfile",
  ]);

  // 已知二进制扩展名：只显示大小，跳过行数统计（含 docx/pdf/zip/图片/音视频等）
  private static readonly BINARY_EXTENSIONS = new Set([
    "docx", "doc", "xlsx", "xls", "pptx", "ppt",
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif",
    "heic", "avif", "psd", "ai", "eps",
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img",
    "exe", "dll", "so", "dylib", "bin", "dat", "class", "jar", "war",
    "pyc", "pyd", "o", "obj", "a", "lib", "wasm",
    "mp3", "mp4", "wav", "flac", "ogg", "aac", "m4a", "avi", "mkv", "mov",
    "wmv", "flv", "webm",
    "ttf", "otf", "woff", "woff2", "eot",
    "sqlite", "db",
  ]);

  // 行数统计的文件大小上限（超过只显示大小）
  private static readonly MAX_LINE_COUNT_SIZE = 512 * 1024;

  // Per-file write lock: serializes concurrent edit/write to the same file
  private readonly fileLocks = new Map<string, Promise<void>>();

  manifest = {
    id: "file",
    name: "%file.name%",
    description: "%file.description%",
    version: "1.1.0",
    category: "core" as const,
  };

  constructor(
    private workspaceService: WorkspaceService,
    private askService: AskService,
    private readonly workspaceRouter: WorkspaceToolRouter,
    private readonly policyRules: PolicyRulesService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── file 能力包：全部文件工具与工作目录说明统一挂载，智能体层按包启停 ──
    const fileKit = api.registerToolKit({
      id: "file",
      name: "%file.name%",
      description: "%file.toolkitDescription%",
      activator: "Read, write, edit, list and search files in the workspace.",
    });
    fileKit.registerTool({
      name: "read",
      description:
        "Read the content of a text file at the specified path, supports pagination by line or by character. Automatically truncates at a hard limit (20KB) and appends a plain-text continuation hint when truncated. NOTE: each output line is prefixed with a line number and a tab (N<TAB>); that prefix is NOT part of the original file content. When copying text into `edit.old_text`, strip the prefix.",
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
            "File encoding, e.g., utf-8, gbk; defaults to utf-8",
          ),
        unit: z
          .enum(["line", "char"])
          .optional()
          .describe(
            "Offset unit: line=read by line (default), char=read by character",
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
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx) => {
        const { file_path, encoding, unit = "line", offset = 0, limit } = args;
        if (!file_path) throw new Error("File path cannot be empty");

        const target = await this.resolveTarget(ctx, args.workspace);
        let raw: string;
        if (target) {
          this.logger.log(
            `读取远程文件: ${target.connectionName}:${file_path}, unit=${unit}, offset=${offset}, limit=${limit}`,
          );
          const absPath = target.provider.resolvePath(file_path);
          raw = String(
            await target.provider.readFile(absPath, { encoding }),
          );
        } else {
          const resolvedPath = this.resolvePath(file_path, ctx);
          await this.ensureSensitiveRead(resolvedPath, ctx, ctx?.toolCallId);
          this.logger.log(
            `读取文件: ${file_path}, unit=${unit}, offset=${offset}, limit=${limit}`,
          );
          raw = await fs.readFile(resolvedPath, {
            encoding: (encoding || "utf-8") as BufferEncoding,
          });
        }

        return this.formatReadResult(raw, unit, offset, limit);
      },
      display: {
        actionType: "read",
        text: { executing: "%read.executing%", completed: "%read.completed%" },
        aggregate: { executing: "%read.aggregate.executing%", completed: "%read.aggregate.completed%" },
        argsKey: "file_path",
        icon: "read",
      },
      dangerLevel: "safe",
      readOnly: true,
    });

    fileKit.registerTool({
      name: "glob",
      description:
        "Search for files using a glob pattern (e.g., **/*.ts, *.json, src/**/*.css). Returns a flat file list. Supports depth control and result limits. Automatically skips node_modules/.git/dist/build directories. Each result includes the file size (B/KB/MB); text files <=512KB also include the line count, helping you gauge file scale before reading.",
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
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx) => {
        const { pattern, directory, limit = 100, depth } = args;
        if (!pattern) throw new Error("pattern 不能为空");
        this.assertJailGlobPattern(pattern, ctx);

        const target = await this.resolveTarget(ctx, args.workspace);
        if (target) {
          // 远端分支：line 数统计不可用（仅返回大小）；limit+1 探测 hasMore
          const baseDir = directory
            ? target.provider.resolvePath(directory)
            : target.basePath;
          const entries = await target.provider.glob(pattern, {
            cwd: baseDir,
            ignore: FilePlugin.IGNORE_PATTERNS,
            limit: limit + 1,
            deep: depth !== undefined ? depth + 1 : undefined,
          });
          const hasMore = entries.length > limit;
          const files = entries.slice(0, limit);
          let output = `${files.length} files found:`;
          for (const f of files) {
            output += `\n${f.path} (${this.formatSize(f.size)})`;
          }
          if (hasMore) {
            output += `\n(More results exist. Use a more specific pattern or increase limit to see more.)`;
          }
          return output;
        }

        // 牢笼模式下省略 directory 时以牢笼根为基准（否则会默认到整个工作区）
        const basePath = directory
          ? this.resolvePath(directory, ctx)
          : this.getPathJail(ctx) || ctx?.session.workspacePath || process.cwd();

        // fast-glob deep 语义：1=当前目录, 2=一级, ... N=N-1级
        const deep = depth !== undefined ? depth + 1 : undefined;

        const stream = fg.stream(pattern, {
          cwd: basePath,
          deep,
          onlyFiles: true,
          dot: false,
          absolute: false,
          stats: true,
          ignore: FilePlugin.IGNORE_PATTERNS,
        });

        const files: { path: string; size: number; lines: number | null }[] =
          [];
        let hasMore = false;

        for await (const entry of stream) {
          if (files.length >= limit) {
            hasMore = true;
            break;
          }
          let relPath: string;
          let size = 0;
          if (typeof entry === "string") {
            relPath = entry;
          } else {
            const e = entry as unknown as {
              path: string;
              stats?: { size: number };
            };
            relPath = e.path;
            size = e.stats?.size ?? 0;
          }
          files.push({ path: relPath, size, lines: null });
        }

        // 分批并行统计行数（复用 grep 的批次大小），单文件失败降级为仅大小
        const BATCH_SIZE = 20;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((f) =>
              this.countLinesIfTextable(path.join(basePath, f.path), f.size),
            ),
          );
          results.forEach((r, idx) => {
            if (r.status === "fulfilled") batch[idx].lines = r.value;
          });
        }

        let output = `${files.length} files found:`;
        for (const f of files) {
          output += `\n${f.path} (${this.formatSize(f.size)}`;
          if (f.lines !== null) output += `, ${f.lines} lines`;
          output += ")";
        }
        if (hasMore) {
          output += `\n(More results exist. Use a more specific pattern or increase limit to see more.)`;
        }

        return output;
      },
      display: {
        actionType: "search",
        text: { executing: "%glob.executing%", completed: "%glob.completed%" },
        aggregate: { executing: "%glob.aggregate.executing%", completed: "%glob.aggregate.completed%" },
        argsKey: "pattern",
        icon: "search",
      },
      dangerLevel: "safe",
      readOnly: true,
    });

    fileKit.registerTool({
      name: "write",
      description:
        "Write content to the specified file in full, automatically creating directories. Overwrites existing content. Use edit for partial changes; use write only for new files or full rewrites.",
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
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx, abortSignal) => {
        const { file_path, content, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("file_path is required");

        const target = await this.resolveTarget(ctx, args.workspace);
        if (target) {
          // 远端写：路径级权限由连接 perm 控制，不受本地安全档位/审批管辖
          this.assertWritableSession(ctx);
          const absPath = target.provider.resolvePath(file_path);
          this.logger.log(`写入远程文件: ${target.connectionName}:${absPath}`);
          await target.provider.writeFile(absPath, content, { encoding });
          return `File written: ${absPath} (${content.length} chars)`;
        }

        const resolvedPath = this.resolvePath(file_path, ctx);
        const verdict = this.evaluateWritePath(resolvedPath, ctx);
        if (verdict.kind === "deny") throw new Error(verdict.message);
        if (verdict.kind === "ask") {
          await this.ensureWriteApproval({
            resolvedPath,
            operation: "write",
            preview: safeTruncate(content, 240),
            context: ctx,
            toolCallId: ctx?.toolCallId,
            abortSignal,
          });
        }
        this.logger.log(`写入文件: ${file_path}`);
        return this.withFileLock(resolvedPath, async () => {
          // 记忆索引上限守卫：读当前内容做"是否变长"的比较，任何落盘之前判定。
          // 只对会话自己的索引路径生效（见 evaluateMemoryIndexCap）；远程分支不适用
          // ——记忆目录恒在主本地工作区，远端 provider 目标不可能是它。
          const indexCap = await this.evaluateMemoryIndexCap(
            resolvedPath,
            content,
            ctx,
          );
          if (indexCap.kind === "deny") throw new Error(indexCap.message);

          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, content, {
            encoding: encoding as BufferEncoding,
          });
          return (
            `File written: ${resolvedPath} (${content.length} chars)` +
            (indexCap.notice ? `\n${indexCap.notice}` : "")
          );
        });
      },
      display: {
        actionType: "write",
        text: { executing: "%write.executing%", completed: "%write.completed%" },
        aggregate: { executing: "%write.aggregate.executing%", completed: "%write.aggregate.completed%" },
        argsKey: "file_path",
        icon: "edit",
        renderer: { kind: "content", fields: { file: "file_path", content: "content" } },
      },
      dangerLevel: "high",
    });

    fileKit.registerTool({
      name: "edit",
      description: [
        "Find and replace an exact text segment in a file.",
        "",
        "- `old_text` must exactly match a contiguous segment. Copy it from `read` output WITHOUT the line-number prefix (N<TAB>).",
        "- If `old_text` occurs multiple times the edit fails: include more surrounding context, or set `replace_all: true`.",
        "- Prefer this tool for partial edits. Do not use `run_command`, Python, `sed -i`, `node -e`, or heredocs to modify project files.",
        "- If no match is found, re-read the relevant range and retry with more context; do not fall back to a script.",
      ].join("\n"),
      inputSchema: z.object({
        file_path: z
          .string()
          .describe(
            "Path to the file to edit, can be an absolute path or a relative path relative to the working directory",
          ),
        old_text: z
          .string()
          .describe(
            "The exact text to replace; copy it from read output without the line-number prefix. Must match a contiguous segment in the original file",
          ),
        new_text: z.string().describe("The new text to replace with"),
        replace_all: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Replace every occurrence of old_text. When false, old_text must be unique",
          ),
        encoding: z
          .string()
          .optional()
          .describe("File encoding, default utf-8"),
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx, abortSignal) => {
        const {
          file_path,
          old_text,
          new_text,
          replace_all = false,
          encoding = "utf-8",
        } = args;
        if (!file_path) throw new Error("file_path is required");
        if (!old_text) throw new Error("old_text is required");
        if (new_text === undefined) throw new Error("new_text is required");

        const target = await this.resolveTarget(ctx, args.workspace);
        if (target) {
          // 远端编辑：read → 与本地一致的替换变换 → write（agent replaceInFile
          // 原语为全部替换且无行尾归一，不走）；权限控制同 write
          this.assertWritableSession(ctx);
          const absPath = target.provider.resolvePath(file_path);
          this.logger.log(`编辑远程文件: ${target.connectionName}:${absPath}`);
          if (old_text === new_text) {
            return `File ${absPath} unchanged`;
          }
          const content = String(
            await target.provider.readFile(absPath, { encoding }),
          );
          const { content: modified, message } = FilePlugin.applyEditTransform(
            content,
            old_text,
            new_text,
            replace_all,
          );
          await target.provider.writeFile(absPath, modified, { encoding });
          return `File ${absPath} ${message}`;
        }

        const resolvedPath = this.resolvePath(file_path, ctx);
        const verdict = this.evaluateWritePath(resolvedPath, ctx);
        if (verdict.kind === "deny") throw new Error(verdict.message);
        if (verdict.kind === "ask") {
          await this.ensureWriteApproval({
            resolvedPath,
            operation: "edit",
            preview: `- ${safeTruncate(old_text, 120)}\n+ ${safeTruncate(new_text, 120)}`,
            context: ctx,
            toolCallId: ctx?.toolCallId,
            abortSignal,
          });
        }
        this.logger.log(`编辑文件: ${file_path}`);
        return this.withFileLock(resolvedPath, async () => {
          const content = await fs.readFile(resolvedPath, {
            encoding: encoding as BufferEncoding,
          });
          if (old_text === new_text) {
            return `File ${resolvedPath} unchanged`;
          }

          const { content: modified, message } = FilePlugin.applyEditTransform(
            content,
            old_text,
            new_text,
            replace_all,
          );

          // 记忆索引上限守卫：改写后文本已在手，与当前内容比较是否变长（缩小/持平永远放行）
          const indexCap = await this.evaluateMemoryIndexCap(
            resolvedPath,
            modified,
            ctx,
            content,
          );
          if (indexCap.kind === "deny") throw new Error(indexCap.message);

          await fs.writeFile(resolvedPath, modified, {
            encoding: encoding as BufferEncoding,
          });
          return (
            `File ${resolvedPath} ${message}` +
            (indexCap.notice ? `\n${indexCap.notice}` : "")
          );
        });
      },
      display: {
        actionType: "edit",
        text: { executing: "%edit.executing%", completed: "%edit.completed%" },
        aggregate: { executing: "%edit.aggregate.executing%", completed: "%edit.aggregate.completed%" },
        argsKey: "file_path",
        icon: "edit",
        renderer: { kind: "diff", fields: { file: "file_path", oldValue: "old_text", newValue: "new_text" } },
      },
      dangerLevel: "high",
    });

    // api.registerTool({
    //   name: "delete",
    //   description:
    //     "Delete a file or directory (recursively deletes all contents). This operation cannot be undone — use with caution!",
    //   inputSchema: z.object({
    //     path: z
    //       .string()
    //       .describe(
    //         "Path to the file or directory to delete, can be an absolute path or a relative path relative to the working directory",
    //       ),
    //   }),
    //   execute: async (args, ctx) => {
    //     const { path: targetPath } = args;
    //     if (!targetPath) throw new Error("path is required");
    //     const resolvedPath = this.resolvePath(targetPath, ctx);
    //     this.validateWritePath(targetPath, ctx);
    //     this.logger.log(`删除文件/目录: ${targetPath} -> ${resolvedPath}`);
    //     const stats = await fs.stat(resolvedPath);
    //     if (stats.isFile()) {
    //       await fs.unlink(resolvedPath);
    //       return `File deleted: ${resolvedPath}`;
    //     } else if (stats.isDirectory()) {
    //       await fs.rm(resolvedPath, { recursive: true, force: true });
    //       return `Directory deleted: ${resolvedPath}`;
    //     }
    //     throw new Error(`${resolvedPath} is not a valid file or directory`);
    //   },
    //   display: { actionType: "delete", argsKey: "path", icon: "edit" },
    //   dangerLevel: "critical",
    // });

    fileKit.registerTool({
      name: "grep",
      description:
        "Search file contents. Supports single-file or recursive directory search (automatically skips node_modules/.git/dist/build). When pattern is all lowercase, the search is case-insensitive; when it contains uppercase letters, it is case-sensitive.",
      inputSchema: z.object({
        pattern: z.string().describe("Regex pattern"),
        path: z
          .string()
          .optional()
          .describe(
            "Target file or directory path, defaults to the working directory. If a directory is given, it will be searched recursively",
          ),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of matching lines to return, default 50"),
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx) => {
        const {
          pattern,
          path: targetPath,
          max_results = 50,
        } = args;
        if (!pattern) throw new Error("pattern is required");

        const target = await this.resolveTarget(ctx, args.workspace);
        if (target) {
          // 远端分支：POSIX grep 语义（JS 正则的高级语法 \d 等不适用），
          // 输出为 relPath:line: content（无函数名上下文后缀）
          const searchPath = targetPath
            ? target.provider.resolvePath(targetPath)
            : target.basePath;
          const lines = await target.provider.grep(pattern, {
            path: searchPath,
            maxResults: max_results,
            ignore: FilePlugin.IGNORE_PATTERNS,
          });
          if (lines.length === 0) return "No matches found.";
          const base = target.basePath.replace(/\/$/, "");
          return lines
            .map((l) => (l.startsWith(`${base}/`) ? l.slice(base.length + 1) : l))
            .join("\n");
        }

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
            ignore: FilePlugin.IGNORE_PATTERNS,
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
        const BATCH_SIZE = 20;

        for (let i = 0; i < files.length && total < max_results; i += BATCH_SIZE) {
          const batch = files.slice(i, Math.min(i + BATCH_SIZE, files.length));
          const results = await Promise.allSettled(
            batch.map((fp) =>
              this.grepInFile(fp, regex, relativeRoot, max_results - total),
            ),
          );

          for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
              outputLines.push(...result.value.lines);
              total += result.value.count;
              if (total >= max_results) break;
            }
          }
        }

        if (outputLines.length === 0) {
          return "No matches found.";
        }

        return outputLines.join("\n");
      },
      display: {
        actionType: "grep",
        text: { executing: "%grep.executing%", completed: "%grep.completed%" },
        aggregate: { executing: "%grep.aggregate.executing%", completed: "%grep.aggregate.completed%" },
        argsKey: "pattern",
        icon: "search",
      },
      dangerLevel: "safe",
      readOnly: true,
    });

    fileKit.registerPrompt({
      frequency: "STATIC",
      description: "当前会话工作目录和安全路径说明",
      content: (ctx: PluginContext) => {
        if (!ctx.session.workspacePath) return "";
        const lines = [
          "# Working Directory:",
          `${ctx.session.workspacePath}`,
          "",
          "**Important Notes**:",
          "1. All scripts, temporary files, generated data, etc. should be stored in the working directory above.",
          "2. **Default Path Rule**: All file operation tools automatically use the working directory as the base when handling relative paths.",
          "   Always use relative paths unless the user explicitly specifies an absolute path.",
          "3. .guada is a special directory — only store files specified in prompts here. Project files, scripts, etc. must not be placed under .guada.",
        ];
        // 附加（远程）工作目录说明：静态文案（不随绑定变化——连接清单由 ssh-tools 提示词/
        // 注入块提供），避免绑定变更打破提示词前缀缓存
        lines.push(
          "4. Additional remote workspaces may be bound to this session. To operate on one, pass workspace=\"<connection name>\" to the file tools; paths then resolve inside that remote workspace. Omit the parameter for the local working directory above.",
          "",
          "**File Editing Policy**:",
          "1. Use `edit` for partial changes; use `write` only for new files or full rewrites.",
          "2. `old_text` must be copied from `read` output without the line-number prefix (N<TAB>). It must be unique unless `replace_all: true`.",
          "3. Do not use `run_command`, Python, `sed -i`, `node -e`, or heredocs to modify project files. If `edit` fails, re-read the relevant range and retry with more context.",
          "4. After a successful `edit`, do not re-read the file just to verify; the tool would have errored if the replacement failed.",
        );
        return lines.join("\n");
      },
    });
  }

  /**
   * 解析工具的 workspace 参数 → 附加（远程）工作目录目标。
   * 返回 null = 主工作目录（本地），工具走本地代码路径。
   */
  private async resolveTarget(
    ctx: PluginContext,
    workspace?: string,
  ): Promise<RemoteToolTarget | null> {
    // 牢笼是本地单根约束，远程工作目录会让它形同虚设（远端路径不在本地包含性判断内）
    if (this.getPathJail(ctx)) {
      const target = await this.workspaceRouter.resolveRemoteTarget(
        workspace,
        ctx.session.sessionId,
        ctx.session.getSettings?.()?.attachments,
      );
      if (target) {
        throw new Error(
          "Path jail active: remote workspaces are not accessible in this mode.",
        );
      }
      return null;
    }
    return this.workspaceRouter.resolveRemoteTarget(
      workspace,
      ctx.session.sessionId,
      ctx.session.getSettings?.()?.attachments,
    );
  }

  /**
   * 会话 read-only 模式拦截（本地与远程一致）：远程写分支在调用前检查，
   * 远端路径级权限另由连接 perm（readonly/workspace/unrestricted）控制。
   */
  private assertWritableSession(ctx: PluginContext): void {
    const mode = ctx?.session.getSandboxMode?.() ?? "workspace-write";
    if (mode === "read-only") {
      throw new Error(
        "Read-only mode: file writes are denied (including remote workspaces). To modify a file, ask the user to switch modes.",
      );
    }
  }

  /**
   * read 输出格式化（本地/远程共用）：行/字符分页 + 行号前缀 + 截断续读提示。
   */
  private formatReadResult(
    raw: string,
    unit: "line" | "char",
    offset: number,
    limit?: number,
  ): string {
    const totalChars = raw.length;
    const lines = raw.split("\n");
    const totalLines = lines.length;
    const MAX_BYTES = 20 * 1024;

    if (unit === "char") {
      // 按字符读取
      const charLimit = limit ?? 20000;
      const content = safeSubstring(raw, offset, offset + charLimit);
      const truncated = offset + charLimit < totalChars;

      // 计算起始行号
      const startLineNumber = safeTruncate(raw, offset).split("\n").length;
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
        partialLine = safeTruncate(line, avail);
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
      formattedLines.push(`${num}\t${lines[i]}`);
    }
    if (partialLine !== null) {
      const num = String(endLine + 1).padStart(padWidth, " ");
      formattedLines.push(`${num}\t${partialLine}`);
    }
    let result = formattedLines.join("\n");

    if (truncatedByBytes) {
      result += `\n(Text truncated at 20KB. To continue: unit=char, offset=${nextCharOffset}, limit=20000)`;
    } else if (hasMoreLines) {
      const remaining = totalLines - endLine;
      result += `\n(${remaining} more lines remain. To continue: unit=line, offset=${endLine}, limit=${lineLimit})`;
    }
    return result;
  }

  /**
   * edit 替换变换（本地/远程共用）：
   * - 先精确匹配；失败后再尝试剥离 read 输出的行号前缀
   * - 多处匹配且未 replace_all 时返回 multiple，由调用方给出可操作提示
   * - 用函数式 replacement 做字面替换，避免 new_text 里的 $& / $' 被展开
   * - 保留原文件行尾风格
   */
  private static transformEdit(
    content: string,
    oldText: string,
    newText: string,
    replaceAll: boolean,
  ): EditTransformResult {
    const normContent = content.replace(/\r\n/g, "\n");
    const normOld = oldText.replace(/\r\n/g, "\n");

    // 精确匹配优先；仅当精确匹配失败时才尝试去掉 read 输出的行号前缀，
    // 避免把内容本身就形如 "12\t..." 的文件误判。
    const candidates = [normOld];
    const stripped = stripReadLinePrefixes(normOld);
    if (stripped !== normOld) candidates.push(stripped);

    for (const candidate of candidates) {
      if (!candidate) continue;
      const count = countOccurrences(normContent, candidate);
      if (count === 0) continue;
      if (count > 1 && !replaceAll) {
        return { kind: "multiple", count };
      }
      const firstIdx = normContent.indexOf(candidate);
      const firstLine = normContent.slice(0, firstIdx).split("\n").length;
      const replaced = replaceAll
        ? normContent.split(candidate).join(newText)
        : normContent.replace(candidate, () => newText);
      const hasCRLF = content.includes("\r\n");
      return {
        kind: "ok",
        content: hasCRLF ? replaced.replace(/\n/g, "\r\n") : replaced,
        replacements: replaceAll ? count : 1,
        firstLine,
      };
    }

    return { kind: "not_found" };
  }

  /** 统一把 transformEdit 的结构化结果翻译成成功文案或可操作错误 */
  private static applyEditTransform(
    content: string,
    oldText: string,
    newText: string,
    replaceAll: boolean,
  ): { content: string; message: string } {
    const result = FilePlugin.transformEdit(
      content,
      oldText,
      newText,
      replaceAll,
    );
    if (result.kind === "not_found") {
      throw new Error(
        `No match text found: ${safeTruncate(oldText, 120)}. old_text must exactly match a contiguous segment; copy it from read output without the line-number prefix, then retry with more context.`,
      );
    }
    if (result.kind === "multiple") {
      throw new Error(
        `Found ${result.count} matches for old_text. Include more surrounding context to make it unique, or set replace_all: true.`,
      );
    }
    return {
      content: result.content,
      message:
        result.replacements === 1
          ? `modified (1 replacement at line ${result.firstLine})`
          : `modified (${result.replacements} replacements)`,
    };
  }

  /**
   * Serialize concurrent write operations to the same file.
   * Different files still run in parallel; only same-file writes are queued.
   */
  private withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath).replace(/\\/g, "/");
    const prev = this.fileLocks.get(key) || Promise.resolve();
    const exec = prev.then(() => fn());
    // Store a never-rejecting version so one failure doesn't break the chain
    const stored = exec.then(() => {}, () => {});
    this.fileLocks.set(key, stored);
    // Clean up map entry once settled (no-op if a newer lock already replaced it)
    stored.then(() => {
      if (this.fileLocks.get(key) === stored) this.fileLocks.delete(key);
    });
    return exec;
  }

  /**
   * 将字节数格式化为可读单位（B/KB/MB/GB，1024 进制，1 位小数）
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
  }

  /**
   * 统计文件行数。仅当：大小 <= 512KB、非已知二进制扩展名，
   * 且未知扩展名时首块不含 NUL 字节（视为文本）才统计；
   * 其余情况（二进制/超限/读取失败）返回 null，只显示大小。
   * 按 0x0A 字节计数：UTF-8/GBK 等多字节编码的字符内不会出现该字节，无需解码。
   */
  private async countLinesIfTextable(
    filePath: string,
    size: number,
  ): Promise<number | null> {
    if (size > FilePlugin.MAX_LINE_COUNT_SIZE) return null;
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (FilePlugin.BINARY_EXTENSIONS.has(ext)) return null;
    try {
      const raw = await fs.readFile(filePath);
      if (!FilePlugin.TEXT_EXTENSIONS.has(ext) && raw.includes(0)) {
        return null; // 未知后缀且含 NUL 字节 → 按二进制处理
      }
      if (raw.length === 0) return 0;
      return raw.toString("latin1").split("\n").length;
    } catch {
      return null;
    }
  }

  /** 当前会话的路径牢笼（瞬态；记忆维护等系统级写入为文件工具收窄可用范围） */
  private getPathJail(context?: PluginContext): string | null {
    return context?.session.getPathJail?.() ?? null;
  }

  /**
   * 目标路径是否落在会话自己的记忆目录内（只读模式下的记忆写入例外）。
   * 路径规则取自 common/utils/memory-path.util.ts，与记忆注入/牢笼根同一真相。
   */
  private isInSessionMemoryDir(
    filePath: string,
    context?: PluginContext,
  ): boolean {
    const workspacePath = context?.session.workspacePath;
    const sessionId = context?.session.sessionId;
    if (!workspacePath || !sessionId) return false;
    try {
      const memoryDir = resolveMemoryDir({
        workspacePath,
        sessionId,
        sessionType: context?.session.sessionType,
      });
      return this.workspaceService.isPathWithin(
        this.resolvePath(filePath, context),
        [memoryDir],
      );
    } catch {
      return false;
    }
  }

  /**
   * 记忆索引（MEMORY.md）上限守卫 —— 本仓唯一的"内容级"写入否决。
   *
   * 为什么需要它：索引每回合整段注入（前 MEMORY_INDEX_MAX_LINES 行），超出部分**永不**
   * 进入上下文，所以体积失控等于静默失去召回。格式/排序仍交给提示词纪律，唯有体积是
   * 确定性强制。
   *
   * 规则（与 engramory 的 cap hook 同构）：
   * - 只对**会话自己的索引路径**生效——不是任何名为 MEMORY.md 的文件（避免误拦项目里
   *   同名的无关文件，也就省掉了 engramory 不得不提供的 indexPath 逃生阀）；
   * - 只有"结果超硬上限**且**比当前文件更长"才拒绝 → 缩小/持平永远放行，保证可以
   *   210 → 205 → 198 逐次瘦身；索引不存在视为 0（首次就写超限会被拒）；
   * - 明细文件不限体积（12KB 级提示属 doctor 层，尚未实现）。
   *
   * 诚实边界：只拦**本工具的 write/edit**（本地分支）。shell 重定向/脚本、远端 provider、
   * 文件 API 等其它写通道绕过它——这是纪律栏杆，不是安全边界。
   *
   * @param nextContent 改写后的完整文本（write = 入参 content；edit = transformEdit 结果）
   * @param currentContent 当前磁盘内容（edit 已在锁内读过则传入，省一次读；write 省略则由本方法读）
   */
  private async evaluateMemoryIndexCap(
    resolvedPath: string,
    nextContent: string,
    context?: PluginContext,
    currentContent?: string,
  ): Promise<
    { kind: "allow"; notice?: string } | { kind: "deny"; message: string }
  > {
    const workspacePath = context?.session.workspacePath;
    const sessionId = context?.session.sessionId;
    if (!workspacePath || !sessionId) return { kind: "allow" };

    let indexPath: string;
    try {
      indexPath = resolveMemoryIndexPath({
        workspacePath,
        sessionId,
        sessionType: context?.session.sessionType,
      });
    } catch {
      return { kind: "allow" };
    }
    if (path.resolve(resolvedPath) !== path.resolve(indexPath)) {
      return { kind: "allow" };
    }

    let current = currentContent;
    if (current === undefined) {
      try {
        current = await fs.readFile(resolvedPath, "utf-8");
      } catch {
        current = ""; // 索引尚不存在 → 视为空（首次写入按"变长"判定）
      }
    }

    const nextLines = countIndexLines(nextContent);
    const nextBytes = Buffer.byteLength(nextContent, "utf8");
    const curLines = countIndexLines(current);
    const curBytes = Buffer.byteLength(current, "utf8");

    const hard = isIndexOverHardCap(nextLines, nextBytes);
    const grows =
      (nextLines > MEMORY_INDEX_MAX_LINES && nextLines > curLines) ||
      (nextBytes > MEMORY_INDEX_MAX_BYTES && nextBytes > curBytes);

    if (hard.over && grows) {
      return {
        kind: "deny",
        message:
          `Refused: this write would put the memory index over its hard cap (${hard.detail.join(", ")}). ` +
          `The index is injected every turn and only its first ${MEMORY_INDEX_MAX_LINES} lines are ever visible, ` +
          `so anything past the cap silently stops being recalled. Compact BEFORE writing: ` +
          `move prose that leaked onto an index line back into the linked detail file, merge duplicate pointers, ` +
          `drop cold entries, and keep every line to "one short hook + link". ` +
          `A write that SHRINKS the index always passes, so you can compact step by step.`,
      };
    }

    if (isIndexOverSoftCap(nextLines, nextBytes)) {
      return {
        kind: "allow",
        notice:
          `⚠️ memory index is at ${nextLines} lines / ${nextBytes} bytes ` +
          `(soft cap ${MEMORY_INDEX_SOFT_LINES} lines / ${MEMORY_INDEX_SOFT_BYTES} bytes). ` +
          `Still fully injected, but consolidate soon — writes that grow it past ` +
          `${MEMORY_INDEX_MAX_LINES} lines / ${MEMORY_INDEX_MAX_BYTES} bytes are refused.`,
      };
    }

    return { kind: "allow" };
  }

  /**
   * 牢笼越界拒绝。
   *
   * 读类工具（read/glob/grep）本身没有沙箱约束且接受绝对路径，所以牢笼必须由
   * 所有文件工具共同的路径解析点 resolvePath 收口，而不是只挂在写校验上。
   */
  private assertWithinJail(resolvedPath: string, context?: PluginContext): void {
    const jail = this.getPathJail(context);
    if (!jail) return;
    if (!this.workspaceService.isPathWithin(resolvedPath, [jail])) {
      throw new Error(
        `Path jail active: only paths under "${jail}" are accessible in this mode (requested: ${resolvedPath}). ` +
          `Relative paths resolve against the working directory, so use an absolute path under "${jail}" ` +
          `or a working-directory-relative path that lands inside it.`,
      );
    }
  }

  /**
   * 牢笼下的 glob pattern 约束：fast-glob 的 cwd 只约束基准目录，
   * 绝对 pattern 与 `..` 段都能逃逸出牢笼。
   */
  private assertJailGlobPattern(pattern: string, context?: PluginContext): void {
    if (!this.getPathJail(context)) return;
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
      throw new Error(
        `Path jail active: glob pattern must be relative and must not contain ".." (got: ${pattern}).`,
      );
    }
  }

  private resolvePath(filePath: string, context?: PluginContext): string {
    const resolved = this.workspaceService.resolveFilePath(
      filePath,
      context?.session.workspacePath,
    );
    this.assertWithinJail(resolved, context);
    return resolved;
  }

  /**
   * 本地写入路径判定（无副作用、不含交互）：allow / deny / ask。
   *
   * 模型不能自我提权——越界写在 workspace-write 档交 ensureWriteApproval 询问用户，
   * read-only 档直接拒绝（对齐命令策略：能力放宽只由用户授予）。
   */
  private evaluateWritePath(
    resolvedPath: string,
    context?: PluginContext,
  ):
    | { kind: "allow" }
    | { kind: "deny"; message: string }
    | { kind: "ask"; resolvedPath: string } {
    // 牢笼优先：记忆维护这类系统级写入不受安全档位约束，
    // 作用面已由牢笼收窄到单一根目录（牢笼内可写，牢笼外已由 resolvePath 抛出），且不打扰用户。
    if (this.getPathJail(context)) {
      return { kind: "allow" };
    }

    const mode = context?.session.getSandboxMode?.() ?? "workspace-write";

    if (mode === "read-only") {
      // 例外：会话自己的记忆目录（.guada/memory）始终可写——记忆是应用状态而非项目文件，
      // 且压缩前记忆维护（牢笼模式）本就绕过只读模式，前台与后台语义需一致。
      if (this.isInSessionMemoryDir(resolvedPath, context)) {
        this.logger.debug(
          `[read-only] write allowed inside the session memory dir: ${resolvedPath}`,
        );
        return { kind: "allow" };
      }
      return {
        kind: "deny",
        message:
          "Read-only mode: file writes are denied. To modify a file, ask the user to switch the session mode to workspace-write.",
      };
    }

    if (mode === "danger-full-access") {
      this.logger.warn(
        `[danger-full-access] 跳过工作区路径校验，允许写入任意路径: ${resolvedPath}`,
      );
      return { kind: "allow" };
    }

    // 敏感路径（出厂 敏感规则 / 你的规则）：命中 ask → 交审批；命中 deny → 直接拒绝。
    // 放在"工作区内直接放行"之前，所以工作区里的 .env / 密钥文件也要问一次。
    const sensitive = this.policyRules.matchPathRuleSync(
      context?.session.workspacePath,
      resolvedPath,
    );
    if (sensitive?.action === "deny") {
      return { kind: "deny", message: `Denied by policy rule (${sensitive.path}): ${resolvedPath}` };
    }
    if (sensitive?.action === "ask") {
      return { kind: "ask", resolvedPath };
    }

    // workspace-write：工作区内或系统注册的安全路径（技能目录等）直接放行；
    // 其余交 ensureWriteApproval 询问用户（本会话内记住过的同路径直接放行）
    const extra = context?.session.workspacePath
      ? [context.session.workspacePath]
      : [];
    if (this.workspaceService.isSafeWritePath(resolvedPath, extra)) {
      return { kind: "allow" };
    }
    return { kind: "ask", resolvedPath };
  }

  /**
   * 工作区外写入的用户审批（对齐命令策略：会话内路径记忆 + 无人应答 fail-closed）。
   *
   * 「本会话内始终允许该路径」→ writeApprovalMemory 记账；拒绝/自定义回复抛 AskDeniedError
   * （工具层以 isError tool-result 反馈模型）。
   */
  private async ensureWriteApproval(params: {
    resolvedPath: string;
    operation: "write" | "edit";
    preview?: string;
    context?: PluginContext;
    toolCallId?: string;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const session = params.context?.session;
    const sessionId = session?.sessionId || "";
    if (sessionId && writeApprovalMemory.has(sessionId, params.resolvedPath)) {
      return;
    }

    // 敏感路径：走"敏感文件访问"卡（点"放通此类"写的是这条路径 glob）
    const sensitive = this.policyRules.matchPathRuleSync(
      params.context?.session.workspacePath,
      params.resolvedPath,
    );
    if (sensitive?.action === "ask") {
      await this.requestSensitiveAccess({
        resolvedPath: params.resolvedPath,
        glob: sensitive.path,
        op: params.operation === "edit" ? "write" : "write",
        context: params.context,
        toolCallId: params.toolCallId,
        sessionId,
        abortSignal: params.abortSignal,
      });
      return;
    }

    // 用户规则：可写根（出厂开发缓存 + 你追加的目录）
    if (this.isPathAllowedByPolicy(params.resolvedPath, params.context)) {
      return;
    }

    // 无人能应答审批（子代理 / 机器人 / 界面无连接）→ 直接拒绝，绝不挂起
    const canAsk = session?.hasAnswerSurface
      ? session.hasAnswerSurface()
      : session?.sessionType === "web";
    if (!canAsk) {
      throw new Error(
        `File not written: approval is unavailable in this session (no one can approve it right now) and the path is outside the workspace (${params.resolvedPath}). ` +
          `Write inside the workspace instead, or report back to the user and let them run it in a session they're watching.`,
      );
    }

    const approval = await this.askService.requestWriteApproval(session as any, {
      toolCallId: params.toolCallId,
      toolName: params.operation,
      resolvedPath: params.resolvedPath,
      operation: params.operation,
      preview: params.preview,
      abortSignal: params.abortSignal,
    });
    if (approval === "session" && sessionId) {
      writeApprovalMemory.remember(sessionId, params.resolvedPath);
    }
    this.logger.log(
      `Write approved (${approval}) by policy prompt: ${params.resolvedPath}`,
    );
  }

  /**
   * 敏感路径门：命中 `{action: "ask", path}` 的路径 → 弹"敏感文件访问"卡。
   * 工作档才弹窗；只读档已在 evaluateWritePath / read_file 里直接拒绝。
   */
  private async requestSensitiveAccess(params: {
    resolvedPath: string;
    glob: string;
    op: "read" | "write" | "delete";
    context?: PluginContext;
    toolCallId?: string;
    sessionId: string;
    abortSignal?: AbortSignal;
  }): Promise<void> {
    const session = params.context?.session;
    const canAsk = session?.hasAnswerSurface
      ? session.hasAnswerSurface()
      : session?.sessionType === "web";
    if (!canAsk) {
      throw new Error(
        `File access denied: ${params.resolvedPath} matches a sensitive path rule (${params.glob}) ` +
          `and no one can approve it right now (sub-agent / bot / no live UI).`,
      );
    }
    const approval = await this.askService.requestCommandApproval(session as any, {
      toolCallId: params.toolCallId,
      command: `${params.op === "read" ? "read" : "write"} ${params.resolvedPath}`,
      reason: `命中敏感路径规则（${params.glob}）`,
      allowRule: params.glob,
      allowRuleKind: "path",
      pathDetail: { target: params.resolvedPath, op: params.op },
      abortSignal: params.abortSignal,
    });
    if (approval !== "once") {
      try {
        await this.policyRules.appendRule(
          approval.scope,
          { action: "allow", path: params.glob },
          params.context?.session.workspacePath,
        );
      } catch (e: any) {
        this.logger.warn(`failed to persist path rule "${params.glob}": ${e?.message ?? e}`);
      }
    }
    if (params.sessionId) writeApprovalMemory.remember(params.sessionId, params.resolvedPath);
  }

  /**
   * 读类工具的敏感路径门：工作档弹一次（本会话记住该目标），只读档直接拒绝。
   */
  private async ensureSensitiveRead(
    resolvedPath: string,
    context: PluginContext | undefined,
    toolCallId?: string,
  ): Promise<void> {
    const rule = this.policyRules.matchPathRuleSync(context?.session.workspacePath, resolvedPath);
    if (!rule || rule.action === "allow") return;
    if (rule.action === "deny") {
      throw new Error(`Denied by policy rule (${rule.path}): ${resolvedPath}`);
    }
    const mode = context?.session.getSandboxMode?.() ?? "workspace-write";
    if (mode === "read-only") {
      throw new Error(
        `Read-only mode: access to a sensitive path is denied (${resolvedPath}, rule: ${rule.path}). ` +
          `Allow it under Settings → Command policy, or switch the session mode to workspace-write.`,
      );
    }
    if (mode === "danger-full-access") return;
    const sessionId = context?.session.sessionId || "";
    if (sessionId && writeApprovalMemory.has(sessionId, resolvedPath)) return;
    await this.requestSensitiveAccess({
      resolvedPath,
      glob: rule.path,
      op: "read",
      context,
      toolCallId,
      sessionId,
    });
  }

  /** 目标是否命中"可写根"（policy.yaml 的路径 allow 规则：出厂开发缓存 + 用户追加的目录） */
  private isPathAllowedByPolicy(resolvedPath: string, context?: PluginContext): boolean {
    try {
      return this.policyRules.isPathAllowedSync(context?.session.workspacePath, resolvedPath);
    } catch {
      return false;
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

  private async grepInFile(
    filePath: string,
    regex: RegExp,
    relativeRoot: string,
    remaining: number,
  ): Promise<{ lines: string[]; count: number }> {
    const lines: string[] = [];
    let count = 0;
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const fileLines = content.replace(/\r\n/g, "\n").split("\n");
      const relPath = path.relative(relativeRoot, filePath);

      // 并发调用时 clone regex 避免 lastIndex 竞态
      const localRegex = new RegExp(regex.source, regex.flags);

      for (let i = 0; i < fileLines.length && count < remaining; i++) {
        localRegex.lastIndex = 0;
        const m = localRegex.exec(fileLines[i]);
        if (m) {
          const matchIdx = m.index;
          const matchLen = m[0].length;
          const ctxLen = 50;
          const cStart = Math.max(0, matchIdx - ctxLen);
          const cEnd = Math.min(
            fileLines[i].length,
            matchIdx + matchLen + ctxLen,
          );
          const snippet = safeSubstring(fileLines[i], cStart, cEnd).trim();
          const funcName = this.findEnclosingFunction(fileLines, i);
          const funcSuffix = funcName ? `    ← in ${funcName}()` : "";
          lines.push(`${relPath}:${i + 1}: ${snippet}${funcSuffix}`);
          count++;
        }
      }
    } catch {
      // skip unreadable files
    }
    return { lines, count };
  }
}
