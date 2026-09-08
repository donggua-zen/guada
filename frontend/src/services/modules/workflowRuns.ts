/**
 * Workflow 运行进度 reducer（纯函数，独立于会话流投影）
 *
 * 数据双源：REST 快照（GET sessions/:id/workflow/runs，基线）+ workflow_event SSE（实时增量），
 * 两源喂同一 applyWorkflowEvent，按 run 内 seq 幂等去重收敛到同一 WorkflowRunState。
 * 进度不落 JSONL（方案 B）：刷新后由快照恢复基线，运行中事件由 SSE 实时推进。
 */
import type {
  WorkflowEventData,
  WorkflowRunState,
} from "@/types/stream/workflow.types";

/** 单 run 保留的最大 log 条数（防失控脚本刷屏，与引擎快照一致） */
export const WORKFLOW_LOG_CAP = 50;

export function createWorkflowRunState(runId: string): WorkflowRunState {
  return {
    runId,
    name: "",
    status: "running",
    agents: [],
    logs: [],
    startedAt: Date.now(),
    lastSeq: 0,
  };
}

/**
 * 在 runs 数组中原位应用一条进度事件（找不到 run 则新建条目）。
 * @returns 是否实际应用（seq 幂等去重：重复/回退事件忽略）
 */
export function applyWorkflowEvent(
  runs: WorkflowRunState[],
  data: WorkflowEventData,
): boolean {
  if (!data || typeof data.runId !== "string" || typeof data.seq !== "number") {
    return false;
  }
  let state = runs.find((r) => r.runId === data.runId);
  if (!state) {
    state = createWorkflowRunState(data.runId);
    runs.push(state);
  }
  if (data.seq <= state.lastSeq) return false;
  state.lastSeq = data.seq;

  switch (data.kind) {
    case "run-start": {
      const p = data.payload as Extract<WorkflowEventData["payload"], { name: string }>;
      state.name = p.name;
      if (p.description) state.description = p.description;
      if (p.phases) state.phases = p.phases;
      state.status = "running";
      state.startedAt = data.time;
      break;
    }
    case "run-phase":
      // 阶段纯展示：成员按自身 phase 字段分组，无需存储
      break;
    case "run-log": {
      const p = data.payload as Extract<WorkflowEventData["payload"], { message: string }>;
      state.logs.push(p.message);
      if (state.logs.length > WORKFLOW_LOG_CAP) state.logs.shift();
      break;
    }
    case "agent-start": {
      const p = data.payload as Extract<WorkflowEventData["payload"], { callId: string }>;
      const existing = state.agents.find((a) => a.callId === p.callId);
      if (existing) {
        existing.status = "running";
        if (p.subSessionId) existing.subSessionId = p.subSessionId;
      } else {
        state.agents.push({
          callId: p.callId,
          label: p.label,
          phase: p.phase,
          ...(p.subSessionId ? { subSessionId: p.subSessionId } : {}),
          status: "running",
        });
      }
      break;
    }
    case "agent-end": {
      const p = data.payload as Extract<WorkflowEventData["payload"], { callId: string }>;
      const agent = state.agents.find((a) => a.callId === p.callId);
      if (!agent) {
        // end 先于 start 的防御路径：建条目再落终态
        state.agents.push({
          callId: p.callId,
          label: p.label,
          phase: p.phase,
          ...(p.subSessionId ? { subSessionId: p.subSessionId } : {}),
          status: p.status ?? "completed",
          ...(p.outputSummary ? { outputSummary: p.outputSummary } : {}),
        });
      } else {
        agent.status = p.status ?? "completed";
        if (p.outputSummary !== undefined) agent.outputSummary = p.outputSummary;
        if (p.subSessionId && !agent.subSessionId) agent.subSessionId = p.subSessionId;
      }
      break;
    }
    case "run-end": {
      const p = data.payload as Extract<WorkflowEventData["payload"], { runStatus: string }>;
      state.status = p.runStatus as WorkflowRunState["status"];
      if (p.errorCode) state.errorCode = p.errorCode;
      if (p.errorMessage) state.errorMessage = p.errorMessage;
      if (p.durationMs !== undefined) state.durationMs = p.durationMs;
      state.endedAt = data.time;
      break;
    }
  }
  return true;
}

/** 概览排序：运行中在前（按启动时间升序），完成后按结束时间倒序 */
export function sortWorkflowRuns(runs: WorkflowRunState[]): WorkflowRunState[] {
  return [...runs].sort((a, b) => {
    const aRunning = a.status === "running" ? 0 : 1;
    const bRunning = b.status === "running" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    if (aRunning === 0) return a.startedAt - b.startedAt;
    return (b.endedAt ?? 0) - (a.endedAt ?? 0);
  });
}
