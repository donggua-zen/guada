/**
 * 命令策略（Windows 去沙盒后的强制层）：类型定义。
 *
 * 目标不是"证明命令安全"，而是"只接受能证明为静态只读的窄形状"：
 * 任何无法静态确定的构造（变量展开、命令替换、脚本块、写重定向…）都记为不可信，
 * 由 decision.ts 按档位转换为"需审批"或"拒绝"。
 */

/** 单一方言（执行壳语义） */
export type ShellDialect = "posix" | "powershell";

/**
 * 某方言对整条命令的判定：
 * - `read-only`：每一段都命中只读白名单且参数已核验
 * - `unknown`：语法静态可查，但至少一段无法核验（未知命令/未知参数）
 * - `unsafe`：命中已知的写/危险特征（写重定向、删除、写入类参数…）
 */
export type DialectVerdict = "read-only" | "unknown" | "unsafe";

export interface DialectAnalysis {
  verdict: DialectVerdict;
  /** 逐段说明（审批卡片/日志用） */
  reasons: string[];
  /** 触发非只读结论的片段（诊断用） */
  offending: string[];
}

/** 非白名单命令的原因分类（决定给模型的文案） */
export type CommandPolicyCode =
  | "unknown-command"
  | "unverifiable-syntax"
  | "write-signal"
  | "no-allowlist";

/**
 * 执行壳的 kind（与 process-manager 的 ShellKind 结构兼容）。
 * 这里本地声明是为了避免 common/ → modules/ 的分层反转。
 */
export type PolicyShellKind = "gitbash" | "powershell" | "cmd" | "sh";

/** 对外决策：白名单放行，或需要人工批准（只读档下直接拒绝） */
export type CommandDecision =
  | { kind: "whitelisted"; reason: string }
  | { kind: "needs-approval"; code: CommandPolicyCode; reason: string };

/** 命令原文长度上限（超过即不可核验） */
export const MAX_POLICY_COMMAND_LENGTH = 4096;
