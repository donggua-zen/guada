import { describe, it, expect, vi } from "vitest";
// modelUtils 依赖 locales（i18n 单例）在 node 测试环境不可用，mock 掉
vi.mock("@/locales", () => ({ t: (k: string) => k }));
import {
  PATCH_TEMPLATE_CUSTOM,
  getDefaultThinkingEffort,
  matchPatchTemplate,
} from "./modelUtils";

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

/**
 * 拼法模板选择态推导：表达式文本 → 下拉显示值。
 * 逐字相等才算命中模板（避免"看起来像"的误判），空 = 默认 openai 拼法（无表达式）。
 */
describe("matchPatchTemplate", () => {
  const templates = [
    { format: "openai", expression: '{"reasoning_effort": wireValue}' },
    { format: "zai", expression: '{"thinking": {"type": "enabled"}}' },
  ];

  it("空表达式 → 空串（下拉显示默认 openai 占位）", () => {
    expect(matchPatchTemplate("", templates)).toBe("");
    expect(matchPatchTemplate("   ", templates)).toBe("");
    expect(matchPatchTemplate(undefined, templates)).toBe("");
    expect(matchPatchTemplate(null, templates)).toBe("");
  });

  it("与模板逐字相等（忽略首尾空白）→ 该模板名", () => {
    expect(
      matchPatchTemplate('{"reasoning_effort": wireValue}', templates),
    ).toBe("openai");
    expect(
      matchPatchTemplate('  {"thinking": {"type": "enabled"}}  ', templates),
    ).toBe("zai");
  });

  it("模板被编辑过 → 自定义", () => {
    expect(
      matchPatchTemplate('{"reasoning_effort": "high"}', templates),
    ).toBe(PATCH_TEMPLATE_CUSTOM);
    expect(matchPatchTemplate('{"reasoning_effort": wireValue} ', [
      { format: "openai", expression: '{"reasoning_effort": wireValue} ' },
    ])).toBe("openai");
  });
});
