import { Injectable, Logger } from "@nestjs/common";
import { spawn, ChildProcess, exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as iconv from "iconv-lite";
import { ChatRunnerService } from "../chat/chat-runner.service";

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
  /** 合并日志文件路径（stdout + stderr 交织写入同一文件，同终端效果） */
  logPath: string;
  /** 最近 stdout 行（最多 50 行，poll 后清空） */
  recentStdout: string[];
  /** 最近 stderr 行（最多 50 行，poll 后清空） */
  recentStderr: string[];
  /** 静默监控 */
  silentMonitoringMinutes: number;
  lastOutputAt: Date;
  silentTimer: ReturnType<typeof setInterval> | null;
  /** 元数据 */
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
  /** 完整日志文件路径 */
  logPath: string;
}

export interface BackgroundResult {
  processId: string;
  status: "backgrounded";
  /** 转入后台时截取的 stdout 行（最多 50 行） */
  stdout: string[];
  /** 转入后台时截取的 stderr 行（最多 50 行） */
  stderr: string[];
  logPath: string;
}

export interface ProcessListEntry {
  id: string;
  command: string;
  status: ProcessStatus;
  sessionId: string;
  isBackgrounded: boolean;
  startedAt: Date;
  finishedAt?: Date;
  silentMonitoringMinutes: number;
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
  /** 等待新数据时 resolve 的 poll 回调队列 */
  private readonly pollWatchers = new Map<
    string,
    Array<(result: PollResult) => void>
  >();

  /** 最近输出最大行数 */
  private readonly MAX_RECENT_LINES = 50;
  /** 默认静默监控时长（分钟），0 = 不监控 */
  private readonly DEFAULT_SILENT_MONITORING_MINUTES = 0;

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
    const processId = this.generateId();

    // 日志写入工作目录下的 .guada/process/logs/{processId}.log
    const logDir = path.join(cwd, ".guada/process/logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${processId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

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
      logPath,
      recentStdout: (initialStdout || []).slice(-this.MAX_RECENT_LINES),
      recentStderr: (initialStderr || []).slice(-this.MAX_RECENT_LINES),
      silentMonitoringMinutes: this.DEFAULT_SILENT_MONITORING_MINUTES,
      lastOutputAt: new Date(),
      silentTimer: null,
      startedAt: new Date(),
    };

    this.logger.log(`开始写入日志: ${logPath}`);

    // 接管 stdout/stderr pipe → 同一文件（交织写入，同控制台效果）
    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = this.decodeBuffer(chunk, encoding);
      logStream.write(text);
      this.appendRecent(entry, text, "stdout");
      this.onOutput(entry);
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = this.decodeBuffer(chunk, encoding);
      logStream.write(text);
      this.appendRecent(entry, text, "stderr");
      this.onOutput(entry);
    });

    childProcess.on("close", (code) => {
      logStream.end();
      entry.status = code === 0 ? "completed" : "error";
      entry.exitCode = code;
      entry.finishedAt = new Date();

      if (entry.silentTimer) {
        clearInterval(entry.silentTimer);
        entry.silentTimer = null;
      }

      this.logger.log(`后台进程 ${processId} 已结束, 退出码: ${code}`);

      // 先投递信箱，再通知 poll 等待者（后者从中撤回）
      this.enqueueSystemMessage(entry);
      this.resolvePollWatchers(entry);
    });

    childProcess.on("error", (err) => {
      logStream.end();
      entry.status = "error";
      entry.exitCode = 1;
      entry.finishedAt = new Date();

      if (entry.silentTimer) {
        clearInterval(entry.silentTimer);
        entry.silentTimer = null;
      }

      this.logger.error(`后台进程 ${processId} 错误: ${err.message}`);

      this.enqueueSystemMessage(entry);
      this.resolvePollWatchers(entry);
    });

    this.processes.set(processId, entry);
    // 维护会话→进程索引
    if (!this.sessionProcesses.has(sessionId)) {
      this.sessionProcesses.set(sessionId, new Map());
    }
    this.sessionProcesses.get(sessionId)!.set(processId, entry);

    this.logger.log(
      `进程已转入后台: ${processId}, 命令: ${command.substring(0, 80)}`,
    );

    return {
      processId,
      status: "backgrounded",
      stdout: entry.recentStdout.slice(-this.MAX_RECENT_LINES),
      stderr: entry.recentStderr.slice(-this.MAX_RECENT_LINES),
      logPath,
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

    if (entry.silentTimer) {
      clearInterval(entry.silentTimer);
      entry.silentTimer = null;
    }

    this.logger.log(`后台进程 ${processId} 已被手动终止`);

    // 通知 poll 等待者
    this.resolvePollWatchers(entry);

    // kill 是 AI 主动行为，AI 已知晓，不投递系统消息
    // 但若有 pendingNotify 标记，仍需清除

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
          const payload = removed[0].source?.systemPayload?.[0];
          if (payload) {
            return {
              processId: payload.processId,
              status: payload.status,
              exitCode: payload.exitCode,
              newStdout: payload.recentStdout || [],
              newStderr: payload.recentStderr || [],
              logPath: payload.logPath,
            };
          }
        }
      }
      return null;
    }

    // 进程已结束 → 直接返回结果
    if (entry.status !== "running") {
      return this.buildPollResult(entry);
    }

    // 进程还在跑且需要等待
    if (timeoutMs > 0) {
      return new Promise<PollResult>((resolve) => {
        const timer = setTimeout(() => {
          this.removePollWatcher(processId, resolve);
          resolve(this.buildPollResult(entry));
        }, timeoutMs);

        this.addPollWatcher(processId, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
      });
    }

    // 进程还在跑，timeout=0（理论上不会被 Zod 传递下来，但兜底处理）
    return this.buildPollResult(entry);
  }

  /**
   * 修改静默监控时间
   */
  updateSilentMonitoring(
    processId: string,
    minutes: number,
  ): ProcessEntry | null {
    const entry = this.processes.get(processId);
    if (!entry) return null;

    entry.silentMonitoringMinutes = minutes;

    // 重置定时器
    if (entry.silentTimer) {
      clearInterval(entry.silentTimer);
      entry.silentTimer = null;
    }

    if (minutes > 0 && entry.status === "running") {
      this.startSilentTimer(entry);
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
          silentMonitoringMinutes: entry.silentMonitoringMinutes,
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
      silentMonitoringMinutes: entry.silentMonitoringMinutes,
    };
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

  /** 有输出时的处理：更新最后输出时间（poll 不因中间输出提前返回） */
  private onOutput(entry: ProcessEntry): void {
    entry.lastOutputAt = new Date();
  }

  /** 构建 poll 结果，返回后清空缓冲区 */
  private buildPollResult(entry: ProcessEntry): PollResult {
    const newStdout = [...entry.recentStdout];
    const newStderr = [...entry.recentStderr];
    entry.recentStdout.length = 0;
    entry.recentStderr.length = 0;

    // AI poll 看到进程结束 → 从信箱撤回消息 + 清理本地
    if (entry.status !== "running") {
      this.chatRunnerService.peekQueuedMessage(
        entry.sessionId,
        (item) => item.source?.processId === entry.id,
      );
      this.cleanupProcess(entry.id, entry.sessionId);
    }

    return {
      processId: entry.id,
      status: entry.status,
      exitCode: entry.exitCode,
      newStdout: newStdout.slice(-this.MAX_RECENT_LINES),
      newStderr: newStderr.slice(-this.MAX_RECENT_LINES),
      logPath: entry.logPath,
    };
  }

  // ── Poll 等待者管理 ──

  private addPollWatcher(
    processId: string,
    resolve: (result: PollResult) => void,
  ): void {
    if (!this.pollWatchers.has(processId)) {
      this.pollWatchers.set(processId, []);
    }
    this.pollWatchers.get(processId)!.push(resolve);
  }

  private removePollWatcher(
    processId: string,
    resolve: (result: PollResult) => void,
  ): void {
    const watchers = this.pollWatchers.get(processId);
    if (!watchers) return;
    const idx = watchers.indexOf(resolve);
    if (idx !== -1) watchers.splice(idx, 1);
    if (watchers.length === 0) this.pollWatchers.delete(processId);
  }

  private resolvePollWatchers(entry: ProcessEntry): void {
    const watchers = this.pollWatchers.get(entry.id);
    if (!watchers || watchers.length === 0) return;

    const result = this.buildPollResult(entry);
    for (const resolve of watchers) {
      resolve(result);
    }
    this.pollWatchers.delete(entry.id);
  }

  // ── 静默监控 ──

  private startSilentTimer(entry: ProcessEntry): void {
    if (entry.silentTimer) return;

    entry.silentTimer = setInterval(() => {
      const silentSince = Date.now() - entry.lastOutputAt.getTime();
      const thresholdMs = entry.silentMonitoringMinutes * 60 * 1000;

      if (silentSince >= thresholdMs && entry.status === "running") {
        this.chatRunnerService.enqueueMessage({
          sessionId: entry.sessionId,
          userId: entry.userId,
          content: `[系统通知] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 已持续 ${entry.silentMonitoringMinutes} 分钟无任何输出`,
          source: {
            type: "process_monitor",
            processId: entry.id,
            event: "silent_timeout",
            silentMinutes: entry.silentMonitoringMinutes,
          },
        });

        this.logger.log(
          `静默监控触发: ${entry.id} 已 ${entry.silentMonitoringMinutes} 分钟无输出`,
        );
      }
    }, 30_000);
  }

  // ── 系统消息投递 ──

  /** 投递系统消息，每进程独立投递，投递后清理本地 */
  private enqueueSystemMessage(entry: ProcessEntry): void {
    const content = `[系统通知] 后台进程 \`${entry.id}\` (\`${entry.command}\`) 已${entry.status === "completed" ? `执行结束，退出码 ${entry.exitCode}` : entry.status === "error" ? `异常退出，退出码 ${entry.exitCode}` : "被终止"}`;

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
            logPath: entry.logPath,
            recentStdout: entry.recentStdout.slice(-this.MAX_RECENT_LINES),
            recentStderr: entry.recentStderr.slice(-this.MAX_RECENT_LINES),
          },
        ],
      },
    });

    // 信箱即副本，本地不再保留
    this.cleanupProcess(entry.id, entry.sessionId);
  }
}
