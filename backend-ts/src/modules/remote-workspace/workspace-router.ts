/**
 * WorkspaceToolRouter — 工具层的 workspace 参数路由。
 *
 * 语义（主工作目录 / 附加工作目录模型）：
 * - 参数缺省 / "main" / "local" → 主工作目录（固定本地），返回 null，工具走本地代码路径；
 * - 其他取值 → 附加（远程）工作目录的连接名：解析连接配置、校验会话绑定
 *   （复用 RemoteAgentManager.getAgent 的完整校验与缓存链路），返回远程操作目标。
 *
 * 连接名清单由 ssh-tools 工具包的 prompt 随会话绑定注入，AI 直接抄写连接名。
 */
import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import * as iconv from "iconv-lite";
import { RemoteAgentManager } from "./remote-workspace-agent-manager";
import {
  SshWorkspaceProvider,
  buildRemoteProcessId,
} from "./ssh-workspace-provider";

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

/** 附加（远程）工作目录操作目标 */
export interface RemoteToolTarget {
  /** 连接名（= workspace 参数原值） */
  connectionName: string;
  /** 远端工作目录基准（相对路径解析用，posix 语义） */
  basePath: string;
  /** 远程操作面（WorkspaceProvider 实现） */
  provider: SshWorkspaceProvider;
}

/** 主工作目录标识（本地）：这些取值不启用远程分支 */
export const MAIN_WORKSPACE_VALUES = new Set(["", "main", "local"]);

/** 远程后台进程登记（供 turn.stopping 续跑钩子检查运行状态与输出解码） */
interface TrackedRemoteProcess {
  sessionId: string;
  connectionName: string;
  /** agent 端裸进程 ID（无前缀） */
  pid: string;
  /** 输出编码（run_command 传入；outputB64 解码用，缺省 utf-8） */
  encoding?: string;
}

@Injectable()
export class WorkspaceToolRouter {
  private readonly logger = new Logger(WorkspaceToolRouter.name);

  /** 会话 → 远程后台进程登记（key = 完整前缀 processId） */
  private readonly trackedProcesses = new Map<string, TrackedRemoteProcess>();

  constructor(private readonly manager: RemoteAgentManager) {}

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
    // getAgent 内含：连接存在性、会话绑定校验、按需部署/连接、断线自动重建
    const agent = await this.manager.getAgent(
      workspace,
      sessionId,
      sessionAttachments,
    );
    this.logger.log(
      `Tool target resolved: workspace='${workspace}', sessionId=${sessionId}`,
    );
    return {
      connectionName: workspace,
      basePath: agent.basePath,
      provider: new SshWorkspaceProvider(agent, workspace),
    };
  }

  // ── 远程后台进程登记（turn.stopping 续跑钩子用）──

  /** run_command 远程分支转后台时登记进程（含输出编码，供 poll/drain 解码 outputB64） */
  registerRemoteProcess(
    sessionId: string,
    prefixedProcessId: string,
    connectionName: string,
    encoding?: string,
  ): void {
    this.trackedProcesses.set(prefixedProcessId, {
      sessionId,
      connectionName,
      pid: prefixedProcessId.split(":").pop() || "",
      encoding,
    });
  }

  /** 查询登记进程的输出编码（process 工具 poll 用） */
  getProcessEncoding(prefixedProcessId: string): string | undefined {
    return this.trackedProcesses.get(prefixedProcessId)?.encoding;
  }

  /** 进程结束后清理登记 */
  unregisterRemoteProcess(prefixedProcessId: string): void {
    this.trackedProcesses.delete(prefixedProcessId);
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
      const encoding = this.trackedProcesses.get(fullId)?.encoding;
      out.push({
        connectionName: r.connectionName,
        processId: fullId,
        status: r.status,
        exitCode: r.exitCode,
        output: decodeAgentOutputBytes(r.outputB64, encoding),
        truncated: r.truncated,
        logFilePath: r.logFile,
      });
      // 已收割的登记进程清理
      this.trackedProcesses.delete(fullId);
    }
    return out;
  }
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
