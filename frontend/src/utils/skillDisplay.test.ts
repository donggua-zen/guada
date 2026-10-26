import { describe, it, expect, vi, beforeEach } from "vitest";

// 只桩掉 getLocale：展示名解析依赖当前界面语言，其余逻辑为纯函数
const getLocaleMock = vi.hoisted(() => vi.fn(() => "zh-CN"));
vi.mock("@/locales", () => ({ getLocale: getLocaleMock }));

import { getSkillDisplayName, getSkillDisplayDescription } from "./skillDisplay";

beforeEach(() => {
  getLocaleMock.mockReturnValue("zh-CN");
});

describe("getSkillDisplayName", () => {
  it("中文界面优先 display_name_zh", () => {
    expect(
      getSkillDisplayName(
        { name: "humanizer", display_name: "去AI味", display_name_zh: "去AI味", display_name_en: "Humanizer" },
        "humanizer",
      ),
    ).toBe("去AI味");
  });

  it("无本地化字段时回退 display_name", () => {
    expect(
      getSkillDisplayName({ name: "gzh-design", display_name: "公众号排版引擎" }, "gzh-design"),
    ).toBe("公众号排版引擎");
  });

  it("display_name 等于 slug 时忽略，回退 name", () => {
    expect(
      getSkillDisplayName({ name: "minimax-xlsx", display_name: "minimax-xlsx", display_name_en: "Excel 处理" }, "minimax-xlsx"),
    ).toBe("minimax-xlsx");
  });

  it("英文界面优先 display_name_en", () => {
    getLocaleMock.mockReturnValue("en-US");
    expect(
      getSkillDisplayName(
        { name: "humanizer", display_name: "去AI味", display_name_zh: "去AI味", display_name_en: "AI Text Humanizer" },
        "humanizer",
      ),
    ).toBe("AI Text Humanizer");
  });

  it("display_name_en 与 slug 仅大小写不同时按 slug 忽略", () => {
    getLocaleMock.mockReturnValue("en-US");
    expect(
      getSkillDisplayName({ name: "humanizer", display_name_en: "Humanizer" }, "humanizer"),
    ).toBe("humanizer");
  });

  it("英文界面不回退到中文展示名（与服务端口径一致）", () => {
    getLocaleMock.mockReturnValue("en-US");
    expect(
      getSkillDisplayName({ name: "gzh-design", display_name_zh: "公众号排版引擎" }, "gzh-design"),
    ).toBe("gzh-design");
  });

  it("完全没有展示字段时回退 name / id", () => {
    expect(getSkillDisplayName({ name: "caveman" }, "caveman")).toBe("caveman");
    expect(getSkillDisplayName({ name: "" }, "fallback-id")).toBe("fallback-id");
  });

  it("skid 大小写不同也按 slug 忽略 display_name", () => {
    expect(
      getSkillDisplayName({ name: "Humanizer-ZH", display_name: "humanizer-zh" }, "Humanizer-ZH"),
    ).toBe("Humanizer-ZH");
  });
});

describe("getSkillDisplayDescription", () => {
  it("中文界面优先 description_zh", () => {
    expect(
      getSkillDisplayDescription({
        description: "Remove AI writing patterns",
        description_zh: "去除 AI 写作痕迹",
      }),
    ).toBe("去除 AI 写作痕迹");
  });

  it("英文界面优先 description_en", () => {
    getLocaleMock.mockReturnValue("en-US");
    expect(
      getSkillDisplayDescription({
        description: "去除 AI 写作痕迹",
        description_zh: "去除 AI 写作痕迹",
        description_en: "Remove AI writing patterns",
      }),
    ).toBe("Remove AI writing patterns");
  });

  it("无本地化描述时回退 description", () => {
    expect(getSkillDisplayDescription({ description: "标准描述" })).toBe("标准描述");
    expect(getSkillDisplayDescription({ description: "" })).toBe("");
  });
});
