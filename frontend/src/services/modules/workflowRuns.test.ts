/**
 * Workflow 运行进度 reducer 测试（数据层：store 与审阅面板共用）
 *
 * 覆盖：live workflow_event 与 REST 快照基线喂同一 reducer，按 run 内 seq 幂等去重；
 * run-start 关联键（toolCallId）落进状态；agent-end 先于 agent-start 的防御建条目；
 * 多 run 并存；run-log 封顶。
 */
import { describe, it, expect } from "vitest";
import {
  applyWorkflowEvent,
  sortWorkflowRuns,
  WORKFLOW_LOG_CAP,
} from "./workflowRuns";
import type { WorkflowEventData, WorkflowRunState } from "@/types/stream/workflow.types";

const wfEvent = (
  runId: string,
  seq: number,
  kind: string,
  payload: any,
): WorkflowEventData => ({
  runId,
  seq,
  kind,
  time: 1700000000000 + seq,
  payload,
} as WorkflowEventData);

describe("WorkflowRunState reducer（数据层）", () => {
  it("live workflow_event 序列累积出完整 run 状态", () => {
    const runs: WorkflowRunState[] = [];
    applyWorkflowEvent(runs, wfEvent("wfr_1", 1, "run-start", { name: "审查", phases: [{ title: "P1" }], toolCallId: "tc_1" }));
    applyWorkflowEvent(runs, wfEvent("wfr_1", 2, "agent-start", { callId: "a1", label: "分析", phase: "P1", subSessionId: "sub_1" }));
    applyWorkflowEvent(runs, wfEvent("wfr_1", 3, "agent-end", { callId: "a1", label: "分析", phase: "P1", status: "completed", outputSummary: "完成" }));
    applyWorkflowEvent(runs, wfEvent("wfr_1", 4, "run-end", { runStatus: "completed", agentCount: 1, durationMs: 5000 }));

    expect(runs).toHaveLength(1);
    const wf = runs[0]!;
    expect(wf.name).toBe("审查");
    expect(wf.phases).toEqual([{ title: "P1" }]);
    expect(wf.status).toBe("completed");
    // 关联键：内联卡片据此把 run 绑回对话流里的那次工具调用
    expect(wf.toolCallId).toBe("tc_1");
    expect(wf.agents).toHaveLength(1);
    expect(wf.agents[0]).toMatchObject({
      callId: "a1",
      label: "分析",
      phase: "P1",
      subSessionId: "sub_1",
      status: "completed",
      outputSummary: "完成",
    });
    expect(wf.durationMs).toBe(5000);
    expect(wf.endedAt).toBe(1700000000000 + 4);
  });

  it("旧归档（无 toolCallId）不产生关联键，也不被后续事件伪造", () => {
    const runs: WorkflowRunState[] = [];
    applyWorkflowEvent(runs, wfEvent("wfr_old", 1, "run-start", { name: "老 run" }));
    applyWorkflowEvent(runs, wfEvent("wfr_old", 2, "run-end", { runStatus: "completed", agentCount: 0 }));
    expect(runs[0]!.toolCallId).toBeUndefined();
  });

  it("REST 快照基线 + SSE 重复事件收敛（seq 幂等去重）", () => {
    const runs: WorkflowRunState[] = [
      {
        runId: "wfr_1",
        name: "审查",
        status: "running",
        agents: [],
        logs: [],
        startedAt: 1700000000000,
        lastSeq: 4,
      },
    ];
    // 快照已应用到 seq 4，SSE 重连补发旧事件 → 全部去重忽略
    expect(applyWorkflowEvent(runs, wfEvent("wfr_1", 2, "agent-start", { callId: "a1", label: "分析", phase: null }))).toBe(false);
    expect(applyWorkflowEvent(runs, wfEvent("wfr_1", 4, "run-end", { runStatus: "failed", agentCount: 1 }))).toBe(false);
    expect(runs[0]!.agents).toHaveLength(0);
    expect(runs[0]!.lastSeq).toBe(4);
  });

  it("agent-end 先于 agent-start（spawn 失败路径）→ 防御建条目", () => {
    const runs: WorkflowRunState[] = [];
    applyWorkflowEvent(runs, wfEvent("wfr_2", 1, "run-start", { name: "n" }));
    applyWorkflowEvent(runs, wfEvent("wfr_2", 2, "agent-end", { callId: "aX", label: "坏代理", phase: null, status: "failed" }));

    expect(runs[0]!.agents).toHaveLength(1);
    expect(runs[0]!.agents[0]).toMatchObject({ callId: "aX", label: "坏代理", status: "failed" });
  });

  it("多 run 并存：不同 runId 各自独立状态；run-log 累积且封顶", () => {
    const runs: WorkflowRunState[] = [];
    applyWorkflowEvent(runs, wfEvent("wfr_A", 1, "run-start", { name: "A" }));
    applyWorkflowEvent(runs, wfEvent("wfr_B", 1, "run-start", { name: "B" }));
    for (let i = 2; i <= WORKFLOW_LOG_CAP + 10; i++) {
      applyWorkflowEvent(runs, wfEvent("wfr_A", i, "run-log", { message: `log ${i}` }));
    }
    expect(runs).toHaveLength(2);
    const wfA = runs.find((r) => r.runId === "wfr_A")!;
    expect(wfA.logs.length).toBeLessThanOrEqual(WORKFLOW_LOG_CAP);
    expect(wfA.logs[wfA.logs.length - 1]).toBe(`log ${WORKFLOW_LOG_CAP + 10}`);
  });

  it("sortWorkflowRuns：运行中在前，完成后按结束时间倒序", () => {
    const runs: WorkflowRunState[] = [
      { runId: "f1", name: "", status: "failed", agents: [], logs: [], startedAt: 1, lastSeq: 0, endedAt: 100 },
      { runId: "live", name: "", status: "running", agents: [], logs: [], startedAt: 3, lastSeq: 0 },
      { runId: "f2", name: "", status: "completed", agents: [], logs: [], startedAt: 2, lastSeq: 0, endedAt: 200 },
    ];
    const sorted = sortWorkflowRuns(runs);
    expect(sorted.map((r) => r.runId)).toEqual(["live", "f2", "f1"]);
  });
});
