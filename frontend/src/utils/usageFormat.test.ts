import { describe, expect, it } from "vitest";

import {
  formatCompactTokens,
  formatDurationMs,
  formatMonthDay,
  formatMonthLabel,
  formatPercent,
} from "./usageFormat";

describe("usageFormat", () => {
  it("压缩 token 数字", () => {
    expect(formatCompactTokens(999)).toBe("999");
    expect(formatCompactTokens(1_000)).toBe("1K");
    expect(formatCompactTokens(1_250)).toBe("1.3K");
    expect(formatCompactTokens(2_000_000)).toBe("2M");
    expect(formatCompactTokens(3_500_000_000)).toBe("3.5B");
    expect(formatCompactTokens(null)).toBe("0");
  });

  it("格式化百分比与耗时", () => {
    expect(formatPercent(0.256)).toBe("25.6%");
    expect(formatPercent(null)).toBe("0%");
    expect(formatDurationMs(420)).toBe("420ms");
    expect(formatDurationMs(1_500)).toBe("1.5s");
    expect(formatDurationMs(65_000)).toBe("1m 5s");
    expect(formatDurationMs(null)).toBe("—");
  });

  it("日期只保留月日", () => {
    expect(formatMonthDay("2026-10-18")).toBe("10-18");
  });

  it("热力图月份标签按 locale 输出", () => {
    expect(formatMonthLabel("2026-10-01", "zh-CN")).toBe("10月");
    expect(formatMonthLabel("2026-10-01", "en-US")).toBe("Oct");
  });
});
