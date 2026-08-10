import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { z } from "zod";
import {
  ProcessManagerService,
  SandboxOptions,
} from "./process-manager.service";
import { PluginContext } from "../plugins/types/plugin.types";
import { StreamFinishedEvent } from "../../common/events/stream.events";
import langZh from "./shell.lang.zh.json";

/** 格式化毫秒为人类可读时长，如 "5s", "3m 5s", "1h 3s" */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

@Injectable()
export class ShellPlugin extends PluginBase {
  private readonly logger = new Logger(ShellPlugin.name);
  /** 自动转入后台的阈值（1分钟） */
  private readonly BACKGROUND_THRESHOLD_MS = 60_000;

  constructor(private readonly processManager: ProcessManagerService) {
    super();
  }

  manifest = {
    id: "shell",
    name: "Shell 命令行",
    description: "执行系统命令和管理后台进程",
    version: "1.3.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
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
        const cwd = ctx?.session.workspacePath || process.cwd();

        // sandbox 映射：sandbox 模式工作区内可写；plan 模式全盘只读
        const runMode = ctx?.session.getRunMode?.();
        const sandbox: SandboxOptions | undefined =
          runMode === "sandbox" || runMode === "plan"
            ? { enabled: true, readOnly: runMode === "plan" }
            : undefined;

        // sandbox 不可用时提前报错（execute/background 内部也会检查）
        if (sandbox?.enabled) {
          if (!(await this.processManager.isSandboxAvailable())) {
            throw new Error(
              `The user has enabled ${runMode} mode, but the sandbox binary is currently unavailable. Please use other tools or inform the user.`,
            );
          }
        }

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `Running command: ${command}, working directory: ${cwd}, background: ${background}${sandbox?.enabled ? ", sandbox: enabled" : ""}`,
        );

        const sandboxNote = sandbox?.enabled
          ? sandbox.readOnly
            ? "Plan mode: sandbox read-only enabled, all writes blocked"
            : "Sandbox mode enabled, read-only outside workspace"
          : null;

        const execResult = await this.processManager.execute(
          command,
          cwd,
          encoding,
          ctx?.session.sessionId || "",
          ctx?.session.userId || "",
          {
            timeout: this.BACKGROUND_THRESHOLD_MS,
            abortSignal,
            sandbox,
            background,
          },
        );

        const parts: string[] = [];
        if (sandboxNote) parts.push(sandboxNote);

        switch (execResult.kind) {
          case "completed":
            if (execResult.output) {
              parts.push(`Latest output:\n---\n${execResult.output}\n---`);
            }
            parts.push(
              `[exit code: ${execResult.exitCode}, uptime: ${formatDuration(execResult.uptimeMs)}]`,
            );
            break;
          case "backgrounded":
            if (execResult.output) {
              parts.push(`Latest output:\n---\n${execResult.output}\n---`);
            }
            const bgMsg = background
              ? `[Process moved to background, processId: ${execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}. Use the process tool to manage.]`
              : `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s, switched to background. processId: ${execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}. Use the process tool to manage.]`;
            parts.push(bgMsg);
            break;
        }

        if (execResult.truncated && execResult.logFilePath) {
          parts.push(
            `[Note: Output was truncated. The complete log is saved at: ${execResult.logFilePath}. You can read it using the read tool if needed.]`,
          );
        }

        return parts.join("\n\n");
      },
      display: {
        actionType: "shell",
        text: { executing: "%run_command.executing%", completed: "%run_command.completed%" },
        aggregate: { executing: "%run_command.aggregate.executing%", completed: "%run_command.aggregate.completed%" },
        argsKey: "command",
        icon: "shell",
      },
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
      execute: async (args, ctx, abortSignal) => {
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
              abortSignal,
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

            if (result.truncated && result.logFilePath) {
              parts.push(
                `[Note: Output was truncated. The complete log is saved at: ${result.logFilePath}. You can read it using the read tool if needed.]`,
              );
            }

            if (result.status === "running") {
              parts.push(
                `[status: running, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`,
              );
            } else {
              parts.push(
                `[status: ${result.status}, exit code: ${result.exitCode}, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`,
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
        text: { executing: "%process.executing%", completed: "%process.completed%" },
        aggregate: { executing: "%process.aggregate.executing%", completed: "%process.aggregate.completed%" },
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
          
**Current System**: ${isWindows ? "Windows (PowerShell)" : process.platform === "darwin" ? "macOS" : "Linux"}
          
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

        // 1. 收割已完成进程的输出（不碰运行中进程的 offset）
        const completed = await this.processManager.drainCompleted(
          session.sessionId,
        );

        // 2. 子 Agent 检查是否有运行中的进程
        const stillRunning = isSubAgent
          ? this.processManager
              .listBySession(session.sessionId)
              .filter((p) => p.status === "running")
          : [];

        // 3. 无已完成输出且无运行中进程 → 不拦截
        const hasOutput = completed.some((r) => r.output);
        if (!hasOutput && stillRunning.length === 0) return null;

        // 4. 组装消息
        const parts: string[] = [];

        for (const result of completed) {
          if (!result.output) continue;
          const exitInfo =
            result.status === "completed"
              ? ` exitcode:${result.exitCode}`
              : "";
          const truncNote =
            result.truncated && result.logFilePath
              ? `\n[Note: Output was truncated. The complete log is saved at: ${result.logFilePath}. You can read it using the run_command tool if needed.]`
              : "";
          parts.push(
            `[Process ${result.processId},status:${result.status}${exitInfo}]:\nnew Output:\n${result.output}${truncNote}`,
          );
        }

        if (stillRunning.length > 0) {
          const list = stillRunning
            .map((p) => `- \`${p.id}\` (${p.command})`)
            .join("\n");
          parts.push(
            `You have ${stillRunning.length} unfinished background processes:\n${list}\n\nYou must use the process tool to check their status (poll), wait for them to complete or terminate them (kill) before ending the current task.`,
          );
        }

        if (parts.length === 0) return null;

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
