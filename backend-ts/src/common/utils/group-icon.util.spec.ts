import { parseGroupIcon } from "./group-icon.util";

describe("parseGroupIcon", () => {
  it("未提供 → 保持原值", () => {
    expect(parseGroupIcon(undefined)).toEqual({ invalid: false });
  });

  it("null / 空串 → 清除为默认图标", () => {
    expect(parseGroupIcon(null)).toEqual({ value: null, invalid: false });
    expect(parseGroupIcon("   ")).toEqual({ value: null, invalid: false });
  });

  it("合法 key 去空白后透传", () => {
    expect(parseGroupIcon(" code ")).toEqual({ value: "code", invalid: false });
    expect(parseGroupIcon("ai-2")).toEqual({ value: "ai-2", invalid: false });
  });

  it("非法字符 / 超长 / 大写均拒绝", () => {
    expect(parseGroupIcon("Bad Key")).toEqual({ invalid: true });
    expect(parseGroupIcon("Code")).toEqual({ invalid: true });
    expect(parseGroupIcon("a".repeat(33))).toEqual({ invalid: true });
  });
});
