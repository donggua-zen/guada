import type { FileRef } from "../../../../common/types/conversation.types";
import type { ComputerLeaseRegistry } from "../computer-use/lease";
import type { ComputerPolicyKey } from "../computer-use/policy";

export type ComputerScriptStatus = "completed" | "failed" | "cancelled";

export interface ComputerScriptErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ComputerScriptTraceStep {
  method: string;
  target?: string;
  ok: boolean;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface ComputerScriptScreenshot {
  ref?: FileRef;
  absolutePath?: string;
  width?: number;
  height?: number;
}

export interface ComputerScriptRunResult {
  status: ComputerScriptStatus;
  value?: unknown;
  error?: ComputerScriptErrorPayload;
  trace: ComputerScriptTraceStep[];
  screenshots: ComputerScriptScreenshot[];
  logs: string[];
  durationMs: number;
  /** 是否发生过任何桌面调用（纯参数错误时不需要 sidecar 兜底） */
  usedComputer: boolean;
}

export interface ComputerScriptAuthorizeRequest {
  /** 与设置页一致的策略键 */
  policyKey: ComputerPolicyKey;
  /** 展示在审批卡里的人类可读动作摘要 */
  detail: string;
  /** observe / input / launch；input 与 launch 在计划模式下被拒 */
  phase: "observe" | "input" | "launch";
}

export interface ComputerScriptHooks {
  sessionId: string;
  leases: ComputerLeaseRegistry;
  /** 策略 + 审批 + 计划模式门（由插件注入，运行时只负责调用） */
  authorize: (
    request: ComputerScriptAuthorizeRequest,
    signal?: AbortSignal,
  ) => Promise<void>;
  isPlanMode: () => boolean;
  /** sidecar 截图的临时输出目录；缺省用 os.tmpdir() */
  screenshotDir?: string;
  /**
   * 截图落盘回调（由插件按会话注入，运行时只传字节）。
   * 返回会话副本引用与物理路径；运行时会把路径回给脚本。
   */
  persistScreenshot?: (
    data: Buffer,
    meta: { width?: number; height?: number },
  ) => Promise<{ ref?: FileRef; absolutePath: string }>;
}

export interface ComputerScriptRunParams {
  script: string;
  name?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  hooks: ComputerScriptHooks;
}

export class ComputerScriptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ComputerScriptError";
  }
}
