import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { StringDecoder } from "string_decoder";

/**
 * 带输出上限的 git 命令执行器。
 *
 * 背景（对齐 ZCode `gitCommandProvider`）：超大仓库的 `git status -u all` 可能输出
 * 20MB/25 万条。如果先让 simple-git 把 stdout 全量缓冲，再在 JS 层截断，内存峰值
 * 已经发生。这里在 stdout/stderr 累计到上限时立刻 kill 子进程，截断结果由调用方
 * 丢弃，绝不解析。
 */
export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** 输出超过 maxOutputBytes，stdout/stderr 只包含截断前的片段 */
  outputTruncated: boolean;
  /** 超过 timeoutMs 被强制终止 */
  timedOut: boolean;
  durationMs: number;
}

export interface GitCommandRunOptions {
  cwd: string;
  args: string[];
  /** 默认 15s；从 spawn 起算，不因输出重置 */
  timeoutMs?: number;
  /** stdout/stderr 各自的上限，默认 512KB */
  maxOutputBytes?: number;
  /** 默认 "git"；测试可注入 node 等可执行文件 */
  command?: string;
  /** 测试注入；默认 child_process.spawn */
  spawnFn?: GitSpawnFn;
}

export type GitSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 15_000;
export const DEFAULT_GIT_OUTPUT_BYTES = 512 * 1024;
/** kill 后等待子进程退出的宽限；超时再 force kill */
const KILL_GRACE_MS = 2_000;

/** 统一的 git 子进程环境：禁止 optional index 写入、分页、颜色和本地化输出 */
export function getGitCommandEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    TERM: "dumb",
    LC_ALL: "C",
    LANG: "C",
  };
}

export function runGitWithOutputCap(
  options: GitCommandRunOptions,
): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_GIT_OUTPUT_BYTES;
  const spawnFn = options.spawnFn ?? (spawn as unknown as GitSpawnFn);
  const command = options.command ?? "git";
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(command, options.args, {
        cwd: options.cwd,
        windowsHide: true,
        env: getGitCommandEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -2,
        signal: null,
        outputTruncated: false,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    // 按 chunk 直接 toString 会在 UTF-8 字符跨 chunk 时产生替换符；StringDecoder
    // 会保留不完整的多字节序列到下一次 write。
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let finalizeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      timeoutTimer = null;
      forceKillTimer = null;
      finalizeTimer = null;
    };

    const settle = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (!outputTruncated) {
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
      }
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        outputTruncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    };

    const forceKill = () => {
      if (settled || child.exitCode !== null) return;
      if (process.platform === "win32" && child.pid) {
        try {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).once("error", () => undefined);
        } catch {
          // ignore
        }
      } else {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };

    const killChild = () => {
      if (child.exitCode !== null || child.killed) return;
      try {
        child.kill();
      } catch {
        // ignore
      }
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(forceKill, KILL_GRACE_MS);
        forceKillTimer.unref?.();
      }
      if (!finalizeTimer) {
        // 兜底：子进程既不 close 也不响应 kill 时，仍要 resolve，避免请求永久挂起
        finalizeTimer = setTimeout(() => settle(null, null), KILL_GRACE_MS + 1_000);
        finalizeTimer.unref?.();
      }
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);
    timeoutTimer.unref?.();

    const append = (chunk: Buffer, target: "stdout" | "stderr") => {
      if (settled || outputTruncated) return;
      const currentBytes = target === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.length > maxOutputBytes) {
        outputTruncated = true;
        killChild();
        return;
      }
      const text =
        target === "stdout"
          ? stdoutDecoder.write(chunk)
          : stderrDecoder.write(chunk);
      if (target === "stdout") {
        stdout += text;
        stdoutBytes += chunk.length;
      } else {
        stderr += text;
        stderrBytes += chunk.length;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.once("error", (error) => {
      stderr = error instanceof Error ? error.message : String(error);
      settle(-2, null);
    });
    child.once("close", (code, signal) => {
      settle(code, signal);
    });
  });
}
