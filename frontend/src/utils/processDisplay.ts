/**
 * 后台进程展示的纯格式化（输入区运行时胶囊与进程日志面板共用；不含 i18n 依赖）
 */

/** 单行化 + 截断命令（胶囊/行内展示；完整命令走 title/tooltip） */
export function shortCommand(command: string, max = 42): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/**
 * 已运行时长的分档拆解（非有限值/负数按 0 处理：时钟回拨防御）。
 *
 * 返回原始数值而不是拼好的字符串：胶囊 hover 面板要按语言输出「已运行 1 分 18 秒」，
 * 将来若要紧凑的等宽形态（1m 05s）也只需另写一个拼装函数——分档与取整只有这一处真相。
 */
export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export function durationParts(ms: number): DurationParts {
  const total = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const sec = Math.floor(total / 1000);
  return {
    hours: Math.floor(sec / 3600),
    minutes: Math.floor(sec / 60) % 60,
    seconds: sec % 60,
  };
}
