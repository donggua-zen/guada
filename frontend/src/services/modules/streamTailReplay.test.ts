import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/services/ApiService", () => ({ apiService: {} }));

import {
  applyInFlightChunks,
  isChunkCoveredByPage,
  type ProjectorChunk,
  type ProjectorSessionState,
} from "./streamProjector";
import { replayStreamTailAfterReload } from "./streamTailReplay";

/**
 * 在飞帧的"是否已被事件页覆盖"判定与批量应用（stash 消费 / 强制重拉尾部重放共用）。
 *
 * 口径：发布时刻的落库游标（优先 logSeq，回退 baseSeq）< pageEndSeq ⇒ 页内已含 ⇒ 跳过；
 * 缺游标 fail-open 应用。跳过是必须的——重复应用 delta 会让文本翻倍。
 */
function chunk(
  type: string,
  seqs: { logSeq?: number; baseSeq?: number } = {},
): ProjectorChunk {
  return { type, sessionId: "s1", ...seqs } as ProjectorChunk;
}

function createStore() {
  const state = {
    loaded: true,
    turns: [] as any[],
    eventLog: [] as any[],
    pendingAsks: undefined as ProjectorSessionState["pendingAsks"],
  };
  const store = {
    state,
    getSessionState: () => state,
    getTurns: () => state.turns,
    setTurns: (_sid: string, t: any[]) => {
      state.turns = t;
    },
    deleteTurnById: (_sid: string, id: string) => {
      state.turns = state.turns.filter((t) => t.id !== id);
    },
    setSessionIsCompressing: () => {},
    sessionIsCompressing: () => false,
    sessionIsStreaming: (): boolean => false,
    upsertSessionPendingAsk: () => {},
    removeSessionPendingAsk: () => {},
    clearSessionPendingAsks: () => {},
  };
  return store;
}

describe("isChunkCoveredByPage", () => {
  it("logSeq 落后于页尾 → 已覆盖（跳过）", () => {
    expect(isChunkCoveredByPage(chunk("text_delta", { logSeq: 3 }), 4)).toBe(true);
  });

  it("logSeq 等于/大于页尾 → 未覆盖（应用）", () => {
    expect(isChunkCoveredByPage(chunk("text_delta", { logSeq: 4 }), 4)).toBe(false);
    expect(isChunkCoveredByPage(chunk("text_delta", { logSeq: 5 }), 4)).toBe(false);
  });

  it("logSeq 优先于被钳制的 baseSeq", () => {
    // baseSeq 钳制后偏大（4），真实落库游标 logSeq=2 → 应按 logSeq 判定为已覆盖
    expect(
      isChunkCoveredByPage(chunk("text_delta", { baseSeq: 4, logSeq: 2 }), 4),
    ).toBe(true);
  });

  it("缺 logSeq 时回退 baseSeq（旧后端/裸运行时帧）", () => {
    expect(isChunkCoveredByPage(chunk("text_delta", { baseSeq: 2 }), 4)).toBe(true);
    expect(isChunkCoveredByPage(chunk("text_delta", { baseSeq: 4 }), 4)).toBe(false);
  });

  it("无任何游标 → fail-open（应用）", () => {
    expect(isChunkCoveredByPage(chunk("usage"), 4)).toBe(false);
  });

  it("pageEndSeq 非有限值 → 不过滤", () => {
    expect(isChunkCoveredByPage(chunk("text_delta", { logSeq: 1 }), Number.NaN)).toBe(
      false,
    );
  });
});

describe("applyInFlightChunks", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it("页尾之后的帧按序应用，页内已含的跳过", () => {
    const applied = applyInFlightChunks(
      store,
      "s1",
      [
        chunk("block_start", { logSeq: 3 }), // 页内已含 → 跳过
        chunk("block_end", { logSeq: 4 }), // 页尾之后 → 应用
        chunk("finish", { logSeq: 4 }), // 应用
      ],
      4,
    );

    expect(applied).toBe(2);
    // applyLiveChunk 会把终态事件记进 eventLog（delta/block_start 不记）
    expect(store.state.eventLog.map((e: any) => e.type)).toEqual([
      "block_end",
      "finish",
    ]);
  });

  it("空批次零行为（普通加载/无活跃流路径）", () => {
    expect(applyInFlightChunks(store, "s1", [], 10)).toBe(0);
    expect(store.state.eventLog).toHaveLength(0);
  });

  it("无游标的帧 fail-open 应用（不因过滤丢事件）", () => {
    const applied = applyInFlightChunks(
      store,
      "s1",
      [chunk("block_end"), chunk("finish")],
      Number.NaN,
    );
    expect(applied).toBe(2);
  });
});

describe("replayStreamTailAfterReload", () => {
  it("与 applyInFlightChunks 同口径（邮箱尾部重放 = stash 消费语义）", () => {
    const store = createStore();
    const applied = replayStreamTailAfterReload(
      store,
      "s1",
      [chunk("block_start", { logSeq: 3 }), chunk("finish", { logSeq: 4 })],
      4,
    );
    expect(applied).toBe(1);
    expect(store.state.eventLog.map((e: any) => e.type)).toEqual(["finish"]);
  });
});
