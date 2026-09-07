/**
 * diff 行数统计工具
 *
 * 从 useFileChanges.ts 抽出的共享逻辑：基于 diffLines 计算增删行数，
 * 供工具调用渲染器（折叠行 +N/−M 徽章）与回合级文件变更聚合共用。
 */
import { diffLines } from "diff";

export interface DiffStat {
  added: number;
  removed: number;
}

/**
 * 计算两段文本的增删行数。
 *
 * diffLines 末尾常带一个空行分隔，统计时修正。
 * 任一文本为空（如 write 的旧文本）同样适用：整段记为新增/删除。
 */
export function countDiffLines(oldText: string, newText: string): DiffStat {
  const parts = diffLines(oldText || "", newText || "");
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const lineCount = part.value.split("\n").length;
    const effective = part.value.endsWith("\n")
      ? lineCount - 1
      : lineCount;
    if (part.added) added += effective;
    else if (part.removed) removed += effective;
  }
  return { added, removed };
}
