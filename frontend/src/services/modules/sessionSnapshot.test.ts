import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/services/ApiService", () => ({ apiService: {} }));

import { applySessionSnapshot, type SessionSnapshotPayload } from "./sessionSnapshot";
import type { ProjectorSessionState } from "./streamProjector";
import type { Turn } from "@/types/message";

/**
 * 带内历史快照的客户端应用：
 * - 事件页替换 eventLog → fold 重建
 * - 快照 tail 过滤后重放（页内已含的 logSeq 跳过）
 * - 分页游标 / loaded / appliedSeq（可降）一次写入
 */
function createStore() {
  const state = {
    loaded: false,
    turns: [] as any[],
    eventLog: [] as any[],
    pendingAsks: undefined as ProjectorSessionState["pendingAsks"],
    pageCursor: undefined as number | null | undefined,
    turnsHasMore: undefined as boolean | undefined,
    appliedSeq: undefined as number | undefined,
  };
  const store = {
    state,
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
    upsertSessionPendingAsk: () => {},
    removeSessionPendingAsk: () => {},
    clearSessionPendingAsks: () => {},
    resetAppliedSeq: (_sid: string, seq?: number) => {
      // 复刻真实 store：非法/负值 → 无水位
      state.appliedSeq =
        typeof seq === "number" && Number.isFinite(seq) && seq >= 0 ? seq : undefined;
    },
  };
  return store;
}

const turnStart = (turnId: string, seq: number) =>
  ({ type: "turn/start", seq, data: { turnId } }) as any;
const assistantMessage = (turnId: string, messageId: string, seq: number, text: string) =>
  ({
    type: "assistant/message",
    seq,
    data: { turnId, messageId, content: [{ type: "text", text }], metadata: {} },
  }) as any;

function snapshot(overrides: Partial<SessionSnapshotPayload> = {}): SessionSnapshotPayload {
  return {
    requestId: "req-1",
    sessionId: "s1",
    events: [turnStart("t1", 1), assistantMessage("t1", "m1", 2, "落盘内容")],
    endSeq: 2,
    nextBeforeSeq: 0,
    hasMore: true,
    tail: [],
    bootId: "boot-1",
    ...overrides,
  };
}

describe("applySessionSnapshot", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    // 模拟"重拉前已有旧树/旧水位"（旧内容必须被快照替换）
    store.state.turns = [{ id: "old", messages: [], state: { isWorking: false } } as any];
    store.state.eventLog = [{ type: "turn/start", seq: 99 } as any];
    store.state.appliedSeq = 99;
  });

  it("替换事件数组、fold 重建、写入分页/水位", () => {
    const { appliedTail } = applySessionSnapshot(store as any, "s1", snapshot());

    expect(appliedTail).toBe(0);
    expect(store.state.turns.map((t) => t.id)).toEqual(["t1"]);
    expect(store.state.turns[0].messages[0].blocks[0].content).toBe("落盘内容");
    expect(store.state.eventLog.map((e: any) => e.seq)).toEqual([1, 2]);
    expect(store.state.pageCursor).toBe(0);
    expect(store.state.turnsHasMore).toBe(true);
    expect(store.state.loaded).toBe(true);
    // 水位可降：旧水位 99 → 快照页尾 2
    expect(store.state.appliedSeq).toBe(2);
  });

  it("尾部按 logSeq 过滤后重放（页内已含的跳过，页尾之后的保留）", () => {
    const { appliedTail } = applySessionSnapshot(
      store as any,
      "s1",
      snapshot({
        tail: [
          {
            type: "text_delta",
            sessionId: "s1",
            messageId: "m1",
            turnId: "t1",
            index: 0,
            logSeq: 1,
            text: "covered",
          },
          {
            type: "text_delta",
            sessionId: "s1",
            messageId: "m1",
            turnId: "t1",
            index: 0,
            logSeq: 2,
            text: "in-flight",
          },
        ] as any,
      }),
    );

    expect(appliedTail).toBe(1);
    const bundle = store.state.turns[0].messages.find((m: any) => m.messageId === "m1");
    expect(bundle.blocks[0].content).toBe("落盘内容in-flight");
  });

  it("空快照也把水位复位（清空记录后的新代次）", () => {
    applySessionSnapshot(
      store as any,
      "s1",
      snapshot({
        events: [],
        endSeq: -1,
        nextBeforeSeq: null,
        hasMore: false,
        tail: [],
      }),
    );

    expect(store.state.pageCursor).toBeNull();
    expect(store.state.turnsHasMore).toBe(false);
    // resetAppliedSeq(-1) → 语义为"无水位"
    expect(store.state.appliedSeq).toBeUndefined();
  });
});
