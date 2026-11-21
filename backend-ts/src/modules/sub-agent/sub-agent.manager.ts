import { Injectable, Logger, OnModuleInit, Inject, Optional } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
import { SESSION_STORE_TOKEN } from '../chat/session-store.facade';
import type { SessionStoreFacade } from '../chat/session-store.facade';
import { AgentFileStore } from "../agents/agent-file.store";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { UserInputQueueService } from "../chat/user-input-queue.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { normalizeSandboxMode } from "../../common/services/sandbox-policy";
import { ISessionContext } from "../chat/session-context";
import { HOOKS } from "../chat/types/hooks.contract";
import type { DeliveryMode } from "../../common/types/delivery.types";
import { safeTruncate } from "../../common/utils/string.utils";
import { JobRegistryService } from "../jobs/job-registry.service";
import { sliceJobText } from "../jobs/job-output.util";
import type {
  JobId,
  JobOutcome,
  JobOutputRead,
  JobReadOptions,
} from "../jobs/job.types";
import {
  MESSAGE_STORE_TOKEN,
  IMessageStore,
} from "../../common/persistence/message-store.interface";
import type {
  TextBlock,
  ReasoningBlock,
} from "../../common/types/conversation.types";

/**
 * 子 Agent 默认系统提示词
 *
 * 当子 Agent 没有自定义智能体提示词时，使用此提示词作为基础身份定义。
 * 通过 session.settings.systemPrompt 注入，与工具配置走相同的继承机制。
 */
const SUB_AGENT_DEFAULT_PROMPT = `You are a Sub Agent, delegated by the main Agent to execute a specific task.

## Core Responsibilities
- Focus on the task assigned by the main Agent, analyze deeply and complete it independently
- Use available tools to gather information, process data, and perform actions
- Return clear, structured results for the main Agent to integrate

## Guidelines
- Proactively use tools to complete the task; do not rely solely on existing knowledge
- When facing complex problems, break them down into multiple steps and solve them incrementally
- When the task is complete, provide a concise summary and key conclusions
- If the task cannot be completed, explain the reason and what approaches have been attempted

## Notes
- Your tool permissions are assigned by the main Agent; make full use of them
- The working directory is shared with the main Agent; be mindful of file operation consistency
- Do not ask the user questions; make decisions and execute the task independently`;

/**
 * 子代理停止原因（对齐 DSH SubagentStopReason）
 *
 * merge-extensible：新增原因不破坏既有消费者；
 * 未知/缺失原因一律按 error 处理（DSH 原则：未知原因不误报成功）。
 */
export type SubAgentStopReason =
  | "completed"
  | "aborted"
  | "error"
  | "max_tokens"
  | "refusal"
  | "stopped";

/**
 * finishReason → 结构化停止原因
 *
 * error 场景由调用方显式置位（event.error / onError / abort），不走本映射；
 * 无显式原因（undefined/空）视为正常完成。
 */
export function mapFinishReason(reason?: string): SubAgentStopReason {
  if (!reason) return "completed";
  switch (reason) {
    case "stop":
    case "tool-calls":
    case "tool_calls":
      return "completed";
    case "length":
    case "max_tokens":
      return "max_tokens";
    case "content_filter":
    case "refusal":
      return "refusal";
    case "user_cancel":
    case "aborted":
      return "aborted";
    default:
      // 未知原因（含 timeout/error 等）→ 保守按 error 处理
      return "error";
  }
}

/** 子 Agent 结果是否失败（与 finalizeSubAgent / toJobOutcome 同口径） */
function isSubAgentError(result: SubAgentResult): boolean {
  return (
    result.status === "error" ||
    (result.stopReason !== undefined && result.stopReason !== "completed")
  );
}

/** 子 Agent 结果 → 通用 job 终态（与 finalizeSubAgent 的 isError 口径一致） */
function toJobOutcome(result: SubAgentResult): JobOutcome {
  const isError = isSubAgentError(result);
  const output = result.content || undefined;
  if (result.stopReason === "aborted" || result.stopReason === "stopped") {
    return {
      status: "killed",
      detail: result.stopReason,
      output,
      exitCode: null,
    };
  }
  if (isError) {
    return {
      status: "failed",
      detail: result.error ?? result.stopReason,
      output,
      exitCode: null,
    };
  }
  return {
    status: "completed",
    detail: result.stopReason,
    output,
    exitCode: 0,
  };
}

/**
 * 子 Agent 执行结果
 */
export interface SubAgentResult {
  subSessionId: string;
  /** 后台作业 id（仅后台 spawn / 前台超时转后台时存在） */
  jobId?: JobId;
  status: "completed" | "error" | "running";
  /** 结构化停止原因（P2；unknown 一律 error） */
  stopReason?: SubAgentStopReason;
  content: string;
  reasoningContent?: string;
  finishReason?: string;
  error?: string;
}

/**
 * deliver() 的投递回执
 *
 * 补充消息与人类用户输入共用会话队列，唯一区别是投递时机与 source.kind：
 * - queued：目标忙，消息已入其会话队列（默认 delivery=inject：
 *   当前回合跑到工具批次结束、该发下一次请求的边界时结束本回合，
 *   随后以**新回合**送达）
 * - started：目标空闲，已直接开启新回合（阻塞至回合完成）
 */
export interface SubAgentDeliveryReceipt {
  subSessionId: string;
  delivery: "queued" | "started";
  /** queued 时的队列深度 */
  pending?: number;
  /** started 路径的回合结果 */
  result?: SubAgentResult;
}

/**
 * 单次 run 的收尾屏障
 *
 * finishing 在首轮执行结束后同步置位；done 在结算/收尾全部完成后 resolve。
 * deliver 借此关闭「本轮已结束、settle 未完成」窗口内的投递竞态
 * （避免消息搁浅或在收尾与开新回合之间夹出脏状态）。
 */
interface SubAgentRunLifecycle {
  finishing: boolean;
  stopped: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

/**
 * 父会话下的子 Agent 状态管理
 */
interface ParentSessionState {
  // 正在运行的子 Agent sessionId 集合（由 executeSubAgentStream 维护）
  running: Set<string>;
  // 已完成的子 Agent（携带完整输出结果）
  completed: {
    subSessionId: string;
    name: string;
    result: SubAgentResult;
    jobId?: JobId;
  }[];
  // 等待中的 completer
  completers: SubAgentCompleter[];
}

interface SubAgentCompleter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

/**
 * 子 Agent 管理器
 *
 * 核心设计：
 * 1. spawn：创建子 Agent 并启动，支持前台（阻塞）和后台（非阻塞）两种模式
 * 2. 生命周期唯一：一次运行结束即记录结束时间（保留供回放）；继续交互走 job_send，
 *    发送时直接开启新回合——模型面没有 lifecycle 概念
 * 3. 内部通过 startStream 的 callbacks 监听完成，自动广播 sub_agent_finish
 * 4. waitForComplete：供主 Agent 主动等待子 Agent 完成
 */
@Injectable()
export class SubAgentManager implements OnModuleInit {
  private readonly logger = new Logger(SubAgentManager.name);
  private readonly states = new Map<string, ParentSessionState>();
  /** 子会话 → 通用后台作业 id（仅后台/超时路径） */
  private readonly jobIds = new Map<string, JobId>();
  /** 子会话 → 派生它的工具调用（settle/stop 时按 toolCallId 即时通知前端） */
  private readonly toolLinks = new Map<
    string,
    { parentContext: ISessionContext; toolCallId: string }
  >();
  /** 子会话 → 本次 run 的收尾屏障；deliver 借此关闭收尾窗口竞态 */
  private readonly lifecycles = new Map<string, SubAgentRunLifecycle>();
  /** 子会话 → 正在准备启动的新回合，阻止并发 job_send 重复启动 */
  private readonly startingRuns = new Set<string>();
  /**
   * 子会话 → 挂起的结算唤醒器（结算静默门）。
   * 队列排空 + 流空闲就绪时由事件监听 resolve；超时/停止兜底直接 resolve。
   */
  private readonly quiesceWaiters = new Map<
    string,
    Set<{ resolve: () => void; settled: boolean }>
  >();

  constructor(
    @Inject(SESSION_STORE_TOKEN) private sessionStore: SessionStoreFacade,
    private chatRunnerService: ChatRunnerService,
    private eventBus: EventBusService,
    private agentStore: AgentFileStore,
    @Inject(MESSAGE_STORE_TOKEN) private messageStore: IMessageStore,
    // 允许直接 new 的测试/嵌入场景不挂 Registry；生产由 SubAgentModule imports JobsModule 注入。
    @Optional() private readonly jobRegistry?: JobRegistryService,
    // 子代理的补充消息走与人类用户相同的会话队列（仅 source.kind 不同）。
    // 测试/嵌入场景可不注入：此时降级为直接入 ChatRunner 系统队列。
    @Optional() private readonly userInputQueue?: UserInputQueueService,
  ) {}

  onModuleInit() {
    this.logger.log("SubAgentManager initialized");
  }

  // ─── 结算静默门（Job 等子会话静默才结算） ───

  /** 结算等待上限：防止队列故障（drain 失败永久搁浅）把 Job 卡死占配额 */
  private static readonly JOB_SETTLE_QUIESCE_TIMEOUT_MS = 10 * 60_000;

  /**
   * 子会话是否已静默（可安全结算）
   *
   * 三条件同查：队列排空、流空闲、无处理中投递。
   * turn_finished 发出时下一回合可能已启动（收尾消费先于事件），
   * 因此事件到达后仍需重查 hasActiveStream。
   */
  private isSubAgentQuiescent(subSessionId: string): boolean {
    if (!this.userInputQueue) return true;
    const state = this.userInputQueue.getState(subSessionId);
    if (state?.paused) return true;
    if (this.userInputQueue.getCount(subSessionId) > 0) return false;
    if (this.userInputQueue.isProcessing(subSessionId)) return false;
    return !this.chatRunnerService.hasActiveStream(subSessionId);
  }

  /**
   * 等待子会话静默（事件驱动 + 超时兜底）
   *
   * - 队列 paused：不会再自主续跑，立即返回（带告警，结果可能不含后续轮）
   * - 超时：兜底结算（带告警），避免 Job 永久占用每会话配额
   * - 无队列（测试/嵌入）：立即返回，保持旧语义
   */
  private async waitForSubAgentQuiesce(subSessionId: string): Promise<void> {
    // 门只挂在生产路径（有 Registry 的后台 Job）：测试/嵌入降级（无 Registry）
    // 保持即时结算，避免嵌入方被接续投递卡住收尾。
    if (!this.jobRegistry || !this.userInputQueue) return;
    if (this.isSubAgentQuiescent(subSessionId)) return;

    const state = this.userInputQueue?.getState(subSessionId);
    if (state?.paused) {
      this.logger.warn(
        `子 Agent 队列已暂停，按当前内容结算: ${subSessionId}`,
      );
      return;
    }

    const deadline = Date.now() + SubAgentManager.JOB_SETTLE_QUIESCE_TIMEOUT_MS;
    await new Promise<void>((resolve) => {
      const waiter = { resolve, settled: false };
      const waiters = this.quiesceWaiters.get(subSessionId) ?? new Set();
      waiters.add(waiter);
      this.quiesceWaiters.set(subSessionId, waiters);
      const timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        waiters.delete(waiter);
        this.logger.warn(
          `子 Agent 结算等待超时(${SubAgentManager.JOB_SETTLE_QUIESCE_TIMEOUT_MS}ms)，按当前内容强制结算: ${subSessionId}`,
        );
        resolve();
      }, Math.max(1, deadline - Date.now()));
      // 兜底防泄漏：正常 resolve 时清掉超时定时器
      waiter.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** 静默就绪时唤醒挂起的结算（幂等） */
  private releaseQuiesceWaiters(subSessionId: string): void {
    const waiters = this.quiesceWaiters.get(subSessionId);
    if (!waiters?.size) return;
    this.quiesceWaiters.delete(subSessionId);
    for (const waiter of waiters) {
      if (waiter.settled) continue;
      waiter.settled = true;
      waiter.resolve();
    }
  }

  /** 子会话回合正常收尾：复查静默条件，就绪则触发挂起结算 */
  @OnEvent("chat.turn_finished")
  handleSubAgentTurnFinished(event: {
    sessionId: string;
    sessionType?: string;
  }): void {
    if (event.sessionType !== "sub_agent") return;
    if (!this.quiesceWaiters.has(event.sessionId)) return;
    if (this.isSubAgentQuiescent(event.sessionId)) {
      this.releaseQuiesceWaiters(event.sessionId);
    }
  }

  /** 子会话队列变化（入队/消费/清空）：复查静默条件 */
  @OnEvent("chat.user_queue_changed")
  handleSubAgentQueueChanged(event: { sessionId?: string }): void {
    const sessionId = event?.sessionId;
    if (!sessionId || !this.quiesceWaiters.has(sessionId)) return;
    if (this.isSubAgentQuiescent(sessionId)) {
      this.releaseQuiesceWaiters(sessionId);
    }
  }

  /**
   * 向子会话投递主代理消息（统一队列入口）
   *
   * 与人类用户输入完全同一条路径：写入子会话自己的会话队列，
   * delivery=inject 表示「工具批次跑完后结束本回合、以新回合一送达」。
   * 与旧实现的区别：不再写 metadata.hidden，因此这条消息是可见的真实回合锚点，
   * 前端据 source.kind='coordinator' 渲染成「主代理补充指令」。
   */
  private async enqueueCoordinatorMessage(
    subSessionId: string,
    parentSessionId: string,
    text: string,
    delivery: DeliveryMode,
  ): Promise<void> {
    if (this.userInputQueue) {
      this.userInputQueue.enqueue({
        sessionId: subSessionId,
        content: text,
        delivery,
        messageSource: {
          kind: "coordinator",
          senderSessionId: parentSessionId,
        },
        messageMetadata: { inputPresentation: "coordinator_steer" },
      });
      // 队列自身会广播 queue_updated；这里补一次消费尝试，
      // 覆盖「子会话已空闲（无活跃流）」的场景（等价于用户发消息）。
      void this.chatRunnerService.drainUserQueue(subSessionId);
      return;
    }

    // 降级路径（无队列注入，如直接 new 的测试）：仍以真实 user 消息开启新回合。
    await this.chatRunnerService.enqueueMessage({
      sessionId: subSessionId,
      blocks: [{ type: "text", text }],
      source: { kind: "coordinator", senderSessionId: parentSessionId },
    });
  }

  /**
  /**
   * 创建子 Agent 并执行
   *
   * 前台模式（默认）：阻塞直到子 Agent 执行完毕并返回完整结果
   * 后台模式：立即返回 SubAgentResult（status=running + jobId），结果经 Job 通知交付
   *
   * 生命周期唯一：一次运行结束即记下结束时间（保留供回放；前台=结果返回时；
   * 后台=结果被消费时）。继续交互走 job_send，无需 AI 管理生命周期。
   */
  async spawn(
    params: {
      parentContext: ISessionContext;
      name: string;
      task: string;
      agentId?: string;
      /** 派生这次子代理的工具调用 id：据此发布 subagent_link 流事件（可选，非工具路径不传） */
      toolCallId?: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const { parentContext } = params;
    const parentSessionId = parentContext.sessionId;

    // 从父会话上下文提取已合并的工具配置
    // PersistentSessionContext.mergeSettings() 已自动处理
    // sessionSettings.xxx ?? agentSettings.xxx 回退
    const inheritedPlugins = parentContext.getSettings("plugins");
    const inheritedSkillsConfig = parentContext.getSettings("skills");

    // 智能体驱动的子 Agent 创建
    let finalModelId: string | null = parentContext.getModelConfig().id;
    let finalAgentId: string | null = null;
    let finalAvatarUrl: string | undefined;

    // 配置继承策略委托给 PersistentSessionContext.mergeSettings()，
    // 它自动处理 sessionSettings.xxx ?? agentSettings.xxx 回退。
    //
    // 有智能体时: 智能体设定自动生效，spawn 只需设 agentId，不设重复值
    // 无智能体时: 显式设置父会话的继承值作为 sessionSettings
    const settings: Record<string, any> = {};

    // 思考强度：无论是否有智能体，都从父会话继承
    settings.thinkingEffort = parentContext.getSettings("thinkingEffort");
    // 安全模式：从父会话继承，防止子代理权限逃逸（如 workspace-write → danger-full-access）。
    // 父会话在计划模式时强制只读：sandbox + planEnabled 双保险。
    // Windows 上 sandboxMode 会被 normalize 成 workspace-write（用户档位已取消），
    // 但子会话继承 planEnabled 后，ToolExecutor 计划门 + shell 只读仍然生效。
    const parentPlanMode = parentContext.getPlanEnabled?.() === true;
    settings.sandboxMode = parentPlanMode
      ? "read-only"
      : normalizeSandboxMode(parentContext.getSandboxMode());
    if (parentPlanMode) settings.planEnabled = true;
    // 附加连接配置：从父会话继承（如 ssh-connection 远程连接），使子代理可复用主代理绑定的连接
    settings.attachments = parentContext.getSettings("attachments") ?? {};

    if (params.agentId && params.agentId !== "generic") {
      // ── 智能体模式（定义来自 agents/<id>/AGENT.md） ──
      const agent = await this.agentStore.findById(params.agentId);
      if (!agent) {
        throw new Error(
          `Agent "${params.agentId}" does not exist. Please check if the ID is correct or if the agent has been deleted.`,
        );
      }
      finalModelId = agent.modelId || parentContext.getModelConfig().id;
      finalAgentId = params.agentId;
      finalAvatarUrl = agent.avatarUrl || undefined;
      this.logger.log(
        `子 Agent 将继承智能体设定: ${agent.name} (${params.agentId})`,
      );
    } else {
      // ── 通用子 Agent ──
      settings.systemPrompt = SUB_AGENT_DEFAULT_PROMPT;
      settings.plugins = inheritedPlugins;
      settings.skills = inheritedSkillsConfig;
      // finalAgentId 保持 null（不走 agentRepo）
    }

    return this.createSubSessionAndRun(
      parentContext,
      params,
      mode,
      abortSignal,
      settings,
      finalModelId,
      finalAgentId,
      finalAvatarUrl,
    );
  }

  /**
   * 创建子会话记录、广播事件并启动执行
   * 抽离为私有方法，供普通智能体和轻量 Agent 共用
   */
  private async createSubSessionAndRun(
    parentContext: ISessionContext,
    params: {
      name: string;
      task: string;
      agentId?: string;
      toolCallId?: string;
    },
    mode: "foreground" | "background",
    abortSignal: AbortSignal | undefined,
    settings: Record<string, any>,
    modelId: string | null,
    agentId: string | null,
    avatarUrl: string | undefined,
  ): Promise<SubAgentResult> {
    const parentSessionId = parentContext.sessionId;

    const subSession = await this.sessionStore.create({
      parentId: parentSessionId,
      title: params.name,
      agentId,
      modelId,
      settings,
      sessionType: "sub_agent",
      workspacePath: parentContext.workspacePath,
      avatarUrl: avatarUrl || null,
    });

    this.logger.log(
      `子 Agent 会话创建成功: ${subSession.id}, 父会话: ${parentSessionId}, 模式: ${mode}`,
    );

    this.eventBus.emit("subagent.created", {
      sessionId: parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId: subSession.id,
        name: params.name,
        mode,
        session: subSession,
      },
    });

    // 工具调用 ↔ 子会话的关联键，走流通道（进 eventBuffer）：
    // 前台 spawn 会阻塞到子代理跑完，这段时间工具结果尚未落库（meta.link 还不存在），
    // 客户端若在此时刷新只能靠 SSE 建连重放这条事件找回关联。
    // 必须在创建瞬间发布——等 spawn 返回再发就与 meta.link 同时到达，失去意义。
    if (params.toolCallId) {
      await parentContext.publishStream({
        type: "subagent_link",
        toolCallId: params.toolCallId,
        subSessionId: subSession.id,
        name: params.name,
      });
      // 结算时不再依赖整批 tool_calls_response：按 toolCallId 即时回传终态
      this.toolLinks.set(subSession.id, {
        parentContext,
        toolCallId: params.toolCallId,
      });
    }

    this.getOrCreateState(parentSessionId);

    return this.executeSubAgentStream(
      subSession.id,
      params.task,
      parentSessionId,
      mode,
      abortSignal,
    );
  }

  /**
   * 向已存在的子 Agent 发送消息继续交互
   *
   * 1. 验证子会话存在且属于该父会话
   * 2. 检查子 Agent 是否正在运行，若运行中则报错
   * 3. 复用 executeSubAgentStream 启动流式执行
   *
   * 会话没有「冻结」态：上一次运行结束与本次能否继续无关，
   * closedAt 只是「最近一次运行结束时间」的展示时间戳，直接开新回合即可。
   */
  async sendMessage(
    params: {
      parentSessionId: string;
      sessionId: string;
      message: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    // 1. 验证子会话存在且属于该父会话
    await this.assertSubSessionOwnership(
      params.parentSessionId,
      params.sessionId,
    );

    // 2. 检查子 Agent 是否正在运行
    if (this.isSubAgentRunning(params.sessionId)) {
      throw new Error(
        "Sub-agent is currently running. Please wait for it to complete before sending a message.",
      );
    }

    this.logger.log(
      `向子 Agent 发送消息: ${params.sessionId}, 父会话: ${params.parentSessionId}, 模式: ${mode}`,
    );

    // 3. 复用执行逻辑
    return this.executeSubAgentStream(
      params.sessionId,
      params.message,
      params.parentSessionId,
      mode,
      abortSignal,
    );
  }

  /** 校验子会话存在且属于该父会话（sendMessage / deliver 共用），返回子会话记录 */
  private async assertSubSessionOwnership(
    parentSessionId: string,
    sessionId: string,
  ) {
    const subSession = await this.sessionStore.get(sessionId);
    if (!subSession) {
      throw new Error("Sub-agent session does not exist.");
    }
    if (subSession.parentId !== parentSessionId) {
      throw new Error("Sub-agent does not belong to this parent session.");
    }
    return subSession;
  }

  /**
   * 向子 Agent 投递消息（与人类用户走同一条会话队列）
   *
   * - 运行中：写入子会话队列，delivery=inject → 当前回合跑到「工具批次结束、
   *   该发下一次请求」的边界时结束本回合，随后以**新回合**送达（可见、可回放）
   * - 收尾窗口（run 已排空、settle/stop 未完成）：等 finish barrier 后按空闲处理
   * - 空闲：直接开新回合（started，阻塞至完成）
   */
  async deliver(params: {
    parentSessionId: string;
    sessionId: string;
    message: string;
    /** 投递时机；子代理默认 inject（工具边界接管） */
    delivery?: DeliveryMode;
  }): Promise<SubAgentDeliveryReceipt> {
    await this.assertSubSessionOwnership(params.parentSessionId, params.sessionId);
    const delivery = params.delivery ?? "inject";

    const lifecycle = this.lifecycles.get(params.sessionId);
    if (lifecycle?.finishing) {
      await lifecycle.done;
    } else {
      const trackedRunning =
        this.states.get(params.parentSessionId)?.running.has(params.sessionId) ===
        true;
      if (trackedRunning) {
        await this.enqueueCoordinatorMessage(
          params.sessionId,
          params.parentSessionId,
          params.message,
          delivery,
        );
        this.logger.log(
          `子 Agent 运行中，消息已入会话队列: ${params.sessionId}, delivery=${delivery}`,
        );
        return {
          subSessionId: params.sessionId,
          // job_send 仅支持 queue/inject 两种时机（interrupt 是人类输入框能力）
          delivery: "queued",
          pending: this.userInputQueue?.getCount(params.sessionId) ?? 1,
        };
      }
    }

    // 非 manager 跟踪但确有活跃流（用户直接在子会话交互中）：同样入队列
    if (this.chatRunnerService.hasActiveStream(params.sessionId)) {
      await this.enqueueCoordinatorMessage(
        params.sessionId,
        params.parentSessionId,
        params.message,
        delivery,
      );
      this.logger.log(
        `子 Agent 非跟踪运行中，消息入会话队列: ${params.sessionId}`,
      );
      return { subSessionId: params.sessionId, delivery: "queued" };
    }

    // 空闲路径也要先占位：startStream 的忙碌检查与 manager 状态登记之间存在异步窗口。
    // 该占位只覆盖启动阶段，成功后由 executeSubAgentStream 建立 lifecycle。
    if (this.startingRuns.has(params.sessionId)) {
      throw new Error(
        "Sub-agent is starting a new turn. Please wait before sending another message.",
      );
    }
    this.startingRuns.add(params.sessionId);
    try {
      const result = await this.sendMessage({
        parentSessionId: params.parentSessionId,
        sessionId: params.sessionId,
        message: params.message,
      });
      return {
        subSessionId: params.sessionId,
        delivery: "started",
        result,
      };
    } finally {
      this.startingRuns.delete(params.sessionId);
    }
  }

  /**
   * 为 Workflow 编排引擎创建并执行子代理（对齐 DSH workflow host → subagents.start）
   *
   * 与 spawn() 的差异：
   * - 不走 states Map / completer / 信箱：workflow 引擎自己就是等待者，
   *   结果直接经返回的 Promise 交付，绝不投递 <system_reminder> 唤醒父循环
   * - 跳过每父会话 10 个上限（并发由 workflow 引擎的槽位控制）
   * - 本轮结束即记录运行结束（只写 closedAt 时间戳、不删除，执行过程仍可回放）
   * - settings.workflow 记录来源（runId/label/phase），照常广播 subagent.created
   */
  async spawnForWorkflow(
    params: {
      parentContext: ISessionContext;
      name: string;
      task: string;
      agentId?: string;
      workflow: { runId: string; label?: string; phase?: string | null };
      onCreated?: (subSessionId: string) => void;
    },
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const { parentContext } = params;
    const parentSessionId = parentContext.sessionId;

    // 继承策略与 spawn() 一致（PersistentSessionContext.mergeSettings 语义）
    const settings: Record<string, any> = {
      thinkingEffort: parentContext.getSettings("thinkingEffort"),
      // 安全模式：从父会话继承，防止子代理权限逃逸（如 workspace-write → danger-full-access）
      sandboxMode: normalizeSandboxMode(parentContext.getSandboxMode()),
      attachments: parentContext.getSettings("attachments") ?? {},
      workflow: {
        runId: params.workflow.runId,
        ...(params.workflow.label ? { label: params.workflow.label } : {}),
        ...(params.workflow.phase ? { phase: params.workflow.phase } : {}),
      },
    };

    let finalModelId: string | null = parentContext.getModelConfig().id;
    let finalAgentId: string | null = null;
    let finalAvatarUrl: string | undefined;

    if (params.agentId && params.agentId !== "generic") {
      const agent = await this.agentStore.findById(params.agentId);
      if (!agent) {
        throw new Error(
          `Agent "${params.agentId}" does not exist. Please check if the ID is correct or if the agent has been deleted.`,
        );
      }
      finalModelId = agent.modelId || parentContext.getModelConfig().id;
      finalAgentId = params.agentId;
      finalAvatarUrl = agent.avatarUrl || undefined;
    } else {
      // 通用子代理：显式继承父会话的插件/技能配置
      settings.systemPrompt = SUB_AGENT_DEFAULT_PROMPT;
      settings.plugins = parentContext.getSettings("plugins");
      settings.skills = parentContext.getSettings("skills");
    }

    const subSession = await this.sessionStore.create({
      parentId: parentSessionId,
      title: params.name,
      agentId: finalAgentId,
      modelId: finalModelId,
      settings,
      sessionType: "sub_agent",
      workspacePath: parentContext.workspacePath,
      avatarUrl: finalAvatarUrl || null,
    });

    this.logger.log(
      `Workflow 子代理会话创建: ${subSession.id}, run: ${params.workflow.runId}, 父会话: ${parentSessionId}`,
    );

    this.eventBus.emit("subagent.created", {
      sessionId: parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId: subSession.id,
        name: params.name,
        mode: "foreground",
        session: subSession,
      },
    });

    params.onCreated?.(subSession.id);

    // 直接等待流执行结果：不走 settle/信箱（workflow 引擎是唯一等待者）；
    // abortSignal 中止时 runSubAgentStream 内部联动 cancelStream 并以 aborted 结算
    const result = await this.runSubAgentStream(
      subSession.id,
      params.task,
      parentSessionId,
      abortSignal,
    );

    // 本轮结束即记录运行结束（只写时间戳，不删除，仍可回放）。
    // 本路径绕过 executeSubAgentStream 与 settle，是唯一没有收尾调用点的分支，
    // 必须在此显式记录，否则该子会话的结束时间永不落库。
    await this.markRunEnded(subSession.id, parentSessionId, result);

    return result;
  }

  /**
   * 执行子 Agent 流式执行（前台/后台模式）
   *
   * 统一架构（参考 shell execute）：
   * - 始终 fire-and-forget 启动 runSubAgentStream
   * - 前台模式：Promise.race 等待结果（20min 超时），完成直接返回，超时转后台
   * - 后台模式：不等待，pending 完成后入队通知
   * - 一次运行结束即记下结束时间（前台=结果返回时；后台=信箱消费时）
   */
  private async executeSubAgentStream(
    subSessionId: string,
    content: string,
    parentSessionId: string,
    mode: "foreground" | "background",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const state = this.getOrCreateState(parentSessionId);
    state.running.add(subSessionId);

    // 收尾屏障：deliver 借此识别「run 已排空 inbox、结算/收尾未完成」窗口
    const lifecycle = this.createLifecycle(subSessionId);

    const pending = this.runSubAgentRounds(
      subSessionId,
      content,
      parentSessionId,
      mode === "foreground" ? abortSignal : undefined,
      lifecycle,
    );

    // 后台作业结算：done 必须在 settle（completed 入队/收尾记录）之后 resolve，
    // 否则 notifier 可能早于状态登记投递，wait/stop 的清理会与投递竞争。
    let resolveJobDone: ((outcome: JobOutcome) => void) | undefined;
    const jobDone = new Promise<JobOutcome>((resolve) => {
      resolveJobDone = resolve;
    });

    // 后台完成后的统一处理（入队通知主 Agent）
    const onSettled = () => {
      void pending.then(
        async (result) => {
          try {
            // 结算静默门：子会话队列里还有接续投递（inject 消息将驱动新回合）时，
            // 等「队列排空 + 流空闲」再结算。Job 终态、完成通知与 closedAt 全部顺延，
            // 主代理不会在子代理仍在处理补充指令时提前收到"已完成"（zcode 同语义：
            // 通知挂任务终态，不挂单次回合）。
            await this.waitForSubAgentQuiesce(subSessionId);
            await this.settle(subSessionId, result, parentSessionId, lifecycle);
          } catch (error) {
            this.logger.error(`子 Agent 结算失败: ${subSessionId}`, error);
          } finally {
            resolveJobDone?.(toJobOutcome(result));
            this.releaseLifecycle(subSessionId, lifecycle);
          }
        },
        async (error) => {
          // 基建故障（startStream 失败）也编码为一条 error 结果，走同一结算通道
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorResult: SubAgentResult = {
            subSessionId,
            status: "error",
            stopReason: "error",
            content: "",
            error: errorMsg,
          };
          try {
            await this.waitForSubAgentQuiesce(subSessionId);
            await this.settle(subSessionId, errorResult, parentSessionId, lifecycle);
          } catch (settleError) {
            this.logger.error(`子 Agent 结算失败: ${subSessionId}`, settleError);
          } finally {
            resolveJobDone?.(toJobOutcome(errorResult));
            this.releaseLifecycle(subSessionId, lifecycle);
          }
        },
      );
    };

    if (mode === "background") {
      const name = await this.getSubAgentName(subSessionId);
      // 注册失败（配额满等）直接抛错：子 Agent 不注册 job 就不让跑，
      // 否则配额被回退路径架空，且模型管不到这个进程。
      // 此时流已启动（pending 先行），必须同步回收 running/inbox/lifecycle 并取消流，
      // 否则 registerSubAgentJob 抛错会让这个 run 永久泄漏。
      let jobId: JobId | undefined;
      try {
        jobId = this.registerSubAgentJob(
          subSessionId,
          parentSessionId,
          name,
          jobDone,
        );
      } catch (error) {
        state.running.delete(subSessionId);
        this.cleanupParentStateIfEmpty(parentSessionId);
        this.clearInbox(subSessionId, "job 注册失败");
        this.releaseLifecycle(subSessionId, lifecycle);
        this.chatRunnerService.cancelStream(subSessionId);
        throw error;
      }
      // 先登记 job 再接 pending：避免 pending 先结算、wait 先取走结果时产生 job 重复通知。
      onSettled();
      return { subSessionId, status: "running", content: "", jobId };
    }

    // 前台模式：等待结果，超时 20 分钟转后台
    const FOREGROUND_TIMEOUT_MS = 20 * 60 * 1000;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => {
        if (!settled) resolve("timeout");
      }, FOREGROUND_TIMEOUT_MS);
    });

    try {
      const raceResult = await Promise.race([
        pending.then(
          (r) => ({ kind: "completed" as const, result: r }),
          (e) => ({
            kind: "error" as const,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
        timeoutPromise.then(() => ({ kind: "timeout" as const })),
      ]);

      settled = true;

      if (raceResult.kind === "completed") {
        // 前台完成（含 abort 导致的 resolve）：直接返回结果
        // abort 时 runSubAgentStream 的监听器已 cancelStream + resolve error result
        state.running.delete(subSessionId);
        this.cleanupParentStateIfEmpty(parentSessionId);
        // 前台不经过 settle：在这里即时回传终态，先完成的子代理行不必等整批结果
        await this.publishToolStatus(
          subSessionId,
          isSubAgentError(raceResult.result) ? "error" : "completed",
          {
            stopReason: raceResult.result.stopReason,
            error: raceResult.result.error,
          },
        );
        // 结果已作为工具结果交付，记录本次运行结束（fire-and-forget，失败仅告警）。
        // 记录完成后才释放收尾屏障：deliver 不会在收尾与开新回合之间夹入脏状态。
        void this.markRunEnded(
          subSessionId,
          parentSessionId,
          raceResult.result,
        ).finally(() => this.releaseLifecycle(subSessionId, lifecycle));
        return raceResult.result;
      }

      if (raceResult.kind === "error") {
        // startStream 本身失败（如会话不存在）
        state.running.delete(subSessionId);
        this.cleanupParentStateIfEmpty(parentSessionId);
        await this.publishToolStatus(subSessionId, "error", {
          stopReason: "error",
          error: raceResult.error,
        });
        const errorResult: SubAgentResult = {
          subSessionId,
          status: "error",
          stopReason: "error",
          content: "",
          error: raceResult.error,
          finishReason: "error",
        };
        void this.markRunEnded(
          subSessionId,
          parentSessionId,
          errorResult,
        ).finally(() => this.releaseLifecycle(subSessionId, lifecycle));
        return errorResult;
      }

      // 超时：转后台，pending 完成后入队
      const name = await this.getSubAgentName(subSessionId);
      // 注册失败（配额满等）直接抛错——此时子 Agent 已跑了一轮，结果会随错误返回，
      // 不再产生模型管不到的无 job 后台会话。已跑的轮次挂无 job 结算（信箱回退），
      // 防止 state.running/lifecycle 泄漏。
      try {
        const jobId = this.registerSubAgentJob(
          subSessionId,
          parentSessionId,
          name,
          jobDone,
        );
        // 先登记 job 再接 pending，避免 wait 先取走结果时 job 仍发完成通知。
        onSettled();
        return {
          subSessionId,
          status: "running",
          content: "",
          jobId,
          error: `Sub-agent exceeded ${FOREGROUND_TIMEOUT_MS / 60_000}-minute foreground timeout and was moved to background.`,
        };
      } catch (error) {
        onSettled();
        throw error;
      }
    } finally {
      // 清理定时器
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private getOrCreateState(parentSessionId: string): ParentSessionState {
    let state = this.states.get(parentSessionId);
    if (!state) {
      state = { running: new Set(), completed: [], completers: [] };
      this.states.set(parentSessionId, state);
    }
    return state;
  }

  /**
   * 父会话状态为空（无运行中 / 无已完成 / 无等待者）时移除，防止 Map 泄漏
   */
  private cleanupParentStateIfEmpty(parentSessionId: string): void {
    const state = this.states.get(parentSessionId);
    if (
      state &&
      state.completed.length === 0 &&
      state.completers.length === 0 &&
      state.running.size === 0
    ) {
      this.states.delete(parentSessionId);
    }
  }

  /** 为一次 run 建收尾屏障（executeSubAgentStream 专属） */
  private createLifecycle(subSessionId: string): SubAgentRunLifecycle {
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const lifecycle: SubAgentRunLifecycle = {
      finishing: false,
      stopped: false,
      done,
      resolveDone,
    };
    this.lifecycles.set(subSessionId, lifecycle);
    return lifecycle;
  }

  /** run 的结算/收尾记录全部完成后释放对应屏障（幂等，不释放后续新 run） */
  private releaseLifecycle(
    subSessionId: string,
    expected?: SubAgentRunLifecycle,
  ): void {
    const lifecycle = this.lifecycles.get(subSessionId);
    if (!lifecycle || (expected && lifecycle !== expected)) return;
    this.lifecycles.delete(subSessionId);
    lifecycle.resolveDone();
  }

  /**
   * 丢弃指定子会话的待投递消息（stop/kill/注册失败等终态路径），返回丢弃条数。
   *
   * 补充消息现在存放在子会话的通用队列里，因此这里清的是该队列；
   * 没有注入队列（测试/嵌入）时无操作。
   */
  private clearInbox(subSessionId: string, reason: string): number {
    if (!this.userInputQueue) return 0;
    const count = this.userInputQueue.getCount(subSessionId);
    if (count === 0) return 0;
    this.userInputQueue.clearSession(subSessionId);
    this.logger.warn(
      `子 Agent 待投递消息被丢弃(${reason}): ${subSessionId}, 共 ${count} 条`,
    );
    return count;
  }

  /**
   * 运行子 Agent 的本次执行
   *
   * 补充消息不再由本方法续轮：它们进入子会话的通用队列，由
   * ChatRunner 的队列消费开启新回合（与人类用户输入同一条路径）。
   * 本方法只负责首轮执行 + 结果推导；Job 结算时机由 settle 决定。
   */
  private async runSubAgentRounds(
    subSessionId: string,
    firstContent: string,
    parentSessionId: string,
    abortSignal: AbortSignal | undefined,
    lifecycle: SubAgentRunLifecycle,
  ): Promise<SubAgentResult> {
    const result = await this.runSubAgentStream(
      subSessionId,
      firstContent,
      parentSessionId,
      abortSignal,
    );
    // 与 deliver 的同步检查互斥：置位必须在同一同步段内（无 await 间隔）
    lifecycle.finishing = true;
    return result;
  }

  /**
   * 记录「本次运行结束」（唯一生命周期收尾动作）
   *
   * fire-and-forget：清理失败仅记录日志，不吞没已交付的业务结果。
   * result 用于向 subagent.run_ended 事件携带结束原因与结果摘要。
   *
   * 关键语义：这不是「关闭会话」，会话没有关闭态。写 closedAt 只是记下
   * 「最近一次运行结束时间」供展示；继续交互（job_send）不受它影响。
   */
  private markRunEnded(
    subSessionId: string,
    parentSessionId: string,
    result?: SubAgentResult,
  ): Promise<void> {
    return this.recordRunEnd(subSessionId, parentSessionId, {
      stopReason: result
        ? result.stopReason ??
          (result.status === "error" ? "error" : "completed")
        : undefined,
      content: result?.content,
    }).catch((err) => {
      this.logger.error(
        `子 Agent 运行结束记录失败: ${subSessionId}`,
        err instanceof Error ? err.stack : err,
      );
    });
  }

  /**
   * 写入「最近一次运行结束」时间戳并广播 subagent.run_ended。
   *
   * closedAt 非空 => 该子会话上一次运行已结束（仅供展示/回放判断）。
   * 它不表示会话被销毁，也不阻止后续 sendMessage/job_send 开新回合；
   * 生命周期判定一律看活跃流，不看本字段。
   */
  private async recordRunEnd(
    subSessionId: string,
    parentSessionId: string,
    extra?: { stopReason?: string; content?: string },
  ): Promise<void> {
    const closedAt = new Date().toISOString();
    await this.sessionStore.update(subSessionId, {
      closedAt,
      closeReason: extra?.stopReason ?? null,
    });

    this.eventBus.emit("subagent.run_ended", {
      sessionId: parentSessionId,
      timestamp: closedAt,
      payload: {
        subSessionId,
        closedAt,
        ...(extra?.stopReason ? { stopReason: extra.stopReason } : {}),
        ...(extra?.content
          ? { content: safeTruncate(extra.content, 200) }
          : {}),
      },
    });

    this.logger.log(`子 Agent 运行结束: ${subSessionId}`);
  }

  /**
   * 判断子 Agent 是否正在运行
   *
   * 以 SessionStreamManager 中的活跃流状态为真实来源，
   * 支持感知所有方式启动的子 Agent（spawn 或用户直接交互）。
   */
  private isSubAgentRunning(subSessionId: string): boolean {
    return this.chatRunnerService.hasActiveStream(subSessionId);
  }

  /**
   * 从数据库获取子 Agent 名称
   */
  private async getSubAgentName(subSessionId: string): Promise<string> {
    const session = await this.sessionStore.get(subSessionId);
    return session?.title || "Unknown Sub-Agent";
  }

  /**
   * wait 取走 completed 后的交付收尾：
   * - 有 jobId：markReported 触发 onReported，由它清 completed/jobIds 并补记录运行结束；
   * - 无 jobId（Registry 未接入/注册失败）：走旧路径，这里直接补记录。
   */
  private finalizeCompletedDelivery(
    parentSessionId: string,
    items: ParentSessionState["completed"],
  ): void {
    for (const item of items) {
      if (item.jobId && this.jobRegistry) {
        this.jobRegistry.markReported(item.jobId);
      } else {
        void this.markRunEnded(
          item.subSessionId,
          parentSessionId,
          item.result,
        );
      }
    }
  }

  /**
   * 等待子 Agent 完成（阻塞）
   *
   * 供主 Agent 通过工具调用主动等待子 Agent 执行结果。
   * 任意一个子 Agent 完成即可返回所有已完成的子 Agent ID 及完整输出。
   * 若全部完成则立刻返回空数组告知没有进行中的任务。
   */
  async waitForComplete(
    parentSessionId: string,
    timeoutMs = 120000,
    abortSignal?: AbortSignal,
  ): Promise<{ subSessionId: string; name: string; result: SubAgentResult }[]> {
    // 如果已收到中止信号，立即返回空数组
    if (abortSignal?.aborted) {
      return [];
    }

    const state = this.states.get(parentSessionId);

    // 如果有已完成的子 Agent，取出全部返回
    if (state && state.completed.length > 0) {
      const items = [...state.completed];
      state.completed = [];
      this.finalizeCompletedDelivery(parentSessionId, items);

      // 清理空状态（运行中也为空时才清理）
      this.cleanupParentStateIfEmpty(parentSessionId);
      // 队列中的消息通过 isValid 检测到 state.completed 已清空，processQueue 自动丢弃
      return items;
    }

    // 无运行中的子 Agent 且无已完成结果 → 立即返回空数组
    if (state && state.running.size === 0) {
      return [];
    }

    // 确保状态存在，用于注册 completer
    const activeState = this.getOrCreateState(parentSessionId);

    // 等待任意一个子 Agent 完成（支持 abortSignal 中止）
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeCompleter(parentSessionId, completer);
        reject(new Error("Timeout waiting for sub-agent to complete."));
      }, timeoutMs);

      // 监听 abortSignal，中止时清理并返回空数组
      const onAbort = () => {
        clearTimeout(timeout);
        this.removeCompleter(parentSessionId, completer);
        resolve([]);
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      const completer: SubAgentCompleter = {
        resolve: () => {
          clearTimeout(timeout);
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          const completed = [...activeState.completed];
          activeState.completed = [];
          this.finalizeCompletedDelivery(parentSessionId, completed);
          resolve(completed);
        },
        reject: (error) => {
          clearTimeout(timeout);
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          reject(error);
        },
      };
      activeState.completers.push(completer);
    });
  }

  /**
   * 停止子 Agent 的当前运行（不关闭会话）。
   *
   * 对齐 zcode TaskStop：只终止「这一次 execution」，会话本身、历史与
   * 后续可续聊能力全部保留。停止后 closedAt 记下结束时间，仅作展示。
   *
   * @param parentSessionId 父会话 ID
   * @param subSessionId 子 Agent 会话 ID
   */
  async stopSubAgent(
    parentSessionId: string,
    subSessionId: string,
  ): Promise<void> {
    // 主动停止不产生完成通知；同时触发 completed/jobIds 清理。
    this.suppressSubAgentJob(subSessionId);

    const lifecycle = this.lifecycles.get(subSessionId);
    // 先标记 finishing，阻止新的 deliver 在停止清理期间排入本 run。
    if (lifecycle) lifecycle.finishing = true;
    if (lifecycle) lifecycle.stopped = true;
    const stateForStop = this.states.get(parentSessionId);
    stateForStop?.running.delete(subSessionId);

    // 停止终态先仲裁，再尝试通知父流。父流已结束时通知无需也无法补入；
    // 子会话的 ended 快照会在父会话重同步时恢复 UI 状态。
    await this.publishToolStatus(subSessionId, "error", {
      stopReason: "stopped",
    });

    // 停止是本次运行的终态：未消费的接续投递随之丢弃（运行中注入无意义），
    // 清空子会话队列让结算静默门立即就绪
    this.clearInbox(subSessionId, "stop/kill");
    this.releaseQuiesceWaiters(subSessionId);

    // 如果子 Agent 正在运行，取消流并从运行中集合移除
    // 后续 finalizeSubAgent 因 lifecycle.stopped / running 不存在而早退
    if (this.isSubAgentRunning(subSessionId)) {
      this.logger.log(`子 Agent 运行中，取消流: ${subSessionId}`);
      this.chatRunnerService.cancelStream(subSessionId);

      // 等待流完全停止（最多 30s），避免直接删除数据库导致异常
      const deadline = Date.now() + 30000;
      while (this.isSubAgentRunning(subSessionId) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (this.isSubAgentRunning(subSessionId)) {
        this.logger.warn(
          `子 Agent 流在 30s 内未完全停止，仍继续清理: ${subSessionId}`,
        );
      }
    }

    // 清理 state 中该子 Agent 的残留（completed 中的条目、completers）
    // 此时 finalizeSubAgent 已被跳过，settle 推入的条目需手动清理
    // 队列中的消息通过 isValid 检测到 state.completed 已清空，processQueue 自动丢弃
    const state = this.states.get(parentSessionId);
    if (state) {
      state.completed = state.completed.filter(
        (c) => c.subSessionId !== subSessionId,
      );
      // 通知所有等待者，避免挂起
      for (const completer of state.completers) {
        completer.resolve();
      }
      state.completers = [];
      this.cleanupParentStateIfEmpty(parentSessionId);
    }

    // 记录本次运行结束并广播事件（手动 stop → stopReason=stopped）
    await this.recordRunEnd(subSessionId, parentSessionId, {
      stopReason: "stopped",
    });

    // 收尾完成后释放屏障（幂等；onSettled 路径可能已释放）
    this.releaseLifecycle(subSessionId, lifecycle);

    this.logger.log(`子 Agent 已停止: ${subSessionId}`);
  }

  /**
   * 获取当前父会话下的子 Agent 列表。
   *
   * 从数据库查询所有子 Agent 会话，结合内存状态判断是否正在运行。
   * 系统重启后内存状态丢失，但仍能从数据库获取子 Agent 列表：
   * 「是否运行」只看活跃流，运行过与否由 close_reason 派生。
   *
   * @param parentSessionId 父会话 ID
   * @returns 子 Agent 列表，包含 subSessionId、名称、状态
   */
  async getSubAgents(
    parentSessionId: string,
  ): Promise<{ subSessionId: string; name: string; status: string }[]> {
    // 从数据库查询所有子 Agent 会话
    const dbSessions = await this.sessionStore.childrenOf(parentSessionId);

    // 从内存状态获取已完成的子 Agent
    const state = this.states.get(parentSessionId);

    const agents: { subSessionId: string; name: string; status: string }[] = [];

    for (const session of dbSessions) {
      let status = "completed";
      if (this.isSubAgentRunning(session.id)) {
        status = "running";
      } else if (session.closeReason && session.closeReason !== "completed") {
        // 上一次运行非正常收尾（error/aborted/max_tokens/refusal/stopped）
        status = "error";
      } else if (state) {
        const completed = state.completed.find(
          (c) => c.subSessionId === session.id,
        );
        if (completed) {
          status = completed.result.status;
        }
      }
      agents.push({
        subSessionId: session.id,
        name: session.title || "Sub-Agent",
        status,
      });
    }

    return agents;
  }

  private removeCompleter(
    parentSessionId: string,
    completer: SubAgentCompleter,
  ): void {
    const state = this.states.get(parentSessionId);
    if (!state) return;
    const index = state.completers.indexOf(completer);
    if (index >= 0) state.completers.splice(index, 1);
    this.cleanupParentStateIfEmpty(parentSessionId);
  }

  /**
   * 为后台子 Agent 注册通用作业。
   *
   * Registry 未注入（测试/嵌入场景直接 new）时返回 undefined；注册抛错（配额满等）
   * 一律向上抛——子 Agent 不注册 job 就不让跑，否则配额被回退路径架空，
   * 且模型管不到（job_stop/job_list 都查不到）这个进程。
   * done 在 settle 完成后 resolve，保证 state.completed 已登记、清理已执行。
   */
  private registerSubAgentJob(
    subSessionId: string,
    parentSessionId: string,
    name: string,
    done: Promise<JobOutcome>,
  ): JobId | undefined {
    if (!this.jobRegistry) return undefined;
    const existing = this.jobIds.get(subSessionId);
    if (existing) return existing;

    const jobId = this.jobRegistry.start({
      kind: "subagent",
      label: name,
      sessionId: parentSessionId,
      handle: subSessionId,
      notify: true,
      read: (opts) => this.readSubAgentJobOutput(subSessionId, opts),
      cancel: () => {
        // stopSubAgent 会移除 running、清理 completed、记录运行结束；
        // finalizeSubAgent 因 running 不存在而早退，不会投递脏消息。
        void this.stopSubAgent(parentSessionId, subSessionId).catch(
          (error) => {
            this.logger.error(
              `job cancel 停止子 Agent 失败: ${subSessionId}`,
              error,
            );
          },
        );
      },
      send: (input) =>
        // 运行中 → steer inbox（下一工具轮注入）；空闲 → 直接开新回合。
        // 回执经 JobRegistry.send 透传给 job_send（steered/started/queued）。
        this.deliver({
          parentSessionId,
          sessionId: subSessionId,
          message: input,
        }),
      onReported: () =>
        this.handleSubAgentJobReported(subSessionId, parentSessionId, jobId),
      onDisposed: () =>
        this.handleSubAgentJobReported(subSessionId, parentSessionId, jobId),
      done,
    });

    this.jobIds.set(subSessionId, jobId);
    this.attachJobIdToCompleted(subSessionId, parentSessionId, jobId);
    return jobId;
  }

  /** 子 Agent 的 job_read 读取的是最终 assistant 文本，不是完整对话流水。 */
  private async readSubAgentJobOutput(
    subSessionId: string,
    opts: JobReadOptions,
  ): Promise<JobOutputRead> {
    const derived = await this.readSubAgentResult(subSessionId);
    return sliceJobText(derived.content ?? "", opts);
  }

  /** 结算晚于 job 注册时，把 jobId 补进已入队的 completed 条目。 */
  private attachJobIdToCompleted(
    subSessionId: string,
    parentSessionId: string,
    jobId: JobId,
  ): void {
    const entry = this.states
      .get(parentSessionId)
      ?.completed.find((c) => c.subSessionId === subSessionId);
    if (!entry) return;
    entry.jobId = jobId;
    entry.result.jobId = jobId;
  }

  /**
   * 结果已被 read/wait/通知消费，或 job 被 TTL/dispose 移除：
   * 清理 completed 条目与 jobId 映射，并补记录运行结束。
   */
  private handleSubAgentJobReported(
    subSessionId: string,
    parentSessionId: string,
    jobId: JobId,
  ): void {
    // 旧 job 的 TTL/dispose 不得清理同一子会话的新一轮 job。
    const currentJobId = this.jobIds.get(subSessionId);
    if (currentJobId !== jobId) return;
    this.jobIds.delete(subSessionId);
    // 结算没走到（如被主动停止）时兜底清理，避免 toolLinks 泄漏
    this.toolLinks.delete(subSessionId);
    const state = this.states.get(parentSessionId);
    const entry = state?.completed.find(
      (c) => c.subSessionId === subSessionId,
    );
    if (state && entry) {
      state.completed = state.completed.filter(
        (c) => c.subSessionId !== subSessionId,
      );
      this.cleanupParentStateIfEmpty(parentSessionId);
    }
    if (!this.isSubAgentRunning(subSessionId)) {
      // 运行中的 stop/kill 由 stopSubAgent 在流停止后记录运行结束，避免提前给活跃会话打 closedAt。
      void this.markRunEnded(
        subSessionId,
        parentSessionId,
        entry?.result,
      );
    }
  }

  /** 主动 close / kill 时抑制完成通知。 */
  private suppressSubAgentJob(subSessionId: string): void {
    const jobId = this.jobIds.get(subSessionId);
    if (!jobId || !this.jobRegistry) return;
    this.jobRegistry.markReported(jobId);
  }

  /**
   * 子代理终态即时回传前端。
   *
   * 同批工具由 executeBatch 并发执行，但 tool_calls_response 只在整批结束后发布；
   * 本事件让每个子代理在 settle/close 时独立转态。发送失败只告警，不影响结算。
   */
  private async publishToolStatus(
    subSessionId: string,
    status: "completed" | "error",
    extra?: { stopReason?: string; error?: string },
  ): Promise<void> {
    const link = this.toolLinks.get(subSessionId);
    if (!link) return;
    this.toolLinks.delete(subSessionId);
    try {
      await link.parentContext.publishStream({
        type: "subagent_status",
        toolCallId: link.toolCallId,
        subSessionId,
        status,
        ...(extra?.stopReason ? { stopReason: extra.stopReason } : {}),
        ...(extra?.error ? { error: extra.error } : {}),
      });
    } catch (error) {
      this.logger.warn(
        `子代理状态事件发送失败: ${subSessionId}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * 子 Agent 结算单通道（对齐 DSH run-settlement）
   *
   * 完成与失败统一为一条 SubAgentResult（含结构化 stopReason），
   * 由 finalizeSubAgent 决定交付方式（completer 直传 / 信箱投递）。
   */
  private async settle(
    subSessionId: string,
    result: SubAgentResult,
    parentSessionId: string,
    lifecycle: SubAgentRunLifecycle,
  ): Promise<void> {
    if (!lifecycle || lifecycle.stopped || this.lifecycles.get(subSessionId) !== lifecycle) return;
    const state = this.states.get(parentSessionId);
    if (!state || !state.running.has(subSessionId)) return;

    const name = await this.getSubAgentName(subSessionId);
    // stopSubAgent may win while the database lookup is pending.
    if (
      lifecycle.stopped ||
      this.lifecycles.get(subSessionId) !== lifecycle ||
      !state.running.has(subSessionId)
    ) return;

    const jobId = this.jobIds.get(subSessionId);
    if (jobId) result.jobId = jobId;

    // 即时转态：同批其它子代理可能还在跑，不能等整批 tool_calls_response
    const isError = isSubAgentError(result);
    await this.publishToolStatus(
      subSessionId,
      isError ? "error" : "completed",
      { stopReason: result.stopReason, error: result.error },
    );

    state.completed.push({ subSessionId, name, result, jobId });

    await this.finalizeSubAgent(subSessionId, parentSessionId, state, name, {
      result,
      jobId,
    });
  }

  /**
   * settle 共同的收尾逻辑
   *
   * 后台路径的清理时机必须晚于结果交付：
   * - 有等待者：结果经 completer 直接交付 → resolve 后立即记录运行结束
   * - 无等待者（信箱）：主 Agent 消费消息（onConsumed）后才记录结束时间。
   *   不能提前删：isValid 依赖 state.completed 含该条目，提前清理会导致
   *   信箱消息被 processQueue 当作脏消息丢弃，结果永远无法送达主 Agent
   */
  private async finalizeSubAgent(
    subSessionId: string,
    parentSessionId: string,
    state: ParentSessionState | undefined,
    name: string,
    options: {
      result: SubAgentResult;
      jobId?: JobId;
    },
  ): Promise<void> {
    // 如果子 Agent 不在运行中集合（已被 stopSubAgent 移除），说明被主动停止，跳过所有后续处理
    if (!state?.running.has(subSessionId)) return;

    // 从运行中集合移除
    state.running.delete(subSessionId);

    const result = options.result;
    // 停止原因缺失时按 status 推导（兼容旧结算路径）；aborted/max_tokens/refusal 均视为失败态
    const isError =
      result.status === "error" ||
      (result.stopReason !== undefined && result.stopReason !== "completed");

    // 有等待者时直接通传，不投递消息
    if (state.completers.length > 0) {
      for (const completer of state.completers) {
        completer.resolve();
      }
      state.completers = [];

      this.cleanupParentStateIfEmpty(parentSessionId);
      // 结果已通过 completer 交付给主 Agent，记录运行结束
      this.markRunEnded(subSessionId, parentSessionId, result);
      return;
    }

    // 有 jobId：完成通知由 JobRegistry/JobNotifier 统一投递，这里不再写信箱，
    // 避免同一次完成产生两条 reminder。
    if (options.jobId) return;

    // 无 jobId（Registry 未注入：测试/嵌入场景）→ 投递消息到信箱
    // P5b：只保留 <system_reminder> 包裹的模型面内容（用户文案已移除——文案混入
    // LLM 上下文会被误判为用户发言；展示全靠前端解析 source.kind 渲染为通知样式）。
    const reminderDetail = isError
      ? `Sub-agent "${name}" (${subSessionId}) failed${result.stopReason ? `, stopReason: ${result.stopReason}` : ""}${result.error ? `\nError: ${result.error}` : ""}`
      : `Sub-agent "${name}" (${subSessionId}) completed${result.stopReason ? `, stopReason: ${result.stopReason}` : ""}${result.finishReason ? `, finishReason: ${result.finishReason}` : ""}`;

    const resultText = result.content
      ? `${reminderDetail}\nResult:\n${safeTruncate(result.content, 1000)}${result.content.length > 1000 ? "..." : ""}`
      : reminderDetail;

    await this.chatRunnerService
      .enqueueMessage({
        sessionId: parentSessionId,
        blocks: [
          {
            type: "text",
            text: `<system_reminder>\n${resultText}\n</system_reminder>`,
          },
        ],
        // 结构化标识进 source（merge-extensible；systemPayload 已移除）
        source: { kind: "sub_agent", subSessionId, agentName: name },
        isValid: () => {
          const s = this.states.get(parentSessionId);
          return (
            !!s && s.completed.some((c) => c.subSessionId === subSessionId)
          );
        },
        onConsumed: () => {
          const s = this.states.get(parentSessionId);
          if (!s) return;
          const entry = s.completed.find(
            (c) => c.subSessionId === subSessionId,
          );
          s.completed = s.completed.filter(
            (c) => c.subSessionId !== subSessionId,
          );
          this.cleanupParentStateIfEmpty(parentSessionId);
          // 主 Agent 已消费结果，此时才记录运行结束
          // 运行中（deliver 已开新回合）不记录：避免给活跃会话打 closedAt
          if (!this.isSubAgentRunning(subSessionId)) {
            this.markRunEnded(
              subSessionId,
              parentSessionId,
              entry?.result,
            );
          }
        },
      })
      .catch((error) => {
        this.logger.error(`投递子Agent结果失败: ${subSessionId}`, error);
      });
  }

  /**
   * P1：子 Agent 结果从会话日志重放推导（对齐 DSH finalAssistantOutput）
   *
   * 以子会话 JSONL 为单一事实源：取最后一条非空 assistant 消息的可见文本与推理内容。
   * - 取消/截断后部分内容仍落库（agent-engine 中断路径照常 appendMessages）→ 部分答案可回传
   * - 不再依赖流回调的 messageId 时序启发式；结果与落盘历史/前端展示逐字节一致
   * 失败时返回空内容（调用方回退到流累积文本），绝不抛错中断结算
   */
  private async readSubAgentResult(
    subSessionId: string,
  ): Promise<{ content: string; reasoningContent?: string }> {
    try {
      const messages = await this.messageStore.loadContext({
        sessionId: subSessionId,
        keepReasoningContent: true,
      });
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== "assistant") continue;
        const text = m.content
          .filter((b): b is TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        const reasoning = m.content
          .filter((b): b is ReasoningBlock => b.type === "reasoning")
          .map((b) => b.summary)
          .join("");
        if (text.trim() || reasoning.trim()) {
          return {
            content: text,
            reasoningContent: reasoning.trim() ? reasoning : undefined,
          };
        }
      }
      return { content: "" };
    } catch (err) {
      this.logger.warn(
        `子 Agent 结果重放失败，回退流累积文本: ${subSessionId}`,
        err instanceof Error ? err.message : err,
      );
      return { content: "" };
    }
  }

  /**
   * 运行子 Agent 流式执行（内部方法）
   *
   * P1（对齐 DSH）：流回调只负责中止/状态/原因，结果内容由子会话日志重放推导
   * （readSubAgentResult）。不再依赖 messageId 变化的时序启发式；
   * 取消/截断后部分内容仍落库，可稳定回传。重放失败时降级到流累积文本。
   */
  private async runSubAgentStream(
    subSessionId: string,
    task: string,
    parentSessionId: string,
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve, reject) => {
      // 结算态：流回调更新；settle() 统一从日志重放推导内容后 resolve（幂等）
      let status: "completed" | "error" = "completed";
      let stopReason: SubAgentStopReason | undefined;
      let finishReason: string | undefined;
      let errorMsg: string | undefined;
      // 兜底文本：重放失败/中止竞态时回退（仅作降级，非主路径）
      let fallbackContent = "";
      let settled = false;

      const settle = async (): Promise<void> => {
        if (settled) return;
        settled = true;
        const derived = await this.readSubAgentResult(subSessionId);
        resolve({
          subSessionId,
          status,
          stopReason,
          content: derived.content || fallbackContent,
          reasoningContent: derived.reasoningContent,
          finishReason,
          error: errorMsg,
        });
      };

      // 父 Agent 中止时同步取消子 Agent 流
      if (abortSignal) {
        if (abortSignal.aborted) {
          status = "error";
          stopReason = "aborted";
          errorMsg = "Parent agent was aborted";
          void settle();
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => {
            status = "error";
            stopReason = "aborted";
            errorMsg = "Parent agent was aborted";
            this.chatRunnerService.cancelStream(subSessionId);
            // 竞态说明：中止后主循环可能仍在落盘最后一条 assistant 消息，
            // 此时重放可能读不到它 → settle 内回退到 fallbackContent
            void settle();
          },
          { once: true },
        );
      }

      this.chatRunnerService
        .startStream(
          {
            sessionId: subSessionId,
            userMessage: {
              content: task,
            },
            regenerationMode: "overwrite",
          },
          {
            onEvent: (event) => {
              if (event.type === "text_delta") {
                fallbackContent += event.text;
              }
              if (event.type === "turn_end") {
                status = event.error ? "error" : "completed";
                stopReason = event.error
                  ? "error"
                  : mapFinishReason(event.finishReason);
                finishReason = event.finishReason;
                errorMsg = event.error;
              }
            },
            onComplete: (reason) => {
              // 如果是用户取消或错误，构造对应的错误结果
              if (reason === "user_cancel" || reason === "error") {
                status = "error";
                stopReason = reason === "user_cancel" ? "aborted" : "error";
                errorMsg =
                  reason === "user_cancel"
                    ? "User cancelled"
                    : "Stream ended with error";
                finishReason = finishReason || reason;
              }
              void settle();
            },
            onError: (err: any) => {
              status = "error";
              stopReason = "error";
              errorMsg = err instanceof Error ? err.message : String(err);
              void settle();
            },
          },
        )
        .catch((err) => {
          // startStream 本身抛出异常（如会话不存在）
          const errorMsg2 = err instanceof Error ? err.message : String(err);
          reject(new Error(`Failed to start sub-agent stream: ${errorMsg2}`));
        });
    });
  }
}
