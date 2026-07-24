import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { spawn } from "child_process";
import * as path from "path";
import * as fsSync from "fs";
import * as fs from "fs/promises";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { z } from "zod";
import { ProcessManagerService } from "./process-manager.service";
import { PluginContext } from "../plugins/types/plugin.types";
import { StreamFinishedEvent } from "../../common/events/stream.events";

@Injectable()
export class ShellPlugin extends PluginBase {
  private readonly logger = new Logger(ShellPlugin.name);
  /** 自动转入后台的阈值（1分钟） */
  private readonly BACKGROUND_THRESHOLD_MS = 60_000;
  /** sandbox.exe 路径缓存（避免每次执行都搜索） */
  private sandboxExePath: string | null | undefined;

  constructor(private readonly processManager: ProcessManagerService) {
    super();
  }

  /**
   * 解析 sandbox.exe 路径
   *
   * 开发环境：项目根目录下的 sandbox/sandbox.exe
   * 生产环境：resources/sandbox/sandbox.exe（extraResources 打包）
   *
   * 结果缓存：找到后缓存路径，找不到缓存 null 避免重复 IO。
   */
  private async resolveSandboxExe(): Promise<string | null> {
    if (this.sandboxExePath !== undefined) return this.sandboxExePath;

    const candidates: string[] = [];
    const isElectron = process.env.ELECTRON_APP === "true";

    if (isElectron && (process as any).resourcesPath) {
      // 生产环境：resources/sandbox/sandbox.exe
      candidates.push(
        path.join((process as any).resourcesPath, "sandbox", "sandbox.exe"),
      );
    }

    // 开发环境或回退：从 cwd 向上查找 sandbox/sandbox.exe
    // backend-ts/dist → backend-ts → project root
    let dir = process.cwd();
    for (let i = 0; i < 4; i++) {
      candidates.push(path.join(dir, "sandbox", "sandbox.exe"));
      candidates.push(path.join(dir, "build", "bin", "sandbox.exe"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fsSync.constants.X_OK);
        this.sandboxExePath = candidate;
        this.logger.log(`sandbox.exe found at: ${candidate}`);
        return candidate;
      } catch {
        // continue
      }
    }

    this.logger.warn(
      "sandbox.exe not found, sandbox mode will fall back to normal mode",
    );
    this.sandboxExePath = null;
    return null;
  }

  manifest = {
    id: "shell",
    name: "Shell 命令行",
    description: "执行系统命令和管理后台进程",
    version: "1.1.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    // ── execute 工具 ──
    api.registerTool({
      name: "terminal",
      description: `Execute system commands and return output. Commands running over 1 minute will auto-switch to background. "background": true starts in background immediately.`,
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            "System command to execute, e.g. ls -la, echo hello, node script.js",
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            "Output encoding format. Use 'gbk' for Windows Chinese environment; defaults to 'utf-8' on Unix. Auto-detected if not specified.",
          )
          .refine(
            (v) =>
              !v ||
              ["utf-8", "gbk", "gb2312", "gb18030", "big5", "latin1"].includes(
                v,
              ),
            { message: "Unsupported encoding format" },
          ),
        background: z
          .boolean()
          .optional()
          .describe(
            "Whether to run in background mode immediately. Defaults to false. When true, returns process ID immediately without waiting.",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        const command: string = args.command;
        if (!command || typeof command !== "string")
          throw new Error("Command cannot be empty");
        const encoding = args.encoding as string | undefined;
        const background = args.background === true;
        const isWindows = process.platform === "win32";
        const cwd = ctx?.session.workspacePath || process.cwd();

        // 判断是否使用沙盒执行
        const runMode = ctx?.session.getRunMode?.();
        let useSandbox = false;
        let sandboxExe: string | null = null;
        if (runMode === "sandbox") {
          sandboxExe = isWindows ? await this.resolveSandboxExe() : null;
          if (sandboxExe) {
            useSandbox = true;
          } else {
            throw new Error(
              "The user has enabled sandbox mode, but the sandbox environment is currently unavailable. Please use other tools or inform the user.",
            );
          }
        }

        let spawnArgs: string[];
        let spawnCmd: string;
        if (useSandbox) {
          spawnCmd = sandboxExe;
          spawnArgs = ["-c", `cmd /c ${command}`, "--workspace", cwd];
        } else {
          const shell = isWindows ? "cmd" : "sh";
          const shellFlag = isWindows ? "/c" : "-c";
          spawnCmd = shell;
          spawnArgs = [shellFlag, command];
        }

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `Running command: ${command}, working directory: ${cwd}, background: ${background}${useSandbox ? ", sandbox: enabled" : ""}`,
        );

        // 统一启动进程并转入后台管理（所有 stdout/stderr 由 ProcessManager 接管）
        const childProcess = spawn(spawnCmd, spawnArgs, {
          cwd,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          shell: false,
        });
        const result = this.processManager.background(
          childProcess,
          command,
          cwd,
          encoding,
          ctx?.session.sessionId || "",
          ctx?.session.userId || "",
          { notify: ctx?.session.sessionType !== "sub_agent" },
        );

        // 纯后台模式：立即返回
        if (background) {
          const parts: string[] = [];
          if (runMode === "sandbox") {
            parts.push("Sandbox mode enabled, read-only outside workspace");
          }
          if (result.output) {
            parts.push(`Latest output:\n---\n${result.output}\n---`);
          }
          parts.push(
            `[Process moved to background, processId: ${result.processId}. Use the process tool to manage.]`,
          );
          return parts.join("\n\n");
        }

        // 前台模式：内部 poll 等待结果，支持 abortSignal
        if (abortSignal?.aborted) {
          this.processManager.kill(result.processId);
          throw new Error("Request was aborted");
        }
        const onAbort = () => this.processManager.kill(result.processId);
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        try {
          const pollResult = await this.processManager.poll(
            result.processId,
            this.BACKGROUND_THRESHOLD_MS,
            ctx?.session.sessionId,
          )!;

          const parts: string[] = [];
          if (runMode === "sandbox") {
            parts.push("Sandbox mode enabled, read-only outside workspace");
          }
          if (pollResult.output) {
            parts.push(`Latest output:\n---\n${pollResult.output}\n---`);
          }

          // 进程在 1 分钟内结束了 → 返回结果
          if (pollResult.status !== "running") {
            parts.push(`[exit code: ${pollResult.exitCode}]`);
            return parts.join("\n\n");
          }

          // 1 分钟超时，进程还在跑 → 返回 backgrounded（含已收集的输出）
          parts.push(
            `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s, switched to background. processId: ${result.processId}. Use the process tool to manage.]`,
          );
          return parts.join("\n\n");
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
        }
      },
      display: { action: "执行命令", argsKey: "command", icon: "shell" },
      dangerLevel: "critical",
    });

    // ── process 管理工具 ──
    api.registerTool({
      name: "process",
      description: `Manage background processes`,
      inputSchema: z.object({
        action: z.enum([
          "kill",
          "poll",
          "modify_progress_monitoring",
          "dump_log",
          "write",
        ]),
        processId: z.string().describe("Background process ID"),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Additional parameters for each action, grouped into this object. See tool description and system prompt for details.",
          ),
      }),
      execute: async (args, ctx) => {
        const {
          action,
          processId,
          params = {},
        } = args as {
          action: string;
          processId: string;
          params?: Record<string, any>;
        };

        switch (action) {
          case "kill": {
            const status = this.processManager.kill(processId);
            if (status === null) {
              throw new Error(
                `Process ${processId} does not exist or has already ended`,
              );
            }
            return `Process ${processId} terminated (status: ${status})`;
          }

          case "poll": {
            const timeoutMs = (params.timeout || 0) * 1000;
            const result = await this.processManager.poll(
              processId,
              timeoutMs,
              ctx?.session.sessionId,
            );
            if (result === null) {
              throw new Error(`Process ${processId} does not exist`);
            }

            const runMode = ctx?.session.getRunMode?.();
            const parts: string[] = [];

            if (runMode === "sandbox") {
              parts.push("Sandbox mode enabled, read-only outside workspace");
            }

            if (result.output) {
              parts.push(`Latest output:\n---\n${result.output}\n---`);
            }

            if (result.status === "running") {
              parts.push("[status: running]");
            } else {
              parts.push(
                `[status: ${result.status}, exit code: ${result.exitCode}]`,
              );
            }

            return parts.join("\n\n");
          }

          case "modify_progress_monitoring": {
            const minutes = params.intervalMinutes ?? 30;
            const entry = this.processManager.updateProgressMonitoring(
              processId,
              minutes,
            );
            if (entry === null) {
              throw new Error(`Process ${processId} does not exist`);
            }
            const actualMinutes = entry.progressIntervalMinutes;
            return actualMinutes > 0
              ? `Progress notifications enabled, reporting every ${actualMinutes} minute(s). Adjust frequency as needed. Set to 0 to disable monitoring.`
              : "Progress notifications disabled";
          }

          case "dump_log": {
            const entry = this.processManager.getRawEntry(processId);
            if (!entry) {
              throw new Error(`Process ${processId} does not exist`);
            }
            if (!entry.fullLog && !entry.output) {
              return `Process ${processId} has no output log`;
            }

            const targetPath =
              params.file_path ||
              path.join(".guada", "process", "exports", `${processId}.log`);
            const cwd = ctx?.session.workspacePath || process.cwd();
            const resolved = path.resolve(cwd, targetPath);

            // 安全检查：确保导出路径在工作目录内
            const workspaceNorm = cwd.replace(/\\/g, "/").replace(/\/$/, "");
            const resolvedNorm = resolved.replace(/\\/g, "/");
            if (
              !resolvedNorm.startsWith(workspaceNorm + "/") &&
              resolvedNorm !== workspaceNorm
            ) {
              throw new Error(
                `Export path is not within the working directory: ${resolved}`,
              );
            }

            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, entry.fullLog || "", "utf-8");

            // 已导出到磁盘，立即释放内存缓冲区
            this.processManager.removeProcess(processId);

            return `Log exported to ${resolved}, ${(entry.fullLog || "").length} characters total`;
          }

          case "write": {
            const input = params.input;
            if (!input || typeof input !== "string") {
              throw new Error("params.input cannot be empty");
            }

            const entry = this.processManager.getRawEntry(processId);
            if (!entry) {
              throw new Error(`Process ${processId} does not exist`);
            }
            if (entry.status !== "running") {
              throw new Error(`Process ${processId} has ended, cannot write`);
            }

            if (!entry.childProcess.stdin) {
              throw new Error(
                `stdin for process ${processId} is not available`,
              );
            }

            const appendNewline = params.appendNewline !== false;
            const textToWrite = appendNewline ? input + "\n" : input;

            entry.childProcess.stdin.write(textToWrite);

            return `Written ${textToWrite.length} characters to process ${processId}`;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
      display: { action: "管理进程", argsKey: "action", icon: "terminal" },
      dangerLevel: "high",
    });

    // ── Prompt ──
    api.registerPrompt({
      frequency: "STATIC",
      description: "Shell tool usage instructions and safety reminders",
      content: (ctx: PluginContext) => {
        const isWindows = process.platform === "win32";
        const isNotSubAgent = ctx?.session?.sessionType !== "sub_agent";
        return `# Shell Tool Usage Instructions
          
**Current System**: ${isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"}
          
## Command Execution
- Use the \`terminal\` command to execute commands
- Commands run in the foreground by default; the tool waits for completion and returns the output (up to 8000 characters)
- Foreground commands that exceed **1 minute** will automatically switch to background mode
- processId is typically the shell process ID, not the command's own process ID
## Background Process Management
- Use the **process** tool to manage background processes. Additional parameters are grouped into the params object:
- **kill** — Terminate a process, no params required:
  \`{"action":"kill","processId":"xxx"}\`
- **poll** — Check for new output. Optional params.timeout (seconds, minimum 30):
   \`{"action":"poll","processId":"xxx","params":{"timeout":30}}\`
${
  isNotSubAgent
    ? `
- **modify_progress_monitoring** — Set the system's automatic monitoring report interval. intervalMinutes (minutes, 0=off, default 30):
    \`{"action":"modify_progress_monitoring","processId":"xxx","params":{"intervalMinutes":30}}\`
- Monitoring is enabled by default. Set to 0 to disable. Non-zero values must not be less than 15 minutes.`
    : ""
}
- **dump_log** — Export the full log. Optional params.file_path:
  \`{"action":"dump_log","processId":"xxx","params":{"file_path":"logs/my.log"}}\`
- **write** — Write input to the process's stdin. Required params.input, optional params.appendNewline (default true):
    \`{"action":"write","processId":"xxx","params":{"input":"y"}}\`
## Background Task Best Practices
- Prefer foreground execution first to check initial output and verify normal startup
- Prefer using process(action=kill, processId=xxx) to terminate processes          
 ${
   isNotSubAgent
     ? `
- After switching to background, you can work on other tasks in parallel, or end the current turn and wait for system notifications
- The system will automatically notify you when a background process finishes — no need for continuous polling
- Messages already retrieved via poll will not be re-sent as system notifications
- For long-running tasks (expected >30 minutes), use progress notifications (enabled by default) to stay informed. Short tasks do not need to disable monitoring (the default 30-minute interval serves as a fallback).`
     : `- After ending the conversation, all background processes will be automatically terminated. Make sure to use POLL to wait for process completion.`
 }`;
      },
    });
  }

  /**
   * 子 Agent 流结束时，自动杀死该会话下的所有后台进程
   */
  @OnEvent("stream.finished")
  handleStreamFinished(event: StreamFinishedEvent): void {
    if (event.payload.sessionType !== "sub_agent") return;

    const processes = this.processManager.listBySession(event.sessionId);
    for (const proc of processes) {
      if (proc.status !== "running") continue;
      this.processManager.kill(proc.id);
      this.logger.log(
        `Sub-agent stream ended, terminating background process: ${proc.id}`,
      );
    }
  }
}
