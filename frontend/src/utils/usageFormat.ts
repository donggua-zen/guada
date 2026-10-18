/** 用量统计页的展示格式化（纯函数，便于单测）。 */

export function formatCompactTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "0";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return `${trimZero(n / 1_000_000_000)}B`;
  }
  if (abs >= 1_000_000) {
    return `${trimZero(n / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${trimZero(n / 1_000)}K`;
  }
  return String(Math.round(n));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(Number(value))) return "0%";
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatDurationMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const ms = Math.max(0, Number(value));
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${trimZero(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/** 热力图/趋势图用：2026-10-18 → 10-18 */
export function formatMonthDay(isoDate: string): string {
  const parts = isoDate.split("-");
  return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : isoDate;
}

/** 热力图月份标签：2026-10-01 + zh-CN → 10月；en-US → Oct */
export function formatMonthLabel(isoDate: string, locale: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate.slice(5, 7);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function trimZero(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return fixed.replace(/\.0$/, "");
}
