import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { spawn } from "child_process";
import * as path from "path";
import * as fsSync from "fs";
import * as fs from "fs/promises";
// path/fs still used by resolveSandboxBin()
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
  /** sandbox 二进制路径缓存（避免每次执行都搜索） */
  private sandboxBinPath: string | null | undefined;

  constructor(private readonly processManager: ProcessManagerService) {
    super();
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
      // 生产环境：resources/sandbox/{binName}
      candidates.push(
        path.join((process as any).resourcesPath, "sandbox", binName),
      );
    }

    // 开发环境或回退：从 cwd 向上查找 sandbox/{binName}
    // backend-ts/dist → backend-ts → project root
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

  manifest = {
    id: "shell",
    name: "Shell 命令行",
    description: "执行系统命令和管理后台进程",
    version: "1.2.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    // ── execute 工具 ──
    api.registerTool({
      name: "run_command",
      description: `Use the \`run_command\` command to execute commands
- Commands run in the foreground by default; the tool waits for completion and returns the output
- Foreground commands that exceed **1 minute** will automatically switch to background mode
- processId is typically the shell process ID, not the command's own process ID`,
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
        // sandbox 模式：工作目录内可写，外部只读
        // plan 模式：全盘只读（--read-only），工作目录也变为只读
        const runMode = ctx?.session.getRunMode?.();
        let useSandbox = false;
        let sandboxReadOnly = false;
        let sandboxBin: string | null = null;
        if (runMode === "sandbox" || runMode === "plan") {
          sandboxBin = await this.resolveSandboxBin();
          if (sandboxBin) {
            useSandbox = true;
            sandboxReadOnly = runMode === "plan";
          } else {
            throw new Error(
              `The user has enabled ${runMode} mode, but the sandbox binary is currently unavailable. Please use other tools or inform the user.`,
            );
          }
        }

        let spawnArgs: string[];
        let spawnCmd: string;
        let useShellSpawn = false;
        if (useSandbox) {
          spawnCmd = sandboxBin;
          // sandbox 内部会根据平台选择 cmd.exe /c 或 sh -c
          spawnArgs = ["-c", command, "--workspace", cwd];
          if (sandboxReadOnly) {
            spawnArgs.push("--read-only");
          }
        } else {
          // 直接将完整命令字符串交给 OS shell 处理（shell: true）
          // 避免 spawn("cmd", ["/c", command]) 时 Node.js 对内嵌引号做 \" 转义，
          // 而 cmd.exe 不认 \" 导致引号错位、命令被原样回显
          spawnCmd = command;
          spawnArgs = [];
          useShellSpawn = true;
        }

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `Running command: ${command}, working directory: ${cwd}, background: ${background}${useSandbox ? ", sandbox: enabled" : ""}`,
        );

        // 统一启动进程并转入后台管理（所有 stdout/stderr 由 ProcessManager 接管）
        const childProcess = spawn(spawnCmd, spawnArgs, {
          cwd,
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
          shell: useShellSpawn,
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
          if (useSandbox) {
            parts.push(
              sandboxReadOnly
                ? "Plan mode: sandbox read-only enabled, all writes blocked"
                : "Sandbox mode enabled, read-only outside workspace",
            );
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
          if (useSandbox) {
            parts.push(
              sandboxReadOnly
                ? "Plan mode: sandbox read-only enabled, all writes blocked"
                : "Sandbox mode enabled, read-only outside workspace",
            );
          }
          if (pollResult.output) {
            parts.push(`Latest output:\n---\n${pollResult.output}\n---`);
          }

          // 进程在 1 分钟内结束了 → 返回结果
          if (pollResult.status !== "running") {
            parts.push(`[exit code: ${pollResult.exitCode}]`);
            return parts.join("\n\n");
          }

          // Stall 检测：命令似乎在等待键盘输入 → 提前返回
          if (pollResult.stalled) {
            parts.push(
              `[⚠️ The command appears to be waiting for keyboard input. processId: ${result.processId}. Use the process tool with action "write" to send input, or action "kill" to terminate.]`,
            );
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
      display: { actionType: "shell", argsKey: "command", icon: "shell" },
      dangerLevel: "critical",
    });

    // ── process 管理工具 ──
    api.registerTool({
      name: "process",
      description: `Background Process Management

- Use the **process** tool to manage background processes. Additional parameters are grouped into the params object:
- **kill** — Terminate a process, no params required:
  \`{"action":"kill","processId":"xxx"}\`
- **poll** — Check for new output. Optional params.timeout (seconds, minimum 30):
   \`{"action":"poll","processId":"xxx","params":{"timeout":30}}\`
- **write** — Write input to the process's stdin. Required params.input, optional params.appendNewline (default true):
    \`{"action":"write","processId":"xxx","params":{"input":"y"}}\``,
      inputSchema: z.object({
        action: z.enum(["kill", "poll", "write"]),
        processId: z.string().describe("Background process ID"),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Additional parameters for each action, grouped into this object. ",
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
            let timeoutMs = (params.timeout || 0) * 1000;
            // Agent 调用不允许低于 30 秒
            if (timeoutMs < 30_000) {
              timeoutMs = 30_000;
            }
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
            } else if (runMode === "plan") {
              parts.push(
                "Plan mode: sandbox read-only enabled, all writes blocked",
              );
            }

            if (result.output) {
              parts.push(`Latest output:\n---\n${result.output}\n---`);
            }

            if (result.status === "running") {
              if (result.stalled) {
                parts.push(
                  '[The command appears to be waiting for keyboard input. Use action "write" to send input, or action "kill" to terminate.]',
                );
              } else {
                parts.push("[status: running]");
              }
            } else {
              parts.push(
                `[status: ${result.status}, exit code: ${result.exitCode}]`,
              );
            }

            return parts.join("\n\n");
          }

          case "write": {
            const input = params.input;
            if (!input || typeof input !== "string") {
              throw new Error("params.input cannot be empty");
            }

            const appendNewline = params.appendNewline !== false;
            const textToWrite = appendNewline ? input + "\n" : input;

            this.processManager.writeToStdin(processId, textToWrite);

            return `Written ${textToWrite.length} characters to process ${processId}`;
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
      display: {
        actionType: "process",
        argsKey: "action",
        icon: "run_command",
      },
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

## Background Task Best Practices
- Prefer foreground execution first to check initial output and verify normal startup
- Prefer using process(action=kill, processId=xxx) to terminate processes          
 ${
   isNotSubAgent
     ? `
- After switching to background, you can work on other tasks in parallel, or end the current turn and wait for system notifications
- The system will automatically notify you when a background process finishes — no need for continuous polling
- Messages already retrieved via poll will not be re-sent as system notifications`
     : ``
 }`;
      },
    });

    // ── 回合拦截器：收集未接收的 shell 进程输出，子 Agent 额外检查运行状态 ──
    api.registerInterceptor({
      name: "shell_background_check",
      intercept: async (ctx: PluginContext) => {
        const session = ctx.session;
        const isSubAgent = session.sessionType === "sub_agent";

        const processes = this.processManager.listBySession(session.sessionId);
        if (processes.length === 0) return null;

        // 1. 对所有进程执行 poll(0) 收集未接收的输出
        const pollOutputs: string[] = [];
        const stillRunning: typeof processes = [];
        for (const proc of processes) {
          const result = await this.processManager.poll(
            proc.id,
            0,
            session.sessionId,
          );
          if (!result) continue;
          if (result.output) {
            pollOutputs.push(
              `[Process ${proc.id} (${proc.command}) new output]:\n${result.output}`,
            );
          }
          // 仅子 Agent 检查 running 状态（主 Agent 允许后台运行，等待异步注入）
          if (isSubAgent && result.status === "running") {
            stillRunning.push(proc);
          }
        }

        // 2. 无新输出且（子 Agent 无运行中进程）→ 不拦截
        if (pollOutputs.length === 0 && stillRunning.length === 0) return null;

        // 3. 组装消息
        const parts: string[] = [];
        if (pollOutputs.length > 0) {
          parts.push(pollOutputs.join("\n\n"));
        }
        if (stillRunning.length > 0) {
          const list = stillRunning
            .map((p) => `- \`${p.id}\` (${p.command})`)
            .join("\n");
          parts.push(
            `You have ${stillRunning.length} unfinished background processes:\n${list}\n\nYou must use the process tool to check their status (poll), wait for them to complete or terminate them (kill) before ending the current task.`,
          );
        }

        return `<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>`;
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
