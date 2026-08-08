import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as parcelWatcher from "@parcel/watcher";
import fg from "fast-glob";
import {
  WorkspaceProvider,
  FileStat,
  DirEntry,
  FileChangeEvent,
  WatchOptions,
  ExecuteOptions,
  ReplaceResult,
} from "./workspace-provider.interface";
import {
  ExecuteResult,
  PollResult,
  ProcessListEntry,
  ProcessStatus,
  ProcessManagerService,
} from "../../modules/shell/process-manager.service";
import { safeSubstring } from "../utils/string.utils";

// Ignore patterns reused from file.plugin.ts
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/coverage/**",
];

const IGNORE_GLOBS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".venv",
  "__pycache__",
];

/**
 * LocalWorkspaceProvider — wraps native fs.* / @parcel/watcher / ProcessManagerService.
 *
 * This is the default provider for all sessions whose workspacePath does not
 * start with a remote scheme prefix (e.g. `ssh://`).
 *
 * No connection management needed — connect()/disconnect() are no-ops.
 */
@Injectable()
export class LocalWorkspaceProvider implements WorkspaceProvider {
  private readonly logger = new Logger(LocalWorkspaceProvider.name);
  readonly scheme = "local";

  // For process execution delegation
  private processManager: ProcessManagerService | null = null;

  /** Inject ProcessManagerService lazily (circular dep avoidance) */
  setProcessManager(pm: ProcessManagerService): void {
    this.processManager = pm;
  }

  async connect(): Promise<void> {
    // No-op — local filesystem needs no connection
  }

  async disconnect(): Promise<void> {
    // No-op
  }

  // ── File operations ──

  async readFile(
    filePath: string,
    opts?: { encoding?: string },
  ): Promise<string | Buffer> {
    // 未指定 encoding → 返回 Buffer（countLinesIfTextable 等需要原始字节做 NUL 探测）
    if (opts?.encoding) {
      return fs.readFile(filePath, { encoding: opts.encoding as BufferEncoding });
    }
    return fs.readFile(filePath);
  }

  async readFileRange(
    filePath: string,
    offset: number,
    length: number,
  ): Promise<Buffer> {
    const buf = Buffer.alloc(length);
    if (length === 0) return buf;
    const fd = await fs.open(filePath, "r");
    try {
      await fd.read(buf, 0, length, offset);
    } finally {
      await fd.close();
    }
    return buf;
  }

  async writeFile(
    filePath: string,
    content: string | Buffer,
    opts?: { encoding?: string },
  ): Promise<void> {
    const encoding = (opts?.encoding || "utf-8") as BufferEncoding;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, { encoding });
  }

  async stat(filePath: string): Promise<FileStat> {
    const s = await fs.stat(filePath);
    return {
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      size: s.size,
      mtime: s.mtime,
    };
  }

  async readdir(dirPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result: DirEntry[] = [];
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      let size = 0;
      let mtime = new Date(0);
      try {
        const s = await fs.stat(path.join(dirPath, entry.name));
        size = s.size;
        mtime = s.mtime;
      } catch {
        // stat failed — still include the entry with zeroed metadata
      }
      result.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size,
        mtime,
      });
    }
    // Sort: directories first, then alphabetical
    result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async mkdir(
    dirPath: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    await fs.mkdir(dirPath, { recursive: opts?.recursive ?? true });
  }

  async unlink(
    targetPath: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    await fs.rm(targetPath, {
      recursive: opts?.recursive ?? true,
      force: true,
    });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }

  async replaceInFile(
    filePath: string,
    oldText: string,
    newText: string,
    opts?: { encoding?: string },
  ): Promise<ReplaceResult> {
    const encoding = (opts?.encoding || "utf-8") as BufferEncoding;
    const content = await fs.readFile(filePath, { encoding });

    // Normalize CRLF → LF for matching, then restore original line-ending style
    const normContent = content.replace(/\r\n/g, "\n");
    const normOld = oldText.replace(/\r\n/g, "\n");
    const idx = normContent.indexOf(normOld);
    if (idx === -1) {
      return { matched: false, count: 0 };
    }

    const hasCRLF = content.includes("\r\n");
    const normResult = normContent.replace(normOld, newText);
    const modified = hasCRLF
      ? normResult.replace(/\n/g, "\r\n")
      : normResult;

    await fs.writeFile(filePath, modified, { encoding });
    return { matched: true, count: 1 };
  }

  // ── Search ──

  async glob(
    pattern: string,
    opts: { cwd: string; ignore?: string[]; limit?: number; deep?: number },
  ): Promise<{ path: string; size: number }[]> {
    const { cwd, limit = 100 } = opts;
    const stream = fg.stream(pattern, {
      cwd,
      deep: opts.deep,
      onlyFiles: true,
      dot: false,
      absolute: false,
      stats: true,
      ignore: opts.ignore || IGNORE_PATTERNS,
    });

    const files: { path: string; size: number }[] = [];
    for await (const entry of stream) {
      if (files.length >= limit) break;
      if (typeof entry === "string") {
        files.push({ path: entry, size: 0 });
      } else {
        const e = entry as unknown as {
          path: string;
          stats?: { size: number };
        };
        files.push({ path: e.path, size: e.stats?.size ?? 0 });
      }
    }
    return files;
  }

  async grep(
    pattern: string,
    opts: { path: string; maxResults?: number; ignore?: string[] },
  ): Promise<string[]> {
    const { maxResults = 50 } = opts;
    const basePath = opts.path;

    const stat = await fs.stat(basePath);

    const files: string[] = [];
    if (stat.isFile()) {
      files.push(basePath);
    } else if (stat.isDirectory()) {
      const entries = await fg("**/*", {
        cwd: basePath,
        onlyFiles: true,
        dot: false,
        ignore: opts.ignore || IGNORE_PATTERNS,
      });
      files.push(...entries.map((e) => path.join(basePath, e)));
    }

    // smart-case: all-lowercase = case-insensitive, else case-sensitive
    const flags = pattern === pattern.toLowerCase() ? "gi" : "g";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }

    const relativeRoot = stat.isFile() ? path.dirname(basePath) : basePath;
    const outputLines: string[] = [];
    let total = 0;
    const BATCH_SIZE = 20;

    for (let i = 0; i < files.length && total < maxResults; i += BATCH_SIZE) {
      const batch = files.slice(i, Math.min(i + BATCH_SIZE, files.length));
      const results = await Promise.allSettled(
        batch.map((fp) =>
          this.grepInFile(fp, regex, relativeRoot, maxResults - total),
        ),
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          outputLines.push(...result.value.lines);
          total += result.value.count;
          if (total >= maxResults) break;
        }
      }
    }

    return outputLines;
  }

  // ── File watching ──

  watch(
    paths: string[],
    opts: WatchOptions,
    callback: (event: FileChangeEvent) => void,
  ): () => void {
    const ignoreGlobs = (opts.ignore || IGNORE_GLOBS).map(
      (g) => `**/${g}/**`,
    );

    const subscriptions: parcelWatcher.AsyncSubscription[] = [];
    let disposed = false;

    for (const watchPath of paths) {
      if (!fsSync.existsSync(watchPath)) continue;

      parcelWatcher
        .subscribe(
          watchPath,
          (error, events) => {
            if (error || disposed) return;
            for (const ev of events) {
              const absPath = path.resolve(ev.path);
              const relativePath = path.relative(watchPath, absPath);
              if (
                !relativePath ||
                relativePath === ".." ||
                relativePath.startsWith(`..${path.sep}`)
              ) {
                continue;
              }
              let type: FileChangeEvent["type"];
              if (ev.type === "create") {
                try {
                  type = fsSync.statSync(absPath).isDirectory()
                    ? "addDir"
                    : "add";
                } catch {
                  continue; // created then deleted instantly
                }
              } else if (ev.type === "update") {
                type = "change";
              } else {
                type = "unlink";
              }
              callback({
                type,
                path: relativePath.replace(/\\/g, "/"),
              });
            }
          },
          { ignore: ignoreGlobs },
        )
        .then((sub) => {
          if (disposed) {
            sub.unsubscribe().catch(() => {});
          } else {
            subscriptions.push(sub);
          }
        })
        .catch((err) => {
          this.logger.warn(
            `Failed to subscribe watcher for ${watchPath}: ${String(err)}`,
          );
        });
    }

    return () => {
      disposed = true;
      for (const sub of subscriptions) {
        sub.unsubscribe().catch(() => {});
      }
    };
  }

  // ── Process execution (delegates to ProcessManagerService) ──

  async execute(
    command: string,
    cwd: string,
    opts: ExecuteOptions,
  ): Promise<ExecuteResult> {
    if (!this.processManager) {
      throw new Error("ProcessManagerService not attached to LocalWorkspaceProvider");
    }
    return this.processManager.execute(
      command,
      cwd,
      "utf-8",
      opts.sessionId || "",
      opts.userId || "",
      {
        timeout: opts.timeout,
        abortSignal: opts.abortSignal,
        sandbox: opts.sandbox,
        background: opts.background,
      },
    );
  }

  async poll(
    processId: string,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<PollResult | null> {
    if (!this.processManager) {
      throw new Error("ProcessManagerService not attached to LocalWorkspaceProvider");
    }
    return this.processManager.poll(processId, timeoutMs, undefined, abortSignal);
  }

  writeToStdin(processId: string, text: string): void {
    if (!this.processManager) {
      throw new Error("ProcessManagerService not attached to LocalWorkspaceProvider");
    }
    this.processManager.writeToStdin(processId, text);
  }

  kill(processId: string): ProcessStatus | null {
    if (!this.processManager) {
      throw new Error("ProcessManagerService not attached to LocalWorkspaceProvider");
    }
    return this.processManager.kill(processId);
  }

  listBySession(sessionId: string): ProcessListEntry[] {
    if (!this.processManager) return [];
    return this.processManager.listBySession(sessionId);
  }

  async drainCompleted(sessionId: string): Promise<PollResult[]> {
    if (!this.processManager) return [];
    return this.processManager.drainCompleted(sessionId);
  }

  // ── Internal: grep helper (extracted from file.plugin.ts) ──

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

  private findEnclosingFunction(
    lines: string[],
    lineIndex: number,
  ): string | null {
    const patterns: RegExp[] = [
      /\bfunction\s+(\w+)\s*\(/,
      /\bclass\s+(\w+)\b/,
      /\bdef\s+(\w+)\s*\(/,
      /\bfn\s+(\w+)\s*\(/,
      /\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/,
      /\b(?:impl|struct|enum|trait|interface)\s+(\w+)\b/,
      /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/,
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
