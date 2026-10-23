import { Injectable, Logger } from "@nestjs/common";
import { simpleGit, SimpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { markGitRead } from "../../common/services/git-activity";
import { pathExecutableCandidates } from "../shell/windows-shell-detect";
import { runGitWithOutputCap } from "./git-command-runner";
import { parseGitStatusPorcelain } from "./git-status-parser";

export interface GitFileChange {
  /** 相对工作目录的路径（正斜杠分隔） */
  path: string;
  /** 暂存区状态：A/M/D/R/U，"" 表示无暂存变更，"?" 表示未跟踪 */
  index: string;
  /** 工作区状态：A/M/D/R/U，"" 表示无变更，"?" 表示未跟踪 */
  workingDir: string;
  /** 新增行数（tracked=HEAD vs 工作区；未跟踪=全文行数；二进制=0） */
  additions: number;
  /** 删除行数 */
  deletions: number;
}

export interface GitStatusResult {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
  /** 仅暂存区的增删行数（HEAD vs 暂存区）——提交弹窗未勾选「包含未暂存」时的提交量 */
  stagedAdditions: number;
  stagedDeletions: number;
  /** 变更条目总数（files 被上限截断时仍为真实数量） */
  totalFiles?: number;
  /** true 表示 files 不是完整列表（超大仓库降级） */
  truncated?: boolean;
  /** 未跟踪目录过大、未逐文件展开的目录（path 带尾斜杠） */
  collapsedUntrackedDirs?: string[];
  /** 降级原因：timeout / too_many_changes */
  statusError?: string;
  /** 聚合增删行数：前端顶部统计直接使用，避免遍历全部 files */
  totalAdditions?: number;
  totalDeletions?: number;
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
  /** 文件体积超限（总体积 > 2MB 或含超长行 > 4KB），拒绝预览 */
  tooLarge?: boolean;
}

/** 附带全文内容的体积上限（每侧）：超出则省略，前端降级为 hunk 级高亮 + gap 后端展开 */
const MAX_FULL_CONTENT_BYTES = 512 * 1024;
/** 未跟踪文件行数统计的体积上限（超出不计数，避免读大文件） */
const MAX_STAT_BYTES = 1024 * 1024;
/**
 * 单次 git status 返回的变更条目上限。
 * 超过后只保留前 N 条并标记 truncated：真正防 OOM 的是渲染进程，但后端也不该把
 * 数十万条对象继续往下游传（JSON 序列化/传输本身就会产生几十 MB 峰值）。
 */
const MAX_STATUS_FILES = 2000;
/** 未跟踪目录有界扫描：探测到这么多文件就判定为大目录，保持折叠 */
const UNTRACKED_SCAN_MAX_FILES = 2000;
const UNTRACKED_SCAN_MAX_DIRS = 20;
const UNTRACKED_SCAN_MAX_DEPTH = 8;
/** 未跟踪行数统计预算（对齐 ZCode）：4 个 worker、每个复用 64KB buffer */
const STAT_CHUNK_BYTES = 64 * 1024;
const STAT_CONCURRENCY = 4;
const MAX_UNTRACKED_LINE_COUNTS = 500;
/** git status/numstat 硬超时：超时后降级，避免 29s 的全量枚举拖住事件循环 */
const GIT_STATUS_TIMEOUT_MS = 15_000;
/** 折叠模式仍超限的 repo，60s 内直接返回降级，避免重复 spawn 一个必然失败的 status */
const TOO_LARGE_REPO_TTL_MS = 60_000;
/**
 * 预览总体积兜底上限（2MB）：超过则拒绝预览。多行大文件（package-lock / 大 i18n /
 * 生成的 .d.ts 等）行都很短，由 MAX_DIFF_LINES=800 + 虚拟化 + 降级高亮正常预览，
 * 此处只拦「无论如何都不可能预览」的巨型文件。
 */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
/**
 * 单行长度上限（4KB）：普通代码行 <300B，4KB 已远超任何正常行；
 * minified/打包产物/内嵌 base64 等「一行极长」文件的特征 —— 这才是拖垮
 * 高亮与 DOM 布局的真正病根（按行数/总大小都拦不住），命中即拒绝预览。
 */
const MAX_PREVIEW_LINE_BYTES = 4 * 1024;

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

/** Buffer 中是否存在超长行（按字节计，不转字符串，快路径先判总长） */
function bufferHasTooLongLine(buf: Buffer, maxBytes: number): boolean {
  if (buf.length <= maxBytes) return false;
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 10 /* \n */) {
      if (i - start > maxBytes) return true;
      start = i + 1;
    }
  }
  return false;
}

/** diff 文本中是否存在超长内容行（+/-/空格开头的行；排除 +++/---/@@ 元行） */
function diffHasTooLongLine(diff: string, maxBytes: number): boolean {
  for (const line of diff.split("\n")) {
    const c = line.charCodeAt(0);
    if (
      (c === 43 /* + */ || c === 45 /* - */ || c === 32 /* 空格 */) &&
      !line.startsWith("+++") &&
      !line.startsWith("---") &&
      !line.startsWith("@@") &&
      Buffer.byteLength(line, "utf-8") > maxBytes
    ) {
      return true;
    }
  }
  return false;
}

/**
 * PATH 上是否存在 git 可执行文件（**纯 fs，零子进程**）。
 *
 * 不能用 `execFileSync("git", ["--version"])` 探测：打包版后端由 Electron 以
 * ELECTRON_RUN_AS_NODE 启动（GUI 子系统、无控制台），子进程会新建控制台窗口——
 * 实测表现为「首次打开带 Git 标签的会话/工作目录侧边栏时闪出黑色控制台窗口」
 * （该子进程只在 `isGitAvailable()` 首次调用时出现一次，之后走缓存）。
 * Windows 侧复用 shell 探测（windows-shell-detect.ts）同款 PATH × PATHEXT 候选展开，
 * 与 simple-git 自身的 `git` 解析路径同源；POSIX 直接查 PATH 并校验可执行位。
 *
 * 代价：只能证明「git 在 PATH 上」，不能证明它能正常运行；git 存在但损坏时
 * git 接口会返回原始错误（与旧探针通过、命令失败时的行为一致）。
 */
function isGitExecutableOnPath(): boolean {
  if (process.platform === "win32") {
    return pathExecutableCandidates("git", process.env).some((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
  }
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        fs.accessSync(path.join(dir, "git"), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  /** 每个工作目录一个 SimpleGit 实例，复用连接池（diff/show/commit 等） */
  private readonly gitInstances = new Map<string, SimpleGit>();
  /** 同一 workspace 的 status 在飞请求合并（并发刷新共享一份结果） */
  private readonly statusInFlight = new Map<string, Promise<GitStatusResult>>();
  /** `-u all` 曾超限的 repoRoot：后续刷新直接走折叠模式，不再重复触发必然超限的详细命令 */
  private readonly collapsedUntrackedRepoRoots = new Set<string>();
  /** 折叠模式仍超限的 repoRoot → 过期时间与降级原因；TTL 内直接返回同一降级结果 */
  private readonly tooLargeRepoRoots = new Map<
    string,
    { until: number; reason: string }
  >();
  /** repoRoot 解析在途合并（子目录 workspace 共用同一 repo 状态） */
  private readonly repoRootInFlight = new Map<string, Promise<string>>();

  constructor() {
    // 进程级 git 策略：读命令（status/diff/show）在 stat 缓存过期时会刷新并写 .git/index，
    // 被 .git watcher 捕获后推送 → 前端刷新 → 再读命令，形成自激循环。GIT_OPTIONAL_LOCKS=0
    // 让 git 不做这类 optional 的 index 落盘，从源头断掉该循环（借鉴 ZCode：其
    // packages/services/src/git/config.ts 给每个 git 子进程都注入该变量）。
    //
    // 写在 process.env 而不是 simple-git 的 .env()：simple-git 的 block-unsafe-operations
    // 插件会扫描「显式传入的 env」，EDITOR / PAGER / GIT_PAGER / GIT_SSH_COMMAND 等键命中即
    // 抛错（Use of "EDITOR" is not permitted without enabling allowUnsafeEditor），而
    // .env(对象) 又是**整体替换**子进程环境、必须展开 process.env —— 于是所有 git 命令 500。
    // 该限制是 simple-git 自身的策略（git 本身没有，这也是 ZCode 能直接传 PAGER 的原因）；
    // 走 process.env 时 simple-git 不传 env，插件只看到空对象，不做任何检查。
    process.env.GIT_OPTIONAL_LOCKS = "0";
  }

  private getGit(workspacePath: string): SimpleGit {
    let git = this.gitInstances.get(workspacePath);
    if (!git) {
      // 不要在这里加 .env(...)：见构造函数里关于 simple-git 插件与 GIT_OPTIONAL_LOCKS 的说明
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

  private gitAvailable: boolean | null = null;

  /**
   * 探测 git 是否已安装（PATH 查找，结果缓存；见 isGitExecutableOnPath 的零子进程说明）。
   * 目录是 git 仓库但系统未装 git 时，所有 simple-git 命令都会 ENOENT 抛错 →
   * 用此标志提前降级，避免每个接口反复 500。
   */
  isGitAvailable(): boolean {
    if (this.gitAvailable !== null) return this.gitAvailable;
    this.gitAvailable = isGitExecutableOnPath();
    if (!this.gitAvailable) {
      this.logger.warn("Git is not installed in this environment — Git features degraded");
    }
    return this.gitAvailable;
  }

  async getStatus(workspacePath: string): Promise<GitStatusResult> {
    const existing = this.statusInFlight.get(workspacePath);
    if (existing) return existing;

    let request: Promise<GitStatusResult>;
    request = this.doGetStatus(workspacePath).finally(() => {
      if (this.statusInFlight.get(workspacePath) === request) {
        this.statusInFlight.delete(workspacePath);
      }
    });
    this.statusInFlight.set(workspacePath, request);
    return request;
  }

  private async doGetStatus(workspacePath: string): Promise<GitStatusResult> {
    markGitRead(); // 读命令打点：抑制 .git watcher 对本命令引发的 index 刷新噪声
    const startedAt = Date.now();
    const repoRoot = await this.resolveRepoRoot(workspacePath);

    // 折叠模式仍超限的 repo：TTL 内直接降级，避免每次刷新都重复 spawn 一个必然失败的命令。
    const tooLarge = this.tooLargeRepoRoots.get(repoRoot);
    if (tooLarge) {
      if (tooLarge.until > Date.now()) {
        return this.emptyStatusResult(tooLarge.reason);
      }
      this.tooLargeRepoRoots.delete(repoRoot);
    }

    // 先折叠未跟踪目录：超大目录只返回一条 `dir/`，避免把数万/数十万文件逐条枚举。
    // runGitWithOutputCap 在 512KB 处中途 kill，截断结果不会进入解析。
    const normalResult = await this.runStatus(workspacePath, "normal");
    if (normalResult.outputTruncated || normalResult.timedOut) {
      const reason = normalResult.timedOut ? "timeout" : "too_many_changes";
      this.tooLargeRepoRoots.set(repoRoot, {
        until: Date.now() + TOO_LARGE_REPO_TTL_MS,
        reason,
      });
      this.logger.warn(
        `git status (normal) ${
          normalResult.timedOut ? "timed out" : "exceeded output cap"
        } for ${workspacePath}; returning ${reason}`,
      );
      return this.emptyStatusResult(reason);
    }

    let parsed = parseGitStatusPorcelain(normalResult.stdout);
    let mode: "normal" | "all" = "normal";

    // 普通项目的新目录仍逐文件展示：有界扫描确认目录不大时，再跑一次 -u all。
    // all 超限/超时 → 回退 normal，并记住该 repoRoot 不再尝试 all。
    const collapsedDirs = this.collectCollapsedUntrackedDirs(parsed.entries);
    if (
      collapsedDirs.length > 0 &&
      !this.collapsedUntrackedRepoRoots.has(repoRoot) &&
      (await this.untrackedDirsAreSmall(workspacePath, collapsedDirs))
    ) {
      const allResult = await this.runStatus(workspacePath, "all");
      if (allResult.outputTruncated || allResult.timedOut) {
        this.collapsedUntrackedRepoRoots.add(repoRoot);
        this.logger.warn(
          `git status (all) ${
            allResult.timedOut ? "timed out" : "exceeded output cap"
          } for ${workspacePath}; collapsing untracked directories`,
        );
      } else {
        parsed = parseGitStatusPorcelain(allResult.stdout);
        mode = "all";
      }
    }

    const totalFiles = parsed.entries.length;
    const truncated = totalFiles > MAX_STATUS_FILES;
    const selected = truncated
      ? parsed.entries.slice(0, MAX_STATUS_FILES)
      : parsed.entries;

    const untrackedPaths = selected
      .filter((entry) => entry.isUntracked && !entry.path.endsWith("/"))
      .map((entry) => entry.path);
    const untrackedStats = await this.buildUntrackedStats(
      workspacePath,
      untrackedPaths,
    );

    // 行数统计（顶部聚合 +N -M 用）：
    // - tracked 文件：git diff HEAD --numstat -z（HEAD vs 工作区，一次命令覆盖暂存+未暂存）
    // - 未跟踪文件：直接数文件行数（ZCode 的 4×64KB 预算）
    // - 二进制（numstat 为 "-\t-"）计 0/0
    // 条目超限时跳过 numstat：继续跑只会在超大仓库上重复一次大输出。
    const numstatMap = truncated
      ? new Map<string, { add: number; del: number }>()
      : await this.readNumstatWithRunner(workspacePath, [
          "diff",
          "HEAD",
          "--numstat",
          "-z",
        ]);

    const files: GitFileChange[] = selected.map((entry) => {
      const change: GitFileChange = {
        path: entry.path,
        index: entry.index,
        workingDir: entry.workingDir,
        additions: 0,
        deletions: 0,
      };
      if (entry.isUntracked) {
        // 未跟踪：全新增，行数 = 文件行数；折叠目录条目无法统计，保持 0
        change.additions = untrackedStats.get(entry.path) ?? 0;
      } else {
        const st = numstatMap.get(entry.path);
        if (st) {
          change.additions = st.add;
          change.deletions = st.del;
        }
      }
      return change;
    });

    // 已暂存统计（提交弹窗勾选状态切换用）：git diff --cached = HEAD vs 暂存区
    let stagedAdd = 0;
    let stagedDel = 0;
    if (!truncated) {
      const stagedMap = await this.readNumstatWithRunner(workspacePath, [
        "diff",
        "--cached",
        "--numstat",
        "-z",
      ]);
      for (const st of stagedMap.values()) {
        stagedAdd += st.add;
        stagedDel += st.del;
      }
    }

    const collapsedUntrackedDirs = this.collectCollapsedUntrackedDirs(
      parsed.entries,
    );
    this.logger.debug(
      `git status ${mode} for ${workspacePath}: ${totalFiles} entries, ` +
        `${Date.now() - startedAt}ms, truncated=${truncated}, ` +
        `collapsed=${collapsedUntrackedDirs.length}`,
    );

    return {
      branch: parsed.branch,
      ahead: parsed.ahead,
      behind: parsed.behind,
      files,
      stagedAdditions: stagedAdd,
      stagedDeletions: stagedDel,
      totalFiles,
      truncated,
      ...(collapsedUntrackedDirs.length > 0
        ? { collapsedUntrackedDirs }
        : {}),
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };
  }

  /**
   * 解析真实 repoRoot，仅用于折叠/超限缓存键；git 命令仍在 workspacePath 下执行，
   * 保持「路径相对 workspace」的现有语义（子目录 workspace / monorepo）。
   */
  private async resolveRepoRoot(workspacePath: string): Promise<string> {
    const existing = this.repoRootInFlight.get(workspacePath);
    if (existing) return existing;

    let request: Promise<string>;
    request = (async () => {
      const result = await runGitWithOutputCap({
        cwd: workspacePath,
        args: ["rev-parse", "--show-toplevel"],
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      });
      if (result.outputTruncated || result.timedOut || result.exitCode !== 0) {
        return workspacePath;
      }
      const root = result.stdout.trim();
      return root ? path.resolve(root) : workspacePath;
    })().finally(() => {
      if (this.repoRootInFlight.get(workspacePath) === request) {
        this.repoRootInFlight.delete(workspacePath);
      }
    });
    this.repoRootInFlight.set(workspacePath, request);
    return request;
  }

  private runStatus(
    workspacePath: string,
    untrackedMode: "all" | "normal",
  ) {
    return runGitWithOutputCap({
      cwd: workspacePath,
      args: [
        "status",
        "--porcelain=v2",
        "--branch",
        `--untracked-files=${untrackedMode}`,
        "-z",
      ],
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
    });
  }

  private collectCollapsedUntrackedDirs(
    files: Array<{ path: string }>,
  ): string[] {
    return files.map((f) => f.path).filter((p) => p.endsWith("/"));
  }

  /**
   * 未跟踪目录是否有界可展开：最多探测 2000 个文件/20 个目录/8 层。
   * 返回 false 表示目录过大，应保持 git 的 `dir/` 折叠记录。
   */
  private async untrackedDirsAreSmall(
    workspacePath: string,
    dirs: string[],
  ): Promise<boolean> {
    if (dirs.length > UNTRACKED_SCAN_MAX_DIRS) return false;
    let remaining = UNTRACKED_SCAN_MAX_FILES;
    for (const dir of dirs) {
      const count = await this.countFilesBounded(
        path.resolve(workspacePath, dir),
        remaining,
        0,
      );
      if (count === null) return false;
      remaining -= count;
      if (remaining <= 0) return false;
    }
    return true;
  }

  /** 有界统计目录下文件数；超过 budget/深度返回 null（判定为大目录） */
  private async countFilesBounded(
    dirPath: string,
    budget: number,
    depth: number,
  ): Promise<number | null> {
    if (depth > UNTRACKED_SCAN_MAX_DEPTH) return null;
    let dir: Awaited<ReturnType<typeof fsp.opendir>> | undefined;
    let count = 0;
    try {
      dir = await fsp.opendir(dirPath);
      for await (const entry of dir) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        if (entry.isDirectory()) {
          const sub = await this.countFilesBounded(
            path.join(dirPath, entry.name),
            budget - count,
            depth + 1,
          );
          if (sub === null) return null;
          count += sub;
        } else {
          count++;
        }
        if (count >= budget) return null;
      }
      return count;
    } catch {
      return null;
    } finally {
      if (dir) {
        try {
          await dir.close();
        } catch {
          // for-await 正常结束时目录已自动关闭
        }
      }
    }
  }

  private async readNumstatWithRunner(
    cwd: string,
    args: string[],
  ): Promise<Map<string, { add: number; del: number }>> {
    const map = new Map<string, { add: number; del: number }>();
    const result = await runGitWithOutputCap({
      cwd,
      args,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
    });
    if (result.outputTruncated || result.timedOut) {
      this.logger.warn(
        `git ${args.join(" ")} ${
          result.timedOut ? "timed out" : "exceeded output cap"
        }; stats degraded`,
      );
      return map;
    }
    if (result.exitCode !== 0) return map;

    // --numstat -z：`<add>\t<del>\t<path>\0`。rename 时 path 为空，
    // 后面紧跟 oldPath\0newPath\0，统计记到 newPath。
    const tokens = result.stdout.split("\0");
    for (let i = 0; i < tokens.length; i++) {
      const match = tokens[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
      if (!match) continue;
      const stat = {
        add: match[1] === "-" ? 0 : parseInt(match[1], 10),
        del: match[2] === "-" ? 0 : parseInt(match[2], 10),
      };
      const entryPath = match[3];
      if (entryPath) {
        map.set(entryPath, stat);
      } else {
        i++; // oldPath
        const newPath = tokens[++i];
        if (newPath) map.set(newPath, stat);
      }
    }
    return map;
  }

  private emptyStatusResult(statusError: string): GitStatusResult {
    return {
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      stagedAdditions: 0,
      stagedDeletions: 0,
      totalFiles: 0,
      truncated: true,
      statusError,
    };
  }

  /**
   * 未跟踪文件行数统计（对齐 ZCode 的读取预算）：
   * - 先 stat：非普通文件或 >1MB 直接 0，不打开；
   * - 4 个 worker，各自复用 64KB buffer；
   * - 任意块含 NUL 按二进制返回 0；超过 1MB+1 字节返回 0，不返回部分计数；
   * - 只统计前 500 个文件，避免一次刷新放大成上万次读取。
   */
  private async buildUntrackedStats(
    workspacePath: string,
    paths: string[],
  ): Promise<Map<string, number>> {
    const stats = new Map<string, number>();
    const targets = paths.slice(0, MAX_UNTRACKED_LINE_COUNTS);
    if (targets.length === 0) return stats;

    let nextIndex = 0;
    const worker = async () => {
      const buffer = Buffer.allocUnsafe(STAT_CHUNK_BYTES);
      while (true) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const relPath = targets[index];
        try {
          stats.set(
            relPath,
            await this.countFileLines(
              path.resolve(workspacePath, relPath),
              buffer,
            ),
          );
        } catch {
          stats.set(relPath, 0);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(STAT_CONCURRENCY, targets.length) },
        worker,
      ),
    );
    return stats;
  }

  private async countFileLines(
    absPath: string,
    buffer: Buffer,
  ): Promise<number> {
    let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
    try {
      const info = await fsp.stat(absPath);
      if (!info.isFile() || info.size > MAX_STAT_BYTES) return 0;

      handle = await fsp.open(absPath, "r");
      let totalBytes = 0;
      let newlines = 0;
      let lastByte = 10;
      while (totalBytes <= MAX_STAT_BYTES) {
        const length = Math.min(
          buffer.length,
          MAX_STAT_BYTES + 1 - totalBytes,
        );
        const { bytesRead } = await handle.read(buffer, 0, length, null);
        if (bytesRead === 0) return newlines + (lastByte === 10 ? 0 : 1);
        totalBytes += bytesRead;
        if (totalBytes > MAX_STAT_BYTES) return 0;
        for (let i = 0; i < bytesRead; i++) {
          if (buffer[i] === 0) return 0;
          if (buffer[i] === 10) newlines++;
        }
        lastByte = buffer[bytesRead - 1];
      }
      return 0;
    } catch {
      return 0;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // ignore
        }
      }
    }
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

  /**
   * 推送当前分支到远端。
   * simple-git 无参 git.push() 在分支无上游 / 未显式指定 remote+branch 时常静默 resolve
   * 却未真正推送（"提示成功但没推"）—— 故这里显式取 remote + 当前分支，
   * 无 remote 时明确报错；无上游时用 --set-upstream 建立跟踪后推送。
   */
  async push(workspacePath: string) {
    const git = this.getGit(workspacePath);
    const remotes = await git.getRemotes();
    if (remotes.length === 0) {
      throw new Error("No remote repository configured — cannot push. Add a remote first.");
    }
    const current = (await git.branch()).current;
    if (!current) {
      throw new Error("Cannot determine current branch — nothing to push.");
    }
    // -u 建立/确认上游，确保真正推送（失败会抛错，不再静默）
    await git.push(["-u", remotes[0].name, current]);
    return { success: true, branch: current, remote: remotes[0].name };
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
      // 新侧（暂存区）体积上限检查：cat-file -s 只读大小不读内容
      // 文件超限但 diff 文本仍可提供（文件大 ≠ diff 大），保留 diff 供生成提交信息参考
      if (await this.versionTooLarge(git, `:${filePath}`)) {
        return { type: "diff", path: filePath, diff, tooLarge: true };
      }
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
      // 单文件是否未跟踪：用 ls-files 定向判断，避免为了一个文件触发全量 status
      // （超大仓库上 git.status() 会枚举数十万未跟踪文件）。
      if (!(await this.isTrackedFile(git, filePath))) {
        // 先读 Buffer 嗅探二进制：utf-8 直读会把二进制内容解码成乱码替换符
        const buf = await fsp.readFile(absPath);
        const binary = isBinaryPath(filePath) || hasNulByte(buf);
        // 体积上限：超大未跟踪文件前端不可预览，但保留截断内容供生成提交信息参考
        if (buf.length > MAX_PREVIEW_BYTES) {
          return {
            type: "new-file",
            path: filePath,
            content: binary
              ? undefined
              : buf.toString("utf-8").slice(0, MAX_FULL_CONTENT_BYTES),
            binary,
            tooLarge: true,
          };
        }
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
    // 工作区新侧体积上限检查（已删除的文件跳过——diff 只剩删除行，量小）
    // 文件超限但 diff 文本仍可提供（文件大 ≠ diff 大），保留 diff 供生成提交信息参考
    try {
      if (fs.statSync(absPath).size > MAX_PREVIEW_BYTES) {
        return { type: "diff", path: filePath, diff, tooLarge: true };
      }
    } catch {
      // 工作区已删除：不检查体积
    }
    const [oldContent, newContent] = await Promise.all([
      this.showCapped(git, `:${filePath}`, `HEAD:${filePath}`),
      this.readWorkingTreeCapped(absPath),
    ]);
    return { type: "diff", path: filePath, diff, oldContent, newContent };
  }

  /** 文件是否已被 git 跟踪（未跟踪 → ls-files --error-unmatch 退出码 1） */
  private async isTrackedFile(git: SimpleGit, filePath: string): Promise<boolean> {
    try {
      await git.raw(["ls-files", "--error-unmatch", "--", filePath]);
      return true;
    } catch {
      return false;
    }
  }

  /** 检查某版本文件是否超过预览体积上限（git cat-file -s，只读大小不读内容） */
  private async versionTooLarge(git: SimpleGit, spec: string): Promise<boolean> {
    try {
      const size = await git.raw(["cat-file", "-s", spec]);
      return parseInt(size.trim(), 10) > MAX_PREVIEW_BYTES;
    } catch {
      return false; // 该版本不存在（新增文件等）
    }
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
