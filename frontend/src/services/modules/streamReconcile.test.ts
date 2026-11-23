import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "@/stores/session";
import { SESSION_RESYNC_EVENT, clearSessionHistoryStale } from "@/utils/sessionResync";
import type { Turn } from "@/types/message";
import {
  applySessionSnapshotStreamState,
  reconcileStoppedStream,
} from "./streamReconcile";

/**
 * 流停止统一校准：
 * - 服务端确认已停止 → isStreaming/侧栏 working/streamStatus/回合瞬态/待答卡一次收敛
 * - 历史失效（loaded=false）并派发强制重拉；重复校准不重复派发
 * - 详情快照的 running→stopped 转换（含 RTT 内开新回合的 epoch 守卫）
 */

const resyncs: string[] = [];

function workingTurn(): Turn {
  return {
    id: "t1",
    state: { isWorking: true, isStreaming: true },
    messages: [
      {
        id: "m1",
        state: { isStreaming: true, isThinking: true },
        blocks: [{ state: { isStreaming: true, isThinking: true } }],
      },
    ],
  } as unknown as Turn;
}

beforeEach(() => {
  setActivePinia(createPinia());
  resyncs.length = 0;
  // 模块级 stale 标记跨测试共享：清掉本文件用到的会话，避免"已待重拉"跳过派发
  for (const sid of ["s1", "s2", "s3", "s10", "s11", "s12", "s13", "s14", "s15"]) {
    clearSessionHistoryStale(sid);
  }
  vi.stubGlobal("window", new EventTarget());
  window.addEventListener(SESSION_RESYNC_EVENT, (event) => {
    resyncs.push((event as CustomEvent<{ sessionId: string }>).detail.sessionId);
  });
});

describe("reconcileStoppedStream", () => {
  it("一次性收敛流状态/侧栏/回合瞬态/待答卡，并失效历史触发重拉", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s1", true);
    store.setSidebarFlag("s1", "working", true);
    store.upsertSessionPendingAsk("s1", {
      requestId: "r1",
      kind: "approval",
      questions: [],
    });
    const turn = workingTurn();
    store.setTurns("s1", [turn]);
    store.getSessionState("s1").loaded = true;

    reconcileStoppedStream(store, "s1", null);

    expect(store.sessionIsStreaming("s1")).toBe(false);
    expect(store.getSidebarState("s1").working).toBe(false);
    expect(store.peekStreamStatus("s1")).toBe("completed");
    expect(store.sessionPendingAsk("s1")).toBeUndefined();
    expect(store.getSessionState("s1").loaded).toBe(false);
    expect(turn.state?.isWorking).toBe(false);
    expect(turn.messages[0].state?.isStreaming).toBe(false);
    expect(turn.messages[0].blocks?.[0]?.state?.isStreaming).toBe(false);
    expect(resyncs).toEqual(["s1"]);
  });

  it("closeReason 非 completed → 失败态；重复校准不重复派发重拉", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s2", true);
    store.getSessionState("s2").loaded = true;

    reconcileStoppedStream(store, "s2", "error");
    reconcileStoppedStream(store, "s2", "error");

    expect(store.peekStreamStatus("s2")).toBe("error");
    expect(resyncs).toEqual(["s2"]);
  });

  it("加载成功后清除标记，下一次校准可再次派发", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s3", true);
    store.getSessionState("s3").loaded = true;

    reconcileStoppedStream(store, "s3", null);
    clearSessionHistoryStale("s3");
    reconcileStoppedStream(store, "s3", null);

    expect(resyncs).toEqual(["s3", "s3"]);
  });
});

describe("applySessionSnapshotStreamState", () => {
  it("服务端仍在 running → 直接写 running", () => {
    const store = useSessionStore();
    applySessionSnapshotStreamState(store, { id: "s1", isStreaming: true }, undefined);
    expect(store.sessionIsStreaming("s1")).toBe(true);
    expect(store.peekStreamStatus("s1")).toBe("running");
    expect(resyncs).toEqual([]);
  });

  it("请求发出时本地未在流式 + 服务端已停 → 只写终态，不重拉", () => {
    const store = useSessionStore();
    applySessionSnapshotStreamState(store, { id: "s1", isStreaming: false }, undefined);
    expect(store.sessionIsStreaming("s1")).toBe(false);
    expect(store.peekStreamStatus("s1")).toBe("completed");
    expect(store.getSessionState("s1").loaded).toBeUndefined();
    expect(resyncs).toEqual([]);
  });

  it("RTT 内新开回合（本地此刻 running）→ 不写快照的 false", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s1", true);

    applySessionSnapshotStreamState(store, { id: "s1", isStreaming: false }, undefined);

    expect(store.sessionIsStreaming("s1")).toBe(true);
    expect(resyncs).toEqual([]);
  });

  it("请求发出时 running + 服务端已停 + epoch 未变 → 校准并重拉", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s1", true);
    const epochAtRequest = store.streamEpoch("s1");

    applySessionSnapshotStreamState(
      store,
      { id: "s1", isStreaming: false, closeReason: null },
      epochAtRequest,
    );

    expect(store.sessionIsStreaming("s1")).toBe(false);
    expect(store.peekStreamStatus("s1")).toBe("completed");
    expect(resyncs).toEqual(["s1"]);
  });

  it("请求发出后开了新回合（epoch 变化）→ 快照过期，不覆盖", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s1", true); // epoch 1
    const epochAtRequest = store.streamEpoch("s1");
    store.setSessionIsStreaming("s1", false);
    store.setSessionIsStreaming("s1", true); // epoch 2

    applySessionSnapshotStreamState(
      store,
      { id: "s1", isStreaming: false },
      epochAtRequest,
    );

    expect(store.sessionIsStreaming("s1")).toBe(true);
    expect(resyncs).toEqual([]);
  });

  it("本地 proxy 已由终态帧清掉(isStreaming=false)但服务端确认停止 → 仍须失效历史", () => {
    const store = useSessionStore();
    store.setSessionIsStreaming("s1", true);
    const epochAtRequest = store.streamEpoch("s1");
    store.getSessionState("s1").loaded = true;
    store.setSessionIsStreaming("s1", false); // 终态事件已到(但可能缺尾部帧)

    applySessionSnapshotStreamState(
      store,
      { id: "s1", isStreaming: false },
      epochAtRequest,
    );

    expect(store.getSessionState("s1").loaded).toBe(false);
    expect(resyncs).toEqual(["s1"]);
  });
});
