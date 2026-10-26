/**
 * WorkspaceToolRouter — 工具层的 workspace 参数路由。
 *
 * 语义（主工作目录 / 附加工作目录模型）：
 * - 参数缺省 / "main" / "local" → 主工作目录（固定本地），返回 null，工具走本地代码路径；
 * - 其他取值 → 附加（远程/容器）工作目录的连接名：解析连接配置、校验会话绑定
 *   （复用 RemoteAgentManager.getAgent 的完整校验与缓存链路），返回远程操作目标。
 *   连接类型（SSH 主机 / Docker 容器）由连接的 config.kind 决定，传输细节对工具层透明。
 *
 * 连接名清单由 ssh-tools 工具包的 prompt 随会话绑定注入，AI 直接抄写连接名。
 */
import { Injectable, Logger, Optional } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { z } from "zod";
import * as iconv from "iconv-lite";
import { RemoteAgentManager } from "./remote-workspace-agent-manager";
import {
  AgentWorkspaceProvider,
  buildRemoteProcessId,
} from "./agent-workspace-provider";
import { JobRegistryService } from "../jobs/job-registry.service";
import type { JobId, JobOutcome } from "../jobs/job.types";

/**
 * workspace 参数 schema（file / shell 工具共用）：
 * 缺省或 "main" = 主本地目录；其他取值 = 绑定到本会话的远程连接名。
 */
export const workspaceParamField = z
  .string()
  .optional()
  .describe(
    "Target workspace: omit or 'main' for the primary local workspace; otherwise the name of a remote connection bound to this session (see bound connections in context)",
  );

/** 附加（远程/容器）工作目录操作目标 */
export interface RemoteToolTarget {
  /** 连接名（= workspace 参数原值） */
  connectionName: string;
  /** 目标工作目录基准（相对路径解析用，posix 语义） */
  basePath: string;
  /** 目标操作面（WorkspaceProvider 实现；SSH 与 Docker 共用） */
  provider: AgentWorkspaceProvider;
}

/** 主工作目录标识（本地）：这些取值不启用远程分支 */
export const MAIN_WORKSPACE_VALUES = new Set(["", "main", "local"]);

/** 远程后台进程登记（供 turn.stopping 续跑钩子 + JobRegistry 使用） */
interface TrackedRemoteProcess {
  sessionId: string;
  connectionName: string;
  /** agent 端裸进程 ID（无前缀） */
  pid: string;
  /** 输出编码（run_command 传入；outputB64 解码用，缺省 utf-8） */
  encoding?: string;
  /** 通用后台作业 id（0.7+ agent / 注册成功时存在）——本地 job-*，与 agent 侧不同源 */
  jobId?: JobId;
  /**
   * 远端 agent 侧的作业 id（execute 回传）。**与本地 jobId 不是同一个 id 空间**，
   * 只用于匹配 agent 的 process_done 推送（push 可能早于本地注册）。
   */
  agentJobId?: string;
  /** 结算 deferred（push / drain / lost 三处 first-wins） */
  resolve?: (outcome: JobOutcome) => void;
  settled?: boolean;
  /** 最后一次已知的远端日志大小（供快照，非实时） */
  logSize?: number;
  /** 命令文本（job label） */
  label?: string;
}

@Injectable()
export class WorkspaceToolRouter {
  private readonly logger = new Logger(WorkspaceToolRouter.name);

  /** 会话 → 远程后台进程登记（key = 完整前缀 processId） */
  private readonly trackedProcesses = new Map<string, TrackedRemoteProcess>();
  /** push 早于 job 注册时的短缓冲（key = agent 侧 jobId 或完整 processId） */
  private readonly pendingRemoteCompletions = new Map<
    string,
    { data: Record<string, any>; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly manager: RemoteAgentManager,
    @Optional() private readonly jobRegistry?: JobRegistryService,
  ) {}

  /**
   * 解析工具的 workspace 参数。
   *
   * @returns null = 主工作目录（本地）；RemoteToolTarget = 附加远程工作目录
   * @throws 连接不存在 / 未绑定本会话 / 连接失败时抛错（错误信息含可用连接清单）
   */
  async resolveRemoteTarget(
    workspace: string | undefined,
    sessionId: string,
    sessionAttachments?: Record<string, string[]>,
  ): Promise<RemoteToolTarget | null> {
    if (!workspace || MAIN_WORKSPACE_VALUES.has(workspace)) {
      return null;
    }
    // getAgent 内含：连接存在性、会话绑定校验、按需部署/连接（SSH 部署或容器注入）、断线自动重建
    const agent = await this.manager.getAgent(
      workspace,
      sessionId,
      sessionAttachments,
    );
    // 连接类型（ssh / docker）决定 provider.scheme；传输差异对工具层透明
    const scheme = agent.connectionKind;
    this.logger.log(
      `Tool target resolved: workspace='${workspace}' (${scheme}), sessionId=${sessionId}`,
    );
    return {
      connectionName: workspace,
      basePath: agent.basePath,
      provider: new AgentWorkspaceProvider(agent, workspace, scheme),
    };
  }

  // ── 远程后台进程登记（turn.stopping 续跑钩子用）──

  /** run_command 远程分支转后台时登记进程，并在 0.7+ agent 上注册通用 job。 */
  registerRemoteProcess(
    sessionId: string,
    prefixedProcessId: string,
    connectionName: string,
    encoding?: string,
    options?: {
      command?: string;
      logFilePath?: string;
      provider?: AgentWorkspaceProvider;
      /** agent 侧作业 id（execute 回传），仅用于匹配 process_done 推送 */
      agentJobId?: string;
    },
  ): JobId | undefined {
    const tracked: TrackedRemoteProcess = {
      sessionId,
      connectionName,
      pid: prefixedProcessId.split(":").pop() || "",
      encoding,
      label: options?.command,
      agentJobId: options?.agentJobId,
    };
    this.trackedProcesses.set(prefixedProcessId, tracked);

    if (!this.jobRegistry || !options?.provider || !options.command) {
      return undefined;
    }

    let resolveJob!: (outcome: JobOutcome) => void;
    const done = new Promise<JobOutcome>((resolve) => {
      resolveJob = resolve;
    });

    try {
      const jobId = this.jobRegistry.start({
        kind: "remote-shell",
        label: options.command,
        sessionId,
        handle: prefixedProcessId,
        logFilePath: options.logFilePath,
        notify: true,
        getLogSize: async () => tracked.logSize,
        read: async (opts) => {
          const result = await options.provider!.readProcess(
            prefixedProcessId,
            { offset: opts.offset, maxBytes: opts.maxBytes },
            encoding,
          );
          tracked.logSize = result.size;
          return {
            text: result.text,
            offset: result.offset,
            nextOffset: result.nextOffset,
            size: result.size,
            truncated: result.truncated,
            logFilePath: result.logFilePath,
          };
        },
        cancel: () => {
          options.provider!.kill(prefixedProcessId);
        },
        send: async (input, appendNewline) => {
          options.provider!.writeToStdin(
            prefixedProcessId,
            appendNewline === false ? input : `${input}\n`,
          );
        },
        onDisposed: () => this.trackedProcesses.delete(prefixedProcessId),
        done,
      });
      tracked.jobId = jobId;
      tracked.resolve = resolveJob;
      // push 可能早于注册：注册完成后立即消费短缓冲。
      // key 用 agent 侧 jobId（不是本地 jobId）与完整 processId——两端 id 不同源。
      if (options.agentJobId) {
        this.consumePendingRemoteCompletion(options.agentJobId, tracked);
      }
      this.consumePendingRemoteCompletion(prefixedProcessId, tracked);
      return jobId;
    } catch (error: any) {
      this.logger.warn(
        `注册远程后台作业失败 (${prefixedProcessId})，继续用 process/turn.stopping: ${error?.message ?? error}`,
      );
      return undefined;
    }
  }

  /** 查询登记进程的输出编码（process 工具 poll 用） */
  getProcessEncoding(prefixedProcessId: string): string | undefined {
    return this.trackedProcesses.get(prefixedProcessId)?.encoding;
  }

  /** 进程结束后清理登记；主动 kill 时同时抑制完成通知并结算为 killed。 */
  unregisterRemoteProcess(prefixedProcessId: string): void {
    const tracked = this.trackedProcesses.get(prefixedProcessId);
    if (tracked?.jobId) {
      this.jobRegistry?.markReported(tracked.jobId);
      this.settleTrackedRemote(tracked, {
        status: "killed",
        exitCode: null,
      });
    }
    this.trackedProcesses.delete(prefixedProcessId);
  }

  // ── 远程 job 结算 ──

  /**
   * agent 推送 process_done：按 **agent 侧 jobId**（execute 回传的那个）优先匹配，
   * 完整 processId 兜底。
   *
   * 注意不能用本地 `tracked.jobId`（job-*）去比 `event.jobId`：两端是不同 id 空间，
   * 本地从未把 job-* 发给 agent，那样比较永远不命中（历史实现的死快路径）。
   */
  @OnEvent("remote.process.done")
  handleRemoteProcessDone(event: Record<string, any>): void {
    const processId = String(event?.processId || "");
    if (!processId) return;
    const fullId = buildRemoteProcessId(
      String(event.connectionName || ""),
      processId,
    );
    const agentJobId = event.jobId ? String(event.jobId) : "";
    let tracked: TrackedRemoteProcess | undefined;
    if (agentJobId) {
      tracked = [...this.trackedProcesses.values()].find(
        (t) => t.agentJobId === agentJobId,
      );
    }
    tracked ||= this.trackedProcesses.get(fullId);

    if (!tracked) {
      if (agentJobId) this.bufferRemoteCompletion(agentJobId, event);
      this.bufferRemoteCompletion(fullId, event);
      return;
    }
    this.settleTrackedRemote(tracked, event);
  }

  /** 连接断开：该连接下未结算的远程 job 统一标记 lost。 */
  @OnEvent("remote.process.disconnected")
  handleRemoteProcessDisconnected(event: Record<string, any>): void {
    const sessionId = String(event?.sessionId || "");
    const connectionName = String(event?.connectionName || "");
    for (const [id, tracked] of this.trackedProcesses) {
      if (
        tracked.sessionId !== sessionId ||
        tracked.connectionName !== connectionName ||
        tracked.settled
      ) {
        continue;
      }
      this.settleTrackedRemote(tracked, {
        status: "lost",
        exitCode: null,
        output:
          "[connection lost; the remote process may still be running on the host]",
        detail: "connection lost; remote process may still be running",
      });
      this.trackedProcesses.delete(id);
    }
  }

  private settleTrackedRemote(
    tracked: TrackedRemoteProcess,
    event: Record<string, any>,
  ): void {
    if (tracked.settled) return;
    tracked.settled = true;
    tracked.resolve?.({
      status: mapRemoteJobStatus(event.status, event.exitCode),
      detail: event.detail,
      exitCode: event.exitCode ?? null,
      output: event.output,
    });
  }

  private bufferRemoteCompletion(
    key: string,
    data: Record<string, any>,
  ): void {
    if (!key) return;
    const existing = this.pendingRemoteCompletions.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingRemoteCompletions.delete(key);
    }, 10_000);
    timer.unref?.();
    this.pendingRemoteCompletions.set(key, { data, timer });
  }

  private consumePendingRemoteCompletion(
    key: string,
    tracked: TrackedRemoteProcess,
  ): void {
    const pending = this.pendingRemoteCompletions.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRemoteCompletions.delete(key);
    this.settleTrackedRemote(tracked, pending.data);
  }

  /** 查询某会话登记的远程后台进程 */
  getTrackedRemoteProcesses(sessionId: string): TrackedRemoteProcess[] {
    const out: TrackedRemoteProcess[] = [];
    for (const t of this.trackedProcesses.values()) {
      if (t.sessionId === sessionId) out.push(t);
    }
    return out;
  }

  /**
   * 回合关闭前收割该会话所有远程连接上已完成的后台进程输出。
   * manager 返回原始 outputB64，此处按进程登记的 encoding 逐行解码；
   * 只收割已完成进程（与本地 drainCompleted 语义一致），不阻塞续跑。
   */
  async drainRemoteProcesses(
    sessionId: string,
  ): Promise<
    { connectionName: string; processId: string; status: string; exitCode: number | null; output: string; truncated: boolean; logFilePath: string }[]
  > {
    const rows = await this.manager.drainSessionProcesses(sessionId);
    const out: {
      connectionName: string;
      processId: string;
      status: string;
      exitCode: number | null;
      output: string;
      truncated: boolean;
      logFilePath: string;
    }[] = [];
    for (const r of rows) {
      const fullId = buildRemoteProcessId(r.connectionName, r.processId);
      const tracked = this.trackedProcesses.get(fullId);
      const output = decodeAgentOutputBytes(r.outputB64, tracked?.encoding);
      if (tracked?.jobId) {
        // 当前 turn 已交付输出：抑制完成通知，并给 job 一个终态。
        this.jobRegistry?.markReported(tracked.jobId);
        this.settleTrackedRemote(tracked, {
          status: r.status,
          exitCode: r.exitCode,
          output,
        });
      }
      out.push({
        connectionName: r.connectionName,
        processId: fullId,
        status: r.status,
        exitCode: r.exitCode,
        output,
        truncated: r.truncated,
        logFilePath: r.logFile,
      });
      // 已收割的登记进程清理
      this.trackedProcesses.delete(fullId);
    }
    return out;
  }
}

/** 远端进程状态 → 通用 job 终态 */
function mapRemoteJobStatus(
  status: unknown,
  exitCode: unknown,
): "completed" | "failed" | "killed" | "lost" {
  const value = String(status || "");
  if (value === "killed") return "killed";
  if (value === "lost") return "lost";
  if (value === "failed") return "failed";
  if (value === "completed") {
    return typeof exitCode === "number" && exitCode !== 0
      ? "failed"
      : "completed";
  }
  return "failed";
}

/** outputB64 → 按编码解码为文本（无效编码降级 utf-8） */
function decodeAgentOutputBytes(b64: string, encoding?: string): string {
  if (!b64) return "";
  const buf = Buffer.from(b64, "base64");
  const enc = (encoding || "utf-8").toLowerCase();
  try {
    return iconv.decode(buf, enc === "utf8" ? "utf-8" : enc);
  } catch {
    return buf.toString("utf-8");
  }
}
