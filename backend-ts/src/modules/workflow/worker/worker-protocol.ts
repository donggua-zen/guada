/**
 * Host ↔ Worker 消息协议（worker_threads postMessage）
 *
 * 类型化封闭双向 union（对齐 DSH worker protocol 的精简版）：
 * - 每次 workflow run 新建一个 Worker（workerData 携带 script/args），
 *   Worker ready 后等待宿主 'go' 才执行——取消可以竞速到启动之前
 * - 所有跨线程消息经 structured clone：函数/循环引用/BigInt 等直接抛
 *   DataCloneError，即 DSH realm 物化（materializeFromRealm）的等价物
 */

import type { AgentCallOptions, WorkflowErrorCode } from "../workflow.types";

// ─── Worker → Host ───

export interface WorkerReadyMsg {
  type: "ready";
}

export interface WorkerPhaseMsg {
  type: "phase";
  title: string;
}

export interface WorkerLogMsg {
  type: "log";
  message: string;
}

/** 脚本调 agent()：宿主负责并发槽排队 + spawnForWorkflow */
export interface WorkerAgentCallMsg {
  type: "agent-call";
  callId: string;
  prompt: string;
  opts: AgentCallOptions;
}

/** 脚本 return（value 已是 structured clone 兼容的纯 JSON） */
export interface WorkerResultMsg {
  type: "result";
  value: unknown;
}

/** 脚本致命错误（语法/参数/取消/RESULT_UNSERIALIZABLE 等） */
export interface WorkerErrorMsg {
  type: "error";
  code: WorkflowErrorCode;
  message: string;
}

export type WorkerToHost =
  | WorkerReadyMsg
  | WorkerPhaseMsg
  | WorkerLogMsg
  | WorkerAgentCallMsg
  | WorkerResultMsg
  | WorkerErrorMsg;

// ─── Host → Worker ───

/** 启动门：收到才执行脚本 */
export interface HostGoMsg {
  type: "go";
}

export interface HostCancelMsg {
  type: "cancel";
  reason?: string;
}

/** agent 正常结算（含失败：stopReason 表达，子代理自身失败不 reject） */
export interface HostAgentSettledMsg {
  type: "agent-settled";
  callId: string;
  output: string;
  stopReason: string;
}

/** 宿主无法启动该子代理（基建故障/超上限）——worker 侧视为 fatal AGENT_START/AGENT_CAP */
export interface HostAgentFailedMsg {
  type: "agent-failed";
  callId: string;
  code: Extract<WorkflowErrorCode, "AGENT_START" | "AGENT_CAP">;
  message: string;
}

export type HostToWorker = HostGoMsg | HostCancelMsg | HostAgentSettledMsg | HostAgentFailedMsg;

/** workerData（Worker 构造入参） */
export interface WorkflowWorkerData {
  script: string;
  args: unknown;
}
