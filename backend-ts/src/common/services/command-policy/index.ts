/**
 * 命令策略：对外出口。
 *
 * 用途：Windows 上不再使用 OS 沙盒（sandbox.exe 的受限令牌 + ACL 授权在 Windows 上
 * 兼容性差），改为进程内判定 + 人工审批：
 *   - read-only       档：只读白名单内放行，其余拒绝（不弹窗）
 *   - workspace-write 档：黑名单 + 作用域（区内动作默认放行；越界 / 主机级 / 远程副作用 /
 *                        不可核验 → 弹窗；灾难级 → 硬拒且不可放通）；用户可配 allow/ask/deny 规则
 *   - danger-full-access 档：不判定
 * Linux/macOS 不受影响（继续用 Landlock/Seatbelt 沙盒）。
 */

export { evaluateCommand, type CommandPolicyInput } from "./decision";
export {
  EMPTY_RULE_SET,
  catastrophicPatternOf,
  deriveAllowRule,
  evaluateWorkspaceCommand,
  matchRule,
  normalizeScopePath,
  splitRawSegments,
  unwrapShellWrapper,
  type CommandRuleSet,
  type WorkspaceCode,
  type WorkspaceVerdict,
} from "./workspace-rules";
export {
  CommandApprovalMemory,
  commandApprovalMemory,
  normalizeCommandKey,
} from "./approval-memory";
export type {
  CommandDecision,
  CommandPolicyCode,
  DialectAnalysis,
  DialectVerdict,
  PolicyMode,
  PolicyShellKind,
  ShellDialect,
  WorkspacePolicyCode,
} from "./types";
export { MAX_POLICY_COMMAND_LENGTH } from "./types";
