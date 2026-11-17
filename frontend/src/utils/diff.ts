/**
 * diff 行数统计工具
 *
 * 从 useFileChanges.ts 抽出的共享逻辑：基于 diffLines 计算增删行数，
 * 供工具调用渲染器（折叠行 +N/−M 徽章）与回合级文件变更聚合共用。
 */
import { diffLines } from "diff";
import { perfStart } from "@/utils/perf";

export interface DiffStat {
  added: number;
  removed: number;
}

/**
 * 单侧文本行数（与 diffLines 分片统计口径一致：末尾换行不额外算一行）。
 * 用于「另一侧为空」的纯新增/纯删除场景，避免对整份文件跑 Myers diff。
 */
function countSideLines(text: string): number {
  if (!text) return 0;
  let newlines = 0;
  let pos = 0;
  while (true) {
    const index = text.indexOf("\n", pos);
    if (index === -1) break;
    newlines += 1;
    pos = index + 1;
  }
  return newlines + (text.endsWith("\n") ? 0 : 1);
}

/**
 * 计算两段文本的增删行数。
 *
 * diffLines 末尾常带一个空行分隔，统计时修正。
 * 任一文本为空（如 write 的旧文本）同样适用：整段记为新增/删除。
 */
export function countDiffLines(oldText: string, newText: string): DiffStat {
  const span = perfStart("diff.countLines");
  try {
    // 单侧为空是写入/删空的高频路径：直接数行，不进入 diff 算法
    if (!oldText) return { added: countSideLines(newText || ""), removed: 0 };
    if (!newText) return { added: 0, removed: countSideLines(oldText) };

    const parts = diffLines(oldText, newText);
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
  } finally {
    span?.end({ oldChars: oldText.length, newChars: newText.length });
  }
}
