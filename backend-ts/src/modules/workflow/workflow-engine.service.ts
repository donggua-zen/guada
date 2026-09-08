import { Injectable, Logger, Inject } from "@nestjs/common";
import * as os from "os";
import * as vm from "vm";
import { Worker } from "worker_threads";
import { ISessionContext } from "../chat/session-context";
import { SubAgentManager } from "../sub-agent/sub-agent.manager";
import type { SubAgentResult } from "../sub-agent/sub-agent.manager";
import { safeTruncate } from "../../common/utils/string.utils";
import {
  WorkflowError,
  WorkflowEventData,
  WorkflowEventKind,
  WorkflowMemberStatus,
  WorkflowMeta,
  WorkflowPhaseMeta,
  WorkflowRunResult,
  WorkflowRunSnapshot,
  WorkflowEngineOptions,
} from "./workflow.types";
import {
  HostToWorker,
  WorkflowWorkerData,
  WorkerToHost,
} from "./worker/worker-protocol";
import { WORKER_BOOTSTRAP_SOURCE } from "./worker/worker-bootstrap";

// ─── 默认配置（对齐 DSH 默认策略，规模按个人应用收敛）───

/** 默认并发子代理上限 */
const DEFAULT_MAX_CONCURRENT = Math.min(8, Math.max(2, os.cpus().length - 1));
/** 并发上限钳制范围 */
const MAX_CONCURRENT_CLAMP = 32;
/** 单次 run 累计子代理总量兜底（runaway 循环防线） */
const DEFAULT_MAX_TOTAL_AGENTS = 100;
/** 取消后等待 worker 自行退出的宽限，超时强杀 */
const CANCEL_GRACE_MS = 5000;
/** 工具结果里 return 值的最大序列化长度 */
export const WORKFLOW_RESULT_MAX_CHARS = 30000;
/** 内存快照中单 run 保留的最大 log 条数（防失控脚本刷屏；与前端概览一致） */
const WORKFLOW_LOG_CAP = 50;
/** 每会话内存注册表保留的已完成 run 上限（超出按注册顺序淘汰） */
const MAX_FINISHED_RUNS_PER_SESSION = 20;

// ─── 校验 ───

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** meta 纯 JSON 校验（绝不求值；格式错误立即失败，对齐 DSH validateMeta） */
function validateMeta(meta: unknown): WorkflowMeta {
  if (!isPlainObject(meta)) {
    throw new WorkflowError("META_INVALID", "meta must be a plain JSON object");
  }
  const { name, description, phases } = meta as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") {
    throw new WorkflowError("META_INVALID", "meta.name must be a non-empty string");
  }
  if (description !== undefined && typeof description !== "string") {
    throw new WorkflowError("META_INVALID", "meta.description must be a string");
  }
  const normalizedDescription: string | undefined =
    typeof description === "string" ? description : undefined;
  let normalizedPhases: WorkflowPhaseMeta[] | undefined;
  if (phases !== undefined) {
    if (!Array.isArray(phases)) {
      throw new WorkflowError("META_INVALID", "meta.phases must be an array");
    }
    normalizedPhases = phases.map((p) => {
      if (!isPlainObject(p) || typeof p.title !== "string" || p.title.trim() === "") {
        throw new WorkflowError("META_INVALID", "meta.phases[] requires a non-empty title string");
      }
      return {
        title: p.title,
        ...(p.detail === undefined ? {} : { detail: String(p.detail) }),
      };
    });
  }
  return {
    name,
    ...(normalizedDescription === undefined ? {} : { description: normalizedDescription }),
    ...(normalizedPhases === undefined ? {} : { phases: normalizedPhases }),
  };
}

/** 脚本预解析（与 worker 相同的 wrapper；语法错误立即失败，对齐 DSH assertBodyParses） */
function assertBodyParses(script: string): void {
  if (typeof script !== "string" || script.trim() === "") {
    throw new WorkflowError("SCRIPT_PARSE", "script must be a non-empty string");
  }
  try {
    // eslint-disable-next-line no-new
    new vm.Script(`(async () => {\n${script}\n})()`, {
      filename: "workflow-script.js",
      lineOffset: -1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new WorkflowError("SCRIPT_PARSE", `script does not parse: ${msg}`);
  }
}

// ─── 单次运行控制器 ───

interface LiveAgent {
  label: string;
  phase: string | null;
  subSessionId?: string;
}

/**
 * 一次 workflow run 的宿主侧生命周期：
 * worker 管理、消息路由、并发槽 FIFO、事件广播（SSE + 内存快照折叠）、取消收敛。
 *
 * 状态持久化策略（方案 B）：run 进度不落 JSONL——引擎维护内存折叠快照
 * （snapshot()），REST 快照端点 + workflow_event SSE 实时增量喂前端概览面板；
 * 对话流只保留原生 workflow_run 工具调用行。
 */
class WorkflowRun {
  private readonly logger = new Logger("WorkflowRun");
  readonly runId: string;
  private readonly parentContext: ISessionContext;
  private readonly subAgentManager: SubAgentManager;
  private readonly maxConcurrent: number;
  private readonly maxTotal: number;

  private worker: Worker | null = null;
  private eventSeq = 0;
  private startedAt = Date.now();
  /** 已启动（创建过子会话）的子代理总数 */
  private totalStarted = 0;
  /** 运行中的子代理（agent-start ↔ agent-end 恰好一次配对） */
  private readonly liveAgents = new Map<string, LiveAgent>();
  /** 每个子代理的取消控制器（callId → controller） */
  private readonly childControllers = new Map<string, AbortController>();

  /** 并发槽 FIFO：超过上限的 agent() 调用排队 */
  private activeCount = 0;
  private readonly slotQueue: Array<() => void> = [];

  private settled = false;
  private cancelRequested = false;
  private cancelReason: string | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private settledResult: WorkflowRunResult | null = null;
  private doneResolve!: (r: WorkflowRunResult) => void;
  readonly done: Promise<WorkflowRunResult>;

  /** 内存折叠快照（事件广播前同步更新，快照永不落后于已广播事件） */
  private readonly snapshot: WorkflowRunSnapshot;

  constructor(params: {
    runId: string;
    parentContext: ISessionContext;
    subAgentManager: SubAgentManager;
    options: WorkflowEngineOptions;
  }) {
    this.runId = params.runId;
    this.parentContext = params.parentContext;
    this.subAgentManager = params.subAgentManager;
    this.maxConcurrent = Math.min(
      MAX_CONCURRENT_CLAMP,
      Math.max(1, params.options.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT),
    );
    this.maxTotal = params.options.maxTotalAgents ?? DEFAULT_MAX_TOTAL_AGENTS;
    this.snapshot = {
      runId: params.runId,
      name: "",
      status: "running",
      agents: [],
      logs: [],
      startedAt: this.startedAt,
      lastSeq: 0,
    };
    this.done = new Promise<WorkflowRunResult>((resolve) => {
      this.doneResolve = resolve;
    });
  }

  /** 只读快照（引擎注册表直接引用此对象；字段更新是原地 mutation） */
  getSnapshot(): WorkflowRunSnapshot {
    return this.snapshot;
  }

  // ── 事件广播（SSE + 同步折叠进内存快照；广播失败仅告警不打断 run）──

  emit(kind: WorkflowEventKind, payload: WorkflowEventData["payload"]): void {
    const data: WorkflowEventData = {
      runId: this.runId,
      seq: ++this.eventSeq,
      kind,
      time: Date.now(),
      payload,
    };
    this.applyToSnapshot(data);
    // 广播走宿主流通道（SSE→前端概览实时增量）；失败仅告警
    this.parentContext
      .publishStream({ type: "workflow_event", event: data })
      .catch((err) => {
        this.logger.warn(
          `workflow 事件广播失败 run=${data.runId} seq=${data.seq}: ${err instanceof Error ? err.message : err}`,
        );
      });
  }

  /** 单一 reducer：与前端概览面板 reducer 同构，按 kind 折叠进快照 */
  private applyToSnapshot(data: WorkflowEventData): void {
    const state = this.snapshot;
    if (data.seq <= state.lastSeq) return;
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
        break; // 阶段纯展示：成员按自身 phase 字段分组
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
          // end 先于 start（防御）：建条目再落终态
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
        state.status = p.runStatus as WorkflowRunSnapshot["status"];
        if (p.errorCode) state.errorCode = p.errorCode;
        if (p.errorMessage) state.errorMessage = p.errorMessage;
        if (p.durationMs !== undefined) state.durationMs = p.durationMs;
        state.endedAt = data.time;
        break;
      }
    }
  }

  // ── 启动 ──

  start(params: { script: string; args: unknown }, abortSignal?: AbortSignal): void {
    const workerData: WorkflowWorkerData = { script: params.script, args: params.args };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_BOOTSTRAP_SOURCE, {
        eval: true,
        workerData,
        resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 },
      });
    } catch (e) {
      // workerData structured clone 失败（args 含函数/BigInt 等）
      this.settle({
        runId: this.runId,
        status: "failed",
        agentCount: 0,
        errorCode: "INVALID_ARGUMENT",
        errorMessage: `args must be JSON-serializable: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    this.worker = worker;
    this.startedAt = Date.now();

    worker.on("message", (msg: WorkerToHost) => this.onWorkerMessage(msg));
    worker.on("error", (err: Error) => {
      this.logger.warn(`workflow worker 异常 run=${this.runId}: ${err.message}`);
      this.synthesizeInterrupted();
      this.settle({
        runId: this.runId,
        status: "failed",
        agentCount: this.totalStarted,
        errorCode: "WORKER_CRASHED",
        errorMessage: err.message,
      });
    });
    worker.on("exit", (code) => {
      if (this.settled) return;
      this.synthesizeInterrupted();
      if (this.cancelRequested) {
        this.settle({
          runId: this.runId,
          status: "cancelled",
          agentCount: this.totalStarted,
          durationMs: Date.now() - this.startedAt,
        });
      } else {
        this.settle({
          runId: this.runId,
          status: "failed",
          agentCount: this.totalStarted,
          errorCode: "WORKER_CRASHED",
          errorMessage: `worker exited unexpectedly (code=${code})`,
        });
      }
    });

    if (abortSignal) {
      if (abortSignal.aborted) {
        this.cancel("Parent agent aborted");
      } else {
        const onAbort = () => this.cancel("Parent agent aborted");
        abortSignal.addEventListener("abort", onAbort, { once: true });
        void this.done.finally(() =>
          abortSignal.removeEventListener("abort", onAbort),
        );
      }
    }
  }

  // ── worker 消息路由 ──

  private onWorkerMessage(msg: WorkerToHost): void {
    switch (msg.type) {
      case "ready":
        this.post({ type: "go" });
        break;
      case "phase":
        this.emit("run-phase", { title: msg.title });
        break;
      case "log":
        this.emit("run-log", { message: msg.message });
        break;
      case "agent-call":
        this.onAgentCall(msg.callId, msg.prompt, msg.opts);
        break;
      case "result":
        this.synthesizeInterrupted();
        this.emit("run-end", {
          runStatus: "completed",
          agentCount: this.totalStarted,
          durationMs: Date.now() - this.startedAt,
        });
        this.settle({
          runId: this.runId,
          status: "completed",
          value: msg.value,
          agentCount: this.totalStarted,
          durationMs: Date.now() - this.startedAt,
        });
        break;
      case "error":
        this.synthesizeInterrupted();
        this.emit("run-end", {
          runStatus: msg.code === "CANCELLED" ? "cancelled" : "failed",
          agentCount: this.totalStarted,
          errorCode: msg.code,
          errorMessage: msg.message,
          durationMs: Date.now() - this.startedAt,
        });
        this.settle({
          runId: this.runId,
          status: msg.code === "CANCELLED" ? "cancelled" : "failed",
          agentCount: this.totalStarted,
          errorCode: msg.code,
          errorMessage: msg.message,
          durationMs: Date.now() - this.startedAt,
        });
        break;
    }
  }

  private post(msg: HostToWorker): void {
    this.worker?.postMessage(msg);
  }

  // ── 子代理调度（宿主侧并发槽 FIFO）──

  private onAgentCall(
    callId: string,
    prompt: string,
    opts: { agentId?: string; label?: string; phase?: string },
  ): void {
    if (this.settled || this.cancelRequested) return;
    if (this.totalStarted >= this.maxTotal) {
      this.post({
        type: "agent-failed",
        callId,
        code: "AGENT_CAP",
        message: `maxTotalAgents (${this.maxTotal}) reached`,
      });
      return;
    }
    this.totalStarted++;
    this.enqueueSlot(() => void this.launchAgent(callId, prompt, opts));
  }

  private enqueueSlot(task: () => void): void {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      task();
      return;
    }
    this.slotQueue.push(() => {
      this.activeCount++;
      task();
    });
  }

  private releaseSlot(): void {
    this.activeCount--;
    const next = this.slotQueue.shift();
    if (next) next();
  }

  private resolveCharacterId(agentId?: string): string | null {
    if (!agentId || agentId === "generic") return null;
    // 角色白名单：与会话 sub_agent 工具同一配置（settings.agents 显式 true）
    const agentsCfg = this.parentContext.getSettings("agents");
    const allowed =
      typeof agentsCfg === "object" && agentsCfg !== null
        ? agentsCfg[agentId] === true
        : false;
    if (!allowed) {
      throw new WorkflowError(
        "AGENT_START",
        `Agent "${agentId}" is not allowed by the session agents whitelist`,
      );
    }
    return agentId;
  }

  private async launchAgent(
    callId: string,
    prompt: string,
    opts: { agentId?: string; label?: string; phase?: string },
  ): Promise<void> {
    const label = opts.label?.trim() || safeTruncate(prompt.replace(/\s+/g, " "), 40);
    const phase = opts.phase?.trim() || null;
    const controller = new AbortController();
    this.childControllers.set(callId, controller);

    try {
      const characterId = this.resolveCharacterId(opts.agentId);
      if (this.settled || this.cancelRequested) return;

      const result = await this.subAgentManager.spawnForWorkflow(
        {
          parentContext: this.parentContext,
          name: label,
          task: prompt,
          characterId: characterId ?? undefined,
          workflow: { runId: this.runId, label, phase },
          onCreated: (subSessionId) => {
            this.liveAgents.set(callId, { label, phase, subSessionId });
            this.emit("agent-start", {
              callId,
              label,
              phase,
              subSessionId,
            });
          },
        },
        controller.signal,
      );

      const status = toMemberStatus(result);
      this.liveAgents.delete(callId);
      this.emit("agent-end", {
        callId,
        label,
        phase,
        status,
        ...(result.content ? { outputSummary: safeTruncate(result.content, 200) } : {}),
      });
      // 结算回 worker：agent() 依赖此消息 resolve（失败以 stopReason 表达 → 脚本侧 null）
      const stopReason =
        result.stopReason ?? (result.status === "completed" ? "completed" : "error");
      this.post({
        type: "agent-settled",
        callId,
        output: result.content ?? "",
        stopReason,
      });
    } catch (e) {
      // 角色白名单拒绝（AGENT_START）等启动期失败：响亮失败，杀死脚本
      this.liveAgents.delete(callId);
      this.emit("agent-end", {
        callId,
        label,
        phase,
        status: "failed",
      });
      const message = e instanceof Error ? e.message : String(e);
      // agent-failed 只接受启动期错误码；其余一律归一为 AGENT_START
      const code: "AGENT_CAP" | "AGENT_START" =
        e instanceof WorkflowError && e.code === "AGENT_CAP" ? e.code : "AGENT_START";
      this.post({ type: "agent-failed", callId, code, message });
    } finally {
      this.childControllers.delete(callId);
      this.releaseSlot();
    }
  }

  // ── 取消与收尾 ──

  /** worker 死亡/强杀时为所有未配对的 agent-start 合成 cancelled 终态（恰好一次配对） */
  private synthesizeInterrupted(): void {
    for (const [callId, agent] of this.liveAgents) {
      this.emit("agent-end", {
        callId,
        label: agent.label,
        phase: agent.phase,
        ...(agent.subSessionId ? { subSessionId: agent.subSessionId } : {}),
        status: "cancelled" as WorkflowMemberStatus,
      });
    }
    this.liveAgents.clear();
  }

  cancel(reason: string): void {
    if (this.cancelRequested || this.settled) return;
    this.cancelRequested = true;
    this.cancelReason = reason;
    this.slotQueue.length = 0;
    for (const controller of this.childControllers.values()) {
      controller.abort();
    }
    this.post({ type: "cancel", reason });
    this.graceTimer = setTimeout(() => {
      if (!this.settled) {
        this.logger.warn(`workflow worker 宽限期后强杀 run=${this.runId}`);
        this.worker?.terminate();
      }
    }, CANCEL_GRACE_MS);
  }

  private settle(result: WorkflowRunResult): void {
    if (this.settled) return;
    this.settled = true;
    this.settledResult = result;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    // 兜底回收：脚本未 await 的在途子代理（fire-and-forget agent()）统一中止
    this.synthesizeInterrupted();
    for (const controller of this.childControllers.values()) {
      controller.abort();
    }
    this.childControllers.clear();
    // worker 已终态即回收（result/error/crash 后事件循环不再需要）
    this.worker?.terminate().catch(() => {});
    this.worker = null;
    this.doneResolve(result);
  }

  get result(): WorkflowRunResult | null {
    return this.settledResult;
  }
}

/** SubAgentResult → member 可见状态 */
function toMemberStatus(result: SubAgentResult): WorkflowMemberStatus {
  if (result.status === "completed") {
    return result.stopReason && result.stopReason !== "completed" ? "failed" : "completed";
  }
  if (result.stopReason === "aborted") return "cancelled";
  return "failed";
}

// ─── 引擎服务 ───

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);
  private readonly runs = new Map<string, WorkflowRun>();
  /** 每会话运行快照注册表（runId → 快照；运行中永不淘汰，完成态超上限按注册顺序裁剪） */
  private readonly runStatesBySession = new Map<string, Map<string, WorkflowRunSnapshot>>();

  constructor(private readonly subAgentManager: SubAgentManager) {}

  /** 概览面板数据源：某会话的全部已知 run 快照（运行中 + 近期完成） */
  getSessionRunStates(sessionId: string): WorkflowRunSnapshot[] {
    const byRun = this.runStatesBySession.get(sessionId);
    return byRun ? [...byRun.values()] : [];
  }

  /** 注册运行快照并裁剪：每会话最多保留 MAX_FINISHED_RUNS_PER_SESSION 个已完成 run */
  private registerRunState(sessionId: string, state: WorkflowRunSnapshot): void {
    let byRun = this.runStatesBySession.get(sessionId);
    if (!byRun) {
      byRun = new Map();
      this.runStatesBySession.set(sessionId, byRun);
    }
    byRun.set(state.runId, state);
    const finished: string[] = [];
    for (const [runId, st] of byRun) {
      if (st.status !== "running") finished.push(runId);
    }
    while (finished.length > MAX_FINISHED_RUNS_PER_SESSION) {
      const oldest = finished.shift();
      if (oldest === undefined) break;
      byRun.delete(oldest);
    }
  }

  /**
   * 启动一次前台 workflow run（阻塞到脚本完成）。
   *
   * 格式错误（META_INVALID/SCRIPT_PARSE/INVALID_ARGUMENT）同步抛 WorkflowError，
   * 由工具层转为 error 结果回给模型重试；运行期失败不抛（结果以 status/errorCode 表达，
   * 对齐 DSH WorkflowRun.result never rejects）。
   */
  async startRun(
    parentContext: ISessionContext,
    params: { script: string; meta: unknown; args?: unknown },
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRunResult> {
    const meta = validateMeta(params.meta);
    assertBodyParses(params.script);

    if (abortSignal?.aborted) {
      return { runId: "", status: "cancelled", agentCount: 0 };
    }

    const settings = parentContext.getSettings("workflow");
    const options: WorkflowEngineOptions = {
      maxConcurrentAgents: isPlainObject(settings)
        ? (settings.maxConcurrentAgents as number | undefined)
        : undefined,
    };

    const runId = `wfr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const run = new WorkflowRun({
      runId,
      parentContext,
      subAgentManager: this.subAgentManager,
      options,
    });
    this.runs.set(runId, run);
    this.registerRunState(parentContext.sessionId, run.getSnapshot());

    run.emit("run-start", {
      name: meta.name,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.phases ? { phases: meta.phases } : {}),
    });

    try {
      run.start({ script: params.script, args: params.args }, abortSignal);
      return await run.done;
    } finally {
      this.runs.delete(runId);
    }
  }

  /** 供外部（诊断/测试）查询活跃 run */
  getActiveRunIds(): string[] {
    return [...this.runs.keys()];
  }
}
