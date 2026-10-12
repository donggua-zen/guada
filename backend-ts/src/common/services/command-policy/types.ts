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

/** 工作档（例外制）+ 两档共有的原因分类 */
export type WorkspacePolicyCode =
  | "catastrophic"
  | "sensitive-path"
  | "user-deny"
  | "user-ask"
  | "out-of-scope"
  | "host-action"
  | "remote-side-effect"
  | "dynamic-target"
  | "unverifiable"
  | "no-workspace";

/** 只读档（名单制 + 代码兜底）专属的原因分类 */
export type ReadOnlyPolicyCode =
  | "not-whitelisted"
  | "unsafe-flags"
  | "blocked-floor";

/** 非白名单命令的原因分类（决定给模型的文案） */
export type CommandPolicyCode =
  | "unknown-command"
  | "unverifiable-syntax"
  | "write-signal"
  | "no-allowlist"
  | ReadOnlyPolicyCode
  | WorkspacePolicyCode;

/**
 * 判定档位：
 * - `read-only`：只读名单制（不在名单内即拒绝；**不弹窗**）
 * - `workspace-write`：例外制（默认执行；命中规则 / 越界写 / 敏感路径才拦）
 */
export type PolicyMode = "read-only" | "workspace-write";

// ==================== 规则（v3：一条有序表，两种条目） ====================

export type RuleAction = "allow" | "ask" | "deny";

/** 命令规则：命令前缀匹配（末尾 `*` = 其后任意；语义同 v2） */
export interface CommandRule {
  action: RuleAction;
  match: string;
}

/** 路径规则：glob（`allow` = 可写根，`ask` = 敏感路径，`deny` = 一律拒绝） */
export interface PathRule {
  action: RuleAction;
  path: string;
}

export type PolicyRule = CommandRule | PathRule;

export function isPathRule(rule: PolicyRule): rule is PathRule {
  return typeof (rule as PathRule).path === "string";
}

/**
 * 生效策略（由 policy-rules.service 组装：出厂规则 + 用户改动）。
 *
 * 判定顺序（见 docs/windows-command-policy.md）：
 *   T0 → deny（任意规则）→ 路径规则（用户→出厂）→ 命令规则（用户→出厂）→ 默认动作 → 越界检查
 */
export interface EffectivePolicy {
  /** 用户规则（你的改动；先于出厂规则判定） */
  userRules: readonly PolicyRule[];
  /** 出厂规则（随版本升级自动跟随） */
  factoryRules: readonly PolicyRule[];
  readOnly: {
    /** 出厂只读名单（条目 = 命令前缀，隐式"其后任意参数"） */
    factory: readonly string[];
    /** 用户划掉的出厂条目（UI 删行写这里） */
    removed: readonly string[];
    /** 出厂条目集合（归一后）：命中即"内置条目"，参数级核验交给方言分析器 */
    builtin: ReadonlySet<string>;
  };
}

/**
 * 执行壳的 kind（与 process-manager 的 ShellKind 结构兼容）。
 * 这里本地声明是为了避免 common/ → modules/ 的分层反转。
 */
export type PolicyShellKind = "gitbash" | "powershell" | "cmd" | "sh";

/**
 * 对外决策：
 * - `whitelisted`：放行（只读白名单命中 / 工作档判定为区内安全）
 * - `needs-approval`：由调用方按档位决定弹窗还是拒绝
 * - `denied`：系统硬拒（灾难级 / 用户 deny 规则），**不可经审批放通**
 */
/** 敏感路径命中（审批卡显示目标与操作；「放通此类」写这条 glob 的路径规则） */
export interface PolicyPathHit {
  glob: string;
  target: string;
  op: "read" | "write" | "delete";
}

export type CommandDecision =
  | { kind: "whitelisted"; reason: string }
  | { kind: "needs-approval"; code: CommandPolicyCode; reason: string; pathHit?: PolicyPathHit }
  | { kind: "denied"; code: CommandPolicyCode; reason: string; pathHit?: PolicyPathHit };

/** 命令原文长度上限（超过即不可核验） */
export const MAX_POLICY_COMMAND_LENGTH = 4096;
