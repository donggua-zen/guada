import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PtyHandle } from "./types";
import { ensureSpawnHelperExecutable, PtyHelperError } from "./pty-helper";
import { envValue, resolveWindowsShell } from "../shell/windows-shell-detect";

/** transcript 保留上限（字节，超出丢弃头部） */
const TRANSCRIPT_LIMIT = 1 << 20; // 1MB

/** process.on("exit") 的 PTY 同步兜底（node-pty kill 在退出阶段可能来不及） */
const ptyExitGuards = new Set<() => void>();
let ptyExitHookInstalled = false;

function installPtyExitHook(): void {
  if (ptyExitHookInstalled) return;
  ptyExitHookInstalled = true;
  process.once("exit", () => {
    for (const guard of ptyExitGuards) {
      try {
        guard();
      } catch {
        // best-effort
      }
    }
  });
}

/**
 * 终端服务：node-pty 进程管理（PTY 注册表）
 *
 * 关键设计：
 *  - WS 断连（页面刷新/会话切换）不立即杀 PTY，标记为 orphan 等待回收
 *  - 只有显式关闭 tab（前端发 close 消息）才立即 kill
 *  - 定时回收：orphan PTY 超过 5 分钟自动 kill
 *  - 会话归属/权限校验在 Gateway 层完成
 */
@Injectable()
export class TerminalService implements OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(TerminalService.name);
  /** PTY 注册表 */
  private readonly sessions = new Map<string, PtyHandle>();
  /** PTY 退出兜底（process.on("exit") 时同步杀进程树） */
  private readonly exitGuards = new Map<string, () => void>();
  /** 每会话 UI 终端上限 */
  private readonly MAX_UI_TERMINALS = 3;
  /** orphan 回收定时器 */
  private readonly orphanTimer: ReturnType<typeof setInterval>;
  /** orphan 超时（毫秒）：5 分钟 */
  private readonly ORPHAN_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(private configService: ConfigService) {
    this.orphanTimer = setInterval(() => this.reclaimOrphans(), 30_000);
    this.orphanTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.orphanTimer);
    for (const id of this.sessions.keys()) this.dispose(id);
  }

  onApplicationShutdown(): void {
    // onModuleDestroy 已执行时幂等；信号路径也可能只触发 onApplicationShutdown。
    clearInterval(this.orphanTimer);
    for (const id of this.sessions.keys()) this.dispose(id);
  }

  /** 回收超时的 orphan PTY */
  private reclaimOrphans(): void {
    const now = Date.now();
    for (const [id, handle] of this.sessions) {
      if (handle.disconnectedAt && now - handle.disconnectedAt > this.ORPHAN_TIMEOUT_MS) {
        this.logger.log(`Reclaiming orphan terminal: ${id}`);
        this.dispose(id);
      }
    }
  }

  /**
   * 解析默认 shell。
   *
   * 优先级：TERMINAL_SHELL 配置 > Windows：Git Bash → PowerShell → cmd.exe > Unix：$SHELL/sh。
   * Git Bash 用 -l 启动 login shell（/etc/profile 才会把 /usr/bin 加进 PATH）。
   */
  private defaultShell(): { file: string; args: string[]; env?: Record<string, string> } {
    const cfg = this.configService.get<string>("TERMINAL_SHELL");
    if (cfg) return { file: cfg, args: [] };

    if (process.platform === "win32") {
      const resolved = resolveWindowsShell({ env: process.env });
      if (resolved.kind === "gitbash") {
        // Git Bash 不会把 xterm 的设备属性应答（ESC[?1;2c）原样回显——那是 cmd.exe 的坑，
        // 也是这里从 cmd 换成 PowerShell 的历史原因。
        return {
          file: resolved.path,
          args: ["-l"],
          env: { SHELL: resolved.path },
        };
      }
      if (resolved.kind === "cmd") {
        return { file: envValue(process.env, "ComSpec") || "cmd.exe", args: [] };
      }
      return { file: resolved.path || "powershell.exe", args: [] };
    }

    return {
      file: process.env.TERMINAL_SHELL || process.env.SHELL || "/bin/sh",
      args: [],
    };
  }

  createUiTerminal(sessionId: string, cwd: string, cols = 80, rows = 24): PtyHandle {
    const uiCount = [...this.sessions.values()].filter((t) => t.sessionId === sessionId).length;
    if (uiCount >= this.MAX_UI_TERMINALS) {
      throw new Error(`Terminal limit reached (${this.MAX_UI_TERMINALS}) for this session`);
    }
    const id = `${sessionId}:${randomUUID().slice(0, 8)}`;
    return this.spawn(id, sessionId, cwd, cols, rows);
  }

  createAgentTerminal(sessionId: string, cwd: string, command?: string, cols = 100, rows = 30): PtyHandle {
    const id = randomUUID();
    const handle = this.spawn(id, sessionId, cwd, cols, rows);
    if (command) handle.pty.write(command + "\r");
    return handle;
  }

  get(id: string): PtyHandle {
    const handle = this.sessions.get(id);
    if (!handle) throw new Error(`Terminal ${id} not found`);
    return handle;
  }

  /** 仅允许终端所属会话显式销毁 */
  disposeForSession(id: string, sessionId: string): void {
    const handle = this.get(id);
    if (handle.sessionId !== sessionId) throw new Error("Terminal does not belong to session");
    this.dispose(id);
  }

  /**
   * WS 断连时调用：标记 orphan，不杀 PTY。
   * 前端重连时可通过 id 恢复；超时后由 reclaimOrphans 回收。
   */
  markDisconnected(id: string): void {
    const handle = this.sessions.get(id);
    if (handle) handle.disconnectedAt = Date.now();
  }

  /**
   * 显式关闭（用户关 tab / 前端发 close）：立即 kill PTY。
   */
  dispose(id: string): void {
    const handle = this.sessions.get(id);
    if (!handle) return;
    try {
      handle.pty.kill();
    } catch {
      /* ignore */
    }
    const guard = this.exitGuards.get(id);
    if (guard) {
      ptyExitGuards.delete(guard);
      this.exitGuards.delete(id);
    }
    this.sessions.delete(id);
    this.logger.log(`Terminal disposed: ${id}`);
  }

  /** process.exit 时同步杀 PTY 进程树（node-pty 的异步 kill 可能来不及）。 */
  private installExitGuard(id: string, handle: PtyHandle): void {
    const pid = handle.pty.pid;
    if (!pid) return;
    installPtyExitHook();
    const guard =
      process.platform === "win32"
        ? () => {
            try {
              execFileSync(
                "taskkill",
                ["/F", "/T", "/PID", String(pid)],
                { stdio: "ignore", timeout: 1_000 },
              );
            } catch {
              // 已退出
            }
          }
        : () => {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // 已退出
            }
          };
    this.exitGuards.set(id, guard);
    ptyExitGuards.add(guard);
  }

  list(sessionId: string): PtyHandle[] {
    return [...this.sessions.values()].filter((t) => t.sessionId === sessionId);
  }

  private spawn(id: string, sessionId: string, cwd: string, cols: number, rows: number): PtyHandle {
    const shell = this.defaultShell();
    this.logger.log(`[Terminal] spawn shell=${shell.file} args=[${shell.args.join(" ")}] id=${id}`);
    let pty: import("node-pty").IPty;
    try {
      // macOS：helper 缺 x 位会让原生层 std::terminate（后端进程直接 abort），必须前置拦住
      ensureSpawnHelperExecutable();
      // 与 DSH 完全一致的 ConPTY 配置：不传 useConptyDll，
      // 保证 resize 能正确传递到 shell（useConptyDll 会破坏 resize）。
      pty = this.loadNodePty().spawn(shell.file, shell.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", ...shell.env },
        useConpty: true,
      });
    } catch (e: any) {
      this.logger.error(`Terminal spawn failed: ${e?.message}`);
      if (e instanceof PtyHelperError) throw e;
      throw new Error(`Terminal spawn failed: ${e?.message}`);
    }

    const handle: PtyHandle = { id, sessionId, cwd, pty, transcript: "", exited: false, disconnectedAt: undefined };

    pty.onData((data) => {
      handle.transcript += data;
      if (handle.transcript.length > TRANSCRIPT_LIMIT) {
        handle.transcript = handle.transcript.slice(-TRANSCRIPT_LIMIT);
      }
    });

    pty.onExit(({ exitCode }) => {
      handle.exited = true;
      handle.exitCode = exitCode;
      this.logger.log(`Terminal exited: ${id} code=${exitCode}`);
    });

    this.sessions.set(id, handle);
    this.installExitGuard(id, handle);
    this.logger.log(`Terminal created: ${id} cwd=${cwd}`);
    return handle;
  }

  /** 受保护而非私有：供测试子类替换 PTY 工厂，避免单测触发原生模块编译产物 */
  protected loadNodePty(): typeof import("node-pty") {
    try {
      return require("node-pty") as typeof import("node-pty");
    } catch (e: any) {
      throw new Error(
        `node-pty is not available: ${e?.message} — run "pnpm approve-builds && pnpm rebuild node-pty"`,
      );
    }
  }
}
