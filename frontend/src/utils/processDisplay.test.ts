/**
 * 后台进程展示格式化测试（输入区运行时胶囊与进程日志共用）
 */
import { describe, it, expect } from "vitest";
import { shortCommand, durationParts } from "./processDisplay";

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

describe("durationParts", () => {
  it("秒档：hours/minutes 为 0", () => {
    expect(durationParts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(durationParts(12_900)).toEqual({ hours: 0, minutes: 0, seconds: 12 });
    expect(durationParts(59_999)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
  });

  it("分档：秒取余、分钟不越 60", () => {
    expect(durationParts(60_000)).toEqual({ hours: 0, minutes: 1, seconds: 0 });
    expect(durationParts(185_000)).toEqual({ hours: 0, minutes: 3, seconds: 5 });
    expect(durationParts(3_599_999)).toEqual({ hours: 0, minutes: 59, seconds: 59 });
  });

  it("时档：分钟取余、秒同样保留（拼装层自行决定是否显示秒）", () => {
    expect(durationParts(3_600_000)).toEqual({ hours: 1, minutes: 0, seconds: 0 });
    expect(durationParts(4_860_000)).toEqual({ hours: 1, minutes: 21, seconds: 0 });
    expect(durationParts(4_865_000)).toEqual({ hours: 1, minutes: 21, seconds: 5 });
    expect(durationParts(90_000_000)).toEqual({ hours: 25, minutes: 0, seconds: 0 });
  });

  it("负数与 NaN 按 0 处理（时钟回拨防御）", () => {
    expect(durationParts(-5_000)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(durationParts(Number.NaN)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(durationParts(Number.POSITIVE_INFINITY)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});
