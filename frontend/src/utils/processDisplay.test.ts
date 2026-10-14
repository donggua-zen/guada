/**
 * 后台进程展示格式化测试（输入区运行时胶囊与进程日志共用）
 */
import { describe, it, expect } from "vitest";
import { shortCommand, formatProcessDuration } from "./processDisplay";

describe("shortCommand", () => {
  it("多行/连续空白压成单行", () => {
    expect(shortCommand("npm   run\n  dev")).toBe("npm run dev");
  });

  it("超过上限截断并加省略号（默认 42）", () => {
    const long = "a".repeat(60);
    const out = shortCommand(long);
    expect(out).toBe("a".repeat(42) + "…");
    expect(out.length).toBe(43);
  });

  it("恰好等于上限不截断", () => {
    const exact = "b".repeat(42);
    expect(shortCommand(exact)).toBe(exact);
  });
});

describe("formatProcessDuration", () => {
  it("< 60s 用整数秒", () => {
    expect(formatProcessDuration(0)).toBe("0s");
    expect(formatProcessDuration(12_900)).toBe("12s");
    expect(formatProcessDuration(59_999)).toBe("59s");
  });

  it("< 60m 用 m + 补零秒", () => {
    expect(formatProcessDuration(60_000)).toBe("1m 00s");
    expect(formatProcessDuration(185_000)).toBe("3m 05s");
  });

  it("≥ 60m 用 h + 补零分", () => {
    expect(formatProcessDuration(3_600_000)).toBe("1h 00m");
    expect(formatProcessDuration(4_860_000)).toBe("1h 21m");
  });

  it("负数按 0 处理（时钟回拨防御）", () => {
    expect(formatProcessDuration(-5_000)).toBe("0s");
  });
});
