/**
 * 命令策略：对外出口。
 *
 * 用途：Windows 上不再使用 OS 沙盒（sandbox.exe 的受限令牌 + ACL 授权在 Windows 上
 * 兼容性差），改为进程内判定 + 人工审批：
 *   - read-only       档：名单制（默认拒绝，**不弹窗**）——出厂只读名单 + 你的 allow 规则
 *   - workspace-write 档：例外制（默认执行）——只有 deny 规则、必问项、敏感路径、越界写才拦
 *   - danger-full-access 档：不判定
 * Linux/macOS 不受影响（继续用 Landlock/Seatbelt 沙盒）。
 *
 * 判定顺序：T0 → deny（任意规则）→ 路径规则（你的→出厂）→ 命令规则（你的→出厂）→ 默认动作。
 */

export { evaluateCommand, type CommandPolicyInput } from "./decision";
export {
  allowedPathRules,
  catastrophicPatternOf,
  collectPathMentions,
  commandShape,
  deriveAllowRule,
  evaluateRules,
  evaluateWorkspaceCommand,
  hitsCodeRiskLayer,
  isAllowedPath,
  matchPathRule,
  matchRule,
  normalizeScopePath,
  splitRawSegments,
  stripHeredocBodies,
  tokenizeSegment,
  unwrapShellWrapper,
  type PathMention,
  type RuleHit,
  type WorkspacePolicyInput,
  type WorkspaceVerdict,
} from "./workspace-rules";
export {
  basenameGlobOf,
  describePathRule,
  expandPathPattern,
  normalizeForMatch,
  pathRuleMatches,
} from "./path-glob";
export {
  builtinReadOnlyCommands,
  builtinReadOnlySet,
  matchReadOnlyEntry,
  normalizeReadOnlyEntry,
  readOnlyEntryMatches,
} from "./builtin-readonly";
export {
  factoryRules,
  loadFactoryPolicy,
  loadPolicyDefaultsText,
  policyDefaultsPath,
  type FactoryPolicy,
} from "./policy-defaults";
export { gitSubcommandOf, posixReadOnlyEntries } from "./posix-rules";
export { powershellReadOnlyEntries } from "./powershell-rules";
export {
  CommandApprovalMemory,
  commandApprovalMemory,
  normalizeCommandKey,
} from "./approval-memory";
export type {
  CommandDecision,
  CommandPolicyCode,
  CommandRule,
  DialectAnalysis,
  DialectVerdict,
  EffectivePolicy,
  PathRule,
  PolicyMode,
  PolicyRule,
  PolicyShellKind,
  ReadOnlyPolicyCode,
  RuleAction,
  ShellDialect,
  WorkspacePolicyCode,
} from "./types";
export { isPathRule, MAX_POLICY_COMMAND_LENGTH } from "./types";
export type { WorkspaceCode } from "./workspace-rules";
