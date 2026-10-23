/**
 * TreeView 固定行高虚拟化的纯计算部分。
 * 行高固定后，可视区间只由 scrollTop / viewportHeight 决定，便于单测覆盖。
 */
export interface TreeViewVisibleRange {
  /** 第一个渲染行下标（含 overscan） */
  start: number;
  /** 最后一个渲染行下标（不含） */
  end: number;
  /** 上方占位高度（未渲染行） */
  topSpacer: number;
  /** 下方占位高度（未渲染行） */
  bottomSpacer: number;
}

export function computeTreeViewVisibleRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): TreeViewVisibleRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }

  const maxScrollTop = Math.max(0, total * rowHeight - Math.max(0, viewportHeight));
  const safeScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);

  const start = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan);
  const end = Math.min(
    total,
    Math.ceil((safeScrollTop + Math.max(0, viewportHeight)) / rowHeight) + overscan,
  );

  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, (total - end) * rowHeight),
  };
}
