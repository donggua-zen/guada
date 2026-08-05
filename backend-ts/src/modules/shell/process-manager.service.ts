import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ChildProcess, exec, spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { AsyncNotifier } from "../../common/utils/async-notifier";
import { safeTruncate, safeTail } from "../../common/utils/string.utils";
import { SanitizerTransform } from "./stream-sanitizer";

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
// 类型定义
// ============================================================================

export type ProcessStatus = "running" | "completed" | "killed" | "error";

interface ProcessEntry {
  id: string;
  command: string;
  sessionId: string;
  userId: string;
  childProcess: ChildProcess;
  status: ProcessStatus;
  exitCode: number | null;
  cwd: string;
  encoding: string;
  isBackgrounded: boolean;
  /** 日志文件路径（系统临时目录） */
  logFilePath: string;
  /** 字节偏移：下次 poll 读取的起始位置 */
  readOffset: number;
  /** 日志写入流 */
  writeStream: fsSync.WriteStream;
  /** 最近输出的尾部（用于 stall 检测模式匹配，仅保留 500 字符） */
  recentTail: string;
  /** 进程结束时是否投递系统消息到信箱（默认 true） */
  notify: boolean;
  lastOutputAt: Date;
  /** Stall watchdog 定时器 */
  stallTimer: ReturnType<typeof setTimeout> | null;
  /** 是否已发送 stall 通知（防重复） */
  stallNotified: boolean;
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
  /** poll 因 stall 检测提前返回时为 true */
  stalled?: boolean;
  /** 本次 poll 读取的输出是否发生了截断 */
  truncated?: boolean;
}

export type ExecuteResult =
  | {
      kind: "completed";
      output: string;
      exitCode: number | null;
      processStatus: ProcessStatus;
      uptimeMs: number;
      waitMs: number;
    }
  | {
      kind: "backgrounded";
      processId: string;
      output: string;
      uptimeMs: number;
      waitMs: number;
    }
  | {
      kind: "stalled";
      processId: string;
      output: string;
      uptimeMs: number;
      waitMs: number;
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
  /** Stall watchdog 超时（45秒无输出触发检测） */
  private readonly STALL_TIMEOUT_MS = 45_000;
  /** GC 最大文件年龄（10天） */
  private readonly GC_MAX_AGE_DAYS = 10;
  /** GC 扫描间隔（2小时） */
  private readonly GC_INTERVAL_MS = 2 * 60 * 60 * 1000;
  /** 日志目录名 */
  private readonly LOG_DIR_NAME = "guada-logs";
  /** sandbox 二进制路径缓存（避免每次执行都搜索） */
  private sandboxBinPath: string | null | undefined;

  /** 交互提示符模式 — 用于判断进程是否在等待键盘输入 */
  private static readonly PROMPT_PATTERNS = [
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /\(yes\/no\)/i,
    /\[yes\/no\]/i,
    /Press (any key|Enter)/i,
    /press any key to continue/i,
    /Do you want to/i,
    /Are you sure/i,
    /Continue\?/i,
    /Confirm\?/i,
  ];

  /** 截断提示（追加到截断后的输出末尾） */
  private static readonly TRUNCATION_REMINDER =
    "\n<system_reminder>The output above was truncated due to length. The middle portion has been omitted; only the head and tail are shown.</system_reminder>";

  private gcTimer: NodeJS.Timeout | null = null;

  constructor(private readonly chatRunnerService: ChatRunnerService) {}

  // ── 生命周期 ──

  onModuleInit() {
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
   * 内部 spawn 进程，stdout/stderr 经流式清洗后写入临时文件，内存不缓存日志。
   */
  private createProcess(
    command: string,
    cwd: string,
    encoding: string,
    sessionId: string,
    userId: string,
    options?: { sandbox?: SandboxOptions },
  ): ProcessEntry {
    const childProcess = this.spawnProcess(command, cwd, options?.sandbox);
    const processId = childProcess.pid?.toString() || this.generateId();
    const logFilePath = path.join(
      this.getLogDir(),
      `guada-${processId}-${Date.now()}.log`,
    );
    const writeStream = fsSync.createWriteStream(logFilePath);

    const entry: ProcessEntry = {
      id: processId,
      command,
      sessionId,
      userId,
      childProcess,
      status: "running",
      exitCode: null,
      cwd,
      encoding,
      isBackgrounded: true,
      logFilePath,
      readOffset: 0,
      writeStream,
      recentTail: "",
      notify: true,
      lastOutputAt: new Date(),
      stallTimer: null,
      stallNotified: false,
      startedAt: new Date(),
    };

    this.logger.log(
      `后台进程 ${processId} 开始，日志文件: ${logFilePath}: ${command.substring(0, 80)}`,
    );

    // stdout/stderr → PassThrough 合流 → SanitizerTransform → writeStream
    const merger = new PassThrough();
    const sanitizerTransform = new SanitizerTransform(encoding, (cleaned) => {
      entry.recentTail = (entry.recentTail + cleaned).slice(-500);
      this.onOutput(entry);
    });
    merger.pipe(sanitizerTransform).pipe(writeStream);

    // 两个 stdio 流都结束时关闭 merger → 触发 Transform _flush → writeStream.end()
    const stdioStreamCount =
      (childProcess.stdout ? 1 : 0) + (childProcess.stderr ? 1 : 0);
    let stdioEnded = 0;
    const onStdioEnd = () => {
      if (++stdioEnded < stdioStreamCount) return;
      merger.end();
    };

    childProcess.stdout?.pipe(merger, { end: false });
    childProcess.stdout?.on("end", onStdioEnd);
    childProcess.stderr?.pipe(merger, { end: false });
    childProcess.stderr?.on("end", onStdioEnd);

    childProcess.on("close", (code) => {
      if (entry.status !== "running") return;
      this.handleProcessEnd(
        entry,
        code === 0 ? "completed" : "error",
        code ?? 1,
      );
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

    this.resetStallTimer(entry);

    this.logger.log(
      `进程已转入后台: ${processId}, 命令: ${command.substring(0, 80)}`,
    );

    return entry;
  }

  /**
   * 执行命令：前台模式阻塞等待结果，后台模式立即返回 processId。
   *
   * 前台模式（background=false，默认）：
   * - 进程在 timeout 内结束且输出未截断 → 删除日志文件
   * - 进程在 timeout 内结束但输出截断 → 保留日志文件，output 末尾追加路径提示
   * - 进程超时仍在运行 → 转入后台，返回 processId
   * - 进程 stall（等待键盘输入） → 返回 processId
   *
   * 后台模式（background=true）：跳过 poll，立即返回 processId。
   */
  async execute(
    command: string,
    cwd: string,
    encoding: string,
    sessionId: string,
    userId: string,
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
      userId,
      { sandbox: options.sandbox },
    );
    const processId = entry.id;
    const logFilePath = entry.logFilePath;

    // 后台模式：跳过 poll，立即返回
    if (options.background) {
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
      const pollResult = await this.poll(
        processId,
        options.timeout,
        sessionId,
      );

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
        if (!pollResult.truncated && logFilePath) {
          await fs.unlink(logFilePath).catch(() => {});
        } else if (pollResult.truncated && logFilePath) {
          pollResult.output += `\n[Note: Output was truncated. The complete log is saved at: ${logFilePath}. You can read it using the run_command tool if needed.]`;
        }
        return {
          kind: "completed",
          output: pollResult.output,
          exitCode: pollResult.exitCode,
          processStatus: pollResult.status,
          uptimeMs: pollResult.uptimeMs,
          waitMs: pollResult.waitMs,
        };
      }

      // Stall 检测
      if (pollResult.stalled) {
        return {
          kind: "stalled",
          processId,
          output: pollResult.output,
          uptimeMs: pollResult.uptimeMs,
          waitMs: pollResult.waitMs,
        };
      }

      // 超时，进程仍在运行 → 转入后台
      return {
        kind: "backgrounded",
        processId,
        output: pollResult.output,
        uptimeMs: pollResult.uptimeMs,
        waitMs: pollResult.waitMs,
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

    if (entry.status !== "running") return entry.status;

    const isWindows = process.platform === "win32";
    if (isWindows) {
      const pid = entry.childProcess.pid;
      if (pid) {
        exec(`taskkill /F /T /PID ${pid}`, (err) => {
          if (err) this.logger.warn(`taskkill 失败: ${err.message}`);
        });
      }
    } else {
      entry.childProcess.kill("SIGTERM");
      setTimeout(() => {
        if (!entry.childProcess.killed) entry.childProcess.kill("SIGKILL");
      }, 2000);
    }

    entry.status = "killed";
    entry.finishedAt = new Date();

    this.clearStallWatchdog(entry);
    this.pollNotifier.notify(entry.id);

    this.logger.log(`后台进程 ${processId} 已被手动终止`);

    // kill 是 AI 主动行为，立即清理 entry（不投递系统消息）
    this.cleanupProcess(entry.id, entry.sessionId);

    return "killed";
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
    // 0 = 立即返回（不等待），用于拦截器等内部非阻塞场景
    // Agent 调用时的最小值限制由插件入口处理

    const entry = this.processes.get(processId);
    if (!entry) {
      return this.pollFromQueue(processId, sessionId);
    }

    // 进程已结束且 enqueue 路径在进行中 → 等它完成后从队列取
    if (entry.exitPromise) {
      await entry.exitPromise;
      return this.pollFromQueue(processId, sessionId);
    }

    // 进程已结束 → 确保日志落盘后读取
    if (entry.status !== "running") {
      await finished(entry.writeStream).catch(() => {});
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
      return this.pollFromQueue(processId, sessionId);
    }

    // 进程已结束但无 enqueue 在进行 → 确保日志落盘
    if (entry.status !== "running") {
      await finished(entry.writeStream).catch(() => {});
    }

    const result = await this.buildPollResult(entry, waitSeconds);
    if (entry.stallNotified) {
      result.stalled = true;
    }
    return result;
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
    this.processes.delete(processId);
    const sessionProcs = this.sessionProcesses.get(sessionId);
    if (sessionProcs) {
      sessionProcs.delete(processId);
      if (sessionProcs.size === 0) this.sessionProcesses.delete(sessionId);
    }
  }

  /**
   * 检查沙盒二进制是否可用（供插件提前校验）
   */
  async isSandboxAvailable(): Promise<boolean> {
    const bin = await this.resolveSandboxBin();
    return bin !== null;
  }

  // ── 内部方法 ──

  private generateId(): string {
    return `p${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 解析 sandbox 二进制路径（跨平台）
   *
   * Windows: sandbox.exe  |  Linux: sandbox
   *
   * 开发环境：项目根目录下的 sandbox/{name}
   * 生产环境：resources/sandbox/{name}（extraResources 打包）
   *
   * 结果缓存：找到后缓存路径，找不到缓存 null 避免重复 IO。
   */
  private async resolveSandboxBin(): Promise<string | null> {
    if (this.sandboxBinPath !== undefined) return this.sandboxBinPath;

    const isWindows = process.platform === "win32";
    const binName = isWindows ? "sandbox.exe" : "sandbox";

    const candidates: string[] = [];
    const isElectron = process.env.ELECTRON_APP === "true";

    if (isElectron && (process as any).resourcesPath) {
      candidates.push(
        path.join((process as any).resourcesPath, "sandbox", binName),
      );
    }

    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      candidates.push(path.join(dir, "sandbox", binName));
      candidates.push(path.join(dir, "build", "bin", binName));
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
      `sandbox binary (${binName}) not found, sandbox/plan mode will be unavailable`,
    );
    this.sandboxBinPath = null;
    return null;
  }

  /**
   * 内部 spawn：根据 sandbox 选项决定是否使用沙盒包装。
   * 无 sandbox 时直接将命令字符串交给 OS shell（shell: true）。
   * 调用前须确保 sandbox 二进制可用（isSandboxAvailable / resolveSandboxBin）。
   */
  private spawnProcess(
    command: string,
    cwd: string,
    sandbox?: SandboxOptions,
  ): ChildProcess {
    if (sandbox?.enabled) {
      if (!this.sandboxBinPath) {
        throw new Error(
          `Sandbox mode is enabled, but the sandbox binary is currently unavailable.`,
        );
      }
      const args = ["-c", command, "--workspace", cwd];
      if (sandbox.readOnly) {
        args.push("--read-only");
      }
      return spawn(this.sandboxBinPath, args, {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    }

    // 直接将完整命令字符串交给 OS shell 处理（shell: true）
    return spawn(command, [], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      shell: true,
    });
  }

  /** 有输出时的处理：更新最后输出时间 + 重置 stall 状态 + 重启看门狗 */
  private onOutput(entry: ProcessEntry): void {
    entry.lastOutputAt = new Date();
    if (entry.stallNotified) {
      entry.stallNotified = false;
      this.removeStallNotification(entry);
    }
    this.resetStallTimer(entry);
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
        output: head + notice + tail + ProcessManagerService.TRUNCATION_REMINDER,
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

  /** 读取自 readOffset 以来的增量输出（更新 readOffset） */
  private async readIncrementalOutput(
    entry: ProcessEntry,
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

    entry.readOffset = fileSize;
    return result;
  }

  /** 构建 poll 结果（进程仍在运行时） */
  private async buildPollResult(
    entry: ProcessEntry,
    waitSeconds = 0,
  ): Promise<PollResult> {
    const { output, truncated } = await this.readIncrementalOutput(entry);

    // AI poll 接收了消息 → 从信箱撤回
    this.chatRunnerService.peekQueuedMessage(
      entry.sessionId,
      (item) => item.source?.processId === entry.id,
    );

    // 进程已结束 → 立即清理
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
    };
  }

  /** 从消息队列获取已清理进程的 poll 结果 */
  private pollFromQueue(
    processId: string,
    sessionId?: string,
  ): PollResult | null {
    if (!sessionId) return null;

    const removed = this.chatRunnerService.peekQueuedMessage(
      sessionId,
      (item) => item.source?.processId === processId,
    );
    if (removed.length === 0) return null;

    const payload =
      removed[removed.length - 1].source?.systemPayload?.[0];
    if (!payload) return null;

    return {
      processId: payload.processId,
      status: payload.status,
      exitCode: payload.exitCode,
      output: payload.output || "",
      waitMs: 0,
      uptimeMs: 0,
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

    this.clearStallWatchdog(entry);
    this.logger.log(`后台进程 ${entry.id} 已结束, 退出码: ${exitCode}`);

    if (this.pollNotifier.hasWaiters(entry.id)) {
      // 有 poll 等待者 → 通知，poll 会 await finished(writeStream) 后读取
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
    // 确保日志全部落盘
    await finished(entry.writeStream).catch(() => {});

    // 读取剩余增量
    const { output } = await this.readIncrementalOutput(entry);

    if (!entry.notify) {
      this.cleanupProcess(entry.id, entry.sessionId);
      return;
    }

    const content = `[系统通知] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 已${entry.status === "completed" ? `执行结束，退出码 ${entry.exitCode}` : entry.status === "error" ? `异常退出，退出码 ${entry.exitCode}` : "被终止"}`;

    this.logger.debug(`投递系统消息: ${content}`);
    this.chatRunnerService.enqueueMessage({
      sessionId: entry.sessionId,
      userId: entry.userId,
      content,
      source: {
        type: "process_monitor",
        processId: entry.id,
        event: entry.status,
        systemPayload: [
          {
            processId: entry.id,
            command: entry.command,
            status: entry.status,
            exitCode: entry.exitCode,
            output,
          },
        ],
      },
    });

    // 投递后立即清理（poll 会从消息队列获取）
    this.cleanupProcess(entry.id, entry.sessionId);
  }

  // ── Stall Watchdog ──

  /** 清理 stall watchdog（定时器 + 通知撤回） */
  private clearStallWatchdog(entry: ProcessEntry): void {
    if (entry.stallTimer) {
      clearTimeout(entry.stallTimer);
      entry.stallTimer = null;
    }
    entry.stallNotified = false;
    this.removeStallNotification(entry);
  }

  /** 重置 stall watchdog 定时器（每次有新输出时调用） */
  private resetStallTimer(entry: ProcessEntry): void {
    if (entry.stallTimer) {
      clearTimeout(entry.stallTimer);
    }
    entry.stallTimer = setTimeout(() => {
      entry.stallTimer = null;
      this.checkStall(entry);
    }, this.STALL_TIMEOUT_MS);
  }

  /**
   * Stall 检测：输出停止 45 秒 + 尾部匹配交互提示符
   * - 前台（有 poll 等待者）→ notify 唤醒 poll 提前返回
   * - 后台（无 poll 等待者）→ 入队 stall 通知（含当前未读输出）
   */
  private checkStall(entry: ProcessEntry): void {
    if (entry.status !== "running") return;
    if (entry.stallNotified) return;

    const tail = entry.recentTail;
    if (!tail.trim()) return;

    const isPrompt = ProcessManagerService.PROMPT_PATTERNS.some((pattern) =>
      pattern.test(tail),
    );
    if (!isPrompt) return;

    entry.stallNotified = true;
    this.logger.log(
      `Stall detected: process ${entry.id} appears to be waiting for keyboard input`,
    );

    if (this.pollNotifier.hasWaiters(entry.id)) {
      this.pollNotifier.notify(entry.id);
    } else {
      this.enqueueStallNotification(entry).catch((err) => {
        this.logger.error(
          `Error enqueuing stall notification: ${err.message}`,
        );
      });
    }
  }

  /** 投递 stall 通知到会话队列（含当前未读输出） */
  private async enqueueStallNotification(
    entry: ProcessEntry,
  ): Promise<void> {
    if (!entry.notify) return;

    const { output } = await this.readIncrementalOutput(entry);

    const content = `[交互提示] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 似乎在等待键盘输入`;

    this.chatRunnerService.enqueueMessage({
      sessionId: entry.sessionId,
      userId: entry.userId,
      content,
      source: {
        type: "process_monitor",
        processId: entry.id,
        event: "stall_detected",
        systemPayload: [
          {
            processId: entry.id,
            command: entry.command,
            status: "running",
            stalled: true,
            output,
            message:
              'The process appears to be waiting for keyboard input. Use the process tool with action "write" to send input, or action "kill" to terminate. If this is a false positive, simply ignore this message.',
          },
        ],
      },
    });
  }

  /** 从会话队列中移除指定进程的 stall 通知（去重） */
  private removeStallNotification(entry: ProcessEntry): void {
    this.chatRunnerService.peekQueuedMessage(
      entry.sessionId,
      (item) =>
        item.source?.processId === entry.id &&
        item.source?.event === "stall_detected",
    );
  }
}
