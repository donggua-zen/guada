/**
 * 命令策略：参数级核验的共享工具。
 *
 * 双方言的白名单表都表达为「已知安全开关 + 明确危险开关 + 位置参数规则」，
 * 未列出的开关一律降级为 unknown（fail-closed）——不做"这个参数看起来没事"的猜测。
 */

export type FlagKind = "none" | "string" | "number";

export interface FlagEvalResult {
  verdict: "ok" | "unknown" | "unsafe";
  detail: string;
  /** 位置参数（非开关、非开关取值） */
  positionals: string[];
}

export interface FlagEvalOptions {
  /** 已知安全开关 → 是否吃值 */
  flags?: Record<string, FlagKind>;
  /** 命中即 unsafe（写/危险开关）；短开关按前缀匹配附加形式（如 -i.bak） */
  forbidden?: readonly string[];
}

function isForbidden(arg: string, forbidden: readonly string[] | undefined): boolean {
  if (!forbidden) return false;
  for (const entry of forbidden) {
    if (arg === entry) return true;
    // 短开关的附加取值形式：-ofile、-i.bak
    if (entry.length === 2 && entry.startsWith("-") && arg.startsWith(entry) && arg.length > 2) {
      return true;
    }
    // 长开关的等号形式：--output=file
    if (entry.startsWith("--") && arg.startsWith(`${entry}=`)) {
      return true;
    }
  }
  return false;
}

/**
 * 逐参数核验：已知安全开关放行，危险开关判 unsafe，未知开关判 unknown。
 */
export function evaluateArgs(
  args: readonly string[],
  options: FlagEvalOptions,
): FlagEvalResult {
  const { flags = {}, forbidden } = options;
  const positionals: string[] = [];
  let verdict: "ok" | "unknown" = "ok";
  let detail = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      positionals.push(...args.slice(i + 1).filter((a) => a !== ""));
      break;
    }

    if (arg.startsWith("-") && arg !== "-") {
      if (isForbidden(arg, forbidden)) {
        return { verdict: "unsafe", detail: `dangerous flag: ${arg}`, positionals };
      }

      const kind = flags[arg];
      if (kind) {
        if (kind !== "none") i++; // 吃掉取值
        continue;
      }

      // 附加取值形式：-n5 / -A3（对已知短开关）
      const attached = Object.keys(flags).find(
        (known) =>
          known.length === 2 &&
          known.startsWith("-") &&
          arg.startsWith(known) &&
          arg.length > 2,
      );
      if (attached) continue;

      verdict = "unknown";
      detail = `unknown flag: ${arg}`;
      continue;
    }

    positionals.push(arg);
  }

  if (verdict === "unknown") {
    return { verdict, detail, positionals };
  }
  return { verdict: "ok", detail: "", positionals };
}
