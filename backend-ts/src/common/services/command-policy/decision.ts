/**
 * 命令策略：双方言合成决策。
 *
 * 执行壳是权威：命令最终由检测到的壳执行（Git Bash → POSIX 语义；PowerShell → PS 语义），
 * 因此以**执行壳方言**的判定为准；另一个方言只作"绊线"——它一旦判定为已知写操作，
 * 即使执行壳那边看着只读也不放行（例如在 PS 下 `rm -rf x` 其实是 Remove-Item）。
 *
 * 合成规则（executing = 执行壳方言，other = 另一方言）：
 *   executing=read-only 且 other≠unsafe      → 白名单
 *   executing=read-only 且 other=unsafe      → 需审批（保守）
 *   其余（executing 为 unknown/unsafe）       → 需审批
 */

import { analyzePosixCommand } from "./posix-rules";
import { analyzePowerShellCommand } from "./powershell-rules";
import { scanCommand } from "./scan";
import {
  evaluateWorkspaceCommand,
  type CommandRuleSet,
} from "./workspace-rules";
import type {
  CommandDecision,
  CommandPolicyCode,
  PolicyMode,
  PolicyShellKind,
  ShellDialect,
} from "./types";

export interface CommandPolicyInput {
  command: string;
  /** 当前执行壳（process-manager.getShellKind()） */
  shellKind: PolicyShellKind;
  /** 档位；缺省 `read-only`（保持既有调用方语义不变） */
  mode?: PolicyMode;
  /** 会话工作区（工作档作用域判定的基准） */
  workspacePath?: string;
  /** 用户规则（工作档）；缺省即内置判定 */
  rules?: CommandRuleSet;
}

function executingDialect(shellKind: PolicyShellKind): ShellDialect | null {
  if (shellKind === "gitbash") return "posix";
  if (shellKind === "powershell") return "powershell";
  return null; // cmd / sh：没有可用的只读白名单
}

function analyzeBy(dialect: ShellDialect, command: string) {
  return dialect === "posix"
    ? analyzePosixCommand(command)
    : analyzePowerShellCommand(command);
}

/** 用扫描结果区分"不可核验"与"只是不在白名单" */
function classifyCode(dialect: ShellDialect, command: string): CommandPolicyCode {
  const { problems } = scanCommand(command, dialect);
  if (problems.some((p) => p.code === "write-redirect")) return "write-signal";
  if (problems.length > 0) return "unverifiable-syntax";
  return "unknown-command";
}

function summarize(reasons: readonly string[]): string {
  const unique = [...new Set(reasons.filter(Boolean))];
  if (unique.length === 0) return "not in the read-only allowlist";
  return unique.slice(0, 3).join("; ");
}

/**
 * 判定一条命令。
 *
 * - `mode === "workspace-write"`：走黑名单 + 作用域（默认放行，T0 硬拒，越界/不可核验 → 待审批）
 * - 其余（含缺省）：走既有的只读白名单（不在白名单内 → 待审批）
 */
export function evaluateCommand(input: CommandPolicyInput): CommandDecision {
  if (input.mode === "workspace-write") {
    const verdict = evaluateWorkspaceCommand({
      command: input.command,
      shellKind: input.shellKind,
      workspacePath: input.workspacePath,
      rules: input.rules,
    });
    if (verdict.tier === "allow") {
      return { kind: "whitelisted", reason: `workspace-write policy: ${verdict.reason}` };
    }
    return {
      kind: verdict.tier === "block" ? "denied" : "needs-approval",
      code: verdict.code ?? "unverifiable",
      reason: verdict.reason,
    };
  }

  const dialect = executingDialect(input.shellKind);
  if (!dialect) {
    return {
      kind: "needs-approval",
      code: "no-allowlist",
      reason: `no read-only allowlist for shell (${input.shellKind})`,
    };
  }

  const executing = analyzeBy(dialect, input.command);
  const otherDialect: ShellDialect = dialect === "posix" ? "powershell" : "posix";
  const other = analyzeBy(otherDialect, input.command);

  if (executing.verdict === "read-only") {
    if (other.verdict === "unsafe") {
      return {
        kind: "needs-approval",
        code: "write-signal",
        reason: `write operation under ${otherDialect} semantics: ${summarize(other.reasons)}`,
      };
    }
    return { kind: "whitelisted", reason: "read-only allowlist" };
  }

  return {
    kind: "needs-approval",
    code:
      executing.verdict === "unsafe"
        ? "write-signal"
        : classifyCode(dialect, input.command),
    reason: summarize(executing.reasons),
  };
}
