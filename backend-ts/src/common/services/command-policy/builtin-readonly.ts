/**
 * 内置只读名单：命令前缀条目（隐式"其后任意参数"）。
 *
 * 这份名单是默认策略文件（`defaults/policy-defaults.yaml`）里 `readOnly.allow` 的生成源，
 * 也是运行时区分"内置条目 / 用户自加条目"的依据：
 * - **内置条目**：参数合法性由方言分析器把关（`find` 放行，`find -delete` 拒绝）
 * - **自加条目**：分析器没有该命令的语义，只能由代码风险层兜底（T0 / 路径型 / 主机 / 远程）
 *
 * 条目形态与用户配置完全一致，所以"从配置里删一行"与"这一行是内置的"互不矛盾。
 */

import { gitSubcommandOf, posixReadOnlyEntries } from "./posix-rules";
import { powershellReadOnlyEntries } from "./powershell-rules";
import { commandShape } from "./workspace-rules";

let commandsCache: string[] | null = null;
let setCache: ReadonlySet<string> | null = null;

/** 全部内置只读条目（去重、排序） */
export function builtinReadOnlyCommands(): string[] {
  if (!commandsCache) {
    commandsCache = [...new Set([...posixReadOnlyEntries(), ...powershellReadOnlyEntries()])].sort();
  }
  return commandsCache;
}

/** 条目归一（折叠空白 + 小写），用于集合比较与"同一行"判定 */
export function normalizeReadOnlyEntry(entry: string): string {
  return entry.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 内置只读条目集合（归一后）：命中即"内置条目"（走分析器的参数级核验） */
export function builtinReadOnlySet(): ReadonlySet<string> {
  if (!setCache) {
    setCache = new Set(builtinReadOnlyCommands().map(normalizeReadOnlyEntry));
  }
  return setCache;
}

/**
 * 单个条目是否匹配一段命令（前缀语义：`cat` 匹配 `cat x`，`git status` 匹配 `git status -s`）。
 *
 * `git` 条目特意跳过全局开关（`git --no-pager log` 命中 `git log`），与 evaluateGit 的前缀处理一致。
 */
export function readOnlyEntryMatches(entry: string, segment: string): boolean {
  const entryTokens = normalizeReadOnlyEntry(entry).split(" ").filter(Boolean);
  if (entryTokens.length === 0) return false;
  // 尾部 `*` 与"隐式其后任意"等价（用户按上一版写法写 `ffmpeg *` 也应命中）
  if (entryTokens.length > 1 && entryTokens[entryTokens.length - 1] === "*") {
    entryTokens.pop();
  }
  const segmentTokens = segment
    .match(/"[^"]*"|'[^']*'|[^\s]+/g)
    ?.map((t) => t.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  if (!segmentTokens || segmentTokens.length === 0) return false;

  const head = entryTokens[0];
  const segmentHead = commandShape(segmentTokens[0]);
  if (head === "git") {
    if (segmentHead !== "git") return false;
    if (entryTokens.length === 1) return true;
    const subcommand = gitSubcommandOf(segmentTokens.slice(1));
    return !!subcommand && commandShape(subcommand) === entryTokens[1];
  }
  if (entryTokens.length > segmentTokens.length) return false;
  return entryTokens.every((token, i) => token === commandShape(segmentTokens[i]));
}

/** 在一组条目里找第一个命中的（未命中返回 null） */
export function matchReadOnlyEntry(
  entries: readonly string[],
  segment: string,
): string | null {
  for (const entry of entries) {
    if (readOnlyEntryMatches(entry, segment)) return entry;
  }
  return null;
}
