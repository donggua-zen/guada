import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as iconv from "iconv-lite";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { AsyncNotifier } from "../../common/utils/async-notifier";

// ============================================================================
// 类型定义
// ============================================================================

export type ProcessStatus = "running" | "completed" | "killed" | "error";

export interface ProcessEntry {
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
  /** 完整的累积日志（最大 1MB，超出保留末尾） */
  fullLog: string;
  /** 最近 stdout 行（最多 50 行，poll 后清空） */
  recentStdout: string[];
  /** 最近 stderr 行（最多 50 行，poll 后清空） */
  recentStderr: string[];
  /** 进度通知间隔（分钟），0=关闭 */
  progressIntervalMinutes: number;
  lastOutputAt: Date;
  progressTimer: ReturnType<typeof setInterval> | null;
  /** 延迟清理定时器 */
  cleanupTimer: NodeJS.Timeout | null;
  /** 元数据 */
  startedAt: Date;
  finishedAt?: Date;
}

export interface PollResult {
  processId: string;
  status: ProcessStatus;
  exitCode: number | null;
  /** 自上次 poll 以来的新 stdout（最多 50 行） */
  newStdout: string[];
  /** 自上次 poll 以来的新 stderr（最多 50 行） */
  newStderr: string[];
  /** 本次 poll 实际等待的秒数（0=未等待） */
  waitSeconds: number;
}

export interface BackgroundResult {
  processId: string;
  status: "backgrounded";
  /** 转入后台时截取的 stdout 行（最多 50 行） */
  stdout: string[];
  /** 转入后台时截取的 stderr 行（最多 50 行） */
  stderr: string[];
}

export interface ProcessListEntry {
  id: string;
  command: string;
  status: ProcessStatus;
  sessionId: string;
  isBackgrounded: boolean;
  startedAt: Date;
  finishedAt?: Date;
  progressIntervalMinutes: number;
}

// ============================================================================
// 服务
// ============================================================================

@Injectable()
export class ProcessManagerService {
  private readonly logger = new Logger(ProcessManagerService.name);
  private readonly processes = new Map<string, ProcessEntry>();
  /** 会话 → 该会话的所有进程（用于 stream.finished 时直接按会话查找） */
  private readonly sessionProcesses = new Map<
    string,
    Map<string, ProcessEntry>
  >();
  /** poll 等待者管理：wait / notify 条件变量 */
  private readonly pollNotifier = new AsyncNotifier();

  /** 最近输出最大行数 */
  private readonly MAX_RECENT_LINES = 50;
  /** 完整日志缓冲区最大值（1MB） */
  private readonly MAX_BUFFER_BYTES = 1024 * 1024;
  /** 进程结束后延迟清理时间（10分钟） */
  private readonly CLEANUP_DELAY_MS = 10 * 60 * 1000;
  /** 进程最大存活时间兜底（30分钟） */
  private readonly MAX_LIFETIME_MS = 30 * 60 * 1000;
  /** 进度通知间隔（分钟），0=关闭，默认30分钟，非0不得低于15 */
  private readonly DEFAULT_PROGRESS_INTERVAL_MINUTES = 30;
  private readonly MIN_PROGRESS_INTERVAL_MINUTES = 15;

  constructor(private readonly chatRunnerService: ChatRunnerService) {}

  // ── 后台进程管理 ──

  /**
   * 将已启动的进程转入后台管理。
   * 由 ShellPlugin.execute 在检测到 background 参数或执行超时时调用。
   */
  background(
    childProcess: ChildProcess,
    command: string,
    cwd: string,
    encoding: string,
    sessionId: string,
    userId: string,
    initialStdout?: string[],
    initialStderr?: string[],
  ): BackgroundResult {
    const processId = childProcess.pid?.toString() || this.generateId();

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
      fullLog: "",
      recentStdout: (initialStdout || []).slice(-this.MAX_RECENT_LINES),
      recentStderr: (initialStderr || []).slice(-this.MAX_RECENT_LINES),
      progressIntervalMinutes: this.DEFAULT_PROGRESS_INTERVAL_MINUTES,
      lastOutputAt: new Date(),
      progressTimer: null,
      cleanupTimer: null,
      startedAt: new Date(),
    };

    this.logger.log(
      `后台进程 ${processId} 开始，缓冲区上限 1MB: ${command.substring(0, 80)}`,
    );

    // 接管 stdout/stderr → 内存缓冲区
    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = this.decodeBuffer(chunk, encoding);
      this.appendFullLog(entry, text);
      this.appendRecent(entry, text, "stdout");
      this.onOutput(entry);
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = this.decodeBuffer(chunk, encoding);
      this.appendFullLog(entry, text);
      this.appendRecent(entry, text, "stderr");
      this.onOutput(entry);
    });

    childProcess.on("close", (code) => {
      if (entry.status === "killed") return;
      entry.status = code === 0 ? "completed" : "error";
      entry.exitCode = code;
      entry.finishedAt = new Date();

      if (entry.progressTimer) {
        clearInterval(entry.progressTimer);
        entry.progressTimer = null;
      }

      this.logger.log(`后台进程 ${processId} 已结束, 退出码: ${code}`);

      // 如果有人在 poll 等结果，直接 notify 即可，不必重复投递系统消息
      if (!this.pollNotifier.hasWaiters(processId)) {
        this.enqueueSystemMessage(entry);
      }
      this.pollNotifier.notify(processId);
    });

    childProcess.on("error", (err) => {
      if (entry.status === "killed") return;
      entry.status = "error";
      entry.exitCode = 1;
      entry.finishedAt = new Date();

      if (entry.progressTimer) {
        clearInterval(entry.progressTimer);
        entry.progressTimer = null;
      }

      this.logger.error(`后台进程 ${processId} 错误: ${err.message}`);

      // 如果有人在 poll 等结果，直接 notify 即可，不必重复投递系统消息
      if (!this.pollNotifier.hasWaiters(processId)) {
        this.enqueueSystemMessage(entry);
      }
      this.pollNotifier.notify(processId);
    });

    this.processes.set(processId, entry);
    // 维护会话→进程索引
    if (!this.sessionProcesses.has(sessionId)) {
      this.sessionProcesses.set(sessionId, new Map());
    }
    this.sessionProcesses.get(sessionId)!.set(processId, entry);

    // 自动启动进度通知（默认每 30 分钟报告一次）
    this.startProgressTimer(entry);

    this.logger.log(
      `进程已转入后台: ${processId}, 命令: ${command.substring(0, 80)}`,
    );

    return {
      processId,
      status: "backgrounded",
      stdout: entry.recentStdout.slice(-this.MAX_RECENT_LINES),
      stderr: entry.recentStderr.slice(-this.MAX_RECENT_LINES),
    };
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

    if (entry.progressTimer) {
      clearInterval(entry.progressTimer);
      entry.progressTimer = null;
    }

    this.logger.log(`后台进程 ${processId} 已被手动终止`);

    // 通知 poll 等待者
    this.pollNotifier.notify(entry.id);

    // kill 是 AI 主动行为，AI 已知晓，不投递系统消息

    return "killed";
  }

  /**
   * 轮询后台进程状态和新输出。
   *
   * 返回自上次 poll 以来的新增内容（使用内部游标），不重复。
   * 如果 timeout > 0，则最多阻塞等待 timeout 毫秒等待新数据到来。
   */
  async poll(
    processId: string,
    timeoutMs: number = 30_000,
    sessionId?: string,
  ): Promise<PollResult | null> {
    // 最低 30s，避免 AI 无限制轮询
    if (timeoutMs < 30_000) timeoutMs = 30_000;
    const entry = this.processes.get(processId);
    if (!entry) {
      // 本地已清理 → 从信箱撤回消息作为 poll 结果
      if (sessionId) {
        const removed = this.chatRunnerService.peekQueuedMessage(
          sessionId,
          (item) => item.source?.processId === processId,
        );
        if (removed.length > 0) {
          const payload =
            removed[removed.length - 1].source?.systemPayload?.[0];
          if (payload) {
            return {
              processId: payload.processId,
              status: payload.status,
              exitCode: payload.exitCode,
              newStdout: payload.recentStdout || [],
              newStderr: payload.recentStderr || [],
              waitSeconds: 0,
            };
          }
        }
      }
      return null;
    }

    // 进程已结束 → 直接返回结果
    if (entry.status !== "running") {
      return this.buildPollResult(entry, 0);
    }

    // poll 即视为已收到消息，重置进度通知计时器
    if (entry.progressIntervalMinutes > 0) {
      if (entry.progressTimer) {
        clearInterval(entry.progressTimer);
        entry.progressTimer = null;
      }
      this.startProgressTimer(entry);
    }

    // 进程还在跑，注册等待器，有新输出或超时时返回
    const waitStartedAt = Date.now();
    await this.pollNotifier.wait(processId, timeoutMs);
    const waitSeconds = Math.round((Date.now() - waitStartedAt) / 1000);
    return this.buildPollResult(entry, waitSeconds);
  }

  /**
   * 修改静默监控时间
   */
  updateProgressMonitoring(
    processId: string,
    minutes: number,
  ): ProcessEntry | null {
    const entry = this.processes.get(processId);
    if (!entry) return null;

    // 非0值不得低于15分钟
    if (minutes > 0 && minutes < this.MIN_PROGRESS_INTERVAL_MINUTES) {
      minutes = this.MIN_PROGRESS_INTERVAL_MINUTES;
    }

    entry.progressIntervalMinutes = minutes;

    // 重置定时器
    if (entry.progressTimer) {
      clearInterval(entry.progressTimer);
      entry.progressTimer = null;
    }

    if (minutes > 0 && entry.status === "running") {
      this.startProgressTimer(entry);
    }

    return entry;
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
          progressIntervalMinutes: entry.progressIntervalMinutes,
        });
      }
    }
    return result;
  }

  /**
   * 根据 ID 获取进程（不暴露 ChildProcess）
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
      progressIntervalMinutes: entry.progressIntervalMinutes,
    };
  }

  /** 获取完整进程条目（含完整日志），供 dump_log 使用 */
  getRawEntry(processId: string): ProcessEntry | null {
    return this.processes.get(processId) || null;
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

  // ── 内部方法 ──

  private generateId(): string {
    return `p${Math.random().toString(36).slice(2, 8)}`;
  }

  private decodeBuffer(buffer: Buffer, encoding?: string): string {
    if (!buffer || buffer.length === 0) return "";
    try {
      if (encoding) return iconv.decode(buffer, encoding);
      return iconv.decode(
        buffer,
        process.platform === "win32" ? "gbk" : "utf-8",
      );
    } catch {
      return buffer.toString("latin1");
    }
  }

  /** 将新输出追加到 recent 行列表（限制最大行数） */
  private appendRecent(
    entry: ProcessEntry,
    text: string,
    type: "stdout" | "stderr",
  ): void {
    const lines = text.split("\n");
    const target = type === "stdout" ? entry.recentStdout : entry.recentStderr;
    for (const line of lines) {
      if (line.length > 0) target.push(line);
    }
    if (target.length > this.MAX_RECENT_LINES) {
      target.splice(0, target.length - this.MAX_RECENT_LINES);
    }
  }

  /** 将新输出追加到完整日志缓冲区（最大 1MB，超出保留末尾） */
  private appendFullLog(entry: ProcessEntry, text: string): void {
    entry.fullLog += text;
    if (entry.fullLog.length > this.MAX_BUFFER_BYTES) {
      // 丢掉前半，保留末尾 1MB
      entry.fullLog = entry.fullLog.slice(-this.MAX_BUFFER_BYTES);
    }
  }

  /** 有输出时的处理：更新最后输出时间（poll 不因中间输出提前返回） */
  private onOutput(entry: ProcessEntry): void {
    entry.lastOutputAt = new Date();
  }

  /** 构建 poll 结果，返回后清空缓冲区 */
  private buildPollResult(entry: ProcessEntry, waitSeconds = 0): PollResult {
    const newStdout = [...entry.recentStdout];
    const newStderr = [...entry.recentStderr];
    entry.recentStdout.length = 0;
    entry.recentStderr.length = 0;

    // AI poll 看到进程结束 → 从信箱撤回消息 + 延迟清理
    if (entry.status !== "running") {
      this.chatRunnerService.peekQueuedMessage(
        entry.sessionId,
        (item) => item.source?.processId === entry.id,
      );
      this.scheduleCleanup(entry);
    }

    return {
      processId: entry.id,
      status: entry.status,
      exitCode: entry.exitCode,
      newStdout: newStdout.slice(-this.MAX_RECENT_LINES),
      newStderr: newStderr.slice(-this.MAX_RECENT_LINES),
      waitSeconds,
    };
  }

  // ── 进度通知 ──

  /** 定时发送进度通知。每 progressIntervalMinutes 分钟报告一次最近输出 */
  private startProgressTimer(entry: ProcessEntry): void {
    if (entry.progressTimer) return;

    entry.progressTimer = setInterval(
      () => {
        if (entry.status !== "running") return;

        // poll 期间有人正在等结果，跳过通知避免重复
        if (this.pollNotifier.hasWaiters(entry.id)) return;

        this.enqueueSystemMessage(entry, "progress_report");

        this.logger.log(
          `进度通知: ${entry.id} 已运行 ${Math.round((Date.now() - entry.startedAt.getTime()) / 60000)} 分钟`,
        );
      },
      entry.progressIntervalMinutes * 60 * 1000,
    );
  }

  // ── 系统消息投递 ──

  /** 投递系统消息，每进程独立投递，投递后延迟清理 */
  private enqueueSystemMessage(entry: ProcessEntry, event?: string): void {
    const eventType = event || entry.status;

    const isProgress = eventType === "progress_report";

    const content = isProgress
      ? `[进度通知] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 运行中（已运行 ${Math.round((Date.now() - entry.startedAt.getTime()) / 60000)} 分钟）`
      : `[系统通知] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 已${entry.status === "completed" ? `执行结束，退出码 ${entry.exitCode}` : entry.status === "error" ? `异常退出，退出码 ${entry.exitCode}` : "被终止"}`;

    const systemPayload: Record<string, any>[] = [
      {
        processId: entry.id,
        command: entry.command,
        status: isProgress ? "running" : entry.status,
        exitCode: isProgress ? undefined : entry.exitCode,
        progressIntervalMinutes: isProgress
          ? entry.progressIntervalMinutes
          : undefined,
        recentStdout: entry.recentStdout.slice(-this.MAX_RECENT_LINES),
        recentStderr: entry.recentStderr.slice(-this.MAX_RECENT_LINES),
      },
    ];
    this.logger.debug(`投递系统消息: ${content}`);
    this.chatRunnerService.enqueueMessage({
      sessionId: entry.sessionId,
      userId: entry.userId,
      content,
      source: {
        type: "process_monitor",
        processId: entry.id,
        event: eventType,
        systemPayload,
      },
    });

    // 进度通知不触发清理，仅进程结束时才调度清理
    if (!isProgress) {
      this.scheduleCleanup(entry);
    }
  }

  // ── 延迟清理 ──

  /** 安排延迟清理：10 分钟后移除，最多保留 30 分钟兜底 */
  private scheduleCleanup(entry: ProcessEntry): void {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);

    const lifetimeElapsed =
      Date.now() - (entry.finishedAt?.getTime() || Date.now());
    const remaining = Math.max(0, this.MAX_LIFETIME_MS - lifetimeElapsed);
    const delay = Math.min(this.CLEANUP_DELAY_MS, remaining);

    if (delay <= 0) {
      this.cleanupProcess(entry.id, entry.sessionId);
      return;
    }

    entry.cleanupTimer = setTimeout(() => {
      this.cleanupProcess(entry.id, entry.sessionId);
    }, delay);
  }

  /** 重置延迟清理计时器 */
  resetCleanupTimer(processId: string): void {
    const entry = this.processes.get(processId);
    if (!entry) return;
    this.scheduleCleanup(entry);
  }

  /** 立即从内存移除进程（供 dump_log 导出后调用，释放缓冲区） */
  removeProcess(processId: string): void {
    const entry = this.processes.get(processId);
    if (!entry) return;
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    this.cleanupProcess(entry.id, entry.sessionId);
  }
}
