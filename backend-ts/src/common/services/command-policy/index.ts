/**
 * 命令策略：对外出口。
 *
 * 用途：Windows 上不再使用 OS 沙盒（sandbox.exe 的受限令牌 + ACL 授权在 Windows 上
 * 兼容性差），改为进程内"只读白名单 + 人工审批"：
 *   - read-only       档：白名单内放行，其余拒绝（不弹窗）
 *   - workspace-write 档：白名单内放行，其余弹窗（本次允许 / 本会话内始终允许 / 拒绝）
 *   - danger-full-access 档：不判定
 * Linux/macOS 不受影响（继续用 Landlock/Seatbelt 沙盒）。
 */

export { evaluateCommand, type CommandPolicyInput } from "./decision";
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
  PolicyShellKind,
  ShellDialect,
} from "./types";
export { MAX_POLICY_COMMAND_LENGTH } from "./types";
