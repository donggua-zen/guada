import { describe, expect, it } from "vitest";
import { takeTextPreview } from "./textPreview";

/**
 * 预览切片测试
 *
 * 重点保证两点：行数口径与原 `content.split("\n").length` 一致，
 * 以及截断后只保留前 N 行 / 前 N 字符。
 */
describe("takeTextPreview", () => {
  it("空文本保持 split 语义（1 行）", () => {
    expect(takeTextPreview("", 400)).toEqual({
      text: "",
      totalLines: 1,
      truncated: false,
    });
  });

  it("无换行的单行文本", () => {
    expect(takeTextPreview("const a = 1", 400)).toEqual({
      text: "const a = 1",
      totalLines: 1,
      truncated: false,
    });
  });

  it("尾随换行按 split 语义多算一行", () => {
    const preview = takeTextPreview("a\n", 400);
    expect(preview.totalLines).toBe(2);
    expect(preview.text).toBe("a\n");
    expect(preview.truncated).toBe(false);
  });

  it("恰好 maxLines 行时不截断", () => {
    const content = Array.from({ length: 400 }, (_, i) => `line${i}`).join("\n");
    const preview = takeTextPreview(content, 400);
    expect(preview.totalLines).toBe(400);
    expect(preview.text).toBe(content);
    expect(preview.truncated).toBe(false);
  });

  it("超过 maxLines 时截掉第 N+1 行，行头仍是总行数", () => {
    const content = Array.from({ length: 401 }, (_, i) => `line${i}`).join("\n");
    const preview = takeTextPreview(content, 400);
    expect(preview.totalLines).toBe(401);
    expect(preview.text).toBe(content.slice(0, content.lastIndexOf("\n")));
    expect(preview.text.split("\n")).toHaveLength(400);
    expect(preview.truncated).toBe(true);
  });

  it("字符上限优先于行数上限，且不切断行时仍报总行数", () => {
    const content = "12345\n67890\nabcde";
    const preview = takeTextPreview(content, 400, 8);
    expect(preview.text).toBe("12345\n67");
    expect(preview.totalLines).toBe(3);
    expect(preview.truncated).toBe(true);
  });

  it("字符上限覆盖单行大文本（minified 文件）", () => {
    const content = "x".repeat(1000);
    const preview = takeTextPreview(content, 400, 120);
    expect(preview.text).toBe("x".repeat(120));
    expect(preview.totalLines).toBe(1);
    expect(preview.truncated).toBe(true);
  });
});
