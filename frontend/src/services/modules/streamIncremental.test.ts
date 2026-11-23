import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services/ApiService", () => ({ apiService: {} }));

import { clearTokenStats } from "@/composables/useSessionTokenStats";
import {
  applyEventsIncremental,
  applyLiveChunk,
  type ProjectorSessionState,
} from "./streamProjector";
import { catchUpIncrementally, type CatchUpStore, type EventsTailBatch } from "./streamIncremental";
import type { Turn } from "@/types/message";
import type { PendingAsk } from "@/types/session";

/**
 * 增量补拉（断点续传）：
 * - 截断的在飞消息能被落盘的完整 assistant/message 修复（旧实现整条跳过 → 永远补不回）
 * - 重复应用幂等（reasoning 时长不翻倍）
 * - 已收尾回合不被重新标成工作中
 * - 批次从回合中间开始时用未闭合回合播种游标
 * - 水位缺失 / 多未闭合回合 / 缺口超批 / 应用失败 → 回退整页重拉
 */

function createStore() {
  const state = {
    loaded: true,
    turns: [] as any[],
    eventLog: [] as any[],
    pendingAsks: undefined as ProjectorSessionState["pendingAsks"],
    appliedSeq: undefined as number | undefined,
  };
  const refreshPlans = vi.fn((_sessionId: string): void => {});
  const store = {
    state,
    refreshPlans,
    getSessionState: () => state,
    getTurns: () => state.turns,
    setTurns: (_sid: string, t: Turn[]) => {
      state.turns = t;
    },
    deleteTurnById: (_sid: string, id: string) => {
      state.turns = state.turns.filter((t) => t.id !== id);
    },
    setSessionIsCompressing: () => {},
    sessionIsCompressing: () => false,
    sessionIsStreaming: (): boolean => false,
    upsertSessionPendingAsk: (_sid: string, ask: PendingAsk) => {
      state.pendingAsks = { ...(state.pendingAsks ?? {}), [ask.requestId]: ask };
    },
    removeSessionPendingAsk: (_sid: string, requestId: string) => {
      if (!state.pendingAsks) return;
      const next = { ...state.pendingAsks };
      delete next[requestId];
      state.pendingAsks = Object.keys(next).length > 0 ? next : undefined;
    },
    clearSessionPendingAsks: () => {
      state.pendingAsks = undefined;
    },
    getAppliedSeq: (): number | undefined => state.appliedSeq,
    setAppliedSeq: (_sid: string, seq: number): void => {
      if (!Number.isFinite(seq) || seq < 0) return;
      state.appliedSeq = Math.max(state.appliedSeq ?? -1, seq);
    },
  };
  return store satisfies CatchUpStore & { state: typeof state; refreshPlans: typeof refreshPlans };
}

/** 领域事件：turn/start */
function turnStart(turnId: string, seq: number) {
  return { type: "turn/start", seq, data: { turnId } } as any;
}
/** 领域事件：assistant/message（整包块） */
function assistantMessage(
  turnId: string,
  messageId: string,
  seq: number,
  blocks: Array<{ type: string; [k: string]: unknown }>,
  metadata: Record<string, unknown> = {},
) {
  return {
    type: "assistant/message",
    seq,
    data: { turnId, messageId, content: blocks, metadata },
  } as any;
}
/** 领域事件：turn/finish */
function turnFinish(turnId: string, seq: number, finishReason = "stop") {
  return { type: "turn/finish", seq, data: { turnId, finishReason } } as any;
}

function batch(
  events: any[],
  overrides: Partial<EventsTailBatch> = {},
): EventsTailBatch {
  const endSeq = events.length > 0 ? events[events.length - 1].seq : -1;
  return {
    events,
    endSeq,
    tailSeq: endSeq,
    hasMoreAfter: false,
    ...overrides,
  };
}

beforeEach(() => {
  clearTokenStats();
  vi.clearAllMocks();
});

describe("applyEventsIncremental：就地修复现有树", () => {
  it("live 截断的 assistant 消息被落盘完整事件修复（文本补全 + 元数据合并）", () => {
    const store = createStore();

    // live：turn_start + 块开 + 部分文本（模拟后台前已流出的截断内容）
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    applyLiveChunk(store, "s1", {
      type: "block_start",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      blockType: "text",
    } as any);
    applyLiveChunk(store, "s1", {
      type: "text_delta",
      messageId: "m1",
      turnId: "t1",
      index: 0,
      text: "前半",
    } as any);

    const turn = store.state.turns[0];
    const bundle = turn.messages.find((m: any) => m.messageId === "m1");
    expect(bundle.blocks[0].content).toBe("前半");
    expect(bundle.blocks[0].state.isStreaming).toBe(true);

    // 增量：落盘的完整 assistant/message（含全部文本 + usage）
    applyEventsIncremental(store, "s1", [
      assistantMessage("t1", "m1", 2, [{ type: "text", text: "前半后半" }], {
        usage: { totalTokens: 9 },
      }),
    ]);

    const after = store.state.turns[0].messages.find((m: any) => m.messageId === "m1");
    expect(after.blocks[0].content).toBe("前半后半"); // 修复而非跳过
    expect(after.blocks[0].state.isStreaming).toBe(false);
    expect(after.metadata.usage).toEqual({ totalTokens: 9 });
    // 不产生重复 bundle
    expect(
      store.state.turns[0].messages.filter((m: any) => m.messageId === "m1"),
    ).toHaveLength(1);
  });

  it("重复应用同一批幂等：reasoning 时长不翻倍", () => {
    const store = createStore();
    const events = [
      turnStart("t1", 1),
      assistantMessage("t1", "m1", 2, [
        {
          type: "reasoning",
          summary: "想一想",
          timing: { startedAt: 1000, finishedAt: 2500 },
        },
      ]),
    ];

    applyEventsIncremental(store, "s1", events);
    const first = store.state.turns[0].messages[0].blocks[0].thinkingDurationMs;
    expect(first).toBe(1500);

    applyEventsIncremental(store, "s1", events);
    const second = store.state.turns[0].messages[0].blocks[0].thinkingDurationMs;
    expect(second).toBe(1500); // 不是 3000
    expect(store.state.turns[0].messages).toHaveLength(1);
  });

  it("已收尾回合被历史 turn/start 重放时不重新标成工作中", () => {
    const store = createStore();
    applyEventsIncremental(store, "s1", [
      turnStart("t1", 1),
      assistantMessage("t1", "m1", 2, [{ type: "text", text: "ok" }]),
      turnFinish("t1", 3),
    ]);
    expect(store.state.turns[0].state.isWorking).toBe(false);

    // 再应用一次 turn/start（增量批次从回合起点开始）
    applyEventsIncremental(store, "s1", [turnStart("t1", 1)]);
    expect(store.state.turns[0].state.isWorking).toBe(false);
  });

  it("批次从回合中间开始：用 startTurnId 播种游标，assistant 消息不丢", () => {
    const store = createStore();
    // 本地已有未闭合回合（live turn_start 到达过）
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);

    // 批次首事件不是 turn/start（缺口从回合中间开始）
    applyEventsIncremental(
      store,
      "s1",
      [assistantMessage("t1", "m1", 5, [{ type: "text", text: "补回" }])],
      { startTurnId: "t1" },
    );

    const turn = store.state.turns[0];
    expect(turn.messages.map((m: any) => m.messageId)).toEqual(["m1"]);
    expect(turn.messages[0].blocks[0].content).toBe("补回");
  });

  it("走 replay 模式：不刷计划缓存、不清待答卡", () => {
    const store = createStore();
    store.state.pendingAsks = {
      r1: { requestId: "r1", kind: "approval", questions: [] } as PendingAsk,
    };

    applyEventsIncremental(store, "s1", [
      turnStart("t1", 1),
      turnFinish("t1", 2),
    ]);

    expect(store.refreshPlans).not.toHaveBeenCalled();
    expect(store.state.pendingAsks).toBeDefined();
  });

  it("增量批记入 eventLog（load-more re-fold 不丢），且按 seq 去重", () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    const events = [
      turnStart("t1", 1),
      assistantMessage("t1", "m1", 2, [{ type: "text", text: "x" }]),
    ];

    applyEventsIncremental(store, "s1", events);
    const seqsAfterFirst = store.state.eventLog
      .map((e: any) => e.seq)
      .filter((s: any) => typeof s === "number");
    expect(seqsAfterFirst).toEqual([1, 2]);

    // 重复应用同一批：不重复记账
    applyEventsIncremental(store, "s1", events);
    const seqsAfterSecond = store.state.eventLog
      .map((e: any) => e.seq)
      .filter((s: any) => typeof s === "number");
    expect(seqsAfterSecond).toEqual([1, 2]);
  });
});

describe("catchUpIncrementally：增量优先 / 回退判定", () => {
  it("成功应用：事件并入树、水位推进到 tailSeq", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 4;

    const fetchTail = vi.fn(async () =>
      batch(
        [
          assistantMessage("t1", "m1", 5, [{ type: "text", text: "补齐" }]),
          turnFinish("t1", 6),
        ],
        { tailSeq: 6 },
      ),
    );

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("applied");
    expect(res.events).toHaveLength(2);
    expect(fetchTail).toHaveBeenCalledWith({ afterSeq: 4, limit: 500 });
    expect(store.state.turns[0].messages[0].blocks[0].content).toBe("补齐");
    expect(store.state.turns[0].state.isWorking).toBe(false);
    expect(store.state.appliedSeq).toBe(6);
  });

  it("已追平（空批且 tailSeq === 水位）：applied，不重复请求", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 10;
    const fetchTail = vi.fn(async () => batch([], { endSeq: 10, tailSeq: 10 }));

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("applied");
    expect(res.events).toEqual([]);
    expect(fetchTail).toHaveBeenCalledTimes(1);
    expect(store.state.appliedSeq).toBe(10);
  });

  it("空批但日志尾超前（读后并发追加）→ 重试一次拿到事件", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 10;

    const fetchTail = vi
      .fn()
      .mockResolvedValueOnce(batch([], { endSeq: 10, tailSeq: 12 }))
      .mockResolvedValueOnce(
        batch([assistantMessage("t1", "m1", 11, [{ type: "text", text: "追平" }])], {
          endSeq: 12,
          tailSeq: 12,
        }),
      );

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("applied");
    expect(res.events).toHaveLength(1);
    expect(fetchTail).toHaveBeenCalledTimes(2);
    expect(store.state.appliedSeq).toBe(12);
  });

  it("连续空批但日志尾超前 → read-gap（不把未返回的事件记成已应用）", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 10;
    const fetchTail = vi.fn(async () => batch([], { endSeq: 10, tailSeq: 12 }));

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("read-gap");
    expect(fetchTail).toHaveBeenCalledTimes(2);
    expect(store.state.appliedSeq).toBe(10);
  });

  it("日志回绕（空批 tailSeq 小于水位）→ log-rewound，水位不动", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 57;
    const fetchTail = vi.fn(async () => batch([], { endSeq: 57, tailSeq: 3 }));

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("log-rewound");
    expect(store.state.appliedSeq).toBe(57);
  });

  it("批尾越过日志尾（旧代次索引/并发截断）→ log-rewound", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 20;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 21, [{ type: "text", text: "x" }])], {
          endSeq: 21,
          tailSeq: 20,
        }),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("log-rewound");
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("接缝不连续（批首跳过水位后的 seq）→ seq-gap，不应用", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 4;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 6, [{ type: "text", text: "x" }])], {
          tailSeq: 6,
        }),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("seq-gap");
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("批内 seq 跳号 → seq-gap-in-batch，不应用", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 4;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch(
          [
            assistantMessage("t1", "m1", 5, [{ type: "text", text: "a" }]),
            assistantMessage("t1", "m2", 7, [{ type: "text", text: "b" }]),
          ],
          { tailSeq: 7 },
        ),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("seq-gap-in-batch");
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("事件缺 seq → bad-response", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 4;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([{ type: "turn/finish", data: { turnId: "t1" } } as any], {
          endSeq: 5,
          tailSeq: 5,
        }),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("bad-response");
  });

  it("水位缺失 → 回退整页重拉", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    const fetchTail = vi.fn();

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("no-watermark");
    expect(fetchTail).not.toHaveBeenCalled();
  });

  it("补发缺口（拉取前已知）→ 回退整页重拉，不发请求", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 3;
    const fetchTail = vi.fn();

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail,
      hasStreamGap: () => true,
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("stream-gap");
    expect(fetchTail).not.toHaveBeenCalled();
  });

  it("补发缺口在拉取期间才立起（onopen 先于 connected）→ 仍回退，不应用", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 3;

    let gap = false;
    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () => {
        gap = true; // 模拟补发首帧在 fetch 在飞时到达
        return batch([assistantMessage("t1", "m1", 4, [{ type: "text", text: "x" }])]);
      },
      hasStreamGap: () => gap,
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("stream-gap");
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("多个未闭合回合 → 回退整页重拉（状态可疑）", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t2" } as any);
    store.state.appliedSeq = 3;
    const fetchTail = vi.fn();

    const res = await catchUpIncrementally({ store, sessionId: "s1", fetchTail });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("multiple-open-turns");
    expect(fetchTail).not.toHaveBeenCalled();
  });

  it("批次不从 turn/start 开始且无未闭合回合 → 回退（否则会静默丢消息）", async () => {
    const store = createStore();
    // 本地只有一个已收尾回合（没有未闭合回合可播种）
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    applyLiveChunk(store, "s1", { type: "turn_end", turnId: "t1" } as any);
    store.state.appliedSeq = 3;
    expect(store.state.turns[0].state?.isWorking).toBe(false);

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 4, [{ type: "text", text: "x" }])]),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("cant-seed-turn-cursor");
    // 未静默应用
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("批次从回合中间开始且有唯一未闭合回合 → 正常应用", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 3;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 4, [{ type: "text", text: "续" }])]),
    });

    expect(res.status).toBe("applied");
    expect(store.state.turns[0].messages[0].blocks[0].content).toBe("续");
  });

  it("缺口超过单批（hasMoreAfter）→ 回退整页重拉", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 1;

    const res = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 2, [{ type: "text", text: "x" }])], {
          hasMoreAfter: true,
        }),
    });

    expect(res.status).toBe("needs-full-reload");
    expect(res.reason).toBe("gap-too-large");
    // 未应用：树里没有该消息
    expect(store.state.turns[0].messages).toHaveLength(0);
  });

  it("拉取失败 / 坏响应 → 回退整页重拉", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 1;

    const failed = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () => {
        throw new Error("network");
      },
    });
    expect(failed.status).toBe("needs-full-reload");
    expect(failed.reason).toBe("fetch-failed");

    const bad = await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () => ({ endSeq: 1, tailSeq: 1, hasMoreAfter: false } as any),
    });
    expect(bad.status).toBe("needs-full-reload");
    expect(bad.reason).toBe("bad-response");
  });

  it("批后并发写入（tailSeq 超前）→ 水位只推进到 endSeq，剩余留给下次", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 20;

    // hasMoreAfter=false（本批没有因 limit 截断），但批后又有新事件落盘 → tailSeq 超前
    await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 21, [{ type: "text", text: "x" }])], {
          endSeq: 21,
          tailSeq: 25,
        }),
    });

    expect(store.state.appliedSeq).toBe(21);

    // 水位单调：更小的值不会回退
    store.setAppliedSeq("s1", 10);
    expect(store.state.appliedSeq).toBe(21);
  });

  it("已追平（endSeq === tailSeq）→ 水位推进到 tailSeq", async () => {
    const store = createStore();
    applyLiveChunk(store, "s1", { type: "turn_start", turnId: "t1" } as any);
    store.state.appliedSeq = 20;

    await catchUpIncrementally({
      store,
      sessionId: "s1",
      fetchTail: async () =>
        batch([assistantMessage("t1", "m1", 21, [{ type: "text", text: "x" }])], {
          endSeq: 21,
          tailSeq: 21,
        }),
    });

    expect(store.state.appliedSeq).toBe(21);
  });
});
