import { describe, expect, it } from "vitest";
import { computeTreeViewVisibleRange } from "./treeViewVirtual";

describe("computeTreeViewVisibleRange", () => {
  it("空列表返回零区间", () => {
    expect(computeTreeViewVisibleRange(0, 0, 500, 26, 5)).toEqual({
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });

  it("行高非法时返回零区间", () => {
    expect(computeTreeViewVisibleRange(100, 0, 500, 0, 5)).toEqual({
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });

  it("小列表全部渲染，无占位", () => {
    expect(computeTreeViewVisibleRange(10, 0, 260, 26, 2)).toEqual({
      start: 0,
      end: 10,
      topSpacer: 0,
      bottomSpacer: 0,
    });
  });

  it("滚动到中部只渲染可视区 + overscan", () => {
    // 视口 20 行（520px），滚动到第 1000 行，overscan 5
    expect(computeTreeViewVisibleRange(10000, 26000, 520, 26, 5)).toEqual({
      start: 995,
      end: 1025,
      topSpacer: 995 * 26,
      bottomSpacer: (10000 - 1025) * 26,
    });
  });

  it("scrollTop 越界时夹到最大滚动位置", () => {
    // 1000 行总高 26000，视口 260 → 最大 scrollTop 25740
    expect(computeTreeViewVisibleRange(1000, 999999, 260, 26, 2)).toEqual({
      start: 988,
      end: 1000,
      topSpacer: 988 * 26,
      bottomSpacer: 0,
    });
  });

  it("视口尚未测量（0）时至少渲染 overscan 行", () => {
    expect(computeTreeViewVisibleRange(100, 0, 0, 26, 3)).toEqual({
      start: 0,
      end: 3,
      topSpacer: 0,
      bottomSpacer: 97 * 26,
    });
  });
});
