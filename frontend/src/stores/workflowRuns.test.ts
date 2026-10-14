/**
 * WorkflowRunsStore 测试（会话级 run 缓存 + 单一订阅）
 *
 * 覆盖：REST 基线幂等加载；SSE 增量应用（含未加载会话）；基线按 lastSeq 防回退合并；
 * toolCallId 索引与 clearSession；run-end 后去抖补拉（result 只在快照里）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// 只桩掉后端调用与事件总线：ApiService 真实模块加载期会读 localStorage（node 测试环境没有）
const apiMocks = vi.hoisted(() => ({
  getWorkflowRuns: vi.fn(),
}));
vi.mock("@/services/ApiService", () => ({ apiService: apiMocks }));

const hubMocks = vi.hoisted(() => ({
  subscribeAll: vi.fn(),
  emit: null as null | ((chunk: Record<string, unknown>) => void),
  unsubscribe: vi.fn(),
}));
vi.mock("@/services/modules/StreamEventHub", () => ({
  streamEventHub: {
    subscribeAll: hubMocks.subscribeAll,
  },
}));

import { useWorkflowRunsStore } from "./workflowRuns";
import type { WorkflowEventData, WorkflowRunState } from "@/types/stream/workflow.types";

const wfEvent = (runId: string, seq: number, kind: string, payload: unknown): WorkflowEventData =>
  ({ runId, seq, kind, time: 1700000000000 + seq, payload } as WorkflowEventData);

const snapshot = (over: Partial<WorkflowRunState> = {}): WorkflowRunState => ({
  runId: "wfr_1",
  name: "审查",
  status: "running",
  agents: [],
  logs: [],
  startedAt: 1700000000000,
  lastSeq: 2,
  ...over,
});

describe("workflowRunsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMocks.getWorkflowRuns.mockReset();
    hubMocks.subscribeAll.mockReset();
    hubMocks.unsubscribe.mockReset();
    hubMocks.emit = null;
    hubMocks.subscribeAll.mockImplementation((cb: (chunk: Record<string, unknown>) => void) => {
      hubMocks.emit = cb;
      return hubMocks.unsubscribe;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ensureLoaded 幂等：并发/重复调用只发一次基线请求，且只订阅一次事件", async () => {
    apiMocks.getWorkflowRuns.mockResolvedValue({ runs: [snapshot()] });
    const store = useWorkflowRunsStore();

    await Promise.all([store.ensureLoaded("s1"), store.ensureLoaded("s1")]);
    await store.ensureLoaded("s1");

    expect(apiMocks.getWorkflowRuns).toHaveBeenCalledTimes(1);
    expect(hubMocks.subscribeAll).toHaveBeenCalledTimes(1);
    expect(store.isLoaded("s1")).toBe(true);
    expect(store.getSessionRuns("s1").map((r) => r.runId)).toEqual(["wfr_1"]);
  });

  it("基线失败也标记已加载（避免加载态永久停留），并把未命中判给历史回退路径", async () => {
    apiMocks.getWorkflowRuns.mockRejectedValue(new Error("404"));
    const store = useWorkflowRunsStore();

    await store.ensureLoaded("s1");

    expect(store.isLoaded("s1")).toBe(true);
    expect(store.getSessionRuns("s1")).toEqual([]);
    expect(store.findRunByToolCallId("tc_1")).toBeNull();
  });

  it("SSE 增量按 seq 应用；未加载会话的事件也收（基线落地时按 lastSeq 修正）", async () => {
    apiMocks.getWorkflowRuns.mockResolvedValue({ runs: [] });
    const store = useWorkflowRunsStore();
    await store.ensureLoaded("s1");

    expect(hubMocks.emit).toBeTypeOf("function");
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s1",
      event: wfEvent("wfr_1", 1, "run-start", { name: "审查", toolCallId: "tc_1" }),
    });
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s1",
      event: wfEvent("wfr_1", 2, "agent-start", { callId: "a1", label: "分析", phase: null }),
    });
    // 重复/回退事件被 seq 幂等吞掉
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s1",
      event: wfEvent("wfr_1", 2, "agent-start", { callId: "a1", label: "分析", phase: null }),
    });

    const run = store.findRunByToolCallId("tc_1");
    expect(run?.name).toBe("审查");
    expect(run?.agents).toHaveLength(1);

    // 另一个从未 loading 过的会话：事件照收（卡片/面板随后基线会整体覆盖修正）
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s2",
      event: wfEvent("wfr_2", 3, "run-start", { name: "B" }),
    });
    expect(store.getSessionRuns("s2").map((r) => r.runId)).toEqual(["wfr_2"]);
  });

  it("基线合并按 lastSeq 取高者：事件先到时不回退，快照更新时整体覆盖", async () => {
    apiMocks.getWorkflowRuns.mockResolvedValue({ runs: [snapshot({ lastSeq: 1, name: "旧名" })] });
    const store = useWorkflowRunsStore();
    await store.ensureLoaded("s1");

    // 事件推进到 seq 3（基线只有 seq 1）→ 本地态更新
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s1",
      event: wfEvent("wfr_1", 3, "agent-start", { callId: "a1", label: "分析", phase: null }),
    });
    // 迟到的基线（lastSeq 2 < 3）不得回退已推进的状态
    await store.refresh("s1");
    expect(store.getSessionRuns("s1")[0]!.agents).toHaveLength(1);
    expect(store.getSessionRuns("s1")[0]!.lastSeq).toBe(3);

    // 更完整的基线（lastSeq 9）落地 → 以快照为准
    apiMocks.getWorkflowRuns.mockResolvedValue({
      runs: [snapshot({ lastSeq: 9, status: "completed", durationMs: 1200, toolCallId: "tc_1" })],
    });
    await store.refresh("s1");
    const merged = store.getSessionRuns("s1")[0]!;
    expect(merged.status).toBe("completed");
    expect(merged.durationMs).toBe(1200);
    expect(merged.toolCallId).toBe("tc_1");
    expect(store.findRunByToolCallId("tc_1")?.runId).toBe("wfr_1");
  });

  it("run-end 后去抖补拉基线（result 只在快照里），clearSession 清空缓存", async () => {
    vi.useFakeTimers();
    apiMocks.getWorkflowRuns.mockResolvedValue({ runs: [] });
    const store = useWorkflowRunsStore();
    await store.ensureLoaded("s1");
    expect(apiMocks.getWorkflowRuns).toHaveBeenCalledTimes(1);

    // 第二次基线（补拉）带 result
    apiMocks.getWorkflowRuns.mockResolvedValue({
      runs: [
        snapshot({ lastSeq: 5, status: "completed", toolCallId: "tc_1", result: { ok: true } }),
      ],
    });
    hubMocks.emit!({
      type: "workflow_event",
      sessionId: "s1",
      event: wfEvent("wfr_1", 5, "run-end", { runStatus: "completed", agentCount: 1, durationMs: 900 }),
    });
    expect(apiMocks.getWorkflowRuns).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    expect(apiMocks.getWorkflowRuns).toHaveBeenCalledTimes(2);
    expect(store.getSessionRuns("s1")[0]!.result).toEqual({ ok: true });

    store.clearSession("s1");
    expect(store.isLoaded("s1")).toBe(false);
    expect(store.getSessionRuns("s1")).toEqual([]);
    expect(store.findRunByToolCallId("tc_1")).toBeNull();
  });
});
