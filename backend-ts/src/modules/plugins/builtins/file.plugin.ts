import { Logger, Injectable } from "@nestjs/common";
import * as path from "path";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { WorkspaceService } from "../../../common/services/workspace.service";
import { WorkspaceProviderResolver } from "../../../common/workspace/workspace-provider.resolver";
import type { WorkspaceProvider } from "../../../common/workspace/workspace-provider.interface";
import { PluginApi } from "../api/plugin-api";
import { safeSubstring, safeTruncate } from "../../../common/utils/string.utils";
import { z } from "zod";

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

  /** read 工具单次全量读取的文件大小上限（50MB）。
   *  超过此上限的 read 调用会收到提示而非全量 Read，
   *  避免内存暴涨与网络 provider 下的整文件传输。 */
  static readonly MAX_READ_FILE_SIZE = 50 * 1024 * 1024;

  // Per-file write lock: serializes concurrent edit/write to the same file
  private readonly fileLocks = new Map<string, Promise<void>>();

  manifest = {
    id: "file",
    name: "文件工具",
    description: "读写、编辑、搜索、删除文件和目录",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(
    private workspaceService: WorkspaceService,
    private providerResolver: WorkspaceProviderResolver,
  ) {
    super();
  }

  /** Resolve WorkspaceProvider from session's workspacePath */
  private async getProvider(ctx?: PluginContext): Promise<WorkspaceProvider> {
    const workspacePath = ctx?.session.workspacePath || process.cwd();
    return this.providerResolver.resolve(workspacePath);
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

        const provider = await this.getProvider(ctx);

        // 超大文件保护
        const stat = await provider.stat(resolvedPath);
        if (stat.size > FilePlugin.MAX_READ_FILE_SIZE) {
          return `File is too large (${this.formatSize(stat.size)}) to read in full. ` +
            `This tool has a hard limit of ${FilePlugin.MAX_READ_FILE_SIZE / 1024 / 1024}MB per read to avoid excessive memory/bandwidth use. ` +
            `Use the grep tool to locate specific content, or read smaller sections via the workspace file preview.`;
        }

        const raw = (await provider.readFile(resolvedPath, {
          encoding: (encoding || "utf-8"),
        })) as string;

        const totalChars = raw.length;
        const lines = raw.split("\n");
        const totalLines = lines.length;
        const MAX_BYTES = 20 * 1024;

        if (unit === "char") {
          const charLimit = limit ?? 20000;
          const content = safeSubstring(raw, offset, offset + charLimit);
          const truncated = offset + charLimit < totalChars;

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

        let nextCharOffset = 0;
        for (let i = 0; i < startLine; i++) {
          nextCharOffset += lines[i].length + 1;
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
      display: { actionType: "read", argsKey: "file_path", icon: "read" },
      dangerLevel: "safe",
    });

    api.registerTool({
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
      }),
      execute: async (args, ctx) => {
        const { pattern, directory, limit = 100, depth } = args;
        if (!pattern) throw new Error("pattern 不能为空");

        const provider = await this.getProvider(ctx);
        const basePath = directory
          ? this.resolvePath(directory, ctx)
          : ctx?.session.workspacePath || process.cwd();

        // fast-glob deep 语义：1=当前目录, 2=一级, ... N=N-1级
        const deep = depth !== undefined ? depth + 1 : undefined;

        // Request limit+1 to detect hasMore without interface change
        const rawFiles = await provider.glob(pattern, {
          cwd: basePath,
          ignore: FilePlugin.IGNORE_PATTERNS,
          limit: limit + 1,
          deep,
        });
        const hasMore = rawFiles.length > limit;
        const files = hasMore ? rawFiles.slice(0, limit) : rawFiles;

        // 分批并行统计行数，单文件失败降级为仅大小
        const BATCH_SIZE = 20;
        const filesWithLines: { path: string; size: number; lines: number | null }[] =
          files.map((f) => ({ ...f, lines: null }));

        for (let i = 0; i < filesWithLines.length; i += BATCH_SIZE) {
          const batch = filesWithLines.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map((f) =>
              this.countLinesIfTextable(
                provider,
                path.join(basePath, f.path),
                f.size,
              ),
            ),
          );
          results.forEach((r, idx) => {
            if (r.status === "fulfilled") batch[idx].lines = r.value;
          });
        }

        let output = `${filesWithLines.length} files found:`;
        for (const f of filesWithLines) {
          output += `\n${f.path} (${this.formatSize(f.size)}`;
          if (f.lines !== null) output += `, ${f.lines} lines`;
          output += ")";
        }
        if (hasMore) {
          output += `\n(More results exist. Use a more specific pattern or increase limit to see more.)`;
        }

        return output;
      },
      display: { actionType: "search", argsKey: "pattern", icon: "search" },
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
        const provider = await this.getProvider(ctx);
        return this.withFileLock(resolvedPath, async () => {
          await provider.writeFile(resolvedPath, content, { encoding });
          return `File written: ${resolvedPath} (${content.length} chars)`;
        });
      },
      display: { actionType: "write", argsKey: "file_path", icon: "edit" },
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
        const provider = await this.getProvider(ctx);
        return this.withFileLock(resolvedPath, async () => {
          if (old_text === new_text) {
            return `File ${resolvedPath} unchanged`;
          }
          const result = await provider.replaceInFile(
            resolvedPath,
            old_text,
            new_text,
            { encoding },
          );
          if (!result.matched) {
            throw new Error(`No match text found: ${old_text}`);
          }
          return `File ${resolvedPath} modified (${result.count} replacement)`;
        });
      },
      display: { actionType: "edit", argsKey: "file_path", icon: "edit" },
      dangerLevel: "high",
    });

    api.registerTool({
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
      }),
      execute: async (args, ctx) => {
        const {
          pattern,
          path: targetPath,
          max_results = 50,
        } = args;
        if (!pattern) throw new Error("pattern is required");

        const provider = await this.getProvider(ctx);
        const basePath = targetPath
          ? this.resolvePath(targetPath, ctx)
          : ctx?.session.workspacePath || process.cwd();
        const stat = await provider.stat(basePath);

        // smart-case：全小写自动不区分，含大写区分
        const result = await provider.grep(pattern, {
          path: basePath,
          maxResults: max_results,
          ignore: FilePlugin.IGNORE_PATTERNS,
        });

        if (result.length === 0) {
          return "No matches found.";
        }

        return result.join("\n");
      },
      display: { actionType: "grep", argsKey: "pattern", icon: "search" },
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

  /**
   * Serialize concurrent write operations to the same file.
   * Different files still run in parallel; only same-file writes are queued.
   */
  private withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath).replace(/\\/g, "/");
    const prev = this.fileLocks.get(key) || Promise.resolve();
    const exec = prev.then(() => fn());
    const stored = exec.then(() => {}, () => {});
    this.fileLocks.set(key, stored);
    stored.then(() => {
      if (this.fileLocks.get(key) === stored) this.fileLocks.delete(key);
    });
    return exec;
  }

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
   * 统计文件行数。通过 provider 读取（远程场景下不下载全文到本地）。
   */
  private async countLinesIfTextable(
    provider: WorkspaceProvider,
    filePath: string,
    size: number,
  ): Promise<number | null> {
    if (size > FilePlugin.MAX_LINE_COUNT_SIZE) return null;
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (FilePlugin.BINARY_EXTENSIONS.has(ext)) return null;
    try {
      const raw = (await provider.readFile(filePath)) as Buffer;
      if (!FilePlugin.TEXT_EXTENSIONS.has(ext) && raw.includes(0)) {
        return null;
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

  private validateWritePath(filePath: string, context?: PluginContext): void {
    const resolved = this.resolvePath(filePath, context);
    const extra = context?.session.workspacePath
      ? [context.session.workspacePath]
      : [];
    this.workspaceService.validateWritePath(resolved, extra);
  }
}
