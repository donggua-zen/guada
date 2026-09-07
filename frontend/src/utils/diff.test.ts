import { describe, it, expect } from "vitest";
import { countDiffLines } from "./diff";

/**
 * diff 行数统计测试
 *
 * 覆盖：新增/删除/混合、末尾空行修正、空文本（write 全新增 / edit 删空）。
 */
describe("countDiffLines", () => {
  it("纯新增", () => {
    expect(countDiffLines("", "a\nb\nc")).toEqual({ added: 3, removed: 0 });
  });

  it("纯删除", () => {
    expect(countDiffLines("a\nb\nc", "")).toEqual({ added: 0, removed: 3 });
  });

  it("混合增删", () => {
    const stat = countDiffLines("keep\nold1\nold2", "keep\nnew1\nnew2\nnew3");
    expect(stat).toEqual({ added: 3, removed: 2 });
  });

  it("末尾带换行符的修正（diffLines 末尾常带空行分隔）", () => {
    expect(countDiffLines("a\n", "a\nb\n")).toEqual({ added: 1, removed: 0 });
  });

  it("无变更", () => {
    expect(countDiffLines("same\ntext", "same\ntext")).toEqual({
      added: 0,
      removed: 0,
    });
  });
});
