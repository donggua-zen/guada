/**
 * 命令策略：按档位合成决策。
 *
 * **只读档（名单制，默认拒绝，不弹窗）**——计划模式同此：
 *   1. T0 灾难级（代码硬底线）                        → 拒绝
 *   2. 你的规则：deny → 拒绝；ask → 拒绝（只读档不弹窗）；命令 allow → 放行（过代码风险层兜底）
 *   3. 出厂只读名单：每段都必须命中，且过方言分析器的参数级核验
 *   4. 其余 → 拒绝
 *
 * **工作档（例外制，默认执行）**——见 workspace-rules.ts：
 *   T0 → deny → 路径规则（你的→出厂）→ 命令规则（你的→出厂）→ 默认执行 → 越界写/删/移动 → 询问
 *
 * 未传 `policy` 时：只读档 = 只认出厂只读名单、工作档 = 无规则（供单测与极端兜底）。
 */

import { analyzePosixCommand } from "./posix-rules";
import { analyzePowerShellCommand } from "./powershell-rules";
import { scanCommand } from "./scan";
import { builtinReadOnlyCommands, matchReadOnlyEntry, normalizeReadOnlyEntry } from "./builtin-readonly";
import {
  catastrophicPatternOf,
  collectPathMentions,
  evaluateRules,
  evaluateWorkspaceCommand,
  hitsCodeRiskLayer,
  splitRawSegments,
  stripHeredocBodies,
  tokenizeSegment,
} from "./workspace-rules";
import {
  isPathRule,
  type CommandDecision,
  type CommandPolicyCode,
  type EffectivePolicy,
  type PolicyMode,
  type PolicyRule,
  type PolicyShellKind,
  type ShellDialect,
} from "./types";

export interface CommandPolicyInput {
  command: string;
  /** 当前执行壳（process-manager.getShellKind()） */
  shellKind: PolicyShellKind;
  /** 档位；缺省 `read-only`（保持既有调用方语义不变） */
  mode?: PolicyMode;
  /** 会话工作区（工作档作用域判定的基准） */
  workspacePath?: string;
  /** 生效策略（出厂规则 + 你的改动） */
  policy?: EffectivePolicy;
}

function executingDialect(shellKind: PolicyShellKind): ShellDialect | null {
  if (shellKind === "gitbash") return "posix";
  if (shellKind === "powershell") return "powershell";
  return null; // cmd / sh：没有可用的只读名单
}

function analyzeBy(dialect: ShellDialect, command: string) {
  return dialect === "posix"
    ? analyzePosixCommand(command)
    : analyzePowerShellCommand(command);
}

/** 用扫描结果区分"不可核验"与"只是不在名单" */
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

/** 判定一条命令 */
export function evaluateCommand(input: CommandPolicyInput): CommandDecision {
  const policy = input.policy;
  const userRules: readonly PolicyRule[] = policy?.userRules ?? [];
  const factoryRules: readonly PolicyRule[] = policy?.factoryRules ?? [];

  if (input.mode === "workspace-write") {
    const verdict = evaluateWorkspaceCommand({
      command: input.command,
      shellKind: input.shellKind,
      workspacePath: input.workspacePath,
      rules: userRules,
      factoryRules,
    });
    if (verdict.tier === "allow") {
      return { kind: "whitelisted", reason: `workspace-write policy: ${verdict.reason}` };
    }
    return {
      kind: verdict.tier === "block" ? "denied" : "needs-approval",
      code: verdict.code ?? "unverifiable",
      reason: verdict.reason,
      pathHit: verdict.pathHit,
    };
  }

  return evaluateReadOnly(input, policy, userRules, factoryRules);
}

/**
 * 只读档（名单制）：**不弹窗**——ask / deny 一律按拒绝处理。
 */
function evaluateReadOnly(
  input: CommandPolicyInput,
  policy: EffectivePolicy | undefined,
  userRules: readonly PolicyRule[],
  factoryRules: readonly PolicyRule[],
): CommandDecision {
  // 1) T0 灾难级：任何档位、任何名单都不可放通
  const catastrophic = catastrophicPatternOf(input.command);
  if (catastrophic) {
    return {
      kind: "denied",
      code: "catastrophic",
      reason: `catastrophic pattern (${catastrophic})`,
    };
  }

  const dialect = executingDialect(input.shellKind);
  if (!dialect) {
    return {
      kind: "denied",
      code: "no-allowlist",
      reason: `no read-only allowlist for shell (${input.shellKind})`,
    };
  }
  const otherDialect: ShellDialect = dialect === "posix" ? "powershell" : "posix";

  // heredoc 正文是数据：剥离后再看（`cat <<EOF … EOF` 仍是只读的 cat）
  const heredoc = stripHeredocBodies(input.command);
  if (heredoc.sink && heredoc.suspicious) {
    return { kind: "denied", code: "unverifiable-syntax", reason: "heredoc marker followed by inline content" };
  }
  const core = heredoc.sink ? heredoc.text : input.command;
  const segments = splitRawSegments(core);
  if (segments.length === 0) {
    return { kind: "whitelisted", reason: "read-only allowlist (empty command)" };
  }

  // 2) 规则：deny 优先 → 路径规则 → 命令规则。
  //    只读档不弹窗：ask 与 deny 一律按拒绝处理；路径 allow（可写根）不改变"按命令名放行"的语义。
  const mentions = segments.flatMap((text) => collectPathMentions(text));
  const hit = evaluateRules({
    userRules,
    factoryRules,
    tokenSets: [tokenizeSegment(core), ...segments.map(tokenizeSegment)],
    mentions,
  });
  if (hit) {
    const describe = isPathRule(hit.rule) ? hit.rule.path : hit.rule.match;
    if (hit.action !== "allow") {
      return {
        kind: "denied",
        code: isPathRule(hit.rule) ? "sensitive-path" : hit.action === "deny" ? "user-deny" : "not-whitelisted",
        reason: `matched a ${hit.action} rule (${describe})`,
      };
    }
    if (!isPathRule(hit.rule)) {
      // 自加条目：分析器没有该命令的语义 → 代码风险层兜底（先兜底，再看方言分析器）
      if (hitsCodeRiskLayer(core, input.shellKind)) {
        return {
          kind: "denied",
          code: "blocked-floor",
          reason:
            "self-added allow rule matched a code-level risk (catastrophic / path-scoped / host / remote action)",
        };
      }
      const executing = analyzeBy(dialect, core);
      if (executing.verdict === "unsafe") {
        return { kind: "denied", code: "unsafe-flags", reason: summarize(executing.reasons) };
      }
      return { kind: "whitelisted", reason: `matched an allow rule (${describe})` };
    }
    // 路径 allow（可写根）→ 继续走只读名单
  }

  // 2.5) 结构不可核验 / 写重定向：只读档一律拒绝（`ls &` 这类未支持构造也在这里被拦）
  const scan = scanCommand(core, dialect);
  if (scan.problems.length > 0) {
    const redirect = scan.problems.some((p) => p.code === "write-redirect");
    return {
      kind: "denied",
      code: redirect ? "write-signal" : "unverifiable-syntax",
      reason: summarize(scan.problems.map((p) => p.detail)),
    };
  }

  // 3) 出厂只读名单：逐段命中 + 参数级核验
  //    （未传 policy 时回落到代码派生的出厂名单，保证单测与极端兜底的行为一致）
  const removed = new Set((policy?.readOnly.removed ?? []).map(normalizeReadOnlyEntry));
  const factoryList = (policy?.readOnly.factory ?? builtinReadOnlyCommands()).filter(
    (entry) => !removed.has(normalizeReadOnlyEntry(entry)),
  );
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // 注释 / 空白段是无副作用的空操作
    const entry = matchReadOnlyEntry(factoryList, segment);
    if (!entry) {
      // 不在名单里 → not-whitelisted；命中条目但形态不对（下面）→ unknown-command / unsafe-flags
      return {
        kind: "denied",
        code: "not-whitelisted",
        reason: `not in the read-only allowlist: ${summarize(analyzeBy(dialect, segment).reasons)}`,
      };
    }
    const executing = analyzeBy(dialect, segment);
    if (executing.verdict !== "read-only") {
      return {
        kind: "denied",
        code: executing.verdict === "unsafe" ? "unsafe-flags" : classifyCode(dialect, segment),
        reason: summarize(executing.reasons),
      };
    }
    const other = analyzeBy(otherDialect, segment);
    if (other.verdict === "unsafe") {
      return {
        kind: "denied",
        code: "unsafe-flags",
        reason: `write operation under ${otherDialect} semantics: ${summarize(other.reasons)}`,
      };
    }
  }

  return { kind: "whitelisted", reason: "read-only allowlist" };
}
