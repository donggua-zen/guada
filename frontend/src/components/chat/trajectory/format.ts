/**
 * 轨迹台账格式化辅助（耗时 / token / 时间）。
 * dsh duration formatters 的精简版：短台账空间下的紧凑表示。
 */

/** token 数紧凑表示：1234 → 1.2k；12345 → 12.3k；1234567 → 1.2M */
export function formatTrajectoryTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 耗时紧凑表示：ms → 1.2s / 3.4m */
export function formatTrajectoryDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds > 0 ? `${seconds}s` : ''}`;
}

/** 事件时间紧凑表示（HH:mm:ss） */
export function formatTrajectoryTime(ts: number | null | undefined): string | null {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── SYSTEM 提示词行级 diff（LCS；对齐 dsh SYSTEM 页签的 diff 形态） ───

export interface TrajectoryDiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
  /** 折叠省略标记：被压缩的未变行数（组件侧渲染为「N 行未变」） */
  omitted?: number;
}

/**
 * 行级 LCS diff（prev → next）。系统提示词量级为数百行，O(n·m) DP 足够；
 * 全等时返回 null（无 diff，直接展示一份即可）。
 */
export function diffTrajectoryLines(prev: string, next: string): TrajectoryDiffLine[] | null {
  if (prev === next) return null;
  const a = prev.split('\n');
  const b = next.split('\n');
  const n = a.length;
  const m = b.length;
  // DP 表按短边分配（防大输入爆内存：>2000 行降级为整段替换）
  if (n * m > 4_000_000) {
    return [
      ...a.map((text): TrajectoryDiffLine => ({ type: 'removed', text })),
      ...b.map((text): TrajectoryDiffLine => ({ type: 'added', text })),
    ];
  }
  // lcs[i][j] = a[i..] 与 b[j..] 的公共子序列长度
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1]! + 1) : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: TrajectoryDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: 'removed', text: a[i]! });
      i += 1;
    } else {
      out.push({ type: 'added', text: b[j]! });
      j += 1;
    }
  }
  for (; i < n; i++) out.push({ type: 'removed', text: a[i]! });
  for (; j < m; j++) out.push({ type: 'added', text: b[j]! });
  return out;
}

/**
 * diff 显示折叠：长段未变行压缩为一条省略标记，只保留变化点 ±context 行上下文。
 * 修复「变更行把整段提示词摊开 + 下方全文 = 看起来显示两次」的重复观感
 * （对齐 dsh：变更行只看差异，全文按需展开）。
 */
export function compactTrajectoryDiff(
  lines: TrajectoryDiffLine[],
  context = 2,
): TrajectoryDiffLine[] {
  // 标记每行是否处于「变化点邻域」：任一 added/removed 行的 ±context 范围内
  const keep = new Array<number>(lines.length).fill(0);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type === 'same') continue;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep[j] = 1;
    }
  }
  const out: TrajectoryDiffLine[] = [];
  let runStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (runStart >= 0) {
        out.push({ type: 'same', text: '', omitted: i - runStart });
        runStart = -1;
      }
      out.push(lines[i]!);
    } else if (runStart < 0) {
      runStart = i;
    }
  }
  if (runStart >= 0) {
    out.push({ type: 'same', text: '', omitted: lines.length - runStart });
  }
  return out;
}
