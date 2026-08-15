import { Injectable, Logger } from "@nestjs/common";
import { simpleGit, SimpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { markGitRead } from "../../common/services/git-activity";

export interface GitFileChange {
  /** 相对工作目录的路径（正斜杠分隔） */
  path: string;
  /** 暂存区状态：A/M/D/R/U，"" 表示无暂存变更，"?" 表示未跟踪 */
  index: string;
  /** 工作区状态：A/M/D/R/U，"" 表示无变更，"?" 表示未跟踪 */
  workingDir: string;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitFileLinesResult {
  /** 请求行区间的内容（含行内换行的完整行文本，无行号） */
  content: string;
  /** 实际返回的行数（<= 请求行数，文件末尾不足时截断） */
  count: number;
}

export interface GitDiffResult {
  type: "diff" | "new-file";
  path: string;
  /** type=diff 时有效：统一 diff 文本 */
  diff?: string;
  /** type=new-file 时有效：未跟踪文件的完整内容 */
  content?: string;
  /**
   * 完整旧侧内容（staged diff = HEAD 版本；unstaged diff = 暂存区版本，git diff 的旧侧）。
   * 该侧不存在（新增文件）时为 ""；超体积上限时省略（undefined）→ 前端降级逐段高亮。
   */
  oldContent?: string;
  /** 完整新侧内容（staged = 暂存区版本；unstaged = 工作区版本；已删除时为 ""）。同上报体积限 */
  newContent?: string;
  /** 该文件为二进制（图片/压缩包/媒体等），不支持文本预览 */
  binary?: boolean;
}

/** 附带全文内容的体积上限（每侧）：超出则省略，前端降级为 hunk 级高亮 + gap 后端展开 */
const MAX_FULL_CONTENT_BYTES = 512 * 1024;

/** 常见二进制扩展名：命中即不预览（避免读取/展示乱码） */
const BINARY_EXTENSIONS = new Set<string>([
  // 图片
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff",
  "avif", "heic", "heif", "psd", "dds", "ktx", "pkm", "astc",
  // 字体
  "ttf", "otf", "woff", "woff2", "eot",
  // 压缩包 / 可执行 / 数据
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst",
  "exe", "dll", "so", "dylib", "bin", "dat", "iso", "img",
  // 文档 / 媒体
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "webm", "m4a",
  // 代码产物
  "class", "jar", "wasm", "pyc", "pyo", "pyd", "sqlite", "db",
]);

function isBinaryPath(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/** 二进制嗅探：前 8KB 含 NUL 字节即视为二进制（标准 heuristic） */
function hasNulByte(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

/** git 自身对已跟踪二进制文件的 diff 输出特征 */
function isBinaryDiff(diff: string): boolean {
  return diff.startsWith("Binary files") || diff.includes("GIT binary patch");
}

/**
 * 过滤目录级状态条目（不支持嵌套仓库/子目录 diff）：
 * 1. 未跟踪目录：git status 折叠为 `?? dir/`（path 带尾斜杠）——嵌入式仓库（内含 .git
 *    的独立仓库）也走这条路，diff 无法展开；
 * 2. 实际是目录的条目（gitlink/子模块注册在 index 时可能不带尾斜杠）：目录本身不可 diff。
 * 其余（含已删除文件，路径可能已不存在）保留。
 */
function isSkipStatusEntry(workspacePath: string, entryPath: string): boolean {
  if (entryPath.endsWith("/")) return true;
  try {
    return fs.statSync(path.resolve(workspacePath, entryPath)).isDirectory();
  } catch {
    return false; // 文件已删除等路径不存在的情况：不是目录，保留
  }
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  /** 每个工作目录一个 SimpleGit 实例，复用连接池 */
  private readonly gitInstances = new Map<string, SimpleGit>();

  private getGit(workspacePath: string): SimpleGit {
    let git = this.gitInstances.get(workspacePath);
    if (!git) {
      git = simpleGit({
        baseDir: workspacePath,
        binary: "git",
        maxConcurrentProcesses: 1,
      });
      this.gitInstances.set(workspacePath, git);
    }
    return git;
  }

  isGitRepo(workspacePath: string): boolean {
    // .git 可能是目录（常规仓库）或文件（worktree/submodule）
    return fs.existsSync(path.join(workspacePath, ".git"));
  }

  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    const git = this.getGit(workspacePath);
    markGitRead(); // 读命令打点：抑制 .git watcher 对本命令引发的 index 刷新噪声
    const status = await git.status();
    return {
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      files: status.files
        // 过滤目录级条目（嵌入式仓库/未跟踪目录/子模块），diff 树只保留可预览的文件
        .filter((f) => !isSkipStatusEntry(workspacePath, f.path))
        .map((f) => ({
          path: f.path,
          // simple-git 无变更时返回单个空格 " "，统一 trim 为空字符串
          index: f.index.trim(),
          workingDir: f.working_dir.trim(),
        })),
    };
  }

  async getBranches(workspacePath: string) {
    const git = this.getGit(workspacePath);
    markGitRead();
    const branches = await git.branch();
    // 只返回本地分支（远程分支 remotes/* 不参与切换）
    return branches.all
      .filter((name) => !name.startsWith("remotes/"))
      .map((name) => ({
        name,
        current: name === branches.current,
      }));
  }

  async checkout(workspacePath: string, branch: string) {
    const git = this.getGit(workspacePath);
    await git.checkout(branch);
    return { success: true, branch };
  }

  async commit(workspacePath: string, message: string, files?: string[]) {
    const git = this.getGit(workspacePath);
    if (files && files.length > 0) {
      await git.add(files);
    }
    const result = await git.commit(message);
    return {
      success: true,
      commit: result.commit,
      summary: result.summary,
      branch: result.branch,
    };
  }

  async stage(workspacePath: string, files?: string[]) {
    const git = this.getGit(workspacePath);
    if (files && files.length > 0) {
      await git.add(files);
    } else {
      // 无参数 = 暂存所有变更（含删除与新增）
      await git.add(["-A"]);
    }
    return { success: true };
  }

  async unstage(workspacePath: string, files?: string[]) {
    const git = this.getGit(workspacePath);
    if (files && files.length > 0) {
      // git reset HEAD -- <files>：将暂存区重置为 HEAD（新文件会退回未跟踪）
      await git.reset(["--", ...files]);
    } else {
      // 全部取消暂存
      await git.reset();
    }
    return { success: true };
  }

  async getDiff(
    workspacePath: string,
    filePath: string,
    cached: boolean,
  ): Promise<GitDiffResult> {
    const git = this.getGit(workspacePath);
    const absPath = path.resolve(workspacePath, filePath);

    markGitRead(); // 读命令打点（diff 会刷新 index stat 缓存 → 抑制自触发事件）
    if (cached) {
      const diff = await git.diff(["--cached", "--", filePath]);
      const binary = isBinaryPath(filePath) || isBinaryDiff(diff);
      if (binary) return { type: "diff", path: filePath, diff, binary };
      // staged diff = HEAD vs 暂存区：附带两侧全文（前端全文高亮 + gap 本地展开）
      const [oldContent, newContent] = await Promise.all([
        this.showCapped(git, `HEAD:${filePath}`),
        this.showCapped(git, `:${filePath}`),
      ]);
      return { type: "diff", path: filePath, diff, oldContent, newContent };
    }

    // 未跟踪文件（untracked）：git diff 不显示，读取内容展示为全新增
    if (fs.existsSync(absPath)) {
      const stat = await fsp.stat(absPath);
      if (!stat.isFile()) {
        throw new Error(`Not a file: ${filePath}`);
      }
      const status = await git.status();
      const entry = status.files.find((f) => f.path === filePath);
      if (entry && entry.index === "?" && entry.working_dir === "?") {
        // 先读 Buffer 嗅探二进制：utf-8 直读会把二进制内容解码成乱码替换符
        const buf = await fsp.readFile(absPath);
        const binary = isBinaryPath(filePath) || hasNulByte(buf);
        const content = binary ? undefined : buf.toString("utf-8");
        return {
          type: "new-file",
          path: filePath,
          content,
          // 全文模式字段：旧侧不存在（空串），新侧 = 工作区全文（超限省略 → 前端降级）
          oldContent: binary ? undefined : "",
          newContent:
            binary || buf.length > MAX_FULL_CONTENT_BYTES ? undefined : content,
          binary,
        };
      }
    }

    // 已跟踪文件（含工作区删除）：git diff（无参数）= 暂存区 vs 工作区，
    // 旧侧是**暂存区**版本（:path，部分暂存时 ≠ HEAD；不在暂存区时回退 HEAD）
    const diff = await git.diff(["--", filePath]);
    const binary = isBinaryPath(filePath) || isBinaryDiff(diff);
    if (binary) return { type: "diff", path: filePath, diff, binary };
    const [oldContent, newContent] = await Promise.all([
      this.showCapped(git, `:${filePath}`, `HEAD:${filePath}`),
      this.readWorkingTreeCapped(absPath),
    ]);
    return { type: "diff", path: filePath, diff, oldContent, newContent };
  }

  /**
   * git show 读取某版本全文，依次尝试多个 spec（文件在该版本不存在时尝试下一个）。
   * 全部失败（新增/删除文件缺失的一侧）→ ""；内容超体积上限 → undefined（前端降级）。
   */
  private async showCapped(
    git: SimpleGit,
    ...specs: string[]
  ): Promise<string | undefined> {
    for (const spec of specs) {
      try {
        const content = await git.show([spec]);
        return Buffer.byteLength(content, "utf-8") > MAX_FULL_CONTENT_BYTES
          ? undefined
          : content;
      } catch {
        // 文件在该版本不存在，尝试下一个 spec
      }
    }
    return "";
  }

  /** 读工作区文件全文：文件已删除 → ""；超限 → undefined（前端降级） */
  private async readWorkingTreeCapped(
    absPath: string,
  ): Promise<string | undefined> {
    try {
      const buf = await fsp.readFile(absPath);
      return buf.length > MAX_FULL_CONTENT_BYTES
        ? undefined
        : buf.toString("utf-8");
    } catch {
      return ""; // 工作区删除
    }
  }

  /**
   * 读取指定版本文件的指定行区间内容（diff hunk 之间的未修改行展开用）。
   * staged=true → 暂存区版本 `git show :path`；false → HEAD 版本 `git show HEAD:path`
   * （未暂存 diff 的 gap 是旧文件=HEAD 的行区间；若文件在 HEAD 不存在则抛错由前端兜底）。
   */
  async getFileLines(
    workspacePath: string,
    filePath: string,
    cached: boolean,
    fromLine: number,
    toLine: number,
  ): Promise<GitFileLinesResult> {
    if (!Number.isInteger(fromLine) || !Number.isInteger(toLine) || fromLine < 1 || toLine < fromLine) {
      throw new Error("Invalid line range");
    }
    // 展开一次最多 200 行，防止大区间拉爆
    const count = Math.min(toLine - fromLine + 1, 200);
    const git = this.getGit(workspacePath);
    markGitRead();
    const spec = cached ? `:${filePath}` : `HEAD:${filePath}`;
    try {
      const content = await git.show([spec]);
      const lines = content.split("\n");
      // git show 输出末尾常带一个 \n → 最后一项是空串；去掉末尾空行再切片
      if (lines[lines.length - 1] === "") lines.pop();
      const slice = lines.slice(fromLine - 1, fromLine - 1 + count);
      return { content: slice.join("\n"), count: slice.length };
    } catch (e) {
      throw new Error(`Failed to read ${filePath} (${spec}): ${(e as Error).message}`);
    }
  }
}
