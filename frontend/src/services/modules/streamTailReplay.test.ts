import { describe, it, expect, vi } from "vitest";
import type { ProjectorChunk, ProjectorSessionStore } from "./streamProjector";

/**
 * 强制重拉尾部重放的筛选规则（与 stash 消费同一口径）：
 * - prevSeq >= pageEndSeq（或缺失）→ 页内没有，重放
 * - prevSeq < pageEndSeq → 必已包含在事件页内，整体跳过（含 delta，防文本翻倍）
 */
const { applyLiveChunkMock } = vi.hoisted(() => ({ applyLiveChunkMock: vi.fn() }));

vi.mock("./streamProjector", () => ({
  applyLiveChunk: (...args: unknown[]) => applyLiveChunkMock(...args),
}));

import { replayStreamTailAfterReload } from "./streamTailReplay";

const store = {} as ProjectorSessionStore;

function chunk(type: string, prevSeq?: number): ProjectorChunk {
  return { type, sessionId: "s1", prevSeq } as ProjectorChunk;
}

describe("replayStreamTailAfterReload", () => {
  it("在飞尾部（prevSeq == 页尾）全部按序重放，含 delta/block_start", () => {
    applyLiveChunkMock.mockClear();
    const tail = [
      chunk("block_start", 4),
      chunk("text_delta", 4),
      chunk("block_end", 4),
      chunk("finish", 4),
      chunk("usage"), // 无 prevSeq → fail-open
    ];

    const applied = replayStreamTailAfterReload(store, "s1", tail, 4);

    expect(applied).toBe(5);
    expect(applyLiveChunkMock.mock.calls.map((call) => call[2].type)).toEqual([
      "block_start",
      "text_delta",
      "block_end",
      "finish",
      "usage",
    ]);
  });

  it("prevSeq 落后于页尾的 chunk 一律跳过（页内已含，重复应用会文本翻倍）", () => {
    applyLiveChunkMock.mockClear();
    const tail = [
      chunk("block_start", 3),
      chunk("text_delta", 3),
      chunk("block_end", 3),
      chunk("turn_end", 2),
    ];

    expect(replayStreamTailAfterReload(store, "s1", tail, 4)).toBe(0);
    expect(applyLiveChunkMock).not.toHaveBeenCalled();
  });

  it("空尾部零行为（普通加载/无活跃流路径）", () => {
    applyLiveChunkMock.mockClear();
    expect(replayStreamTailAfterReload(store, "s1", [], 10)).toBe(0);
    expect(applyLiveChunkMock).not.toHaveBeenCalled();
  });

  it("pageEndSeq 非有限值时不因过滤丢事件", () => {
    applyLiveChunkMock.mockClear();
    const tail = [chunk("block_end", 1), chunk("finish", 1)];
    expect(replayStreamTailAfterReload(store, "s1", tail, Number.NaN)).toBe(2);
    expect(applyLiveChunkMock).toHaveBeenCalledTimes(2);
  });
});
