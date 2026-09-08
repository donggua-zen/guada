import { describe, it, expect } from "vitest";
import { getThinkingPreview } from "./messageUtils";

/**
 * 思考内容预览测试（步骤行/分组标题摘要文字）
 *
 * 语义：按 \n 拆行取最后一行（从行首显示、超长结尾截断）——
 * 不是取尾部若干字符；思考中实时跟随最新一行，结束后保留。
 */
describe("getThinkingPreview", () => {
  it("多行内容取最后一个非空行", () => {
    expect(getThinkingPreview("第一行\n第二行\n\n第三行结论")).toBe("第三行结论");
  });

  it("从行首取前 200 字符并追加省略号（结尾截断，而非尾部字符）", () => {
    const longLine = "a".repeat(300);
    const preview = getThinkingPreview(`开头\n${longLine}`);
    expect(preview).toBe("a".repeat(200) + "...");
    expect(preview.startsWith("a")).toBe(true);
    expect(preview).toHaveLength(203);
  });

  it("空/空白内容返回空串", () => {
    expect(getThinkingPreview("")).toBe("");
    expect(getThinkingPreview("\n \n")).toBe("");
    expect(getThinkingPreview(null)).toBe("");
    expect(getThinkingPreview(undefined)).toBe("");
  });

  it("行首尾空白被 trim", () => {
    expect(getThinkingPreview("  带空白的行  ")).toBe("带空白的行");
  });

  it("单行内容原样返回", () => {
    expect(getThinkingPreview("只有一行")).toBe("只有一行");
  });
});
