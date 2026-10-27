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
  isCommandPolicyEnforced,
  isShellSandboxSupported,
  sandboxForMode,
  type SandboxMode,
} from "../../common/services/sandbox-policy";
import {
  commandApprovalMemory,
  deriveAllowRule,
  evaluateCommand,
  type CommandPolicyCode,
} from "../../common/services/command-policy";
import { AskService } from "../../common/services/ask.service";
import { PolicyRulesService } from "../../common/services/policy-rules.service";
import { writeApprovalMemory } from "../../common/services/write-approval-memory";
import {
  WorkspaceToolRouter,
  workspaceParamField,
  type RemoteToolTarget,
} from "../remote-workspace/workspace-router";
import {
  buildRemoteProcessId,
  parseRemoteProcessId,
} from "../remote-workspace/agent-workspace-provider";
import { isTransportError } from "../remote-workspace/rpc";
import langZh from "./shell.lang.zh.json";
import langEn from "./shell.lang.en.json";

/**
 * 审批卡里的中文说明（用户可见）：按策略原因码给一句话。
 * 诊断细节（英文，含具体开关/段）只进模型可见的错误文案与日志。
 */
const COMMAND_POLICY_CODE_ZH: Record<CommandPolicyCode, string> = {
  "unknown-command": "该命令不在只读白名单内",
  "unverifiable-syntax": "该命令含无法静态核验的结构（变量、命令替换、写重定向等）",
  "write-signal": "该命令包含写 / 删除操作",
  "no-allowlist": "当前 shell 没有可用的只读白名单",
  // 只读档（名单制）
  "not-whitelisted": "该命令不在当前只读名单内",
  "unsafe-flags": "该命令命中只读名单条目，但参数里带写 / 危险开关",
  "blocked-floor": "该命令是自加的只读条目，但命中了灾难级 / 越界写 / 主机 / 远程动作的兜底",
  "sensitive-path": "该命令要读写敏感文件（凭据 / 密钥 / .env）",
  // 工作档（例外制 + 作用域）
  catastrophic: "该命令属于灾难级操作（格式化磁盘 / 关机 / 下载即执行等），已被直接拒绝",
  "user-deny": "该命令命中你配置的拒绝规则",
  "user-ask": "该命令在你配置的必问项里",
  "out-of-scope": "该命令会操作工作区以外的路径",
  "host-action": "该命令会操作进程 / 服务 / 计划任务（与工作区无关）",
  "remote-side-effect": "该命令带远程或不可逆副作用（推送 / 发布 / 删除容器等）",
  "dynamic-target": "该命令的目标路径是动态拼接的，无法核验是否在工作区内",
  unverifiable: "该命令含无法静态核验的结构",
  "no-workspace": "当前会话没有工作区，无法判定作用域",
};

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
    private readonly policyRules: PolicyRulesService,
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
    const isGitBash = shellKind === "gitbash";
    const shellDesc = this.processManager.getShellInfo();
    const cmdWarning = isCmd
      ? `\n- WARNING: cmd.exe only executes the first line of a multi-line command and silently drops the rest. For multi-line or long commands, write them to a script file (.bat) first, then execute the script`
      : "";
    const psWarning = isPowerShell
      ? `\n- Use PowerShell syntax: separate statements with \`;\` (\`&&\` is not supported in Windows PowerShell 5.1); bash-only syntax (\`export\`, \`source\`, heredocs, \`ls -la\`) will not work. For complex logic, write a .ps1 script file and run it: \`powershell -ExecutionPolicy Bypass -File script.ps1\``
      : "";
    const gitBashNote = isGitBash
      ? `\n- Use POSIX/bash syntax (Git Bash): \`&&\`, \`|\`, redirection, heredocs and \`ls -la\` all work; PowerShell-only syntax (\`Get-ChildItem\`, \`$env:OS\`, \`Select-String\`) does not. For complex logic, write a shell script file and run it: \`bash script.sh\``
      : "";
    // 沙盒模式读的是 sandbox.exe 内置 shell（Windows 固定 PowerShell），与上面的检测结果无关。
    // Windows 默认已无 OS 沙盒（SANDBOX_WIN_ENABLE=1 回归时才可能命中），因此这里按能力门收敛。
    const sandboxShellNote =
      isGitBash && process.platform === "win32" && isShellSandboxSupported()
        ? `\n- **Sandboxed modes use a different shell**: read-only / workspace-write execute commands through the sandbox's built-in Windows PowerShell, so the POSIX syntax above applies only in \`danger-full-access\` (unrestricted) mode.`
        : "";
    // 命令策略层（Windows 无 OS 沙盒）：说明白"什么会直接跑、什么会弹窗"，否则模型会乱试
    const commandPolicyNote = isCommandPolicyEnforced()
      ? `\n- **Command approval (no OS sandbox on this platform)**: in workspace-write mode most commands run directly — the policy only stops catastrophic patterns (disk formatting, raw-device writes, power state, download-and-execute), which are refused outright and cannot be approved; the ask list configured by the user (ssh/scp, git push, npm publish, docker rm, process/service control, ...); destructive actions (rm/mv/Remove-Item/cp/mkdir/Set-Content) whose targets fall outside the workspace or cannot be verified statically; and anything the scanner cannot parse (variable expansion, unknown shell wrappers). In read-only and plan mode only commands on the user's read-only list run — everything else is denied. The user can edit both lists in Settings → Command policy. Keep destructive operations inside the workspace to avoid prompts. There is no escalation parameter: capability changes come from the user, not from the model.`
      : "";
    shellKit.registerTool({
      name: "run_command",
      description: `Use the \`run_command\` command to execute commands
- **Current Shell**: ${shellDesc}${psWarning}${cmdWarning}${gitBashNote}${sandboxShellNote}${commandPolicyNote}
- Commands run in the foreground by default; the tool waits for completion and returns the output
- Foreground commands that exceed **1 minute** will automatically switch to background mode
- Prefer single-line commands when possible; for multi-line or long commands, write them to a script file first, then execute the script
- Background mode (explicit or after the 60s foreground timeout) returns a stable **job id**. Manage everything with the job tools: job_read to read output (pass wait_ms only when genuinely blocked), job_send to write stdin, job_list to list, job_stop to cancel. You will be notified when a background job finishes.
- **Remote workspaces**: with workspace="<connection name>" the command runs via POSIX sh on that remote server (\`encoding\` decodes raw output bytes agent-side). Foreground timeout (60s) switches to background there too; the background job is managed with the same job tools.`,
      inputSchema: z.object({
        command: z
          .string()
          .describe(
            isGitBash
              ? 'Shell command to execute (Git Bash / POSIX), e.g. ls -la, grep -rn "foo" src, git status'
              : isPowerShell
                ? "PowerShell command to execute, e.g. Get-ChildItem, $env:OS, node script.js"
                : "System command to execute, e.g. ls -la, echo hello, node script.js",
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            isGitBash
              ? "Output encoding format. Git Bash emits UTF-8 and it is auto-detected; set explicitly only when auto-detection misfires."
              : "Output encoding format. Use 'gbk' for Windows Chinese environment; defaults to 'utf-8' on Unix. Auto-detected if not specified.",
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
        // Windows 上 OS 沙盒已停用（兼容性问题），由下方命令策略层（白名单 + 审批）接管。
        const sandboxSupported = isShellSandboxSupported();
        const mode: SandboxMode =
          session?.getSandboxMode?.() ?? "workspace-write";
        let sandbox: SandboxOptions | undefined = sandboxSupported
          ? sandboxForMode(mode)
          : undefined;

        // 计划模式（协作状态）：强制只读执行，无视会话安全档位——
        // 计划阶段必须能跑 git status / ls 这类只读命令做调研，写入一律拒绝。
        // 只改本次调用的选项，不改写 session.sandboxMode（两者正交）。
        const planMode = session?.getPlanEnabled?.() === true;
        if (planMode) {
          sandbox = sandboxSupported ? sandboxForMode("read-only") : undefined;
        }
        /** 错误信息里呈现的有效档位（计划模式下真实生效的是 read-only） */
        const effectiveMode: SandboxMode = planMode ? "read-only" : mode;

        // sandbox 不可用时提前报错（execute/background 内部也会检查，fail-closed 不静默放行）
        if (sandbox?.enabled) {
          if (!(await this.processManager.isSandboxAvailable())) {
            throw new Error(
              `The session sandbox mode is ${effectiveMode}, but the sandbox binary is currently unavailable. Please use other tools or inform the user.`,
            );
          }
        }

        // ── 命令策略门（Windows）：只读白名单自动放行，其余按档位审批或拒绝 ──
        await this.enforceCommandPolicy(command, effectiveMode, ctx, abortSignal);

        // 模型不能自我提权：本工具没有提权参数。能力放宽只有两条路——
        // 命令策略的审批卡（本次允许 / 本会话内始终允许 / 拒绝），或用户在界面上切换档位。

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
            // 沙盒拒绝提示：引导用户在界面上切换档位（模型不能自我提权）
            lines.push(
              `[sandbox: denied — if this access is really needed, ask the user to switch the session mode to a wider one]`,
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
          const jobHint = execResult.jobId
            ? ` Use job_read ${execResult.jobId} to read the output, job_send to write stdin, or job_stop to stop it.`
            : "";
          const bgMsg = background
            ? `[Process moved to background. Job ID: ${execResult.jobId ?? execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}.${jobHint}]`
            : `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s, switched to background. Job ID: ${execResult.jobId ?? execResult.processId}, uptime: ${formatDuration(execResult.uptimeMs)}.${jobHint}]`;
          const logLine = execResult.logFilePath
            ? `\nLog file: ${execResult.logFilePath}`
            : "";
          content = `${body}${truncatedNote}\n${bgMsg}${logLine}`;
          meta.backgrounded = true;
          // processId 仅 UI tooltip 通道，模型面只见 jobId
          meta.processId = execResult.processId;
          if (execResult.jobId) meta.jobId = execResult.jobId;
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
      // 计划模式放行，但 handler 强制以只读沙盒执行（见本文件 getPlanEnabled 分支）
      allowedInPlanMode: true,
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
- Use job_stop to terminate a background job that is no longer needed
 ${
   isNotSubAgent
     ? `
- After switching to background, you can work on other tasks in parallel, or end the current turn and wait for system notifications
- The system will automatically notify you when a background job finishes — no need for continuous polling
- Background commands return a stable **job id** (job-...). Manage everything through the job tools: job_read reads the log tail or an offset increment without consuming it (pass wait_ms only when genuinely blocked), job_send writes stdin (shell) or continues a sub-agent conversation, job_list lists this session's jobs, job_stop cancels
- Reading a terminal job (or job_stop) marks the output as observed and suppresses the completion notification; reading a running job is only a snapshot`
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
   * 命令策略门（Windows 去沙盒后的强制层）。
   *
   * 语义（用户确认的方案）：
   *   - read-only       档：**名单制**——名单内放行，其余直接拒绝（不弹窗；名单在设置页可增删）
   *   - workspace-write 档：**例外制**——默认执行，只有必问项 / 越界写 / 灾难级才拦
   *   - danger-full-access 档：不判定
   *   - 无人能应答审批（子代理 / 机器人 / 前端未连接）→ 直接拒绝，绝不挂起
   *
   * 说明：这是对 docs/交互层统一Ask方案.md「无超时」语义的**显式例外**——只在命令策略
   * 这一条路径上 fail-closed，文件写入/计划审批的既有 ask 语义不变。
   */
  private async enforceCommandPolicy(
    command: string,
    effectiveMode: SandboxMode,
    ctx: PluginContext | undefined,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (!isCommandPolicyEnforced()) return;
    if (effectiveMode === "danger-full-access") return;

    const decision = evaluateCommand({
      command,
      shellKind: this.processManager.getShellKind(),
      // 只读档走名单制（内置只读名单物化在 policy.yaml 里）；工作档走例外制 + 作用域
      mode: effectiveMode === "read-only" ? "read-only" : "workspace-write",
      workspacePath: ctx?.session.workspacePath,
      // 两档配置（全局 + 项目级，mtime 缓存）；提供 policy 即"已物化"语义
      policy: this.policyRules.getEffectivePolicySync(ctx?.session.workspacePath),
    });
    if (decision.kind === "whitelisted") return;

    const reasonText = `[${decision.code}] ${decision.reason}`;

    // 灾难级 / 用户 deny 规则：系统硬拒，不进审批（审批也放不通）
    if (decision.kind === "denied") {
      if (
        effectiveMode === "read-only" &&
        decision.code !== "catastrophic" &&
        decision.code !== "user-deny"
      ) {
        throw new Error(
          `Read-only mode denied this command: it is not in the read-only list (${reasonText}). ` +
            `Use read-only commands from the list (git status/diff/log/show, ls, cat, head/tail, grep/rg, find without -delete/-exec, Get-ChildItem/Get-Content/Select-String, ...), ` +
            `ask the user to add it under Settings → Command policy (read-only list), or to switch the session mode to workspace-write.`,
        );
      }
      throw new Error(
        `Command refused by policy and cannot be approved (${reasonText}). ` +
          `This class of command is permanently blocked (disk formatting, raw-device writes, power state, download-and-execute, or a user deny rule). ` +
          `Pick a different approach and explain the blocker to the user.`,
      );
    }

    if (effectiveMode === "read-only") {
      // 只读档只产生 whitelisted / denied，这里只是保底（例如未来新增的结论码）
      throw new Error(
        `Read-only mode denied this command: it is not a verified read-only command (${reasonText}). ` +
          `Use read-only commands from the list, or ask the user to switch the session mode to workspace-write.`,
      );
    }

    // workspace-write：本会话内已批准过同一条命令 / 同一个敏感路径 → 直接放行
    const session = ctx?.session;
    const sessionId = session?.sessionId || "";
    if (sessionId && commandApprovalMemory.has(sessionId, command)) return;
    if (decision.pathHit && sessionId && writeApprovalMemory.has(sessionId, decision.pathHit.target)) {
      return;
    }

    const canAsk = session?.hasAnswerSurface
      ? session.hasAnswerSurface()
      : session?.sessionType === "web";
    if (!canAsk) {
      throw new Error(
        `Command not run: it needs the user's approval, but no approval prompt can be shown right now ` +
          `(the desktop UI has no live connection, or this is a sub-agent / bot session), and the command is not read-only-verified (${reasonText}). ` +
          `Use a read-only command instead, or report back to the user and let them run it in a session they are watching.`,
      );
    }

    // 放通规则：敏感路径 → 命中那条路径 glob；越界类 → 不推导（`rm *` 会把"越界"一起放通）
    const allowRule = decision.pathHit
      ? decision.pathHit.glob
      : decision.code === "out-of-scope"
        ? null
        : deriveAllowRule(command);

    // 本次允许 / 放通此类（本项目）/ 放通此类（全局）/ 拒绝
    // （拒绝与自定义回复抛 AskDeniedError，工具层已按 isError 反馈模型）
    const approval = await this.askService.requestCommandApproval(session as any, {
      toolCallId: ctx?.toolCallId,
      command,
      // 审批卡给用户看：用中文一句话说明为什么需要批准（诊断细节只进模型可见的错误与日志）
      reason: `${COMMAND_POLICY_CODE_ZH[decision.code]}，需要你确认`,
      allowRule,
      allowRuleKind: decision.pathHit ? "path" : "command",
      pathDetail: decision.pathHit
        ? { target: decision.pathHit.target, op: decision.pathHit.op }
        : undefined,
      abortSignal,
    });

    let persisted = false;
    if (approval !== "once" && allowRule) {
      try {
        await this.policyRules.appendRule(
          approval.scope,
          decision.pathHit
            ? { action: "allow", path: allowRule }
            : { action: "allow", match: allowRule },
          session?.workspacePath,
        );
        persisted = true;
        this.logger.log(`Allow rule persisted (${approval.scope}): ${allowRule}`);
      } catch (e: any) {
        this.logger.warn(`failed to persist allow rule "${allowRule}": ${e?.message ?? e}`);
      }
    }
    // 落盘失败（或推导不出规则）时退回会话内记忆：至少本会话不重复打扰
    if (!persisted && approval !== "once" && sessionId) {
      commandApprovalMemory.remember(sessionId, command);
    }
    // 敏感路径：本次放行后本会话内记住这个目标（"每会话首次触碰问一次"）
    if (decision.pathHit && sessionId && approval !== "once") {
      writeApprovalMemory.remember(sessionId, decision.pathHit.target);
    }
    this.logger.log(
      `Command approved (${approval === "once" ? "once" : approval.scope}) by policy prompt: ${command.slice(0, 120)}`,
    );
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
    },
    ctx: PluginContext,
    abortSignal?: AbortSignal,
  ): Promise<string | import("../plugins/api/plugin-api").ToolResultObject> {
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
      // 分流:传输类失败(超时/断线/agent 退出)命令可能已在远端运行,输出落在 agent 日志目录;
      // agent 明确拒绝(如工作目录不存在)则进程从未启动,直接把原因说清楚,不提示去读日志。
      if (!isTransportError(e)) {
        return (
          `[Remote command failed on "${target.connectionName}": ${e?.message || e}. ` +
          `The command did not start. If this mentions a working directory, fix the connection's path ` +
          `in workspace settings (the path is resolved on the remote host).]`
        );
      }
      return `[Command did not return in time (${e?.message || e}). It may still be running in the background on the remote server. Its output (if any) is written to the agent's log directory (guada-logs under the remote temp dir) — inspect it with glob/read (workspace="${target.connectionName}") on that directory.]`;
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
    let jobId = execResult.jobId;
    if (pid && ctx?.session.sessionId) {
      // 旧 agent（<0.7）没有 process_done/readProcess：只登记 processId 供
      // turn.stopping 收割，不注册一个永远不会结算的 job。
      const canRegisterJob =
        !!execResult.jobId && target.provider.supportsRemoteJobs;
      jobId = this.workspaceRouter.registerRemoteProcess(
        ctx.session.sessionId,
        pid,
        target.connectionName,
        args.encoding,
        canRegisterJob
          ? {
              command: args.command,
              logFilePath: execResult.logFilePath,
              provider: target.provider,
              // agent 侧 jobId：process_done 推送按它匹配（与本地 job-* 不同源）
              agentJobId: execResult.jobId,
            }
          : undefined,
      );
    }
    const jobHint = jobId
      ? ` Use job_read ${jobId} to read the output or job_stop to stop it.`
      : "";
    const moved = args.background === true
      ? `[Process moved to background. Job ID: ${jobId ?? pid}.`
      : `[Command exceeded ${this.BACKGROUND_THRESHOLD_MS / 1000}s on the remote server, switched to background. Job ID: ${jobId ?? pid}.`;
    const content = `${execResult.output ? this.sanitize(execResult.output) : "(no output)"}${truncatedNote}\n${moved}${jobHint} Output is written to the remote log file: ${execResult.logFilePath || "(unknown)"} — read it with the read tool (workspace="${target.connectionName}").]`;
    meta.backgrounded = true;
    meta.processId = pid;
    if (jobId) meta.jobId = jobId;
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

    // 3. 无已完成进程且无运行中进程 → 不续跑。
    // 本地已完成进程本身就要告知（含无输出：drain 已消费该完成事件并清理 entry，
    // 队列里的 process_monitor 通知随之失效，若不在此续跑，静默完成的信息也会丢失）；
    // 远程保持"有输出才续跑"的既有语义。
    const hasLocalCompleted = completed.length > 0;
    const hasRemoteOutput = remoteCompleted.some((r) => r.output);
    if (
      !hasLocalCompleted &&
      !hasRemoteOutput &&
      stillRunning.length === 0 &&
      remoteRunningIds.length === 0
    ) {
      return undefined;
    }

    // 4. 组装消息
    const parts: string[] = [];

    for (const result of completed) {
      const exitInfo =
        result.status === "completed"
          ? ` exitcode:${result.exitCode}`
          : "";
      const truncNote =
        result.truncated && result.logFilePath
          ? `\n[Note: Output was truncated. The complete log is saved at: ${result.logFilePath}. You can read it using the run_command tool if needed.]`
          : "";
      parts.push(
        `[Process ${result.processId},status:${result.status}${exitInfo}]:\nnew Output:\n${result.output || "(no output)"}${truncNote}`,
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
        .map((p) => `- \`${p.jobId ?? p.id}\` (${p.command})`)
        .join("\n");
      parts.push(
        `You have ${stillRunning.length} unfinished background jobs:\n${list}\n\nYou must use job_read to check their output (pass wait_ms to block until finished) or job_stop to terminate them before ending the current task.`,
      );
    }

    if (remoteRunningIds.length > 0) {
      const list = remoteRunningIds
        .map((id) => `- \`${id}\``)
        .join("\n");
      parts.push(
        `You have ${remoteRunningIds.length} unfinished background jobs on remote workspaces:\n${list}\n\nYou must use job_read to check their status or job_stop to terminate them before ending the current task.`,
      );
    }

    if (parts.length === 0) return undefined;

    return {
      kind: "continue",
      messages: [`<system_reminder>\n${parts.join("\n\n")}\n</system_reminder>`],
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
