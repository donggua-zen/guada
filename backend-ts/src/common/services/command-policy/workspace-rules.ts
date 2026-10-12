/**
 * 工作目录可写档（workspace-write）的判定：黑名单 + 作用域。
 *
 * 与只读档的"正向白名单"相反，这里**默认放行**，只拦三类：
 *   T0 catastrophic  灾难级（格式化磁盘、写裸设备、关机、下载即执行、删根…）→ 硬拒，用户规则也不可覆盖
 *   T1 作用域敏感    破坏性/写类动作 + 远程副作用 → 目标全在会话工作区内则放行，越界或不可判定则弹窗
 *   T2 不可核验      风险段里出现动态构造 / wrapper 解包失败 / 未闭合引号 / 超长 → 弹窗
 *
 * 为什么表是双方言合一的：Windows 上的 Git Bash 频繁调用 `powershell -Command "…"`、`cmd /c "…"`，
 * 危险动作不会因为换了语言就变安全，因此 T0/T1 同时匹配 POSIX 与 PowerShell 词表（含 wrapper 解包后）。
 *
 * 用户规则（allow / ask / deny，token 前缀匹配）优先级：
 *   T0 > 用户 deny > 用户 ask > 用户 allow > 内置判定
 * allow 可放通 T1/T2（"视频工作者放通 ffmpeg"的机制），但不能放通 T0。
 */

import { analyzePosixCommand } from "./posix-rules";
import { analyzePowerShellCommand } from "./powershell-rules";
import { scanCommand } from "./scan";
import {
  MAX_POLICY_COMMAND_LENGTH,
  type PolicyShellKind,
  type ShellDialect,
  type WorkspacePolicyCode,
} from "./types";

// ==================== 用户规则 ====================

/** 用户可配置的三张表（纯数据；文件读写见 policy-rules.service） */
export interface CommandRuleSet {
  /** 静默放行（token 前缀 + 末尾 `*`） */
  allow: readonly string[];
  /** 一律询问（用于收紧内置的默认放行） */
  ask: readonly string[];
  /** 直接拒绝 */
  deny: readonly string[];
}

export const EMPTY_RULE_SET: CommandRuleSet = { allow: [], ask: [], deny: [] };

// ==================== 结论 ====================

/** 工作档判定码（= CommandPolicyCode 的工作档子集，见 types.ts） */
export type WorkspaceCode = WorkspacePolicyCode;

export interface WorkspaceVerdict {
  tier: "allow" | "ask" | "block";
  /** allow 时缺省；ask/block 必带 */
  code?: WorkspaceCode;
  /** 给模型/日志的一句话原因 */
  reason: string;
}

// ==================== T0：灾难级（不可覆盖） ====================

const CATASTROPHIC: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "disk-format", re: /(^|[;&|]\s*)(mkfs\w*|mke2fs|diskpart|bcdedit)\b/i },
  {
    id: "disk-partition",
    re: /\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition|New-Partition|Set-Disk)\b/i,
  },
  // Windows 的 `format D:`（要求紧跟在语句首，避免命中 `--format D:` 这类参数）
  { id: "drive-format", re: /(^|[;&|]\s*)format\s+["']?[a-z]:/i },
  { id: "raw-device-write", re: /\bdd\b[^|;\n]*\bof=\/dev\//i },
  { id: "raw-device-redirect", re: />>?\s*\/dev\/(sd|vd|nvme|hd|mmcblk)/i },
  {
    id: "power-state",
    re: /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i,
  },
  {
    id: "system-tamper",
    re: /(^|[;&|]\s*)(Set-ExecutionPolicy|vssadmin|wbadmin|bcdedit|secedit)\b/i,
  },
  { id: "fork-bomb", re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/ },
  { id: "mass-kill", re: /\bkill\s+-9\s+-1\b/ },
  {
    id: "pipe-to-shell",
    re: /\b(curl|wget|Invoke-WebRequest|iwr|irm)\b[^|;\n]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i,
  },
  {
    id: "download-and-exec",
    re: /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b[^|;\n]*\|\s*(iex|Invoke-Expression)\b/i,
  },
  // 删根 / 删盘符根（`rm -rf /`、`rm -rf C:\`）
  { id: "root-delete", re: /\brm\s+(-[^\s]+\s+)*\/(\s|$|\*)/i },
  { id: "drive-root-delete", re: /\brm\s+-[^\s]*r[^\s]*\s+(-[^\s]+\s+)*[a-z]:[\\/]?(\s|$)/i },
];

// ==================== T1：作用域敏感 ====================

/** 路径型写/删/移动：目标全在工作区内 → 放行；越界或不可判定 → 弹窗 */
const PATH_SCOPED_ACTIONS =
  /\b(rm|del|erase|rd|rmdir|Remove-Item|mv|move|Move-Item|rename|ren|Rename-Item|cp|copy|Copy-Item|mkdir|md|New-Item|touch|Set-Content|Add-Content|Out-File|tee|chmod|chown|takeown|icacls|attrib|Set-Acl|ln|mklink)\b/i;

/** 主机级动作：与工作区无关（进程/服务/计划任务），目标路径判定对它无意义 → 一律弹窗 */
const HOST_ACTIONS =
  /(^|[;&|]\s*)(Stop-Process|taskkill|Stop-Service|Restart-Service|Start-Service|sc\s+(stop|delete|config)|net\s+(stop|start)|schtasks|Register-ScheduledTask|Unregister-ScheduledTask)\b/i;

/** 远程/不可逆副作用 → 一律弹窗（用户可显式放通） */
const REMOTE_SIDE_EFFECTS: ReadonlyArray<{ id: string; re: RegExp }> = [
  {
    id: "remote-shell",
    re: /(^|[;&|]\s*)(ssh|scp|sftp|rsync|plink|Invoke-Command|Enter-PSSession|New-PSSession)\b/i,
  },
  {
    id: "git-history",
    re: /\bgit\s+(-[^\s]+\s+)*(push|reset\s+--hard|clean\s+-[a-z]*[fd]|rebase|filter-branch|branch\s+-D)\b/i,
  },
  { id: "publish", re: /\b(npm|pnpm|yarn|bun)\s+(publish|unpublish)\b/i },
  {
    id: "container",
    re: /\bdocker\s+(rm|rmi|system\s+prune|volume\s+rm|container\s+prune|image\s+prune)\b|\bkubectl\s+delete\b/i,
  },
  { id: "global-config", re: /\bgit\s+config\s+--global\b|\bnpm\s+config\s+set\b/i },
];

// ==================== 工具 ====================

function dialectOf(shellKind: PolicyShellKind): ShellDialect {
  // cmd 没有专门的方言表：命令分隔符与 POSIX 近似（`&` 会走 unsupported → 保守弹窗）
  return shellKind === "powershell" ? "powershell" : "posix";
}

/** 取 token 的"命令名形状"：去引号、取 basename、去可执行后缀、小写 */
function commandShape(token: string): string {
  const bare = token.replace(/^["']+|["']+$/g, "");
  const idx = Math.max(bare.lastIndexOf("/"), bare.lastIndexOf("\\"));
  let base = idx === -1 ? bare : bare.slice(idx + 1);
  base = base.replace(/\.(exe|cmd|bat|ps1|sh|com)$/i, "");
  return base.toLowerCase();
}

/** 逐 token 前缀匹配；末尾 `*` 表示"其后任意"；不含 `*` 则要求完全相等 */
export function matchRule(rule: string, commandTokens: readonly string[]): boolean {
  const ruleTokens = rule.trim().split(/\s+/).filter(Boolean);
  if (ruleTokens.length === 0) return false;
  const trailingWildcard = ruleTokens[ruleTokens.length - 1] === "*";
  const fixed = trailingWildcard ? ruleTokens.slice(0, -1) : ruleTokens;
  if (fixed.length === 0) {
    return trailingWildcard && commandTokens.length > 0; // 规则 "*" 匹配任何命令（校验层会拒绝它）
  }
  if (commandTokens.length < fixed.length) return false;
  if (!trailingWildcard && commandTokens.length !== fixed.length) return false;
  return fixed.every((rt, i) => commandShape(rt) === commandShape(commandTokens[i]));
}

function splitCommandTokens(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((t) =>
    t.replace(/^["']+|["']+$/g, ""),
  );
}

/** 包装载荷之后允许出现的"尾巴"：仅重定向（`2>&1`、`>nul` 等），不允许再跟命令 */
const WRAPPER_TAIL = "(?:\\s*[0-9]*[<>]{1,2}\\s*(?:&[0-9]+|[^\\s|;&]+))*\\s*";

/** shell 包装解包：`powershell|pwsh … -Command/-c "…"`、`cmd /c "…"`、`bash|sh -c "…"` */
export function unwrapShellWrapper(command: string): string | null {
  const ps = command.match(
    new RegExp(
      `^(?:"?[a-z]:[\\\\/][^"]*[\\\\/])?(?:powershell|pwsh)(?:\\.exe)?\\b[^"|]*?(?:-command|-c)\\s+(?:"([\\s\\S]+)"|'([\\s\\S]+)')${WRAPPER_TAIL}$`,
      "i",
    ),
  );
  if (ps) return (ps[1] ?? ps[2] ?? "").trim() || null;
  const cmd = command.match(
    new RegExp(`^cmd(?:\\.exe)?\\s+\\/c\\s+(?:"([\\s\\S]+)"|([\\s\\S]+?))${WRAPPER_TAIL}$`, "i"),
  );
  if (cmd) return (cmd[1] ?? cmd[2] ?? "").trim() || null;
  const sh = command.match(
    new RegExp(
      `^(?:ba|z|da|k)?sh\\b[^"|]*?-c\\s+(?:"([\\s\\S]+)"|'([\\s\\S]+)')${WRAPPER_TAIL}$`,
      "i",
    ),
  );
  if (sh) return (sh[1] ?? sh[2] ?? "").trim() || null;
  return null;
}

/** 词法消解 `.` / `..`（不碰文件系统；保留盘符/根段） */
function resolveDotSegments(p: string): string {
  const parts = p.split(/[\\/]+/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("\\");
}

/** 归一化路径用于作用域比较：`/d/AI/x` → `d:\ai\x`，消解 `.`/`..`，统一小写、反斜杠 */
export function normalizeScopePath(p: string): string {
  let s = p.replace(/^["']+|["']+$/g, "");
  const drive = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (drive) s = `${drive[1]}:\\${drive[2]}`;
  s = s.replace(/\//g, "\\");
  return resolveDotSegments(s).toLowerCase();
}

/** 归一化结果是否落在工作区内 */
function isInsideWorkspace(resolved: string, wsNorm: string): boolean {
  if (resolved === wsNorm) return true;
  return resolved.startsWith(wsNorm.endsWith("\\") ? wsNorm : `${wsNorm}\\`);
}

function isAbsolutePath(token: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(token) || token.startsWith("/") || token.startsWith("\\\\");
}

/** 动态构造记号：变量展开 / 命令替换 / 反引号 / %VAR% */
const DYNAMIC_TOKEN = /\$[({A-Za-z_]|`|%[A-Za-z_][A-Za-z0-9_]*%/;

/** 写黑洞：这些"目标"不构成写入，不参与作用域判定 */
const NULL_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul", "nul:", "$null"]);

/** 常见 POSIX 根：即便只有一段（`/tmp`）也是路径，不是 Windows 开关 */
const POSIX_ROOTS = new Set([
  "/tmp", "/etc", "/var", "/usr", "/home", "/opt", "/mnt", "/media", "/srv",
  "/bin", "/sbin", "/lib", "/root", "/proc", "/sys", "/dev", "/boot",
]);

/** Windows 单段开关（`/s`、`/format:list`、`/im`）——不是路径；`/` 与 `/tmp` 这类根仍是路径 */
function isWindowsFlagToken(token: string): boolean {
  if (!token.startsWith("/") || token === "/" || token === "//") return false;
  const lower = token.toLowerCase();
  if (POSIX_ROOTS.has(lower)) return false;
  if (token.includes(":", 1)) return true; // /format:list
  return !token.includes("/", 1); // /s /q /im
}

/**
 * 纯环境变量赋值段（cmd 的 `set VAR=x`、POSIX 的 `export VAR=x`、裸 `VAR=x`）：
 * 不写文件，也不能按 PS 的 `Set-Variable` 别名当成危险动作。
 */
function isEnvAssignmentSegment(text: string): boolean {
  return /^(?:set|setx)\s+[A-Za-z_][A-Za-z0-9_]*=/i.test(text) ||
    /^export\s+[A-Za-z_][A-Za-z0-9_]*=/.test(text) ||
    /^[A-Za-z_][A-Za-z0-9_]*=[^\s]/.test(text);
}

/** 引号是否闭合：**不把 `\` 当转义**（Windows 路径常以 `\` 结尾，POSIX 扫描器会误判未闭合） */
function quotesBalancedNoEscape(text: string): boolean {
  let quote: '"' | "'" | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
  }
  return quote === null;
}

/** POSIX 语义下 `\"` 是转义引号（与"Windows 路径以 `\` 结尾"冲突，两种口径任一成立即视为闭合） */
function quotesBalancedWithEscape(text: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < text.length) {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
  }
  return quote === null;
}

function quotesBalanced(text: string): boolean {
  return quotesBalancedNoEscape(text) || quotesBalancedWithEscape(text);
}

/**
 * 轻量分段（引号感知）：与 scan.ts 的分段不同，这里**不把 `\` 当转义**——
 * Windows 路径优先（`D:\AI\x` 必须原样保留；POSIX 扫描器会把反斜杠吃掉，
 * 导致 `Export-Csv -Path D:\AI\other\x.csv` 被误判成区内的相对路径）。
 */
export function splitRawSegments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push(current);
      current = "";
      i++;
      continue;
    }
    // 单用 `&`（cmd/PowerShell 语句分隔，POSIX 后台）：也算分段；
    // `2>&1` 里的 `&` 前有 `>`，不是分隔符
    if (
      ch === "&" &&
      command[i - 1] !== ">" &&
      command[i - 1] !== "&" &&
      command[i + 1] !== "&"
    ) {
      out.push(current);
      current = "";
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "\n") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 段内路径候选：跳过命令名、开关、环境变量赋值与重定向记号 */
function pathCandidates(segment: string): { value: string; dynamic: boolean }[] {
  const tokens = (segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((t) =>
    t.replace(/^["']+|["']+$/g, ""),
  );
  const out: { value: string; dynamic: boolean }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i];
    if (!text) continue;
    if (i === 0) continue; // 命令名
    if (text.startsWith("-") || isWindowsFlagToken(text)) continue; // 开关
    if (text.startsWith(">") || text.startsWith("<")) continue; // 重定向记号（扫描器单独处理目标）
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) continue; // 环境变量赋值
    if (NULL_TARGETS.has(text.toLowerCase())) continue; // 写黑洞
    // 动态记号只对"无空白的整 token"生效：引号里的自然语言（如 "$(date)"）不是路径
    const dynamic = !/\s/.test(text) && DYNAMIC_TOKEN.test(text);
    out.push({ value: text, dynamic });
  }
  return out;
}

/**
 * shell 调用形态（`powershell`/`pwsh`/`cmd`/`bash`/`sh` 打头）：
 * `-Command`/`-c`/`/c` 走解包；`-File <path>` 与 `sh script.sh` 这类"跑脚本"按脚本路径做作用域判定。
 */
function looksLikeShellInvocation(text: string): boolean {
  return /^(?:"?[a-z]:[\\/][^"]*[\\/])?(powershell|pwsh|cmd|(?:ba|z|da|k)?sh)(\.exe)?\b/i.test(
    text.trim(),
  );
}

/** 取值型开关：其后一个 token 是值而不是脚本/路径 */
const SHELL_VALUE_FLAGS = new Set([
  "-executionpolicy",
  "-noprofile",
  "-nologo",
  "-noninteractive",
  "-inputformat",
  "-outputformat",
  "-windowstyle",
  "-version",
  "-file",
  "-f",
]);

/** 从 shell 调用里取"脚本路径"（`-File x` / `sh x`）；取不到返回 null */
function wrapperScriptPath(text: string): string | null {
  const tokens = (text.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((t) =>
    t.replace(/^["']+|["']+$/g, ""),
  );
  const fileIdx = tokens.findIndex((t) => /^-(file|f)$/i.test(t));
  if (fileIdx >= 0 && tokens[fileIdx + 1]) return tokens[fileIdx + 1];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) continue;
    if (SHELL_VALUE_FLAGS.has(tokens[i - 1]?.toLowerCase() ?? "")) continue;
    return t;
  }
  return null;
}

/** 该段是否带 `-c` / `-Command` / `/c` 载荷（必须解包，不能当脚本路径） */
function hasCommandPayload(text: string): boolean {
  return /(^|\s)(-c|-command|\/c|\/k)(\s|$)/i.test(text);
}

/**
 * 剥掉 heredoc 正文（正文是数据，不是语法）：按终止行切。
 * 返回剥离后的文本 + 接收程序名（`cat`/`tee` 这类写文件才放行；解释器当 stdin 脚本 → 不可核验）。
 */
function stripHeredocBodies(command: string): {
  text: string;
  sink: string | null;
  suspicious: boolean;
} {
  const lines = command.split("\n");
  const kept: string[] = [];
  let sink: string | null = null;
  let suspicious = false;
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/);
    if (!marker) {
      kept.push(lines[i]);
      continue;
    }
    if (sink === null) {
      sink = (lines[i].trim().split(/\s+/)[0] ?? "").toLowerCase();
    }
    // 标记之后同一行还有内容 → 结构可疑（正常 heredoc 标记后无内容）
    if (marker.index !== undefined && lines[i].slice(marker.index + marker[0].length).trim()) {
      suspicious = true;
    }
    kept.push(lines[i].slice(0, marker.index ?? 0));
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== marker[1]) j++;
    i = j; // 跳到终止行（i++ 后即正文之外）
  }
  return { text: kept.join("\n"), sink, suspicious };
}

function matchCatastrophic(command: string): { id: string; re: RegExp } | null {
  for (const entry of CATASTROPHIC) {
    if (entry.re.test(command)) return entry;
  }
  return null;
}

/** 该文本命中哪个灾难级模式（供规则校验给出告警；无命中返回 null） */
export function catastrophicPatternOf(text: string): string | null {
  return matchCatastrophic(text)?.id ?? null;
}

/** 二段式 CLI：第二段是子命令（`git push`、`npm publish`），推导规则时保留两段 */
const SUBCOMMAND_CLIS = new Set([
  "git", "npm", "pnpm", "yarn", "bun", "docker", "cargo", "uv", "gh", "kubectl",
  "dotnet", "pip", "pip3", "poetry", "go", "mvn", "gradle", "terraform", "helm",
  "az", "winget", "conda", "deno",
]);

/**
 * 从一条被批准的命令推导"放通此类"规则（审批卡用）。
 *
 * - 先解包 shell 包装，再推导——放通的是内层真正的工具，而不是 `powershell *`
 * - 多段命令（`a && b`）不推导：前缀放通会顺带放行后续段落
 * - 已知二段式 CLI 保留子命令（`git push *`），其余只保留命令名（`ffmpeg *`）
 * - 命中灾难级名单一律不推导（只给"本次允许 / 拒绝"）
 */
export function deriveAllowRule(command: string): string | null {
  let core = command;
  for (let i = 0; i < 3; i++) {
    const inner = unwrapShellWrapper(core);
    if (!inner) break;
    core = inner;
  }
  if (catastrophicPatternOf(core)) return null;

  const segments = splitRawSegments(core);
  if (segments.length !== 1) return null;
  const segment = segments[0];
  if (isEnvAssignmentSegment(segment)) return null;

  const tokens = (segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((t) =>
    t.replace(/^["']+|["']+$/g, ""),
  );
  if (tokens.length === 0) return null;
  const head = commandShape(tokens[0]);
  if (!head || head === "*") return null;

  const second = tokens[1];
  if (SUBCOMMAND_CLIS.has(head) && second && !second.startsWith("-")) {
    const sub = commandShape(second);
    if (sub && sub !== "*") return `${head} ${sub} *`;
  }
  return `${head} *`;
}

function ask(code: WorkspaceCode, reason: string): WorkspaceVerdict {
  return { tier: "ask", code, reason };
}

// ==================== 主判定 ====================

export function evaluateWorkspaceCommand(input: {
  command: string;
  shellKind: PolicyShellKind;
  /** 会话工作区（作用域基准）；缺失时所有风险段一律弹窗 */
  workspacePath?: string;
  rules?: CommandRuleSet;
}): WorkspaceVerdict {
  const { command, shellKind } = input;
  const rules = input.rules ?? EMPTY_RULE_SET;

  // 0) heredoc：正文是数据不是语法——剥离后再做引号核验与风险判定；
  //    解释器读 stdin 的 heredoc（`python <<EOF`）是"看不见的脚本" → 不可核验
  const heredoc = stripHeredocBodies(command);
  if (heredoc.sink && heredoc.suspicious) {
    return ask("unverifiable", "heredoc marker followed by inline content");
  }
  const core = heredoc.sink ? heredoc.text : command;
  if (
    heredoc.sink &&
    /^(python|python3|py|node|deno|bun|(?:ba|z|da|k)?sh|powershell|pwsh|perl|ruby|php)$/.test(
      heredoc.sink,
    )
  ) {
    return ask("unverifiable", "heredoc piped into an interpreter (stdin script)");
  }

  // 1) T0：灾难级（不可覆盖；wrapper/heredoc 剥离后仍按全文匹配）
  const catastrophic = matchCatastrophic(core);
  if (catastrophic) {
    return {
      tier: "block",
      code: "catastrophic",
      reason: `catastrophic pattern (${catastrophic.id})`,
    };
  }

  // 2) 用户规则（优先级 deny > ask > allow）
  const tokenSets = [splitCommandTokens(command)];
  const hits = (list: readonly string[]) =>
    list.some((rule) => tokenSets.some((tokens) => matchRule(rule, tokens)));
  if (hits(rules.deny)) {
    return { tier: "block", code: "user-deny", reason: "matched a user deny rule" };
  }
  if (hits(rules.ask)) {
    return { tier: "ask", code: "unverifiable", reason: "matched a user ask rule" };
  }
  if (hits(rules.allow)) {
    return { tier: "allow", reason: "matched a user allow rule" };
  }

  // 3) 结构不可核验：超长 / 引号未闭合（用自己的引号逻辑——Windows 路径常以 `\` 结尾，
  //    POSIX 扫描器会把它当成转义符而误报"未闭合"）
  if (core.length > MAX_POLICY_COMMAND_LENGTH) {
    return ask("unverifiable", `command longer than ${MAX_POLICY_COMMAND_LENGTH} chars`);
  }
  if (!quotesBalanced(core)) {
    return ask("unverifiable", "unterminated quote");
  }
  // 扫描器只用来取"写重定向目标"等结构信息；分段与路径分词走 splitRawSegments
  const { problems } = scanCommand(core, dialectOf(shellKind));

  // 4) 逐段判定
  const redirectTargets: string[] = [];
  for (const p of problems) {
    if (p.code !== "write-redirect") continue;
    const m = p.detail.match(/\(([^)]*)\)\s*$/);
    redirectTargets.push(m ? m[1] : "");
  }

  const wsNorm = input.workspacePath ? normalizeScopePath(input.workspacePath) : null;
  /** 相对路径的解析基准：跟随 `cd`/`Set-Location` 移动（否则 `cd /etc && rm passwd` 会被误判为区内） */
  let cwdBase = wsNorm;
  let cwdUnknown = false;
  let risky = false;

  /** 目标集合的作用域核验（返回非 null 即应中止判定） */
  const checkTargets = (
    candidates: { value: string; dynamic: boolean }[],
  ): WorkspaceVerdict | null => {
    if (candidates.some((c) => c.dynamic)) {
      return ask("dynamic-target", "destructive/write target is dynamically constructed");
    }
    if (candidates.length === 0) {
      return ask("unverifiable", "destructive/write action with no verifiable target path");
    }
    if (!wsNorm) {
      return ask("no-workspace", "the session has no workspace to scope this action against");
    }
    for (const c of candidates) {
      if (c.value.startsWith("~")) {
        return ask("out-of-scope", `home-directory target (${c.value})`);
      }
      if (!isAbsolutePath(c.value) && cwdUnknown) {
        return ask("dynamic-target", "relative target with an unverifiable working directory");
      }
      const resolved = isAbsolutePath(c.value)
        ? normalizeScopePath(c.value)
        : normalizeScopePath(`${cwdBase ?? wsNorm}\\${c.value}`);
      if (!isInsideWorkspace(resolved, wsNorm)) {
        return ask("out-of-scope", `target outside the workspace (${c.value})`);
      }
    }
    return null;
  };

  for (const text of splitRawSegments(core)) {

    // ── 目录切换：更新相对路径基准（cd 本身不写，不触发判定）──
    const cd = text.match(/^(cd|chdir|pushd|push-location|set-location)\b\s*(.*)$/i);
    if (cd) {
      const target = cd[2].trim().replace(/^["']+|["']+$/g, "");
      if (!target || target === ".") continue;
      if (target.startsWith("~") || /\$|`|%[A-Za-z_]/.test(target)) {
        cwdUnknown = true;
        continue;
      }
      if (!cwdBase) {
        cwdUnknown = true;
        continue;
      }
      cwdBase = isAbsolutePath(target)
        ? normalizeScopePath(target)
        : normalizeScopePath(`${cwdBase}\\${target}`);
      continue;
    }

    // 纯环境变量赋值（cmd 的 `set VAR=x`）不写文件，也不能按 PS 的 Set-Variable 别名当成危险动作
    if (isEnvAssignmentSegment(text)) continue;

    // shell 调用：能解包就递归判定内层；否则 `-File x` / `sh x` 按脚本路径做作用域判定
    if (looksLikeShellInvocation(text)) {
      const inner = unwrapShellWrapper(text);
      if (inner) {
        const innerVerdict = evaluateWorkspaceCommand({
          command: inner,
          shellKind,
          workspacePath: input.workspacePath,
          rules,
        });
        if (innerVerdict.tier !== "allow") return innerVerdict;
        continue;
      }
      if (hasCommandPayload(text)) {
        return ask("unverifiable", "shell wrapper could not be unwrapped");
      }
      const scriptPath = wrapperScriptPath(text);
      if (!scriptPath) {
        return ask("unverifiable", "shell invocation without a verifiable script path");
      }
      risky = true;
      const bad = checkTargets([
        { value: scriptPath, dynamic: DYNAMIC_TOKEN.test(scriptPath) },
      ]);
      if (bad) return bad;
      continue;
    }

    const host = HOST_ACTIONS.test(text);
    const remote = REMOTE_SIDE_EFFECTS.find((r) => r.re.test(text));
    // 写入类动作：T1 动词表 ∪ 两个方言分析器的 unsafe（find -delete / sort -o / sed -i / Set-Content …）
    const pathy =
      PATH_SCOPED_ACTIONS.test(text) ||
      analyzePosixCommand(text).verdict === "unsafe" ||
      analyzePowerShellCommand(text).verdict === "unsafe";

    if (!host && !remote && !pathy) continue; // 非风险段 → 放行
    risky = true;

    if (host) return ask("host-action", "host-level action needs approval");
    if (remote) {
      return ask("remote-side-effect", `remote or irreversible side effect (${remote.id})`);
    }

    const bad = checkTargets(pathCandidates(text));
    if (bad) return bad;
  }

  // 5) 写重定向目标同样受作用域约束（相对目标按"最终" cwd 解析：
  //    `cd /etc && echo x > passwd` 里的相对目标其实落在工作区外）
  for (const target of redirectTargets) {
    risky = true;
    if (!target) {
      return ask("dynamic-target", "write redirect with unreadable target");
    }
    if (!wsNorm) {
      return ask("no-workspace", "write redirect but the session has no workspace");
    }
    if (isAbsolutePath(target)) {
      if (!isInsideWorkspace(normalizeScopePath(target), wsNorm)) {
        return ask("out-of-scope", `write redirect outside the workspace (${target})`);
      }
      continue;
    }
    if (cwdUnknown) {
      return ask("dynamic-target", "relative write redirect with an unverifiable working directory");
    }
    const resolved = normalizeScopePath(`${cwdBase ?? wsNorm}\\${target}`);
    if (!isInsideWorkspace(resolved, wsNorm)) {
      return ask("out-of-scope", `write redirect outside the workspace (${target})`);
    }
  }

  return risky
    ? { tier: "allow", reason: "workspace-scoped action within the workspace" }
    : { tier: "allow", reason: "not a destructive or remote action" };
}
