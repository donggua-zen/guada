import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  ChildProcess,
  SpawnOptions,
  exec,
  execSync,
  spawn,
} from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { AsyncNotifier } from "../../common/utils/async-notifier";
import { ID_PREFIXES, mintId } from "../../common/utils/id.util";
import { safeTruncate, safeTail } from "../../common/utils/string.utils";
import {
  applyNodeShim,
  type NodeShimKind,
} from "../../common/utils/node-shim.util";
import { OutputTailer } from "./output-tailer";
import {
  envValue,
  resolveWindowsShell,
  type ShellKind,
} from "./windows-shell-detect";
import { isShellSandboxSupported } from "../../common/services/sandbox-policy";
import type { ProcessChangedEvent } from "../../common/events/stream.events";

// ============================================================================
// UTF-8 边界修剪工具
// 从任意字节偏移读取时，确保不切在多字节字符中间
// ============================================================================

/** 修剪 head buffer 末尾的不完整 UTF-8 序列 */
function trimUtf8Head(buf: Buffer): string {
  if (buf.length === 0) return "";
  for (let i = buf.length - 1; i >= 0 && i >= buf.length - 3; i--) {
    const byte = buf[i];
    if ((byte & 0xc0) !== 0x80) {
      // Start byte found
      const expectedLen =
        byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      if (i + expectedLen > buf.length) {
        return buf.toString("utf-8", 0, i);
      }
      break;
    }
  }
  return buf.toString("utf-8");
}

/** 跳过 tail buffer 开头的不完整 UTF-8 序列（连续字节） */
function trimUtf8Tail(buf: Buffer): string {
  if (buf.length === 0) return "";
  let start = 0;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return buf.toString("utf-8", start);
}

// ============================================================================
// 日志文件名
//
// 文件名只带会话与进程 ID：guada-<sessionId>-<pid>.log
// - 为什么带 sessionId：内存 entry 是唯一持有 logFilePath 的地方，进程结束约 1s 内
//   即被消费删除；文件名里带会话，UI 就能在 entry 消失后仍定位到文件（并顺带把
//   跨会话边界留在结构里，磁盘读取不放松归属校验）。
// - 为什么不带时间戳：同一 (会话, 进程 ID) 只保留最近一次运行的日志。进程 ID 是会被
//   回收的 OS PID，复用同一 ID 的新进程会覆盖上一份日志；历史运行不留档（AI 侧的
//   完成通知消息里已带输出）。
// ============================================================================

const LOG_FILE_PREFIX = "guada";
const LOG_FILE_EXT = ".log";

// ============================================================================
// 进程树回收参数
// ============================================================================

/**
 * 子进程环境里的执行标记：每次 spawn 唯一。
 *
 * 用途只有一个——Windows 终止时在 MSYS 进程表（/proc）里圈定「本次执行派生出来的进程」。
 * Git Bash 的管道成员（find / sort / head / timeout…）的 Windows ParentProcessId 指向
 * 已经退出的 fork 中转进程，taskkill /T 走不到它们；MSYS 自己的进程表是完整的，按环境标记
 * 反查是唯一不误伤无关进程的圈定方式（禁止按进程名/时间窗猜测）。
 */
export const EXEC_TOKEN_ENV = "GUADA_EXEC_TOKEN";

/** Windows：终止后迟迟收不到进程退出信号的兜底结算时限（对齐 zcode 的 FORCE_EXIT_AFTER_KILL_MS） */
const KILL_FINALIZE_MS = 5_000;
/** Windows：MSYS 侧清扫的最大轮次与轮次间隔（首轮之外再复扫，收掉下刀期间新派生的漏网） */
const WIN_SWEEP_MAX_ATTEMPTS = 3;
const WIN_SWEEP_RETRY_MS = 300;

/**
 * 运行中进程的空闲转写间隔（毫秒）。
 * 与原 SanitizerTransform 的 500ms 空闲冲刷同值：交互式命令的提示词不以 \n 结尾，
 * 不主动冲刷就永远进不了日志（AI 与 UI 都看不到）。
 */
const OUTPUT_IDLE_TICKER_MS = 500;

/**
 * 构造 MSYS 侧清扫脚本（bash）。
 *
 * 全程只用 bash 内建 + /proc 读环境，不依赖 grep/tr/awk（helper 走 --noprofile，
 * PATH 可能与 login shell 不同）：
 *   - `read -r -d ''` 按 NUL 逐个环境项比对，命中即认定属于本次执行；
 *   - 进程组取自 /proc/<pid>/pgid；
 *   - 排除 helper 自身（它不带标记，这里再兜一层）；
 *   - 末尾复核并回报 found / remaining，Node 侧据此决定是否重试。
 */
function buildMsysSweepScript(token: string): string {
  return `export PATH="/usr/bin:/bin:$PATH"
tok='${token}'
self=$$
declare -A groups=()
found=''
for d in /proc/[0-9]*; do
  p="\${d#/proc/}"
  [ "$p" = "$self" ] && continue
  [ -r "$d/environ" ] || continue
  hit=0
  while IFS= read -r -d '' kv; do
    if [ "$kv" = "${EXEC_TOKEN_ENV}=$tok" ]; then hit=1; break; fi
  done < "$d/environ" 2>/dev/null
  [ "$hit" = "1" ] || continue
  found="$found $p"
  if IFS= read -r g < "$d/pgid" 2>/dev/null; then
    [ -n "$g" ] && groups["$g"]=1
  fi
done
for g in "\${!groups[@]}"; do kill -9 -"$g" 2>/dev/null || true; done
for p in $found; do kill -9 "$p" 2>/dev/null || true; done
left="$found"
round=0
# 结算复核：Windows 上 TerminateProcess 到 /proc 消失是异步的，立即复查会把"正在退场"
# 的进程误报成残留，所以原地等一小会儿再复查（最多 3 轮，避免空转）。
while [ -n "$left" ] && [ "$round" -lt 3 ]; do
  round=$((round + 1))
  for g in "\${!groups[@]}"; do kill -9 -"$g" 2>/dev/null || true; done
  for p in $found; do kill -9 "$p" 2>/dev/null || true; done
  sleep 0.2
  left=''
  for p in $found; do [ -d "/proc/$p" ] && left="$left $p"; done
done
printf 'found:%s\\nremaining:%s\\n' "$found" "$left"
`;
}

/**
 * 解析清扫脚本的回报（MSYS pid 列表）。
 * 脚本正常跑完才会同时打印 found / remaining 两行；只拿到部分输出说明 helper 自身出错，
 * 按"未清干净"交给重试，不能当成成功。
 */
function parseMsysSweepResult(output: string): {
  ok: boolean;
  remaining: string[];
} {
  const found = /^found:(.*)$/m.exec(output);
  const remaining = /^remaining:(.*)$/m.exec(output);
  if (!found || !remaining) return { ok: false, remaining: [] };
  return {
    ok: true,
    remaining: remaining[1].trim().split(/\s+/).filter(Boolean),
  };
}

/** 日志文件名的 id 必须是安全字符（防路径穿越：这两个值都来自 URL 参数） */
function isSafeLogId(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** 构造日志文件名：guada-<sessionId>-<pid>.log */
export function buildLogFileName(
  processId: string,
  sessionId: string,
): string {
  return `${LOG_FILE_PREFIX}-${sessionId}-${processId}${LOG_FILE_EXT}`;
}

/**
 * 构造原始输出（spool）文件名：guada-<sessionId>-<tailId>.raw.log
 *
 * spool 是子进程直写的原始字节，由 OutputTailer 转写成上面那份清洗日志。
 * 它与清洗日志的命名基准不同：spool 必须在 spawn 之前就有名字（fd 要进 stdio），
 * 而清洗日志仍用子进程 pid —— 那是 UI 在 entry 消失后按 (会话, pid) 定位日志的依据。
 * 两者都以 .log 结尾，日志目录 GC 一并覆盖。
 */
export function buildRawLogFileName(tailId: string, sessionId: string): string {
  return `${LOG_FILE_PREFIX}-${sessionId}-${tailId}.raw${LOG_FILE_EXT}`;
}

// ============================================================================
// 类型定义
// ============================================================================

export type ProcessStatus = "running" | "completed" | "killed" | "error";

interface ProcessEntry {
  id: string;
  command: string;
  sessionId: string;
  childProcess: ChildProcess;
  status: ProcessStatus;
  exitCode: number | null;
  cwd: string;
  encoding: string;
  isBackgrounded: boolean;
  /** 本次执行注入子进程环境的唯一标记（见 EXEC_TOKEN_ENV） */
  execToken: string;
  /** 终止兜底结算定时器：退出信号迟到时强制收尾（见 scheduleKillFinalize） */
  killFinalizeTimer?: NodeJS.Timeout;
  /** 日志文件路径（系统临时目录）——清洗后的 UTF-8 转写，AI/UI 读的就是它 */
  logFilePath: string;
  /** 字节偏移：下次 poll 读取的起始位置 */
  readOffset: number;
  /** 输出转写器：子进程直写的 spool → 清洗后的 UTF-8 转写 */
  tailer: OutputTailer;
  /** 运行期间的空闲转写定时器（把滞留的未结束行交出去） */
  idleTimer?: NodeJS.Timeout;
  /** 无 poll 等待者时，进程结束后的异步投递 promise（poll 检测到则 await 后从队列取） */
  exitPromise?: Promise<void>;
  /** 元数据 */
  startedAt: Date;
  finishedAt?: Date;
}

export interface PollResult {
  processId: string;
  status: ProcessStatus;
  exitCode: number | null;
  /** 自上次 poll 以来的新输出（已清洗+截断后的文本） */
  output: string;
  /** 本次 poll 实际等待的毫秒数 */
  waitMs: number;
  /** 进程已运行时长（毫秒） */
  uptimeMs: number;
  /** 本次 poll 读取的输出是否发生了截断 */
  truncated?: boolean;
  /** 日志文件路径（截断时可用于提示 AI 读取完整日志） */
  logFilePath?: string;
}

export type ExecuteResult =
  | {
      kind: "completed";
      output: string;
      exitCode: number | null;
      processStatus: ProcessStatus;
      uptimeMs: number;
      waitMs: number;
      truncated?: boolean;
      logFilePath?: string;
    }
  | {
      kind: "backgrounded";
      processId: string;
      output: string;
      uptimeMs: number;
      waitMs: number;
      truncated?: boolean;
      logFilePath?: string;
    };

export interface ProcessListEntry {
  id: string;
  command: string;
  status: ProcessStatus;
  sessionId: string;
  isBackgrounded: boolean;
  startedAt: Date;
  finishedAt?: Date;
}

/**
 * UI 日志查看里的进程状态。
 * entry 已被清理时无从得知退出码/终止方式，只能报 "ended"（进程已结束）。
 */
export type ProcessLogTailStatus = ProcessStatus | "ended";

/** UI 日志查看（readLogTail）返回结构 */
export interface ProcessLogTail {
  processId: string;
  command: string;
  status: ProcessLogTailStatus;
  exitCode: number | null;
  /** 启动时刻（进程已被清理时无从得知，留空） */
  startedAt?: Date;
  finishedAt?: Date;
  /** 日志文件总字节数 */
  size: number;
  /** 本次返回是否只是日志尾部（文件大于 maxBytes） */
  truncated: boolean;
  /** 日志尾部内容（UTF-8） */
  content: string;
}

export interface SandboxOptions {
  enabled: boolean;
  readOnly: boolean;
}

// ============================================================================
// 服务
// ============================================================================

@Injectable()
export class ProcessManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessManagerService.name);
  private readonly processes = new Map<string, ProcessEntry>();
  /** 会话 → 该会话的所有进程（用于 stream.finished 时直接按会话查找） */
  private readonly sessionProcesses = new Map<
    string,
    Map<string, ProcessEntry>
  >();
  /** poll 等待者管理：wait / notify 条件变量 */
  private readonly pollNotifier = new AsyncNotifier();

  /** 小增量全读阈值（30KB）— 超过此值使用 head+tail seek */
  private readonly POLL_FULL_READ_THRESHOLD = 30_000;
  /** head+tail 截断总字节数（10KB） */
  private readonly POLL_MAX_OUTPUT_BYTES = 10_000;
  /** 截断后最大字符数 */
  private readonly MAX_CHARS = 10_000;
  /** 截断后最大行数 */
  private readonly MAX_LINES = 80;
  /** GC 最大文件年龄（10天） */
  private readonly GC_MAX_AGE_DAYS = 10;
  /** GC 扫描间隔（2小时） */
  private readonly GC_INTERVAL_MS = 2 * 60 * 60 * 1000;
  /** 日志目录名 */
  private readonly LOG_DIR_NAME = "guada-logs";
  /** sandbox 二进制路径缓存（避免每次执行都搜索） */
  private sandboxBinPath: string | null | undefined;

  /** 截断提示（追加到截断后的输出末尾） */
  private static readonly TRUNCATION_REMINDER =
    "\nThe output above was truncated due to length. The middle portion has been omitted; only the head and tail are shown.";

  private gcTimer: NodeJS.Timeout | null = null;

  /**
   * 检测出的 shell：Windows 优先 Git Bash，找不到回退 PowerShell（再回退 cmd.exe）；
   * Unix 为 sh/bash。
   */
  private shellInfo = {
    kind: "sh" as ShellKind,
    path: "" as string,
  };

  constructor(
    private readonly chatRunnerService: ChatRunnerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── 生命周期 ──

  onModuleInit() {
    this.detectShell();
    this.ensureLogDir();
    this.cleanupOldLogs();
    this.gcTimer = setInterval(
      () => this.cleanupOldLogs(),
      this.GC_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  // ── Shell 检测 ──

  /**
   * 启动时检测可用的 shell。
   * Unix：默认 sh。
   * Windows：优先 Git Bash（装了 Git for Windows 就有），否则 PowerShell，最后 cmd.exe。
   * 检测细节与优先级见 windows-shell-detect.ts（全程纯 fs 探测，零子进程，避免窗口闪现）。
   *
   * 注意：沙盒模式（read-only / workspace-write）下命令由 sandbox.exe 用其内置 shell 执行，
   * 本检测只决定非沙盒路径（danger-full-access）与交互终端使用哪个壳。
   */
  private detectShell(): void {
    if (process.platform !== "win32") {
      this.shellInfo = { kind: "sh", path: "" };
      this.logger.log("Shell detected: sh (Unix default)");
      return;
    }

    const resolved = resolveWindowsShell({ env: process.env });
    this.shellInfo = { kind: resolved.kind, path: resolved.path };

    const override = envValue(process.env, "GUADA_SHELL");
    if (override && resolved.source !== "GUADA_SHELL override") {
      this.logger.warn(
        `GUADA_SHELL is set but unusable (missing file or unrecognized shell), ignored: ${override}`,
      );
    }
    this.logger.log(`Shell detected: ${resolved.kind} (${resolved.source})`);
  }

  /** 返回检测到的 shell 的人类可读描述（供插件提示 AI） */
  getShellInfo(): string {
    switch (this.shellInfo.kind) {
      case "gitbash":
        return `Git Bash (${this.shellInfo.path})`;
      case "powershell":
        return `Windows PowerShell (${this.shellInfo.path})`;
      case "cmd":
        return "cmd.exe";
      default:
        return "sh (Unix default)";
    }
  }

  /** 当前 shell 的 kind：gitbash | powershell | cmd | sh */
  getShellKind(): ShellKind {
    return this.shellInfo.kind;
  }

  // ── 日志目录 & GC ──

  private getLogDir(): string {
    return path.join(os.tmpdir(), this.LOG_DIR_NAME);
  }

  private ensureLogDir(): void {
    const logDir = this.getLogDir();
    if (!fsSync.existsSync(logDir)) {
      fsSync.mkdirSync(logDir, { recursive: true });
    }
  }

  /** 扫描日志目录，删除超过 GC_MAX_AGE_DAYS 天的文件 */
  private async cleanupOldLogs(): Promise<void> {
    const logDir = this.getLogDir();
    try {
      const files = await fs.readdir(logDir);
      const now = Date.now();
      const maxAgeMs = this.GC_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith(".log")) continue;
        const filePath = path.join(logDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fs.unlink(filePath);
            this.logger.debug(`GC: deleted old log file ${file}`);
          }
        } catch {
          // individual file error — skip
        }
      }
    } catch {
      // dir doesn't exist or other error — ignore
    }
  }

  // ── 后台进程管理 ──

  /**
   * 创建并管理进程（内部方法）。
   *
   * 输出通道：子进程的 stdout/stderr 是**一个由父进程打开的 spool 文件 fd**（不是管道），
   * 原始字节由子进程直写；父进程按偏移把它们转写成清洗后的 UTF-8 日志（OutputTailer）。
   *
   * 为什么不用管道：管道的读端 EOF 取决于「最后一个持有写句柄的进程」——后代进程会继承它，
   * 而 Windows 上 Git Bash 的管道成员（find/sort/head…）的父链是断的、taskkill 够不到，
   * 于是 EOF 可以被拖到命令自己跑完（实测卡 1–2 分钟）。文件 fd 让「输出通道」与
   * 「命令是否结束」彻底解耦：结束只认子进程的 exit 事件。
   */
  private createProcess(
    command: string,
    cwd: string,
    encoding: string,
    sessionId: string,
    options?: { sandbox?: SandboxOptions },
  ): ProcessEntry {
    const execToken = mintId(ID_PREFIXES.execToken);
    // spool 名必须先于 spawn 确定（fd 要进 stdio）；清洗日志仍用进程 pid（见 buildRawLogFileName）
    const rawPath = path.join(
      this.getLogDir(),
      buildRawLogFileName(mintId(ID_PREFIXES.proc), sessionId),
    );
    const outFd = fsSync.openSync(rawPath, "w");

    let childProcess: ChildProcess;
    try {
      childProcess = this.spawnProcess(
        command,
        cwd,
        execToken,
        outFd,
        options?.sandbox,
      );
    } catch (err) {
      // spawn 直接抛错（沙盒缺失等）：先收回 spool 句柄与文件，不留垃圾
      try {
        fsSync.closeSync(outFd);
      } catch {
        // ignore
      }
      try {
        fsSync.rmSync(rawPath, { force: true });
      } catch {
        // ignore
      }
      throw err;
    }
    // 父进程只留读侧身份：写句柄交给子进程树（spool 由它直写）。
    // 即便如此，命令是否结束也不再取决于谁还攥着这个句柄 —— 那正是用文件替代管道的目的。
    try {
      fsSync.closeSync(outFd);
    } catch {
      // ignore
    }

    const processId = childProcess.pid?.toString() || this.generateId();
    const startedAt = new Date();
    const logFilePath = path.join(
      this.getLogDir(),
      buildLogFileName(processId, sessionId),
    );
    // 清洗日志从一开始就存在（与旧的 createWriteStream 建空文件一致）：
    // 否则命令还没输出时，UI 的日志面板会把它当成「已被清理」。
    try {
      fsSync.writeFileSync(logFilePath, "");
    } catch (err: any) {
      this.logger.warn(
        `创建日志文件失败 (${logFilePath}): ${err?.message ?? err}`,
      );
    }

    const tailer = new OutputTailer(rawPath, logFilePath, encoding, (message) =>
      this.logger.warn(message),
    );

    const entry: ProcessEntry = {
      id: processId,
      command,
      sessionId,
      childProcess,
      status: "running",
      exitCode: null,
      cwd,
      encoding,
      // 前台 poll 等待中不算后台；execute() 转后台（超时或 background=true）时置 true
      isBackgrounded: false,
      execToken,
      logFilePath,
      readOffset: 0,
      tailer,
      startedAt,
    };

    this.logger.log(
      `后台进程 ${processId} 开始，日志文件: ${logFilePath}: ${command.substring(0, 80)}`,
    );

    childProcess.on("exit", (code) => {
      // 先把 spool 里剩余字节转写完（本地 IO，必定完成），再判定终态。
      // 注意「完成」只认 exit：后代进程可能还攥着 spool 继续写，那部分输出属于后续读取
      // （readLogTail / poll 会再 pull 到），但绝不允许它们把这次调用拖住。
      entry.tailer.flushFinal();

      if (entry.status === "running") {
        this.handleProcessEnd(
          entry,
          code === 0 ? "completed" : "error",
          code ?? 1,
        );
        return;
      }
      // 手动终止（killed）：由 exit 收尾清理。不在这里投递系统消息（kill 是 AI 主动行为），
      // 也不能在 kill() 里立刻清理——entry 要留到进程真正退出，看门狗才来得及补杀残留进程组。
      if (entry.status === "killed") {
        entry.exitCode = code ?? entry.exitCode;
        this.cleanupProcess(entry.id, entry.sessionId);
      }
    });

    childProcess.on("error", (err) => {
      if (entry.status !== "running") return;
      this.logger.error(`后台进程 ${processId} 错误: ${err.message}`);
      this.handleProcessEnd(entry, "error", 1);
    });

    this.processes.set(processId, entry);
    if (!this.sessionProcesses.has(sessionId)) {
      this.sessionProcesses.set(sessionId, new Map());
    }
    this.sessionProcesses.get(sessionId)!.set(processId, entry);
    this.startIdleTicker(entry);

    this.logger.log(
      `进程已转入后台: ${processId}, 命令: ${command.substring(0, 80)}`,
    );

    return entry;
  }

  /**
   * 运行中的进程：每 OUTPUT_IDLE_TICKER_MS 追平 spool 一次，并交出滞留的未结束行。
   *
   * 对齐旧管道实现里 SanitizerTransform 的 500ms 空闲冲刷：交互式命令的提示词不以 \n 结尾，
   * 不主动冲刷就永远进不了日志（AI 与 UI 都看不到）。
   */
  private startIdleTicker(entry: ProcessEntry): void {
    if (entry.idleTimer) return;
    entry.idleTimer = setInterval(() => {
      if (entry.status !== "running") {
        this.stopIdleTicker(entry);
        return;
      }
      entry.tailer.pull();
      entry.tailer.flushIdle();
    }, OUTPUT_IDLE_TICKER_MS);
    entry.idleTimer.unref?.();
  }

  private stopIdleTicker(entry: ProcessEntry): void {
    if (!entry.idleTimer) return;
    clearInterval(entry.idleTimer);
    entry.idleTimer = undefined;
  }

  /**
   * 执行命令：前台模式阻塞等待结果，后台模式立即返回 processId。
   *
   * 前台模式（background=false，默认）：
   * - 进程在 timeout 内结束且输出未截断 → 删除日志文件
   * - 进程在 timeout 内结束但输出截断 → 保留日志文件，output 末尾追加路径提示
   * - 进程超时仍在运行 → 转入后台，返回 processId
   *
   * 后台模式（background=true）：跳过 poll，立即返回 processId。
   */
  async execute(
    command: string,
    cwd: string,
    encoding: string,
    sessionId: string,
    options: {
      timeout: number;
      abortSignal?: AbortSignal;
      sandbox?: SandboxOptions;
      background?: boolean;
    },
  ): Promise<ExecuteResult> {
    const entry = this.createProcess(
      command,
      cwd,
      encoding,
      sessionId,
      { sandbox: options.sandbox },
    );
    const processId = entry.id;
    const logFilePath = entry.logFilePath;

    // 后台模式：跳过 poll，立即返回
    if (options.background) {
      entry.isBackgrounded = true;
      this.emitProcessChanged(sessionId);
      return {
        kind: "backgrounded",
        processId,
        output: "",
        uptimeMs: Date.now() - entry.startedAt.getTime(),
        waitMs: 0,
      };
    }

    // Abort 处理
    if (options.abortSignal?.aborted) {
      this.kill(processId);
      throw new Error("Request was aborted");
    }
    const onAbort = () => this.kill(processId);
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      const pollResult = await this.poll(processId, options.timeout, sessionId);

      if (!pollResult) {
        return {
          kind: "completed",
          output: "",
          exitCode: null,
          processStatus: "error",
          uptimeMs: 0,
          waitMs: 0,
        };
      }

      // 进程在 timeout 内结束
      if (pollResult.status !== "running") {
        // 未截断的前台完成：清洗日志与 spool 都删掉（截断/后台则都保留给 AI 读）。
        // 删除是 best-effort：Windows 上残留进程还攥着 spool 时会删不掉，交给日志目录 GC。
        if (!pollResult.truncated) {
          entry.tailer.removeFiles();
        }
        return {
          kind: "completed",
          output: pollResult.output,
          exitCode: pollResult.exitCode,
          processStatus: pollResult.status,
          uptimeMs: pollResult.uptimeMs,
          waitMs: pollResult.waitMs,
          truncated: pollResult.truncated,
          logFilePath: pollResult.truncated ? logFilePath : undefined,
        };
      }

      // 超时，进程仍在运行 → 转入后台
      entry.isBackgrounded = true;
      this.emitProcessChanged(sessionId);
      return {
        kind: "backgrounded",
        processId,
        output: pollResult.output,
        uptimeMs: pollResult.uptimeMs,
        waitMs: pollResult.waitMs,
        truncated: pollResult.truncated,
        logFilePath: pollResult.truncated ? logFilePath : undefined,
      };
    } finally {
      options.abortSignal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 终止后台进程
   */
  kill(processId: string): ProcessStatus | null {
    const entry = this.processes.get(processId);
    if (!entry) return null;

    // 已在终止中但进程还没退场：允许再下一刀。
    // 若这里直接 return（旧行为），第一次没杀干净之后"再点一次终止"就是空操作，
    // 用户只能干等兜底结算，而命令还在占着机器。
    if (entry.status === "killed") {
      this.logger.log(`进程 ${processId} 已在终止中，重新下刀`);
      this.terminateTree(entry);
      this.scheduleKillFinalize(entry);
      return "killed";
    }

    if (entry.status !== "running") return entry.status;

    this.terminateTree(entry);

    entry.status = "killed";
    entry.finishedAt = new Date();

    this.pollNotifier.notify(entry.id);

    this.logger.log(`后台进程 ${processId} 已被手动终止`);

    if (!entry.childProcess.pid) {
      // 拿不到 pid（spawn 失败等）→ 没有退出信号可等，直接清理
      this.cleanupProcess(entry.id, entry.sessionId);
      return "killed";
    }
    // 有 pid 时不在 kill() 里清理 entry：留给 createProcess 的 exit 事件收尾，
    // 这样看门狗在进程真正退出前仍能补杀残留的进程组成员。
    // 同时武装兜底结算——退出信号可能一直不来（见 scheduleKillFinalize）。
    this.scheduleKillFinalize(entry);

    return "killed";
  }

  /**
   * 按平台下刀（kill 与重复终止共用）。
   *
   * Unix：整组 SIGTERM → 2s → 整组 SIGKILL（见 killUnixProcess）。
   * Windows：taskkill /F /T 可达父链 + MSYS 侧清扫（见 killWindowsProcess）。
   */
  private terminateTree(entry: ProcessEntry): void {
    const pid = entry.childProcess.pid;
    if (!pid) return;
    if (process.platform === "win32") {
      this.killWindowsProcess(pid, entry);
    } else {
      this.killUnixProcess(pid, entry);
    }
  }

  /**
   * 终止兜底结算：进程退出信号迟到或永不到来时，不让 entry 永久停在 "killed"。
   *
   * 为什么需要：killed 的 entry 由 exit 事件收尾（见 createProcess）。正常路径下 exit 紧随
   * taskkill 到来，但如果下刀本身没生效（launcher 处于僵死态、句柄被占等），entry 会一直
   * 停在「标着已终止、却还没退场」，而且 kill() 也不会再移除它——进程列表与会话归属检查
   * 就永远看不到它退场。
   *
   * 注意：结算只收登记表与 UI 通知，不等于宣称进程已死——真正的死亡判定在 exit。
   * 已完成的进程走不到这里（status 不是 killed）。
   */
  private scheduleKillFinalize(entry: ProcessEntry): void {
    if (entry.killFinalizeTimer) return;
    entry.killFinalizeTimer = setTimeout(() => {
      entry.killFinalizeTimer = undefined;
      if (entry.status !== "killed" || !this.processes.has(entry.id)) return;
      this.logger.warn(
        `进程 ${entry.id} 终止后 ${KILL_FINALIZE_MS}ms 内未收到退出信号，强制结算（下刀可能没生效）`,
      );
      this.cleanupProcess(entry.id, entry.sessionId);
    }, KILL_FINALIZE_MS);
    entry.killFinalizeTimer.unref?.();
  }

  /** 判断子进程是否已真正退出（exitCode/signalCode 产生即视为退出） */
  private isProcessExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
  }

  /**
   * Unix/Linux/macOS：终止整个进程组。
   *
   * spawnProcess 在非 Windows 平台用 detached:true 起进程，子进程即**进程组组长**，
   * 因此 `process.kill(-pid)` 能一次带走命令派生出的所有子孙进程（组杀）。
   * 只给直接子进程发信号是不够的：`npm run x` / `sh -c` 这类命令的真正工作进程是孙进程，
   * 漏掉它们就会出现「面板显示已终止、进程还在跑」。
   *
   * 升级策略：SIGTERM 整组 → 2s 后（或组长退出时立即）SIGKILL 整组 + 直接 SIGKILL 兜底。
   * 组长退出时补一次组杀，是为了处理忽略 SIGTERM 的残留组员（组长退出不代表组内清空）。
   */
  private killUnixProcess(pid: number, entry: ProcessEntry): void {
    const child = entry.childProcess;

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        // 负 PID = 向整个进程组发信号
        process.kill(-pid, signal);
      } catch {
        // ESRCH：进程组已不存在（全部退出）
      }
    };

    killGroup("SIGTERM");

    let watchdog: NodeJS.Timeout | null = null;
    const escalate = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      killGroup("SIGKILL");
      if (!this.isProcessExited(child)) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };

    watchdog = setTimeout(escalate, 2_000);
    child.once("exit", escalate);
  }

  /**
   * 异步强杀 Windows 进程树。
   *
   * 两把刀，缺一不可：
   *
   * 1. `taskkill /F /T` —— 按**活着的父子链**递归，覆盖 Git Bash 启动器 → 真 bash → fork 子壳
   *    与 conhost。退出码 0 只说明"可达链清空了"，不代表命令的管道进程已经死。
   * 2. MSYS 侧清扫 —— 命令真正的管道成员（find / sort / head / timeout…）是被短命的 fork
   *    中转进程拉起来的，Windows 记录的 ParentProcessId 指向已经退出的 PID，`/T` 走不到它们；
   *    而 MSYS 自己的进程表（/proc、进程组）是完整的，所以借一次短命 helper 按执行标记圈定
   *    本次执行派生的进程，按进程组整组下刀。
   *
   * 漏掉第 2 步的后果：命令看似"已终止"，find/sort 这类进程还在烧 CPU 与磁盘，并且继续往
   * spool 里写。完成信号已经不受它们影响（输出走文件 fd、完成认 exit），所以这一步纯粹是
   * 「让终止真的终止」，而不是为了让调用返回。
   *
   * 两把刀都是 fire-and-forget：terminate 的调用方（abort 监听、HTTP handler）不该被进程回收
   * 阻塞；清理结果由清扫自身的复核与 kill 后的兜底结算接手。
   */
  private killWindowsProcess(pid: number, entry: ProcessEntry): void {
    this.runWindowsTaskkill(pid, entry, 1);
    this.sweepMsysProcesses(entry, 1);
  }

  /** taskkill /F /T 单次执行：失败重试一次，仍失败则兜底 SIGTERM 直接子进程 */
  private runWindowsTaskkill(
    pid: number,
    entry: ProcessEntry,
    attempt: number,
  ): void {
    const child = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    const onFailure = (reason: string) => {
      if (settled) return;
      settled = true;
      // 直接子进程已经退出（taskkill 128 = 目标不存在）说明上一次下刀已经生效
      // （或进程自己结束了）—— 不在日志里制造"杀不掉"的假象。
      if (this.isProcessExited(entry.childProcess)) {
        this.logger.debug(`taskkill 结束但目标已退出 (PID ${pid}): ${reason}`);
        return;
      }
      this.logger.warn(`taskkill 第 ${attempt} 次失败 (PID ${pid}): ${reason}`);
      if (attempt < 2) {
        setTimeout(
          () => this.runWindowsTaskkill(pid, entry, attempt + 1),
          300,
        );
      } else {
        this.logger.error(`taskkill 均失败，尝试 SIGTERM (PID ${pid})`);
        try {
          entry.childProcess?.kill("SIGTERM");
        } catch {
          // 进程可能已退出
        }
      }
    };
    child.on("error", (err: any) => onFailure(err?.message ?? String(err)));
    child.on("exit", (code) => {
      if (code !== 0) onFailure(`退出码 ${code}`);
    });
  }

  /**
   * MSYS 侧清扫：把本次执行在 MSYS 进程表里派生出来的进程整组收掉。
   *
   * 做法（一次短命 helper，`--noprofile --norc` 不进 login 流程，避免 profile 开销与噪音）：
   * 扫 /proc/<pid>/environ 命中执行标记的进程 → 收集它们的进程组（去重）→ 整组 `kill -9`
   * → 再逐个 PID 兜底 → 复核并回报 remaining。
   *
   * 为什么按进程组：管道成员的 Windows 父链是断的，但 MSYS 的组关系还在；而且 coreutils
   * `timeout` 会给自己和子进程另开一组，树通常跨多个 pgid，必须全部收集。
   * 圈定只认执行标记，不做进程名/时间窗匹配（后者会误伤无关进程）。
   *
   * 组杀的退出码只作参考：实测偶发 ESRCH（组表竞态）但目标照样全灭，所以以复核回报的
   * remaining 为准；仍有残留就再扫一轮，用尽轮次后打 ERROR —— 残留进程会一直攥着 stdio
   * 句柄，不能静默吞掉。
   */
  private sweepMsysProcesses(entry: ProcessEntry, attempt: number): void {
    // 只有 Git Bash 有 MSYS 进程表（PowerShell / cmd / 沙盒路径没有这一层）
    if (this.shellInfo.kind !== "gitbash" || !this.shellInfo.path) return;
    // 标记由 mintId 铸造，这里再兜一层：脚本会把它嵌进单引号字符串
    if (!/^[A-Za-z0-9_-]+$/.test(entry.execToken)) {
      this.logger.warn(`执行标记不合法，跳过 MSYS 侧清扫: ${entry.execToken}`);
      return;
    }

    const helper = spawn(
      this.shellInfo.path,
      ["--noprofile", "--norc", "-c", buildMsysSweepScript(entry.execToken)],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );

    let output = "";
    helper.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    let settled = false;
    const finish = (reason: string | null, ok: boolean, remaining: string[]) => {
      if (settled) return;
      settled = true;

      if (ok && remaining.length === 0) {
        this.logger.log(`MSYS 侧清扫完成（第 ${attempt} 轮）: ${entry.id}`);
        return;
      }

      const detail = ok
        ? `残留 ${remaining.length} 个进程: ${remaining.join(" ")}`
        : `helper 异常: ${reason}`;
      if (attempt >= WIN_SWEEP_MAX_ATTEMPTS) {
        this.logger.error(
          `MSYS 侧清扫用尽 ${WIN_SWEEP_MAX_ATTEMPTS} 轮仍有残留（owner ${entry.id}）— ${detail}。` +
            `这些进程会继续持有 stdout/stderr 句柄，直到自行退出。`,
        );
        return;
      }
      this.logger.debug(`MSYS 侧清扫第 ${attempt} 轮未清干净，重试 — ${detail}`);
      const timer = setTimeout(
        () => this.sweepMsysProcesses(entry, attempt + 1),
        WIN_SWEEP_RETRY_MS,
      );
      timer.unref?.();
    };

    helper.on("error", (err: any) =>
      finish(err?.message ?? String(err), false, []),
    );
    helper.on("exit", () => {
      const result = parseMsysSweepResult(output);
      finish(null, result.ok, result.remaining);
    });
  }

  /**
   * 轮询后台进程状态和新输出。
   *
   * 使用字节偏移从日志文件读取增量，不缓存日志在内存中。
   * 如果 timeout > 0，则最多阻塞等待 timeout 毫秒等待新数据到来。
   */
  async poll(
    processId: string,
    timeoutMs: number = 30_000,
    sessionId?: string,
    abortSignal?: AbortSignal,
  ): Promise<PollResult | null> {
    const entry = this.processes.get(processId);
    if (!entry) {
      // entry 不存在 = 已被消费或从未创建
      return null;
    }

    // 进程已结束且 enqueue 路径在进行中 → 等它完成
    if (entry.exitPromise) {
      await entry.exitPromise;
      // enqueue 完成后 entry 可能已被 processQueue 消费删除
      if (!this.processes.has(processId)) return null;
    }

    // 进程已结束 → 先把 spool 里剩余字节转写完再读
    if (entry.status !== "running") {
      entry.tailer.pull();
      return this.buildPollResult(entry, 0);
    }

    // 进程还在跑，注册等待器（timeoutMs=0 时跳过等待）
    const waitStartedAt = Date.now();
    // abort 唤醒 poll 等待（不杀进程，进程继续后台运行）
    const onAbort = () => this.pollNotifier.notify(processId);
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (timeoutMs > 0) {
        await this.pollNotifier.wait(processId, timeoutMs);
      }
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }

    const waitSeconds = Math.round((Date.now() - waitStartedAt) / 1000);

    // 等待期间进程可能已结束 → 检查 enqueue 是否在进行
    if (entry.exitPromise) {
      await entry.exitPromise;
      if (!this.processes.has(processId)) return null;
    }

    // 进程已结束但无 enqueue 在进行 → 转写完剩余字节
    if (entry.status !== "running") {
      entry.tailer.pull();
    }

    return this.buildPollResult(entry, waitSeconds);
  }

  /**
   * 获取某个会话下的所有后台进程列表
   */
  listBySession(sessionId: string): ProcessListEntry[] {
    const result: ProcessListEntry[] = [];
    for (const entry of this.processes.values()) {
      if (entry.sessionId === sessionId) {
        result.push({
          id: entry.id,
          command: entry.command,
          status: entry.status,
          sessionId: entry.sessionId,
          isBackgrounded: entry.isBackgrounded,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
        });
      }
    }
    return result;
  }

  // ── UI 侧边栏（OverviewPanel 后台进程区块）──

  /**
   * UI 用：列出某会话当前运行中的后台进程。
   * 仅含已转后台的进程（前台 poll 等待中的命令不显示）；
   * 已结束进程由 poll 消费/系统消息投递后清理，退出即从列表消失。
   */
  listRunningBySession(sessionId: string): ProcessListEntry[] {
    const result: ProcessListEntry[] = [];
    for (const entry of this.processes.values()) {
      if (
        entry.sessionId === sessionId &&
        entry.status === "running" &&
        entry.isBackgrounded
      ) {
        result.push({
          id: entry.id,
          command: entry.command,
          status: entry.status,
          sessionId: entry.sessionId,
          isBackgrounded: entry.isBackgrounded,
          startedAt: entry.startedAt,
          finishedAt: entry.finishedAt,
        });
      }
    }
    return result;
  }

  /**
   * UI 用：校验进程归属（同一会话）后终止。返回终止后状态；null = 进程不存在或不属于该会话。
   */
  killIfOwned(
    processId: string,
    sessionId: string,
  ): ProcessStatus | null {
    const entry = this.processes.get(processId);
    if (!entry || entry.sessionId !== sessionId) {
      return null;
    }
    return this.kill(processId);
  }

  /**
   * UI 用：读取后台进程的日志尾部（UTF-8）。
   *
   * 两级读取：
   * 1. entry 还在（运行中或刚结束未被消费）→ entry 是权威状态源（含 running/exitCode）；
   *    内容仍读它记录的日志文件，文件缺失时返回空 content。
   * 2. entry 已被清理（进程结束约 1s 内即被消费删除）→ 进程一定已结束，改从磁盘读：
   *    按 (sessionId, processId) 推出文件名定位日志，返回 status="ended"；
   *    日志文件也不存在（被 GC/前台完成后删除）→ null（UI 提示"可能已被清理"）。
   *
   * 注意：同一 (sessionId, processId) 只有一个日志槽位——进程 ID 是会被回收的 OS PID，
   * 新进程复用同一 ID 时会覆盖上一份日志（历史运行不在磁盘留档）。
   */
  async readLogTail(
    processId: string,
    sessionId: string,
    maxBytes = 65_536,
  ): Promise<ProcessLogTail | null> {
    const entry = this.processes.get(processId);
    if (entry && entry.sessionId === sessionId) {
      // 读之前先追平 spool：日志面板与 AI 的 poll 都读这份清洗后的转写
      entry.tailer.pull();
      const base = {
        processId: entry.id,
        command: entry.command,
        status: entry.status as ProcessLogTailStatus,
        exitCode: entry.exitCode,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
      };
      const stat = await fs.stat(entry.logFilePath).catch(() => null);
      if (!stat) {
        // 日志文件尚未创建或已被清理（如前台完成未截断被删除）
        return { ...base, size: 0, truncated: false, content: "" };
      }
      return await this.readTailFrom(entry.logFilePath, stat.size, base, maxBytes);
    }

    // entry 已清理 → 从磁盘上的日志文件读（会话归属由文件名结构保证）
    const filePath = await this.resolveLogFileOnDisk(sessionId, processId);
    if (!filePath) return null;

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return null;

    return await this.readTailFrom(
      filePath,
      stat.size,
      {
        processId,
        // 命令/退出码/起止时间都随 entry 一起消失了：命令由前端用标签里存的那份兜底，
        // 时间字段留空（不知道就说不知道）
        command: "",
        status: "ended",
        exitCode: null,
      },
      maxBytes,
    );
  }

  /** 按已知字节数读取日志文件尾部（entry 路径与磁盘路径共用） */
  private async readTailFrom(
    filePath: string,
    fileSize: number,
    base: Omit<ProcessLogTail, "size" | "truncated" | "content">,
    maxBytes: number,
  ): Promise<ProcessLogTail> {
    const start = Math.max(0, fileSize - maxBytes);
    const len = fileSize - start;
    const buf = Buffer.alloc(len);
    const fd = await fs.open(filePath, "r");
    try {
      await fd.read(buf, 0, len, start);
    } finally {
      await fd.close();
    }

    // start > 0 时从文件中间切入，可能切在多字节字符中间 → 修剪开头不完整序列
    const content = start > 0 ? trimUtf8Tail(buf) : buf.toString("utf-8");
    return { ...base, size: fileSize, truncated: start > 0, content };
  }

  /**
   * 在日志目录里定位某个 (sessionId, processId) 的日志文件；不存在返回 null。
   * 路径由会话与进程 ID 唯一确定（见 buildLogFileName），无需扫描目录。
   */
  private async resolveLogFileOnDisk(
    sessionId: string,
    processId: string,
  ): Promise<string | null> {
    if (!isSafeLogId(sessionId) || !isSafeLogId(processId)) return null;
    const filePath = path.join(
      this.getLogDir(),
      buildLogFileName(processId, sessionId),
    );
    const stat = await fs.stat(filePath).catch(() => null);
    return stat?.isFile() ? filePath : null;
  }

  /** 通知前端后台进程列表变化（经 SSE process_changed 感知后重拉） */
  private emitProcessChanged(sessionId: string): void {
    this.eventEmitter.emit("process.changed", {
      sessionId,
      timestamp: new Date().toISOString(),
    } satisfies ProcessChangedEvent);
  }

  /**
  /**
   * 收割已完成进程的输出（不碰运行中进程的 offset）。
   * 用于拦截器等场景：只取已完成进程的剩余输出，运行中的不处理。
   *
   * entry 未被消费前一直在内存中，直接从 entry 读取即可。
   * 消息留在队列中，entry 被删除后 isValid() 返回 false，processQueue 自动丢弃。
   */
  async drainCompleted(sessionId: string): Promise<PollResult[]> {
    const results: PollResult[] = [];

    // 快照迭代：循环内 buildPollResult 会 cleanupProcess 删除 entry，
    // 且 exitPromise await 期间进程表可能被其他路径变更
    for (const entry of [...this.processes.values()]) {
      if (entry.sessionId !== sessionId) continue;
      if (entry.status === "running") continue;
      // 被主动 kill 的进程不投递（kill 是 AI 自己的动作）；entry 由 exit 事件清理
      if (entry.status === "killed") continue;

      // 进程刚结束且 enqueue 路径在进行中 → 等它完成（与 poll 一致）。
      // 否则与 enqueue 的读取竞争可能读到空输出后又清掉 entry，
      // 排队中的通知消息随即被 isValid() 判失效丢弃，输出彻底丢失。
      if (entry.exitPromise) {
        await entry.exitPromise;
        if (!this.processes.has(entry.id)) continue;
      }

      // 已完成 → 先把 spool 剩余字节转写完再读
      entry.tailer.pull();
      const result = await this.buildPollResult(entry, 0);
      results.push(result);
    }

    return results;
  }

  /**
   * 根据 ID 获取进程信息
   */
  get(processId: string): ProcessListEntry | null {
    const entry = this.processes.get(processId);
    if (!entry) return null;
    return {
      id: entry.id,
      command: entry.command,
      status: entry.status,
      sessionId: entry.sessionId,
      isBackgrounded: entry.isBackgrounded,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
    };
  }

  /**
   * 向后台进程的 stdin 写入数据
   */
  writeToStdin(processId: string, text: string): void {
    const entry = this.processes.get(processId);
    if (!entry) {
      throw new Error(`Process ${processId} does not exist`);
    }
    if (entry.status !== "running") {
      throw new Error(`Process ${processId} has ended, cannot write`);
    }
    if (!entry.childProcess.stdin) {
      throw new Error(`stdin for process ${processId} is not available`);
    }
    entry.childProcess.stdin.write(text);
  }

  // ── 内部 cleanup ──

  /** 从内存中移除进程的所有引用 */
  private cleanupProcess(processId: string, sessionId: string): void {
    const entry = this.processes.get(processId);
    if (entry?.killFinalizeTimer) {
      clearTimeout(entry.killFinalizeTimer);
      entry.killFinalizeTimer = undefined;
    }
    if (entry) this.stopIdleTicker(entry);
    this.processes.delete(processId);
    const sessionProcs = this.sessionProcesses.get(sessionId);
    if (sessionProcs) {
      sessionProcs.delete(processId);
      if (sessionProcs.size === 0) this.sessionProcesses.delete(sessionId);
    }
    // kill 等路径不经过 handleProcessEnd，统一在移除时通知 UI 刷新列表
    if (entry) this.emitProcessChanged(entry.sessionId);
  }

  /**
   * 检查沙盒二进制是否可用（供插件提前校验）
   */
  async isSandboxAvailable(): Promise<boolean> {
    if (!isShellSandboxSupported()) return false;
    const bin = await this.resolveSandboxBin();
    return bin !== null;
  }

  // ── 内部方法 ──

  private generateId(): string {
    // pid 不可得时的兜底句柄：统一铸造（proc-<uuid>），禁用手搓 Math.random
    return mintId(ID_PREFIXES.proc);
  }

  /**
   * 解析 sandbox 二进制路径（跨平台）
   *
   * Windows: sandbox.exe  |  Linux: sandbox  |  macOS: sandbox-macos-{arch}
   *
   * 开发环境：项目根目录下的 sandbox/{name}
   * 生产环境：resources/sandbox/{name}（extraResources 打包）
   *
   * 结果缓存：找到后缓存路径，找不到缓存 null 避免重复 IO。
   */
  private async resolveSandboxBin(): Promise<string | null> {
    if (this.sandboxBinPath !== undefined) return this.sandboxBinPath;

    const isWindows = process.platform === "win32";
    // macOS and Linux share the extension-less `sandbox` name in the repo layout,
    // but they are different binaries: the bare name is the Linux ELF. So macOS
    // resolves by architecture only — the bare-name fallback used to hand a Linux
    // ELF to spawn (the X_OK probe passes; only exec fails), turning "no sandbox
    // binary for this arch" into a confusing spawn error. Both architectures are
    // vendored and packaged, so the arch-suffixed name always has a hit.
    const binNames = isWindows
      ? ["sandbox.exe"]
      : process.platform === "darwin"
        ? [`sandbox-macos-${process.arch}`]
        : ["sandbox"];

    const candidates: string[] = [];
    const isElectron = process.env.ELECTRON_APP === "true";

    if (isElectron && (process as any).resourcesPath) {
      for (const binName of binNames) {
        candidates.push(
          path.join((process as any).resourcesPath, "sandbox", binName),
        );
      }
    }

    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      for (const binName of binNames) {
        candidates.push(path.join(dir, "sandbox", binName));
        candidates.push(path.join(dir, "build", "bin", binName));
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fsSync.constants.X_OK);
        this.sandboxBinPath = candidate;
        this.logger.log(`sandbox binary found at: ${candidate}`);
        return candidate;
      } catch {
        // continue
      }
    }

    this.logger.warn(
      `sandbox binary (${binNames.join(" or ")}) not found, confined sandbox modes will be unavailable`,
    );
    this.sandboxBinPath = null;
    return null;
  }

  /**
   * 命令子进程的环境：继承进程 env，并把内置 Node 的 shim 追加到 PATH 末尾
   * （没装 Node 的机器上让命令里的 `node` 回落到 app 内置的 Electron Node，见 node-shim.util.ts）。
   *
   * Git Bash 要 posix shim：bash 只按精确文件名查找，不会命中 node.cmd；
   * PowerShell / cmd 走 node.cmd（PATHEXT 命中 .CMD）。
   */
  private buildChildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const kind: NodeShimKind =
      this.shellInfo.kind === "powershell" || this.shellInfo.kind === "cmd"
        ? "win"
        : "posix";
    return applyNodeShim(
      { ...process.env, PYTHONUNBUFFERED: "1", ...extra },
      kind,
    );
  }

  /**
   * 子进程 spawn 选项（四个 spawn 分支共用）。
   *
   * Unix 下 detached=true 让子进程成为**进程组组长**（setsid）：只有这样才能在 kill 时用
   * `process.kill(-pid)` 整组终止，把命令派生出的子孙进程一起带走。不 detached 时子进程与
   * 后端同组，负 PID 指向的是「不存在的组」，只能杀掉直接子进程，命令树会残留。
   * Windows 保持不 detached：终止走 taskkill /F /T（自带进程树），detached 还会额外弹控制台。
   *
   * stdio：stdout/stderr 都指向同一个 spool fd（合并顺序即子进程真实写序），不再是管道——
   * 这样「谁继承了写句柄」不再影响父进程判断命令是否结束（见 createProcess）。
   * stdin 保持 pipe：process 工具的 write 动作依赖它。
   */
  private spawnOptions(
    cwd: string,
    env: NodeJS.ProcessEnv,
    outFd: number,
  ): SpawnOptions {
    return {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", outFd, outFd],
      ...(process.platform === "win32" ? {} : { detached: true }),
    };
  }

  /**
   * 内部 spawn：根据 sandbox 选项决定是否使用沙盒包装。
   * 沙盒启用时命令由 sandbox.exe 内部固定 shell（Windows PowerShell）执行；
   * 无 sandbox 时，Windows 使用启动时检测的 shell（Git Bash 优先 → PowerShell → cmd.exe），
   * Unix 使用默认 shell。
   * 调用前须确保 sandbox 二进制可用（isSandboxAvailable / resolveSandboxBin）。
   * outFd 是 spool 文件的写句柄（stdout/stderr 共用），由调用方负责在 spawn 后关闭自己的副本。
   */
  private spawnProcess(
    command: string,
    cwd: string,
    execToken: string,
    outFd: number,
    sandbox?: SandboxOptions,
  ): ChildProcess {
    // 平台门（纵深防御）：Windows 已停用 OS 沙盒，调用方即使传了 enabled 也不包装，
    // 由 shell 插件侧的 command-policy（只读白名单 + 审批）承担约束。
    const useSandbox = sandbox?.enabled === true && isShellSandboxSupported();
    if (sandbox?.enabled && !useSandbox) {
      this.logger.warn(
        "sandbox requested but unsupported on this platform (Windows); running in the detected shell instead",
      );
    }

    if (useSandbox) {
      const sandboxBin = this.sandboxBinPath;
      if (!sandboxBin) {
        throw new Error(
          `Sandbox mode is enabled, but the sandbox binary is currently unavailable.`,
        );
      }
      const args = ["-c", command, "--workspace", cwd];
      if (sandbox?.readOnly) {
        args.push("--read-only");
      }
      return spawn(
        sandboxBin,
        args,
        this.spawnOptions(
          cwd,
          this.buildChildEnv({ [EXEC_TOKEN_ENV]: execToken }),
          outFd,
        ),
      );
    }

    // Git Bash：-c 执行命令；-l 走 login shell 以加载 /etc/profile——
    // 没有它 PATH 里不含 /usr/bin，ls/grep/sed 这些 MSYS 工具都不可用。
    // GUADA_GIT_BASH_NO_LOGIN=1 可退回非 login（用户 profile 产生噪音时的逃生舱）。
    if (this.shellInfo.kind === "gitbash" && this.shellInfo.path) {
      const args =
        process.env.GUADA_GIT_BASH_NO_LOGIN === "1"
          ? ["-c", command]
          : ["-c", "-l", command];
      return spawn(
        this.shellInfo.path,
        args,
        this.spawnOptions(
          cwd,
          this.buildChildEnv({
            SHELL: this.shellInfo.path,
            GIT_EDITOR: "true",
            [EXEC_TOKEN_ENV]: execToken,
          }),
          outFd,
        ),
      );
    }

    // Windows 的 PowerShell（支持多行命令，与沙盒内 shell 语法一致），
    // 否则 cmd.exe 兜底；Unix 使用默认 shell
    if (this.shellInfo.kind === "powershell" && this.shellInfo.path) {
      return spawn(
        this.shellInfo.path,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        this.spawnOptions(
          cwd,
          this.buildChildEnv({ [EXEC_TOKEN_ENV]: execToken }),
          outFd,
        ),
      );
    }

    return spawn(command, [], {
      ...this.spawnOptions(
        cwd,
        this.buildChildEnv({ [EXEC_TOKEN_ENV]: execToken }),
        outFd,
      ),
      shell: true,
    });
  }

  // ── 文件读取 & 截断 ──

  /**
   * 从日志文件读取增量并截断。
   * 小增量：全读 + 行数/字符截断；大增量：head + tail seek。
   */
  private async readAndTruncate(
    logFilePath: string,
    readOffset: number,
    fileSize: number,
    increment: number,
  ): Promise<{ output: string; truncated: boolean }> {
    if (increment <= this.POLL_FULL_READ_THRESHOLD) {
      // 小增量 — 全读 + 行/字符截断
      const buf = Buffer.alloc(increment);
      const fd = await fs.open(logFilePath, "r");
      await fd.read(buf, 0, increment, readOffset);
      await fd.close();
      return this.truncateOutput(buf.toString("utf-8"));
    }

    // 大增量 — head + tail seek（必然截断）
    const headLen = Math.floor(this.POLL_MAX_OUTPUT_BYTES * 0.4);
    const tailLen = this.POLL_MAX_OUTPUT_BYTES - headLen;

    const headBuf = Buffer.alloc(headLen);
    const tailBuf = Buffer.alloc(tailLen);

    const fd = await fs.open(logFilePath, "r");
    await fd.read(headBuf, 0, headLen, readOffset);
    await fd.read(tailBuf, 0, tailLen, fileSize - tailLen);
    await fd.close();

    const head = trimUtf8Head(headBuf);
    const tail = trimUtf8Tail(tailBuf);

    return {
      output:
        head +
        `\n[...output truncated, ${increment} bytes total (offset ${readOffset} → ${fileSize}), showing ${headLen}-byte head and ${tailLen}-byte tail...]\n` +
        tail +
        ProcessManagerService.TRUNCATION_REMINDER,
      truncated: true,
    };
  }

  /**
   * 智能截断输出：字符优先（10K），再行数（80），40%+notice+60%
   */
  private truncateOutput(cleanText: string): {
    output: string;
    truncated: boolean;
  } {
    const lines = cleanText.split("\n");
    const charCount = cleanText.length;
    const lineCount = lines.length;

    if (charCount <= this.MAX_CHARS && lineCount <= this.MAX_LINES) {
      return { output: cleanText, truncated: false };
    }

    if (charCount > this.MAX_CHARS) {
      const headLen = Math.floor(this.MAX_CHARS * 0.4);
      const tailLen = this.MAX_CHARS - headLen - 100;
      const head = safeTruncate(cleanText, headLen);
      const tail = safeTail(cleanText, tailLen);
      const notice = `\n[...output truncated, ${charCount} chars total, showing head and tail...]\n`;
      return {
        output:
          head + notice + tail + ProcessManagerService.TRUNCATION_REMINDER,
        truncated: true,
      };
    }

    const headLines = Math.floor(this.MAX_LINES * 0.4);
    const tailLines = this.MAX_LINES - headLines - 3;
    const head = lines.slice(0, headLines).join("\n");
    const tail = lines.slice(lines.length - tailLines).join("\n");
    const notice = `\n[...output truncated, ${lineCount} lines total, showing head and tail...]\n`;
    return {
      output: head + notice + tail + ProcessManagerService.TRUNCATION_REMINDER,
      truncated: true,
    };
  }

  /** 读取自 readOffset 以来的增量输出（advance=true 时推进 readOffset；false 只窥视不消费） */
  private async readIncrementalOutput(
    entry: ProcessEntry,
    advance = true,
  ): Promise<{ output: string; truncated: boolean }> {
    let fileSize: number;
    try {
      const stat = await fs.stat(entry.logFilePath);
      fileSize = stat.size;
    } catch {
      return { output: "", truncated: false };
    }

    const increment = fileSize - entry.readOffset;
    if (increment <= 0) {
      return { output: "", truncated: false };
    }

    const result = await this.readAndTruncate(
      entry.logFilePath,
      entry.readOffset,
      fileSize,
      increment,
    );

    if (advance) entry.readOffset = fileSize;
    return result;
  }

  /** 构建 poll 结果（进程仍在运行时） */
  private async buildPollResult(
    entry: ProcessEntry,
    waitSeconds = 0,
  ): Promise<PollResult> {
    const { output, truncated } = await this.readIncrementalOutput(entry);

    // 进程已结束 → 立即清理（消息留在队列中，isValid 会返回 false 被 processQueue 丢弃）
    if (entry.status !== "running") {
      this.cleanupProcess(entry.id, entry.sessionId);
    }

    const end = entry.finishedAt ?? new Date();
    const uptimeMs = end.getTime() - entry.startedAt.getTime();

    return {
      processId: entry.id,
      status: entry.status,
      exitCode: entry.exitCode,
      output,
      waitMs: waitSeconds * 1000,
      uptimeMs,
      truncated,
      logFilePath: entry.logFilePath,
    };
  }

  // ── 进程结束处理 ──

  /**
   * 进程结束的统一处理：通知 poll 等待者，或投递系统消息后清理
   */
  private handleProcessEnd(
    entry: ProcessEntry,
    status: ProcessStatus,
    exitCode: number,
  ): void {
    entry.status = status;
    entry.exitCode = exitCode;
    entry.finishedAt = new Date();

    this.logger.log(`后台进程 ${entry.id} 已结束, 退出码: ${exitCode}`);
    this.emitProcessChanged(entry.sessionId);

    if (this.pollNotifier.hasWaiters(entry.id)) {
      // 有 poll 等待者 → 通知，poll 会先转写 spool 剩余字节再读取
      this.pollNotifier.notify(entry.id);
    } else {
      // 无 poll 等待者 → 异步读取剩余输出，投递系统消息，然后清理
      // 设置 exitPromise 让并发 poll 等待完成后从队列取
      entry.exitPromise = this.enqueueSystemMessageFromEntry(entry).catch(
        (err) => {
          this.logger.error(
            `Error handling exit for ${entry.id}: ${err.message}`,
          );
        },
      );
    }
  }

  /** 读取剩余输出，投递系统消息，然后清理 entry */
  private async enqueueSystemMessageFromEntry(
    entry: ProcessEntry,
  ): Promise<void> {
    // 先转写 spool 里剩余的原始输出（本地 IO，必定完成）
    entry.tailer.pull();

    // 只窥视不推进 readOffset：输出可能先被 poll / drainCompleted 消费，
    // 届时 entry 被清理、本消息经 isValid() 自动作废（不重复投递）。
    // 若此处预消费偏移，回合结束拦截器 drain 将读到空输出、判定不续跑，
    // 同时清理 entry 使本消息也被丢弃，输出彻底丢失。
    const { output, truncated } = await this.readIncrementalOutput(
      entry,
      false,
    );

    this.logger.debug(`投递进程完成通知: ${entry.id}`);
    this.chatRunnerService.enqueueMessage({
      sessionId: entry.sessionId,
      // P5b：只保留 <system_reminder> 包裹的模型面内容（用户文案已移除——
      // 展示全靠前端解析 source.kind='process_monitor' 渲染为"进程完成"通知样式）。
      // 输出长度由 readIncrementalOutput 截断 + 日志文件路径兜底。
      blocks: [
        {
          type: "text",
          text: `<system_reminder>\nBackground process \`${entry.id}\` (${entry.command}) finished with status ${entry.status}${entry.exitCode != null ? `, exit code ${entry.exitCode}` : ""}:\n${output}${truncated ? "\n(output truncated; see log file)" : ""}\nLog file: ${entry.logFilePath}\n</system_reminder>`,
        },
      ],
      // 结构化标识进 source（merge-extensible；systemPayload 已移除）
      source: {
        kind: "process_monitor",
        processId: entry.id,
        event: entry.status,
        exitCode: entry.exitCode,
      },
      isValid: () => this.processes.has(entry.id),
      onConsumed: () => this.cleanupProcess(entry.id, entry.sessionId),
    });
  }
}
