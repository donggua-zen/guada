import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { z } from "zod";
import {
  ProcessManagerService,
  SandboxOptions,
} from "./process-manager.service";
import { StreamingSanitizer } from "./stream-sanitizer";
import { PluginContext } from "../plugins/types/plugin.types";
import {
  HOOKS,
  type TurnStoppingDecision,
  type TurnStoppingPayload,
} from "../chat/types/hooks.contract";
import { StreamStatusChangedEvent } from "../../common/events/stream.events";
import {
  ESCALATION_TARGETS,
  parseEscalationArgs,
  sandboxForMode,
  assertStrictlyWider,
  type SandboxMode,
} from "../../common/services/sandbox-policy";
import { AskService } from "../../common/services/ask.service";
import {
  WorkspaceToolRouter,
  workspaceParamField,
  type RemoteToolTarget,
} from "../remote-workspace/workspace-router";
import {
  buildRemoteProcessId,
  parseRemoteProcessId,
} from "../remote-workspace/ssh-workspace-provider";
import langZh from "./shell.lang.zh.json";
import langEn from "./shell.lang.en.json";

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

  constructor(
    private readonly processManager: ProcessManagerService,
    private readonly askService: AskService,
    private readonly workspaceRouter: WorkspaceToolRouter,
  ) {
    super();
  }

    manifest = {
      id: "shell",
      name: "%shell.name%",
      description: "%shell.description%",
      version: "1.4.0",
      category: "core" as const,
    };

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    // ── shell 能力包：run_command/process 工具与使用说明统一挂载 ──
    const shellKit = api.registerToolKit({
      id: "shell",
      name: "%shell.name%",
      description: "%shell.toolkitDescription%",
      activator: "Execute system commands and manage background processes.",
    });
    // ── execute 工具 ──
    const shellKind = this.processManager.getShellKind();
    const isCmd = shellKind === "cmd";
    const isPowerShell = shellKind === "powershell";
    const shellDesc = this.processManager.getShellInfo();
    const cmdWarning = isCmd
      ? `\n- WARNING: cmd.exe only executes the first line of a multi-line command and silently drops the rest. For multi-line or long commands, write them to a script file (.bat) first, then execute the script`
      : "";
    const psWarning = isPowerShell
      ? `\n- Use PowerShell syntax: separate statements with \`;\` (\`&&\` is not supported in Windows PowerShell 5.1); bash-only syntax (\`export\`, \`source\`, heredocs, \`ls -la\`) will not work. For complex logic, write a .ps1 script file and run it: \`powershell -ExecutionPolicy Bypass -File script.ps1\``
      : "";
    shellKit.registerTool({
      name: "run_command",
      description: `Use the \`run_command\` command to execute commands
- **Current Shell**: ${shellDesc}${psWarning}${cmdWarning}
- Commands run in the foreground by default; the tool waits for completion and returns the output
- Foreground commands that exceed **1 minute** will automatically switch to background mode
- Prefer single-line commands when possible; for multi-line or long commands, write them to a script file first, then execute the script
- processId is typically the shell process ID, not the command's own process ID
- **Sandbox escalation**: when a command is denied by the sandbox and a wider mode would let it succeed, retry the exact same command once with \`sandbox_permissions\` (the narrowest wider mode that suffices) plus a one-sentence \`justification\`; an approval prompt will ask the user. Never escalate speculatively: ground the request in a real denial. A rejected escalation is final for that command.
- **Remote workspaces**: with workspace="<connection name>" the command runs via POSIX sh on that remote server (\`encoding\` decodes raw output bytes agent-side; \`sandbox_permissions\` does not apply). Foreground timeout (60s) switches to background there too; background processIds carry the "r:" prefix and are managed with the same process tool.`,
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            isPowerShell
              ? "PowerShell command to execute, e.g. Get-ChildItem, $env:OS, node script.js"
              : "System command to execute, e.g. ls -la, echo hello, node script.js",
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
        workspace: workspaceParamField,
        sandbox_permissions: z
          .enum(ESCALATION_TARGETS)
          .optional()
          .describe(
            "The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.",
          ),
        justification: z
          .string()
          .optional()
          .describe(
            "Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        const command: string = args.command;
        if (!command || typeof command !== "string")
          throw new Error("Command cannot be empty");
        const encoding = args.encoding as string | undefined;
        const background = args.background === true;

        // ── 附加（远程）工作目录分支：POSIX sh 语义，远端路径权限由连接 perm 控制 ──
        const remoteTarget = await this.resolveTarget(ctx, args.workspace);
        if (remoteTarget) {
          return this.runRemoteCommand(remoteTarget, args, ctx, abortSignal);
        }

        const cwd = ctx?.session.workspacePath || process.cwd();
        const session = ctx?.session;

        // 安全模式 → 沙盒选项：read-only 全盘只读 / workspace-write 工作区内可写 / danger-full-access 不沙盒
        const mode: SandboxMode =
          session?.getSandboxMode?.() ?? "workspace-write";
        let sandbox: SandboxOptions | undefined = sandboxForMode(mode);

        // sandbox 不可用时提前报错（execute/background 内部也会检查，fail-closed 不静默放行）
        if (sandbox?.enabled) {
          if (!(await this.processManager.isSandboxAvailable())) {
            throw new Error(
              `The session sandbox mode is ${mode}, but the sandbox binary is currently unavailable. Please use other tools or inform the user.`,
            );
          }
        }

        // 提权请求：sandbox_permissions + justification 成对 → 严格放宽校验 → 审批 → 应用放宽模式
        const escalation = parseEscalationArgs(
          args.sandbox_permissions,
          args.justification,
        );
        if (escalation) {
          if (!sandbox?.enabled) {
            throw new Error(
              `Sandbox is not enabled in this session (mode: ${mode}); sandbox_permissions is unavailable.`,
            );
          }
          // 非严格放宽（平级/降级）→ 直接抛错，不打扰人（对齐 DSH）
          assertStrictlyWider(mode, escalation.mode);
          // 原地等待审批（统一 Ask：同意/拒绝/自定义回复，无超时）：
          // 批准正常返回；拒绝/自定义/中止抛 AskDeniedError（命令不执行，终局）
          await this.askService.requestApproval(session, {
            toolCallId: ctx?.toolCallId || "",
            toolName: "run_command",
            detail: `请求沙盒提权 ${mode} → ${escalation.mode}：${escalation.justification}`,
            abortSignal,
          });
          sandbox = sandboxForMode(escalation.mode);
          this.logger.log(
            `Escalation approved: ${mode} → ${escalation.mode} (call=${ctx?.toolCallId})`,
          );
        }

        if (abortSignal?.aborted) throw new Error("Request was aborted");
        this.logger.log(
          `Running command: ${command}, working directory: ${cwd}, background: ${background}${sandbox?.enabled ? ", sandbox: enabled" : ""}`,
        );

        const sandboxShell = process.platform === "win32" ? "Windows PowerShell" : "sh";
        const sandboxNote = sandbox?.enabled
          ? sandbox.readOnly
            ? `Read-only mode: sandbox read-only enabled, all writes blocked (commands run in ${sandboxShell})`
            : `Sandbox mode enabled, read-only outside workspace (commands run in ${sandboxShell})`
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

        // 标记契约（对齐 DSH）：stdout 裸文本 + 行级 [...] 标记；
        // [exit code: N, uptime: X] 恒为末行且恒输出（uptime 供模型判断命令耗时），
        // 前端解析器按末行锚定剥离元数据（见 frontend utils/terminalOutput.ts）。
        const truncatedNote =
          execResult.truncated && execResult.logFilePath
            ? `\n[Note: Output was truncated. The complete log is saved at: ${execResult.logFilePath}. You can read it using the read tool if needed.]`
            : "";

        let content: string;
        const meta: Record<string, any> = {
          card: "terminal",
          backgrounded: false,
          truncated: !!execResult.truncated,
        };
        if (sandboxNote) meta.sandboxNote = sandboxNote;
        if (execResult.logFilePath) meta.logFilePath = execResult.logFilePath;

        if (execResult.kind === "completed") {
          const body = execResult.output || "(no output)";
          const lines: string[] = [];
          if (sandbox?.enabled && execResult.exitCode !== 0) {
            // 沙盒拒绝提示：附提权 hint 供模型带参重试（对齐 DSH，位于末行标记之前）
            lines.push(
              `[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`,
            );
          }
          lines.push(
            `[exit code: ${execResult.exitCode}, uptime: ${formatDuration(execResult.uptimeMs)}]`,
          );
          content = `${body}${truncatedNote}\n${lines.join("\n")}`;
          meta.exitCode = execResult.exitCode;
          meta.processStatus = execResult.processStatus;
          meta.uptimeMs = execResult.uptimeMs;
        } else {
          const body = execResult.output || "(no output)";
          const bgMsg = background
            ? `[Process moved to background, processId: ${execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}. Use the process tool to manage.]`
            : `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s, switched to background. processId: ${execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}. Use the process tool to manage.]`;
          content = `${body}${truncatedNote}\n${bgMsg}`;
          meta.backgrounded = true;
          meta.processId = execResult.processId;
          meta.uptimeMs = execResult.uptimeMs;
        }

        if (sandboxNote) {
          return { content: `${sandboxNote}\n\n${content}`, meta };
        }
        return { content, meta };
      },
      display: {
        actionType: "shell",
        text: { executing: "%run_command.executing%", completed: "%run_command.completed%" },
        aggregate: { executing: "%run_command.aggregate.executing%", completed: "%run_command.aggregate.completed%" },
        argsKey: "command",
        icon: "terminal",
        renderer: { kind: "terminal", fields: { command: "command" } },
      },
      dangerLevel: "critical",
    });

    // ── process 管理工具 ──
    shellKit.registerTool({
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
            // 远程进程（r:<连接名>:<pid>）→ 路由到对应连接的 provider
            const remote = parseRemoteProcessId(processId);
            if (remote?.connectionName) {
              const target = await this.resolveTarget(
                ctx,
                remote.connectionName,
              );
              const status = target!.provider.kill(processId);
              if (status === null) {
                throw new Error(
                  `Process ${processId} does not exist or has already ended`,
                );
              }
              this.workspaceRouter.unregisterRemoteProcess(processId);
              return `Process ${processId} terminated (status: ${status})`;
            }
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
            const remote = parseRemoteProcessId(processId);
            if (remote?.connectionName) {
              const target = await this.resolveTarget(
                ctx,
                remote.connectionName,
              );
              const encoding = this.workspaceRouter.getProcessEncoding(processId);
              const result = await target!.provider.poll(
                processId,
                timeoutMs,
                abortSignal,
                encoding,
              );
              if (result === null) {
                throw new Error(`Process ${processId} does not exist`);
              }
              const truncatedNote =
                (result as any).truncated && (result as any).logFilePath
                  ? `\n[Note: Output was truncated. The complete log is saved on the remote server at: ${(result as any).logFilePath}. Read it with the read tool (workspace="${remote.connectionName}").]`
                  : "";
              const statusLine =
                result.status === "running"
                  ? `[status: running, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`
                  : `[status: ${result.status}, exit code: ${result.exitCode}, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`;
              const meta: Record<string, any> = {
                card: "terminal",
                backgrounded: result.status === "running",
                processId,
                processStatus: result.status,
                uptimeMs: result.uptimeMs,
                truncated: !!(result as any).truncated,
              };
              if ((result as any).logFilePath) {
                meta.logFilePath = (result as any).logFilePath;
              }
              if (result.status !== "running") meta.exitCode = result.exitCode;
              const content = `${result.output ? this.sanitize(result.output) : "(no output)"}${truncatedNote}\n${statusLine}`;
              return { content, meta };
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

            const mode: SandboxMode =
              ctx?.session.getSandboxMode?.() ?? "workspace-write";

            const sandboxForNote = sandboxForMode(mode);
            const sandboxNote = sandboxForNote?.enabled
              ? sandboxForNote.readOnly
                ? "Read-only mode: sandbox read-only enabled, all writes blocked"
                : "Sandbox mode enabled, read-only outside workspace"
              : null;

            const truncatedNote =
              result.truncated && result.logFilePath
                ? `\n[Note: Output was truncated. The complete log is saved at: ${result.logFilePath}. You can read it using the read tool if needed.]`
                : "";
            const statusLine =
              result.status === "running"
                ? `[status: running, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`
                : `[status: ${result.status}, exit code: ${result.exitCode}, uptime: ${formatDuration(result.uptimeMs)}, waited: ${formatDuration(result.waitMs)}]`;
            const meta: Record<string, any> = {
              card: "terminal",
              backgrounded: result.status === "running",
              processId,
              processStatus: result.status,
              uptimeMs: result.uptimeMs,
              truncated: !!result.truncated,
            };
            if (result.logFilePath) meta.logFilePath = result.logFilePath;
            if (result.status !== "running") meta.exitCode = result.exitCode;
            if (sandboxNote) meta.sandboxNote = sandboxNote;

            const content = `${result.output || "(no output)"}${truncatedNote}\n${statusLine}`;
            return sandboxNote
              ? { content: `${sandboxNote}\n\n${content}`, meta }
              : { content, meta };
          }

          case "write": {
            const input = params.input;
            if (!input || typeof input !== "string") {
              throw new Error("params.input cannot be empty");
            }

            const appendNewline = params.appendNewline !== false;
            const textToWrite = appendNewline ? input + "\n" : input;

            const remote = parseRemoteProcessId(processId);
            if (remote?.connectionName) {
              const target = await this.resolveTarget(
                ctx,
                remote.connectionName,
              );
              target!.provider.writeToStdin(processId, textToWrite);
              return `Written ${textToWrite.length} characters to process ${processId}`;
            }

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
        icon: "terminal",
      },
      dangerLevel: "high",
    });

    // ── Prompt ──
    shellKit.registerPrompt({
      frequency: "STATIC",
      description: "Shell tool usage instructions and safety reminders",
      content: (ctx: PluginContext) => {
        const isNotSubAgent = ctx?.session?.sessionType !== "sub_agent";
        return `# Shell Tool Usage Instructions

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

    // ── 工具提示词注册完成（回合续跑钩子已迁移为类方法 @OnEvent(HOOKS.TURN_STOPPING)）──
  }

  // ── 附加（远程）工作目录支持 ──

  /** 解析 workspace 参数；null = 主工作目录（本地） */
  private async resolveTarget(
    ctx: PluginContext,
    workspace?: string,
  ): Promise<RemoteToolTarget | null> {
    return this.workspaceRouter.resolveRemoteTarget(
      workspace,
      ctx?.session.sessionId || "",
      ctx?.session.getSettings?.()?.attachments,
    );
  }

  /** 命令输出清洗（与本地 ProcessManager 输出处理一致）：去 ANSI、折叠 \r 帧 */
  private sanitize(text: string): string {
    const s = new StreamingSanitizer();
    return s.feed(text) + s.flush();
  }

  /**
   * run_command 远程分支：经 agent 在远端以 `sh -c` 执行（UTF-8 输出）。
   * 60s 前台超时自动转后台（agent 端语义，与本地 ProcessManager 对齐），
   * 转后台后输出写入远端日志文件，processId 带 "r:<连接名>:" 前缀并登记，
   * 供 process 工具管理与 turn.stopping 续跑钩子收割。
   */
  private async runRemoteCommand(
    target: RemoteToolTarget,
    args: {
      command: string;
      encoding?: string;
      background?: boolean;
      sandbox_permissions?: string;
      justification?: string;
    },
    ctx: PluginContext,
    abortSignal?: AbortSignal,
  ): Promise<string | import("../plugins/api/plugin-api").ToolResultObject> {
    if (args.sandbox_permissions || args.justification) {
      throw new Error(
        "sandbox_permissions only applies to the local sandbox; remote command execution is governed by the connection's permission mode.",
      );
    }
    if (abortSignal?.aborted) throw new Error("Request was aborted");
    this.logger.log(
      `Running remote command: ${args.command}, workspace: ${target.connectionName}`,
    );

    let execResult: import("./process-manager.service").ExecuteResult;
    try {
      execResult = await target.provider.execute(
        args.command,
        target.basePath,
        {
          timeout: this.BACKGROUND_THRESHOLD_MS,
          abortSignal,
          background: args.background === true,
          encoding: args.encoding,
        },
      );
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // 超时/断线/响应丢失：agent 端日志按 requestId 落盘，路径可预测
      const log: string | undefined = e?.predictedLog;
      const readHint = log
        ? ` Read its log file with the read tool (workspace="${target.connectionName}", file_path: "${log}") or check with run_command (workspace="${target.connectionName}"): tail -f ${log}.`
        : "";
      return `[Command did not return in time (${e?.message || e}). It may still be running in the background on the remote server.${readHint}]`;
    }

    const truncatedNote =
      execResult.truncated && execResult.logFilePath
        ? `\n[Note: Output was truncated. The complete log is saved on the remote server at: ${execResult.logFilePath}. Read it with the read tool (workspace="${target.connectionName}").]`
        : "";
    const meta: Record<string, any> = {
      card: "terminal",
      backgrounded: false,
      truncated: !!execResult.truncated,
    };
    if (execResult.logFilePath) meta.logFilePath = execResult.logFilePath;

    if (execResult.kind === "completed") {
      const content = `${execResult.output ? this.sanitize(execResult.output) : "(no output)"}${truncatedNote}\n[exit code: ${execResult.exitCode}, uptime: ${formatDuration(execResult.uptimeMs)}]`;
      meta.exitCode = execResult.exitCode;
      meta.processStatus = execResult.processStatus;
      meta.uptimeMs = execResult.uptimeMs;
      return { content, meta };
    }

    const pid = execResult.processId || "";
    if (pid && ctx?.session.sessionId) {
      this.workspaceRouter.registerRemoteProcess(
        ctx.session.sessionId,
        pid,
        target.connectionName,
        args.encoding,
      );
    }
    const moved = args.background === true
      ? `[Process moved to background, processId: ${pid}.`
      : `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s on the remote server, switched to background. processId: ${pid}.`;
    const content = `${execResult.output ? this.sanitize(execResult.output) : "(no output)"}${truncatedNote}\n${moved} Output is written to the remote log file: ${execResult.logFilePath || "(unknown)"} — read it with the read tool (workspace="${target.connectionName}") or use the process tool (poll) to check status.]`;
    meta.backgrounded = true;
    meta.processId = pid;
    meta.uptimeMs = execResult.uptimeMs;
    return { content, meta };
  }

  /**
   * 回合关闭前续跑钩子（turn.stopping）：收集未接收的 shell 进程输出，子 Agent 额外检查运行状态。
   * 返回 { kind: 'continue', messages } 时 agent-engine 注入 hidden user 消息并触发新一轮 LLM 调用。
   */
  @OnEvent(HOOKS.TURN_STOPPING)
  async handleTurnStopping(
    payload: TurnStoppingPayload,
  ): Promise<TurnStoppingDecision> {
    if (!this._enabled) return undefined;
    const session = payload.sessionContext;
    const isSubAgent = session.sessionType === "sub_agent";

    // 1. 收割已完成进程的输出（不碰运行中进程的 offset）
    const completed = await this.processManager.drainCompleted(
      session.sessionId,
    );

    // 1.5 远程后台进程：收割该会话所有附加（远程）连接上已完成的进程输出
    let remoteCompleted: {
      connectionName: string;
      processId: string;
      status: string;
      exitCode: number | null;
      output: string;
      truncated: boolean;
      logFilePath: string;
    }[] = [];
    try {
      remoteCompleted = await this.workspaceRouter.drainRemoteProcesses(
        session.sessionId,
      );
    } catch (err: any) {
      this.logger.warn(
        `Remote drainCompleted failed (session ${session.sessionId}): ${err?.message || err}`,
      );
    }

    // 2. 子 Agent 检查是否有运行中的进程（本地 + 远程登记）
    const stillRunning = isSubAgent
      ? this.processManager
          .listBySession(session.sessionId)
          .filter((p) => p.status === "running")
      : [];
    const remoteRunningIds = isSubAgent
      ? await this.checkRemoteRunningProcesses(session.sessionId)
      : [];

    // 3. 无已完成输出且无运行中进程 → 不续跑
    const hasOutput =
      completed.some((r) => r.output) ||
      remoteCompleted.some((r) => r.output);
    if (
      !hasOutput &&
      stillRunning.length === 0 &&
      remoteRunningIds.length === 0
    ) {
      return undefined;
    }

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

    for (const r of remoteCompleted) {
      if (!r.output) continue;
      const exitInfo = r.status === "completed" ? ` exitcode:${r.exitCode}` : "";
const truncNote = r.truncated && r.logFilePath
        ? `\n[Note: Output was truncated. The complete log is saved on the remote server at: ${r.logFilePath}. Read it with the read tool (workspace="${r.connectionName}").]`
        : "";
      parts.push(
        `[Remote process ${r.processId} (workspace: ${r.connectionName}),status:${r.status}${exitInfo}]:\nnew Output:\n${r.output}${truncNote}`,
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

    if (remoteRunningIds.length > 0) {
      const list = remoteRunningIds
        .map((id) => `- \`${id}\``)
        .join("\n");
      parts.push(
        `You have ${remoteRunningIds.length} unfinished background processes on remote workspaces:\n${list}\n\nYou must use the process tool (poll) to check their status or terminate them (kill) before ending the current task.`,
      );
    }

    if (parts.length === 0) return undefined;

    return {
      kind: "continue",
      messages: [`<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>`],
    };
  }

  /**
   * 子 Agent 收尾检查：快速轮询登记的远程后台进程（每进程 ≤1s 等待），
   * 返回仍在运行的完整进程 ID（"r:<连接名>:<pid>"）。
   */
  private async checkRemoteRunningProcesses(
    sessionId: string,
  ): Promise<string[]> {
    const tracked = this.workspaceRouter.getTrackedRemoteProcesses(sessionId);
    if (tracked.length === 0) return [];
    const attachments = undefined; // resolveTarget 校验以登记信息为准，无需附件
    const running: string[] = [];
    for (const t of tracked) {
      try {
        const target = await this.workspaceRouter.resolveRemoteTarget(
          t.connectionName,
          sessionId,
          attachments,
        );
        if (!target) continue;
        const fullId = buildRemoteProcessId(t.connectionName, t.pid);
        const r = await target.provider.poll(fullId, 1000, undefined, t.encoding);
        if (r && r.status === "running") running.push(fullId);
      } catch {
        // 连接失效/未绑定：进程随连接消亡，不计入运行中
      }
    }
    return running;
  }

  /**
   * 子 Agent 流结束时，自动杀死该会话下的所有后台进程
   */
  @OnEvent("stream.status_changed")
  handleStreamFinished(event: StreamStatusChangedEvent): void {
    if (event.payload.status === "running") return;
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
