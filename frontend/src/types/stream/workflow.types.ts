/**
 * Workflow 编排进度类型（前端本地镜像，与后端
 * backend-ts/src/modules/workflow/workflow.types.ts 逐字段同构）
 */

export interface WorkflowPhaseMeta {
  title: string;
  detail?: string;
}

export type WorkflowMemberStatus = "running" | "completed" | "failed" | "cancelled";

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

export type WorkflowEventKind =
  | "run-start"
  | "run-phase"
  | "run-log"
  | "agent-start"
  | "agent-end"
  | "run-end";

export interface WorkflowAgentState {
  callId: string;
  label: string;
  phase: string | null;
  /** 子代理会话 id（运行中点击可跳转会话） */
  subSessionId?: string;
  status: WorkflowMemberStatus;
  outputSummary?: string;
}

/** 单条 workflow 进度事件载荷（live 流事件与 JSONL 领域事件共用） */
export interface WorkflowEventData {
  runId: string;
  /** run 内单调序号（重放去重/排序键） */
  seq: number;
  kind: WorkflowEventKind;
  time: number;
  payload:
    | { name: string; description?: string; phases?: WorkflowPhaseMeta[] }
    | { title: string }
    | { message: string }
    | {
        callId: string;
        label: string;
        phase: string | null;
        subSessionId?: string;
        status?: WorkflowMemberStatus;
        outputSummary?: string;
      }
    | {
        runStatus: WorkflowRunStatus;
        agentCount: number;
        errorCode?: string;
        errorMessage?: string;
        durationMs?: number;
      };
}

/** 卡片消费的运行状态（由 reducer 从事件流累积，live 与回放收敛同一形态） */
export interface WorkflowRunState {
  runId: string;
  name: string;
  description?: string;
  phases?: WorkflowPhaseMeta[];
  status: WorkflowRunStatus;
  /** 按启动顺序排列的成员 */
  agents: WorkflowAgentState[];
  logs: string[];
  startedAt: number;
  endedAt?: number;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  /** 脚本返回值（仅 completed；终态快照归档携带，历史审阅用） */
  result?: unknown;
  /** 已应用的最高事件 seq（幂等去重：重放 + 实时双源不重复应用） */
  lastSeq: number;
}
