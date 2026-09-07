import { Logger, Injectable } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import {
  parseEscalationArgs,
  type SandboxMode,
  assertStrictlyWider,
} from "../../../common/services/sandbox-policy";
import { AskService } from "../../../common/services/ask.service";
import { PluginApi } from "../api/plugin-api";
import { safeSubstring, safeTruncate } from "../../../common/utils/string.utils";
import {
  WorkspaceToolRouter,
  workspaceParamField,
  type RemoteToolTarget,
} from "../../remote-workspace/workspace-router";
import { z } from "zod";
import langZh from "./file.lang.zh.json";
import langEn from "./file.lang.en.json";

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
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── file 能力包：全部文件工具与工作目录说明统一挂载，角色层按包启停 ──
    const fileKit = api.registerToolKit({
      id: "file",
      name: "%file.name%",
      description: "%file.toolkitDescription%",
      activator: "Read, write, edit, list and search files in the workspace.",
    });
    fileKit.registerTool({
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

        const basePath = directory
          ? this.resolvePath(directory, ctx)
          : ctx?.session.workspacePath || process.cwd();

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
    });

    fileKit.registerTool({
      name: "write",
      description:
        "Write content to the specified file in full, automatically creating directories. Writes are confined to the workspace unless sandbox escalation is approved.",
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
        sandbox_permissions: z
          .literal("danger-full-access")
          .optional()
          .describe(
            "The wider sandbox mode this write needs (workspace → full access). Only valid as a one-shot retry after the workspace containment denied the path; requires justification and user approval.",
          ),
        justification: z
          .string()
          .optional()
          .describe(
            "Required with sandbox_permissions: one sentence for the user explaining why this exact write needs the wider access.",
          ),
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx) => {
        const { file_path, content, encoding = "utf-8" } = args;
        if (!file_path) throw new Error("file_path is required");

        const target = await this.resolveTarget(ctx, args.workspace);
        if (target) {
          // 远端写：路径级权限由连接 perm 控制；sandbox_permissions 提权仅作用于本地沙盒
          this.assertWritableSession(ctx);
          const absPath = target.provider.resolvePath(file_path);
          this.logger.log(`写入远程文件: ${target.connectionName}:${absPath}`);
          await target.provider.writeFile(absPath, content, { encoding });
          return `File written: ${absPath} (${content.length} chars)`;
        }

        const resolvedPath = this.resolvePath(file_path, ctx);
        // 提权批准后按批准模式放行（one-shot）：danger-full-access 跳过包含检查，
        // workspace-write 仍限工作区；未提权则照常校验（read-only 直接拒绝）
        const approved = await this.resolveWriteEscalation("write", args, ctx);
        if (approved !== "danger-full-access")
          this.validateWritePath(file_path, ctx, approved ?? undefined);
        this.logger.log(`写入文件: ${file_path}`);
        return this.withFileLock(resolvedPath, async () => {
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, content, {
            encoding: encoding as BufferEncoding,
          });
          return `File written: ${resolvedPath} (${content.length} chars)`;
        });
      },
      display: {
        actionType: "write",
        text: { executing: "%write.executing%", completed: "%write.completed%" },
        aggregate: { executing: "%write.aggregate.executing%", completed: "%write.aggregate.completed%" },
        argsKey: "file_path",
        icon: "edit",
      },
      dangerLevel: "high",
    });

    fileKit.registerTool({
      name: "edit",
      description:
        "Find and replace specified text in a file. old_text must exactly match a contiguous segment in the original file. Prefer this tool for partial edits. Edits are confined to the workspace unless sandbox escalation is approved.",
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
        sandbox_permissions: z
          .literal("danger-full-access")
          .optional()
          .describe(
            "The wider sandbox mode this edit needs (workspace → full access). Only valid as a one-shot retry after the workspace containment denied the path; requires justification and user approval.",
          ),
        justification: z
          .string()
          .optional()
          .describe(
            "Required with sandbox_permissions: one sentence for the user explaining why this exact edit needs the wider access.",
          ),
        workspace: workspaceParamField,
      }),
      execute: async (args, ctx) => {
        const { file_path, old_text, new_text, encoding = "utf-8" } = args;
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
          const modified = FilePlugin.transformEdit(content, old_text, new_text);
          if (modified === null) {
            throw new Error(`No match text found: ${old_text}`);
          }
          await target.provider.writeFile(absPath, modified, { encoding });
          return `File ${absPath} modified (1 replacement)`;
        }

        const resolvedPath = this.resolvePath(file_path, ctx);
        // 提权批准后按批准模式放行（one-shot）：danger-full-access 跳过包含检查，
        // workspace-write 仍限工作区；未提权则照常校验（read-only 直接拒绝）
        const approved = await this.resolveWriteEscalation("edit", args, ctx);
        if (approved !== "danger-full-access")
          this.validateWritePath(file_path, ctx, approved ?? undefined);
        this.logger.log(`编辑文件: ${file_path}`);
        return this.withFileLock(resolvedPath, async () => {
          const content = await fs.readFile(resolvedPath, {
            encoding: encoding as BufferEncoding,
          });
          if (old_text === new_text) {
            return `File ${resolvedPath} unchanged`;
          }

          const modified = FilePlugin.transformEdit(content, old_text, new_text);
          if (modified === null) {
            throw new Error(`No match text found: ${old_text}`);
          }

          await fs.writeFile(resolvedPath, modified, {
            encoding: encoding as BufferEncoding,
          });
          return `File ${resolvedPath} modified (1 replacement)`;
        });
      },
      display: {
        actionType: "edit",
        text: { executing: "%edit.executing%", completed: "%edit.completed%" },
        aggregate: { executing: "%edit.aggregate.executing%", completed: "%edit.aggregate.completed%" },
        argsKey: "file_path",
        icon: "edit",
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
  }

  /**
   * edit 替换变换（本地/远程共用）：统一换行后匹配、首次替换、还原原文件行尾风格。
   * 返回 null = 未匹配。
   */
  private static transformEdit(
    content: string,
    oldText: string,
    newText: string,
  ): string | null {
    const normContent = content.replace(/\r\n/g, "\n");
    const normOld = oldText.replace(/\r\n/g, "\n");
    const idx = normContent.indexOf(normOld);
    if (idx === -1) return null;
    const hasCRLF = content.includes("\r\n");
    const normResult = normContent.replace(normOld, newText);
    return hasCRLF ? normResult.replace(/\n/g, "\r\n") : normResult;
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

  private resolvePath(filePath: string, context?: PluginContext): string {
    return this.workspaceService.resolveFilePath(
      filePath,
      context?.session.workspacePath,
    );
  }

  private validateWritePath(
    filePath: string,
    context?: PluginContext,
    approvedMode?: SandboxMode,
  ): void {
    // 安全模式判定：read-only 拒绝一切写入（one-shot 提权到 workspace-write 除外）；
    // danger-full-access（自由编辑）不限工作目录
    const mode = context?.session.getSandboxMode?.() ?? "workspace-write";
    if (mode === "read-only" && approvedMode !== "workspace-write") {
      throw new Error(
        "Read-only mode: file writes are denied. To modify a file, retry once with sandbox_permissions + justification (user approval required), or ask the user to switch modes.",
      );
    }
    if (mode === "danger-full-access") {
      this.logger.warn(
        `[danger-full-access] 跳过工作区路径校验，允许写入任意路径: ${filePath}`,
      );
      return;
    }

    const resolved = this.resolvePath(filePath, context);
    const extra = context?.session.workspacePath
      ? [context.session.workspacePath]
      : [];
    this.workspaceService.validateWritePath(resolved, extra);
  }

  /**
   * 解析并执行一次文件写入提权（对齐 DSH escalation，one-shot）。
   *
   * 文件写入始终受会话安全模式约束：read-only / workspace-write 下有效模式 = 会话模式，
   * 经 assertStrictlyWider 放宽（read-only → workspace-write/danger-full-access，
   * workspace-write → danger-full-access）；danger-full-access 下提权无意义直接报错。
   * 返回批准的模式（本次调用按其放行）；null = 未请求提权。
   */
  private async resolveWriteEscalation(
    toolName: "write" | "edit",
    args: { sandbox_permissions?: "danger-full-access" | "workspace-write"; justification?: string },
    context?: PluginContext,
  ): Promise<SandboxMode | null> {
    const escalation = parseEscalationArgs(
      args.sandbox_permissions,
      args.justification,
    );
    if (!escalation) return null;

    const currentMode: SandboxMode =
      context?.session.getSandboxMode?.() ?? "workspace-write";
    if (currentMode === "danger-full-access") {
      throw new Error(
        "danger-full-access already allows arbitrary paths; sandbox_permissions is unnecessary.",
      );
    }

    assertStrictlyWider(currentMode, escalation.mode);
    // 统一 Ask 审批（同意/拒绝/自定义回复，无超时）：批准正常返回；拒绝/中止抛 AskDeniedError
    await this.askService.requestApproval(context!.session, {
      toolCallId: context?.toolCallId || "",
      toolName,
      detail: `请求沙盒提权 ${currentMode} → ${escalation.mode}：${escalation.justification}`,
    });
    return escalation.mode;
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
