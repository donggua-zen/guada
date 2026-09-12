import { describe, it, expect, vi } from "vitest";
// modelUtils 依赖 locales（i18n 单例）在 node 测试环境不可用，mock 掉
vi.mock("@/locales", () => ({ t: (k: string) => k }));
import { getDefaultThinkingEffort } from "./modelUtils";

/**
 * 思考档位默认值测试
 *
 * 规则：取非关闭档的中位数（向下取整）——即"默认开启思考、取中等强度"，
 * 而不是默认关闭。与后端 `defaultThinkingEffort` 必须逐字一致，
 * 否则会出现"UI 显示关闭、实际发了强度值"的分叉。
 */
describe("getDefaultThinkingEffort", () => {
  it("官方 6 档兜底 → high", () => {
    expect(
      getDefaultThinkingEffort(["none", "low", "medium", "high", "xhigh", "max"]),
    ).toBe("high");
  });

  it("deepseek 菜单 [none,high,max] → high（两档取较低那档）", () => {
    expect(getDefaultThinkingEffort(["none", "high", "max"])).toBe("high");
  });

  it("四档菜单 → medium", () => {
    expect(getDefaultThinkingEffort(["none", "low", "medium", "high"])).toBe("medium");
  });

  it("纯开关菜单 [none,on] → on（开启思考）", () => {
    expect(getDefaultThinkingEffort(["none", "on"])).toBe("on");
  });

  it("强制思考菜单 [on] → on", () => {
    expect(getDefaultThinkingEffort(["on"])).toBe("on");
  });

  it("不能思考（空菜单 / 只有 none / undefined）→ none", () => {
    expect(getDefaultThinkingEffort([])).toBe("none");
    expect(getDefaultThinkingEffort(["none"])).toBe("none");
    expect(getDefaultThinkingEffort(undefined)).toBe("none");
  });
});
