/**
 * 命令策略：结构扫描与记号化（双方言共享）。
 *
 * 这是整个策略层的安全底座，因此刻意保守：
 * 只做"引号感知的顶层切分 + 记号化"，并把一切无法静态确定的构造记成结构化 problem，
 * 由上层按 fail-closed 处理。**不尝试完整实现任何一种 shell 的语法**。
 *
 * 已知不追求完备的地方（宁可判不可信，也不放过）：
 * - 复杂内联转义、here-doc、函数的定义与调用
 * - PowerShell 的 splatting / 静态方法调用 / 类型字面量
 */

import { MAX_POLICY_COMMAND_LENGTH, type ShellDialect } from "./types";

export interface SegmentToken {
  text: string;
  /** token 内含展开（$VAR / $(...) / 反引号）→ 动态，不可核验 */
  dynamic: boolean;
}

export interface ScanSegment {
  /** 段原文（已剥离重定向） */
  text: string;
  tokens: SegmentToken[];
}

export type ScanProblemCode =
  /** 写重定向到文件：已知写操作 */
  | "write-redirect"
  /** 变量/命令替换等展开：不可核验 */
  | "dynamic"
  /** 子壳、脚本块、调用运算符等结构：不可核验 */
  | "unsupported"
  /** 引号未闭合 */
  | "unterminated-quote"
  /** 超长命令 */
  | "too-long";

export interface ScanProblem {
  code: ScanProblemCode;
  detail: string;
}

export interface ScanResult {
  segments: ScanSegment[];
  /** 非空即整条命令不可信（write-redirect 为已知写，其余为不可核验） */
  problems: ScanProblem[];
}

/** 顶层分隔符（引号外才生效）。PowerShell 5.1 不支持 && / ||，出现即由记号检查归入不可信 */
const SEPARATORS: Record<ShellDialect, readonly string[]> = {
  posix: ["&&", "||", "|", ";", "\n"],
  powershell: ["|", ";", "\n"],
};

/** 允许写重定向到的"黑洞"目标 */
const NULL_TARGETS = new Set(["/dev/null", "nul", "nul:"]);
/** 允许的 fd 复制形式（`2>&1`、`&2` 等） */
const FD_DUP = /^&?\d*$|^\d*&$/;

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function isSeparatorAt(
  command: string,
  index: number,
  dialect: ShellDialect,
): string | null {
  for (const sep of SEPARATORS[dialect]) {
    if (command.startsWith(sep, index)) return sep;
  }
  return null;
}

/**
 * 扫描命令：切段 + 记号化 + 收集结构性问题。
 *
 * @param command 命令原文
 * @param dialect 执行壳语义（posix = Git Bash；powershell = Windows PowerShell）
 */
export function scanCommand(command: string, dialect: ShellDialect): ScanResult {
  const problems: ScanProblem[] = [];
  const pushProblem = (code: ScanProblemCode, detail: string) => {
    problems.push({ code, detail });
  };

  if (command.length > MAX_POLICY_COMMAND_LENGTH) {
    pushProblem("too-long", `command longer than ${MAX_POLICY_COMMAND_LENGTH} chars`);
  }

  const segments: ScanSegment[] = [];
  let tokens: SegmentToken[] = [];
  let current = "";
  let currentDynamic = false;
  let quote: "'" | '"' | null = null;
  /** 记号边界：判断 `#` 注释 / `.` dot-source 是否在语句首 */
  let atTokenStart = true;

  const flushToken = () => {
    if (current.length > 0 || currentDynamic) {
      tokens.push({ text: current, dynamic: currentDynamic });
    }
    current = "";
    currentDynamic = false;
  };

  const flushSegment = () => {
    flushToken();
    if (tokens.length > 0) {
      segments.push({ text: tokens.map((t) => t.text).join(" "), tokens });
    }
    tokens = [];
    atTokenStart = true;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    // ── 引号内：只找配对引号，并标记动态展开 ──
    if (quote) {
      if (ch === "\\" && quote === '"' && dialect === "posix") {
        current += ch;
        if (i + 1 < command.length) current += command[++i];
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      // PowerShell 的转义字符是反引号（也是续行）
      if (dialect === "powershell" && ch === "`") {
        pushProblem("dynamic", "powershell escape character (backtick)");
        if (i + 1 < command.length) current += command[++i];
        continue;
      }
      // 双引号内的 $ 在两种方言里都是展开；单引号内是字面量
      if (ch === "$" && quote === '"') {
        currentDynamic = true;
        current += ch;
        continue;
      }
      current += ch;
      continue;
    }

    // ── 引号外 ──
    if (ch === "'" || ch === '"') {
      quote = ch;
      atTokenStart = false;
      continue;
    }

    if (dialect === "posix" && ch === "\\") {
      if (i + 1 >= command.length || command[i + 1] === "\n") {
        pushProblem("unsupported", "line continuation (trailing backslash)");
        i++;
        continue;
      }
      current += command[++i];
      atTokenStart = false;
      continue;
    }

    if (dialect === "powershell" && ch === "`") {
      pushProblem("dynamic", "powershell escape character (backtick)");
      if (i + 1 < command.length) i++;
      atTokenStart = false;
      continue;
    }

    if (isWhitespace(ch)) {
      flushToken();
      atTokenStart = true;
      continue;
    }

    const separator = isSeparatorAt(command, i, dialect);
    if (separator) {
      flushSegment();
      i += separator.length - 1;
      continue;
    }

    if (ch === "#" && atTokenStart) {
      // 语句首注释：跳到行尾
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
      continue;
    }

    // 写重定向：`>` `>>`（含 fd 前缀）；目标不是黑洞/fd 复制即视为写操作
    if (ch === ">") {
      const opLength = command[i + 1] === ">" ? 2 : 1;
      // fd 前缀（`2>` 的 `2`）已在 current 里，只含数字时丢弃，避免被当作参数
      if (/^\d*$/.test(current)) current = "";
      let j = i + opLength;
      while (j < command.length && isWhitespace(command[j])) j++;
      let target = "";
      if (command[j] === "&") {
        // fd 复制：&1 / &2 / &-
        while (j < command.length && /[0-9&-]/.test(command[j])) {
          target += command[j];
          j++;
        }
      } else if (command[j] === "'" || command[j] === '"') {
        const q = command[j++];
        while (j < command.length && command[j] !== q) {
          if (command[j] === "\\" && q === '"' && j + 1 < command.length) j++;
          target += command[j];
          j++;
        }
        j++;
      } else {
        // 目标 token 在分隔符处结束（`2>nul;` / `2>&1;` 这类紧贴分隔符的写法）
        while (j < command.length && !isWhitespace(command[j]) && !";|&<>".includes(command[j])) {
          target += command[j];
          j++;
        }
      }
      const normalized = target.toLowerCase();
      if (NULL_TARGETS.has(normalized) || FD_DUP.test(target)) {
        // 允许：写黑洞 / fd 复制
      } else {
        pushProblem("write-redirect", `output redirection to file (${target || "?"})`);
      }
      i = j - 1;
      atTokenStart = true;
      continue;
    }

    // 读重定向：`<`、`<<`、`<<<`（只读，允许）；但 `<(…)` 是进程替换 → 不可核验
    if (ch === "<") {
      if (command[i + 1] === "(") {
        pushProblem("dynamic", "process substitution (<( )");
        let j = i + 2;
        while (j < command.length && !isWhitespace(command[j])) j++;
        i = j - 1;
        atTokenStart = true;
        continue;
      }
      let j = i + 1;
      while (j < command.length && (command[j] === "<" || command[j] === "&")) j++;
      while (j < command.length && isWhitespace(command[j])) j++;
      while (
        j < command.length &&
        !isWhitespace(command[j]) &&
        !";|&<>".includes(command[j])
      ) {
        j++;
      }
      i = j - 1;
      atTokenStart = true;
      continue;
    }

    // 方言特有的不可核验构造
    if (dialect === "posix") {
      if (ch === "&" && atTokenStart) {
        pushProblem("unsupported", "background execution (&)");
        atTokenStart = false;
        continue;
      }
      if (ch === "$" || ch === "`") {
        pushProblem("dynamic", "shell expansion ($... or backtick)");
        currentDynamic = true;
        current += ch;
        atTokenStart = false;
        continue;
      }
      if (ch === "(" || ch === ")" || ch === "{" || ch === "}") {
        pushProblem("unsupported", `unsupported construct (${ch})`);
        atTokenStart = false;
        continue;
      }
      if (ch === "!" && atTokenStart) {
        pushProblem("unsupported", "negation (!)");
        atTokenStart = false;
        continue;
      }
    } else {
      if (ch === "$") {
        pushProblem("dynamic", "powershell variable/subexpression ($...)");
        currentDynamic = true;
        current += ch;
        atTokenStart = false;
        continue;
      }
      if (ch === "{" || ch === "}" || ch === "(" || ch === ")" || ch === "[") {
        pushProblem("dynamic", `powershell script block/type literal (${ch})`);
        atTokenStart = false;
        continue;
      }
      if (ch === "&" && atTokenStart) {
        pushProblem("dynamic", "powershell call operator (&)");
        atTokenStart = false;
        continue;
      }
      if (ch === "@" && (command[i + 1] === "{" || command[i + 1] === "(")) {
        pushProblem("dynamic", "powershell array/hashtable literal (@...)");
        i++;
        atTokenStart = false;
        continue;
      }
      if (ch === "." && atTokenStart && command[i + 1] === " ") {
        pushProblem("dynamic", "powershell dot-sourcing");
        atTokenStart = false;
        continue;
      }
    }

    current += ch;
    atTokenStart = false;
  }

  if (quote) {
    pushProblem("unterminated-quote", "unterminated quote");
  }
  flushSegment();

  return { segments, problems };
}
