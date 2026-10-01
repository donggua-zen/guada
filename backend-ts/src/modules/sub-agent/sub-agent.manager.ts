import { Injectable, Logger, OnModuleInit, Inject } from "@nestjs/common";
import { SessionMetaStore } from "../chat/session-meta.store";
import { AgentFileStore } from "../agents/agent-file.store";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { ISessionContext } from "../chat/session-context";
import { safeTruncate } from "../../common/utils/string.utils";
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
type SubAgentStopReason =
  | "completed"
  | "aborted"
  | "error"
  | "max_tokens"
  | "refusal"
  | "closed";

/**
 * finishReason → 结构化停止原因
 *
 * error 场景由调用方显式置位（event.error / onError / abort），不走本映射；
 * 无显式原因（undefined/空）视为正常完成。
 */
function mapFinishReason(reason?: string): SubAgentStopReason {
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

/**
 * 子 Agent 执行结果
 */
export interface SubAgentResult {
  subSessionId: string;
  status: "completed" | "error" | "running";
  /** 结构化停止原因（P2；unknown 一律 error） */
  stopReason?: SubAgentStopReason;
  content: string;
  reasoningContent?: string;
  finishReason?: string;
  error?: string;
}

/**
 * 父会话下的子 Agent 状态管理
 */
interface ParentSessionState {
  // 正在运行的子 Agent sessionId 集合（由 executeSubAgentStream 维护）
  running: Set<string>;
  // 已完成的子 Agent（携带完整输出结果）
  completed: { subSessionId: string; name: string; result: SubAgentResult }[];
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
 * 2. 生命周期 lifecycle：one_shot（默认）= 结果交付后自动冻结子会话（保留供回放），无需 AI 调用 close；
 *    persist = 保留会话供 send_message 继续交互，由 AI 主动 close
 * 3. 内部通过 startStream 的 callbacks 监听完成，自动广播 sub_agent_finish
 * 4. waitForComplete：供主 Agent 主动等待子 Agent 完成
 */
@Injectable()
export class SubAgentManager implements OnModuleInit {
  private readonly logger = new Logger(SubAgentManager.name);
  private readonly states = new Map<string, ParentSessionState>();

  constructor(
    private sessionStore: SessionMetaStore,
    private chatRunnerService: ChatRunnerService,
    private eventBus: EventBusService,
    private agentStore: AgentFileStore,
    @Inject(MESSAGE_STORE_TOKEN) private messageStore: IMessageStore,
  ) {}

  onModuleInit() {
    this.logger.log("SubAgentManager initialized");
  }

  /**
   * 创建并启动子 Agent
   *
   * 前台模式（默认）：阻塞直到子 Agent 执行完毕并返回完整结果
   * 后台模式：立即返回 SubAgentResult（status=running），后续通过 waitForComplete 获取结果
   *
   * 生命周期（默认 one_shot）：
   * - one_shot：结果交付后自动冻结子会话（保留供回放；前台=结果返回时；后台=信箱消息被消费时）
   * - persist：保留会话，由 AI 通过 subagent_manager close 释放
   */
  async spawn(
    params: {
      parentContext: ISessionContext;
      name: string;
      task: string;
      agentId?: string;
      lifecycle?: "persist" | "one_shot";
      /** 派生这次子代理的工具调用 id：据此发布 subagent_link 流事件（可选，非工具路径不传） */
      toolCallId?: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const { parentContext } = params;
    const parentSessionId = parentContext.sessionId;

    // 限制子代理数量：一个会话最多创建 10 个
    const subAgentCount =
      this.sessionStore.countByParentId(parentSessionId);
    if (subAgentCount >= 10) {
      throw new Error(
        "The maximum number of sub-agents (10) for this session has been reached. Please close some sub-agents before creating new ones.",
      );
    }

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
    // 安全模式：从父会话继承，防止子代理权限逃逸（如 workspace-write → danger-full-access）
    settings.sandboxMode = parentContext.getSandboxMode();
    // 附加连接配置：从父会话继承（如 ssh-connection 远程连接），使子代理可复用主代理绑定的连接
    settings.attachments = parentContext.getSettings("attachments") ?? {};
    // 生命周期持久化：重启后可通过 session.settings.lifecycle 识别 one_shot 遗留（孤儿清扫）
    settings.lifecycle = params.lifecycle || "one_shot";

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
      params.lifecycle || "one_shot",
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
    lifecycle: "persist" | "one_shot",
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
    }

    this.getOrCreateState(parentSessionId);

    return this.executeSubAgentStream(
      subSession.id,
      params.task,
      parentSessionId,
      mode,
      lifecycle,
      abortSignal,
    );
  }

  /**
   * 向已存在的子 Agent 发送消息继续交互
   *
   * 1. 验证子会话存在且属于该父会话
   * 2. 检查子 Agent 是否正在运行，若运行中则报错
   * 3. 复用 executeSubAgentStream 启动流式执行
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
    const subSession = this.sessionStore.get(params.sessionId);
    if (!subSession) {
      throw new Error("Sub-agent session does not exist.");
    }
    if (subSession.parentId !== params.parentSessionId) {
      throw new Error("Sub-agent does not belong to this parent session.");
    }
    // 已冻结（closedAt 非空）的子会话仅供回放，不再接收消息
    if (subSession.closedAt) {
      throw new Error("Sub-agent is closed (frozen for replay only).");
    }

    // 2. 检查子 Agent 是否正在运行
    if (this.isSubAgentRunning(params.sessionId)) {
      throw new Error(
        "Sub-agent is currently running. Please wait for it to complete before sending a message.",
      );
    }

    this.logger.log(
      `向子 Agent 发送消息: ${params.sessionId}, 父会话: ${params.parentSessionId}, 模式: ${mode}`,
    );

    // 3. 复用执行逻辑（send_message 针对的是仍存在的会话，生命周期必为 persist）
    return this.executeSubAgentStream(
      params.sessionId,
      params.message,
      params.parentSessionId,
      mode,
      "persist",
      abortSignal,
    );
  }

  /**
   * 为 Workflow 编排引擎创建并执行子代理（对齐 DSH workflow host → subagents.start）
   *
   * 与 spawn() 的差异：
   * - 不走 states Map / completer / 信箱：workflow 引擎自己就是等待者，
   *   结果直接经返回的 Promise 交付，绝不投递 <system_reminder> 唤醒父循环
   * - 跳过每父会话 10 个上限（并发由 workflow 引擎的槽位控制）
   * - lifecycle 固定 persist（子会话保留，供用户在概览面板工作流运行区回看执行过程）
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
      sandboxMode: parentContext.getSandboxMode(),
      attachments: parentContext.getSettings("attachments") ?? {},
      lifecycle: "persist",
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
    return this.runSubAgentStream(
      subSession.id,
      params.task,
      parentSessionId,
      abortSignal,
    );
  }

  /**
   * 执行子 Agent 流式执行（前台/后台模式）
   *
   * 统一架构（参考 shell execute）：
   * - 始终 fire-and-forget 启动 runSubAgentStream
   * - 前台模式：Promise.race 等待结果（5min 超时），完成直接返回，超时转后台
   * - 后台模式：不等待，pending 完成后入队通知
   * - one_shot 生命周期：结果交付后自动冻结子会话（前台=结果返回时；后台=信箱消费时）
   */
  private async executeSubAgentStream(
    subSessionId: string,
    content: string,
    parentSessionId: string,
    mode: "foreground" | "background",
    lifecycle: "persist" | "one_shot",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const state = this.getOrCreateState(parentSessionId);
    state.running.add(subSessionId);

    const pending = this.runSubAgentStream(
      subSessionId,
      content,
      parentSessionId,
      mode === "foreground" ? abortSignal : undefined,
    );

    // 后台完成后的统一处理（入队通知主 Agent）
    const onSettled = () => {
      pending
        .then((result) =>
          this.settle(
            subSessionId,
            result,
            parentSessionId,
            lifecycle,
          ),
        )
        .catch(async (error) => {
          // 基建故障（startStream 失败）也编码为一条 error 结果，走同一结算通道
          const errorMsg = error instanceof Error ? error.message : String(error);
          await this.settle(
            subSessionId,
            {
              subSessionId,
              status: "error",
              stopReason: "error",
              content: "",
              error: errorMsg,
            },
            parentSessionId,
            lifecycle,
          );
        });
    };

    if (mode === "background") {
      onSettled();
      return { subSessionId, status: "running", content: "" };
    }

    // 前台模式：等待结果，超时 5 分钟转后台
    const FOREGROUND_TIMEOUT_MS = 5 * 60 * 1000;
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
        // one_shot：结果已作为工具结果交付，自动冻结子会话（fire-and-forget，失败仅告警）
        this.maybeAutoDispose(
          subSessionId,
          parentSessionId,
          lifecycle,
          raceResult.result,
        );
        return raceResult.result;
      }

      if (raceResult.kind === "error") {
        // startStream 本身失败（如会话不存在）
        state.running.delete(subSessionId);
        this.cleanupParentStateIfEmpty(parentSessionId);
        const errorResult: SubAgentResult = {
          subSessionId,
          status: "error",
          stopReason: "error",
          content: "",
          error: raceResult.error,
          finishReason: "error",
        };
        this.maybeAutoDispose(
          subSessionId,
          parentSessionId,
          lifecycle,
          errorResult,
        );
        return errorResult;
      }

      // 超时：转后台，pending 完成后入队
      onSettled();
      return {
        subSessionId,
        status: "running",
        content: "",
        error:
          "Sub-agent exceeded 5-minute foreground timeout and was moved to background.",
      };
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

  /**
   * one_shot 生命周期：结果交付后自动冻结子会话
   *
   * fire-and-forget：清理失败仅记录日志，不吞没已交付的业务结果。
   * result 用于向 subagent.closed 事件携带结束原因与结果摘要。
   */
  private maybeAutoDispose(
    subSessionId: string,
    parentSessionId: string,
    lifecycle: "persist" | "one_shot",
    result?: SubAgentResult,
  ): void {
    if (lifecycle !== "one_shot") return;
    this.disposeSession(subSessionId, parentSessionId, {
      stopReason: result
        ? result.stopReason ??
          (result.status === "error" ? "error" : "completed")
        : undefined,
      content: result?.content,
    }).catch((err) => {
      this.logger.error(
        `one_shot 子 Agent 自动冻结失败: ${subSessionId}`,
        err instanceof Error ? err.stack : err,
      );
    });
  }

  /**
   * 冻结子会话并广播关闭事件（不含取消流逻辑，供 close 与 one_shot 自动清理共用）
   *
   * 冻结而非删除：closedAt 非空标记已结束，子会话保留供用户回放；
   * countByParentId 排除已冻结会话，close 仍会释放每父会话的子代理名额。
   */
  private async disposeSession(
    subSessionId: string,
    parentSessionId: string,
    extra?: { stopReason?: string; content?: string },
  ): Promise<void> {
    await this.sessionStore.update(subSessionId, {
      closedAt: new Date(),
      closeReason: extra?.stopReason ?? null,
    });

    this.eventBus.emit("subagent.closed", {
      sessionId: parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId,
        ...(extra?.stopReason ? { stopReason: extra.stopReason } : {}),
        ...(extra?.content
          ? { content: safeTruncate(extra.content, 200) }
          : {}),
      },
    });

    this.logger.log(`子 Agent 会话已冻结: ${subSessionId}`);
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
    const session = this.sessionStore.get(subSessionId);
    return session?.title || "Unknown Sub-Agent";
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
   * 关闭子 Agent：冻结会话数据、清理导出的历史文件并广播关闭事件。
   *
   * 如果子 Agent 仍在运行中，则拒绝关闭并返回错误。
   *
   * @param subSessionId 子 Agent 会话 ID
   * @param parentSessionId 父会话 ID
   * @param workspacePath 工作目录路径（子 Agent 与父 Agent 共用）
   */
  async closeSubAgent(
    subSessionId: string,
    parentSessionId: string,
    workspacePath: string,
  ): Promise<void> {
    // 如果子 Agent 正在运行，取消流并从运行中集合移除
    // 后续 finalizeSubAgent 会因 running.has() === false 直接跳过，避免脏消息入队
    if (this.isSubAgentRunning(subSessionId)) {
      this.logger.log(`子 Agent 运行中，取消流: ${subSessionId}`);
      this.chatRunnerService.cancelStream(subSessionId);

      const state = this.states.get(parentSessionId);
      state?.running.delete(subSessionId);

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

    // 冻结会话数据并广播关闭事件（手动 close → stopReason=closed）
    await this.disposeSession(subSessionId, parentSessionId, {
      stopReason: "closed",
    });

    this.logger.log(`子 Agent 已关闭: ${subSessionId}`);
  }

  /**
   * 获取当前父会话下的子 Agent 列表。
   *
   * 从数据库查询所有子 Agent 会话，结合内存状态判断是否正在运行。
   * 系统重启后内存状态丢失，但仍能从数据库获取子 Agent 列表（已结束的为 completed，已冻结的为 closed）。
   *
   * @param parentSessionId 父会话 ID
   * @returns 子 Agent 列表，包含 subSessionId、名称、状态
   */
  async getSubAgents(
    parentSessionId: string,
  ): Promise<{ subSessionId: string; name: string; status: string }[]> {
    // 从数据库查询所有子 Agent 会话
    const dbSessions = this.sessionStore.childrenOf(parentSessionId);

    // 从内存状态获取已完成的子 Agent
    const state = this.states.get(parentSessionId);

    const agents: { subSessionId: string; name: string; status: string }[] = [];

    for (const session of dbSessions) {
      let status = "completed";
      if (this.isSubAgentRunning(session.id)) {
        status = "running";
      } else if (session.closedAt) {
        // 已冻结（close / one_shot 清理后保留供回放）
        status = "closed";
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
   * 子 Agent 结算单通道（对齐 DSH run-settlement）
   *
   * 完成与失败统一为一条 SubAgentResult（含结构化 stopReason），
   * 由 finalizeSubAgent 决定交付方式（completer 直传 / 信箱投递）。
   */
  private async settle(
    subSessionId: string,
    result: SubAgentResult,
    parentSessionId: string,
    lifecycle: "persist" | "one_shot" = "persist",
  ): Promise<void> {
    const state = this.states.get(parentSessionId);
    if (!state) return;

    const name = await this.getSubAgentName(subSessionId);
    state.completed.push({ subSessionId, name, result });

    await this.finalizeSubAgent(
      subSessionId,
      parentSessionId,
      state,
      name,
      {
        result,
        lifecycle,
      },
    );
  }

  /**
   * settle 共同的收尾逻辑
   *
   * one_shot 生命周期（后台路径）的清理时机必须晚于结果交付：
   * - 有等待者：结果经 completer 直接交付 → resolve 后立即自动清理
   * - 无等待者（信箱）：主 Agent 消费消息（onConsumed）后才冻结子会话。
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
      lifecycle?: "persist" | "one_shot";
    },
  ): Promise<void> {
    // 如果子 Agent 不在运行中集合（已被 closeSubAgent 移除），说明是主动关闭，跳过所有后续处理
    if (!state?.running.has(subSessionId)) return;

    // 从运行中集合移除
    state.running.delete(subSessionId);

    const result = options.result;
    const lifecycle = options.lifecycle || "persist";
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
      // one_shot：结果已通过 completer 交付给主 Agent，自动冻结
      this.maybeAutoDispose(
        subSessionId,
        parentSessionId,
        lifecycle,
        result,
      );
      return;
    }

    // 无等待者 → 投递消息到信箱
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
          // one_shot：主 Agent 已消费结果，此时才冻结子会话
          if (lifecycle === "one_shot") {
            this.maybeAutoDispose(
              subSessionId,
              parentSessionId,
              lifecycle,
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
