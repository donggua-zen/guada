/**
 * 路径规则：glob 匹配（`~` / `%VAR%` 展开 + `/**` 递归 + 归一后不区分大小写）。
 *
 * 与命令规则的关系（见 docs/windows-command-policy.md）：
 *   - `{ action: allow, path }` = **可写根**（工作区外仍允许写/删的目录）
 *   - `{ action: ask, path }`   = **敏感路径**（读写都先问一次）
 *   - `{ action: deny, path }`  = 该路径一律拒绝
 *
 * 写法约定：
 *   - 没写任何通配符的条目视为"该目录及其子目录"（`D:/AI/out` ≡ `D:/AI/out/**`）
 *   - `**` 匹配任意层级，`*` 匹配单层内任意字符，`?` 匹配单层内一个字符
 */

import * as os from "os";

/** 展开 `~` 与 `%VAR%`（Windows 环境变量写法；未定义则原样保留） */
export function expandPathPattern(pattern: string): string {
  let out = pattern.trim();
  if (out === "~") out = os.homedir();
  else if (out.startsWith("~/") || out.startsWith("~\\")) {
    out = `${os.homedir()}${out.slice(1)}`;
  }
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
    const value = process.env[name] ?? process.env[name.toUpperCase()];
    return value ? value : whole;
  });
  return out;
}

/** 归一：正斜杠统一成反斜杠、折叠重复分隔符、去尾分隔符、小写、解析 `.`/`..` */
export function normalizeForMatch(p: string): string {
  let s = p.trim().replace(/\//g, "\\");
  const drive = /^([a-z]):/i.exec(s);
  const prefix = drive ? `${drive[1].toLowerCase()}:` : "";
  const rest = drive ? s.slice(2) : s;
  const rootRelative = rest.startsWith("\\");
  const segments: string[] = [];
  for (const segment of rest.split("\\")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!rootRelative) segments.push("..");
      continue;
    }
    segments.push(segment.toLowerCase());
  }
  return `${prefix}${rootRelative || prefix ? "\\" : ""}${segments.join("\\")}`;
}

/** glob → RegExp（作用于归一后的路径） */
function globToRegExp(glob: string): RegExp {
  const source = normalizeForMatch(glob);
  let re = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "*") {
      const isDouble = source[i + 1] === "*";
      if (isDouble) {
        i++;
        // `**\` / `**` → 任意层级（含零层）
        if (source[i + 1] === "\\") {
          i++;
          re += "(?:.*\\\\)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^\\\\]*";
      }
      continue;
    }
    if (ch === "?") {
      re += "[^\\\\]";
      continue;
    }
    re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 该条目是否只有"任意层级 + 斜杠"前缀、没有目录部分（用于按文件名匹配的敏感条目） */
export function basenameGlobOf(pattern: string): string | null {
  const normalized = normalizeForMatch(expandPathPattern(pattern));
  const match = /^(?:\.\.\\)?(?:\*\*\\|\*\*)?([^\\]+)$/.exec(normalized);
  if (!match) return null;
  return match[1];
}

/** 路径条目是否匹配候选路径（候选应先 `expandPathPattern` 再传入） */
export function pathRuleMatches(pattern: string, candidate: string): boolean {
  const expanded = expandPathPattern(pattern);
  const hasWildcard = /[*?]/.test(expanded);
  const normalizedPattern = hasWildcard ? expanded : `${expanded.replace(/[\\/]+$/, "")}/**`;
  const normalizedCandidate = normalizeForMatch(expandPathPattern(candidate));
  if (globToRegExp(normalizedPattern).test(normalizedCandidate)) return true;
  // 只有文件名部分的条目（`**/id_rsa`、`**/.env`）额外按 basename 匹配：
  // 覆盖 `cd ~/.ssh && cat id_rsa` 这类"命令里只出现文件名"的形态
  const basenameGlob = basenameGlobOf(normalizedPattern);
  if (!basenameGlob) return false;
  const base = normalizedCandidate.split("\\").pop() ?? "";
  if (!base) return false;
  return globToRegExp(basenameGlob).test(base);
}

/** `D:/AI/out` → `d:\ai\out\**`（UI 展示"可写根"用） */
export function describePathRule(pattern: string): string {
  const expanded = expandPathPattern(pattern);
  return /[*?]/.test(expanded) ? normalizeForMatch(expanded) : normalizeForMatch(`${expanded}/**`);
}
