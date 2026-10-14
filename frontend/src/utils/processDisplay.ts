/**
 * 后台进程展示的纯格式化（输入区运行时胶囊与进程日志面板共用；不含 i18n 依赖）
 */

/** 单行化 + 截断命令（胶囊/行内展示；完整命令走 title/tooltip） */
export function shortCommand(command: string, max = 42): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/**
 * 已运行时长（整数秒档：<60s → "12s"，<60m → "3m 05s"，其余 → "1h 20m"）。
 * 秒级跳动由调用方的 now tick 驱动。
 */
export function formatProcessDuration(ms: number): string {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, "0")}s`;
  const hour = Math.floor(min / 60);
  return `${hour}h ${String(min % 60).padStart(2, "0")}m`;
}
