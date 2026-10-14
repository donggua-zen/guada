/**
 * Workflow 子代理编排 — 类型定义
 *
 * 对齐 DSH（deepseek-harness）workflow seam：
 * - WorkflowMeta 是纯 JSON 数据（绝不求值），随 workflow_run 工具调用传入
 * - 脚本是模型现场生成的 JS 函数体（顶层 await + return <JSON>），由引擎在
 *   worker thread + vm 沙箱中执行，经 agent()/parallel()/phase()/log()
 *   钩子编排子代理（对齐 DSH dynamic workflows）
 * - WorkflowEventData 是进度事件的统一载荷：经 workflow_event SSE 实时广播，
 *   引擎同步折叠进内存快照（WorkflowRunSnapshot）——进度不落 JSONL，
 *   前端以 REST 快照为基线、SSE 为增量（方案 B）
 */

// ─── Workflow 元信息（纯 JSON，永不求值）───

/** 声明的阶段（纯观察用途，不施加任何执行结构——对齐 DSH meta.phases 语义） */
export interface WorkflowPhaseMeta {
  title: string;
  detail?: string;
}

export interface WorkflowMeta {
  name: string;
  description?: string;
  phases?: WorkflowPhaseMeta[];
}

/** 脚本内 agent(prompt, opts) 的选项（对齐 DSH AgentCallOptions 的进程内子集） */
export interface AgentCallOptions {
  /** 子代理智能体 id（generic 或白名单智能体；缺省 generic） */
  agentId?: string;
  /** 展示用短标签（前端 member 行名称；缺省用 prompt 截断） */
  label?: string;
  /** 归属阶段标题（前端 phase 分组；未声明的 phase 前端动态成组） */
  phase?: string;
}

// ─── 进度事件 ───

export type WorkflowEventKind =
  | "run-start"
  | "run-phase"
  | "run-log"
  | "agent-start"
  | "agent-end"
  | "run-end";

/** agent / run 的可见状态（agent-end 的 status 派生自 SubAgentStopReason） */
export type WorkflowMemberStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";

/** run-start 载荷 */
export interface WorkflowRunStartPayload {
  name: string;
  description?: string;
  phases?: WorkflowPhaseMeta[];
  /**
   * 触发本次运行的 workflow_run 工具调用 id（关联键，对齐 subagent_link 范式）。
   *
   * 让前端把跑起来的 run 绑回对话流里那次工具调用（工具调用处原地渲染）；
   * run-start 是首条事件即最早绑定点，快照同字段保证刷新后仍可绑定。
   */
  toolCallId?: string;
}

/** agent-start / agent-end 载荷（start 与 end 复用同一结构，按存在性区分） */
export interface WorkflowAgentPayload {
  callId: string;
  label: string;
  phase: string | null;
  /** agent-start 后（会话创建成功）填充；前端点击跳转子会话的锚点 */
  subSessionId?: string;
  /** 仅 agent-end */
  status?: WorkflowMemberStatus;
  /** 仅 agent-end：截断的最终输出摘要（≤200 字符） */
  outputSummary?: string;
}

/** run-end 载荷 */
export interface WorkflowRunEndPayload {
  runStatus: WorkflowRunStatus;
  /** 实际启动过的子代理总数 */
  agentCount: number;
  errorCode?: string;
  errorMessage?: string;
  /** 整个 run 耗时 ms */
  durationMs?: number;
}

/** 单条 workflow 进度事件的统一载荷 */
export interface WorkflowEventData {
  /** 运行 id（同一次 workflow_run 工具调用内稳定） */
  runId: string;
  /** run 内单调序号（前端确定性重放的排序/去重键） */
  seq: number;
  kind: WorkflowEventKind;
  time: number;
  payload:
    | WorkflowRunStartPayload
    | { title: string }
    | { message: string }
    | WorkflowAgentPayload
    | WorkflowRunEndPayload;
}

// ─── 致命错误码（machine-routable，对齐 DSH WorkflowErrorCode）───

export type WorkflowErrorCode =
  | "SCRIPT_PARSE"
  | "SCRIPT_ERROR"
  | "META_INVALID"
  | "INVALID_ARGUMENT"
  | "AGENT_CAP"
  | "ITEM_CAP"
  | "AGENT_START"
  | "AGENT_RESULT"
  | "RESULT_UNSERIALIZABLE"
  | "CANCELLED"
  | "WORKER_CRASHED";

/**
 * Workflow 致命错误（fatal）：
 * parallel()/pipeline() 对 fatal 错误重抛杀死整个脚本；
 * 脚本代码不可伪造 fatal（code + fatal 由宿主/协议层赋予）。
 */
export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly fatal = true as const;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

// ─── 运行结果 ───

export interface WorkflowRunResult {
  /** runId */
  runId: string;
  status: WorkflowRunStatus;
  /** 脚本 return 值（仅 completed；postMessage structured clone 已保证纯 JSON） */
  value?: unknown;
  /** 实际启动过的子代理总数 */
  agentCount: number;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
}

/** 引擎运行参数（settings `workflow` 可覆盖并发上限） */
export interface WorkflowEngineOptions {
  maxConcurrentAgents?: number;
  maxTotalAgents?: number;
}

/** 快照成员行（WorkflowRun 内存折叠态） */
export interface WorkflowAgentSnapshot {
  callId: string;
  label: string;
  phase: string | null;
  /** 子代理会话 id（卡片/审阅面板点击跳转子会话） */
  subSessionId?: string;
  status: WorkflowMemberStatus;
  outputSummary?: string;
}

/**
 * 运行状态快照（引擎内存折叠，不落 JSONL）。
 * 与前端 frontend/src/types/stream/workflow.types.ts 的 WorkflowRunState 逐字段同构：
 * REST 快照（GET sessions/:id/workflow/runs）直接返回本形态，live 增量由
 * workflow_event SSE 喂同一 reducer 收敛。
 */
export interface WorkflowRunSnapshot {
  runId: string;
  /** 触发本次运行的工具调用 id（旧归档无此字段 → 前端卡片只按工具结果出终态，不出进度树） */
  toolCallId?: string;
  name: string;
  description?: string;
  phases?: WorkflowPhaseMeta[];
  status: WorkflowRunStatus;
  /** 按启动顺序排列的成员 */
  agents: WorkflowAgentSnapshot[];
  logs: string[];
  startedAt: number;
  endedAt?: number;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  /** 脚本返回值（仅 completed；历史审阅用，协议保证 JSON 可序列化） */
  result?: unknown;
  /** 已应用的最高事件 seq（幂等去重） */
  lastSeq: number;
}
