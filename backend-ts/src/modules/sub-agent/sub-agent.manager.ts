import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { ISessionContext } from "../chat/session-context";
import { safeTruncate } from "../../common/utils/string.utils";

/**
 * 子 Agent 默认系统提示词
 *
 * 当子 Agent 没有自定义角色提示词时，使用此提示词作为基础身份定义。
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
 * 子 Agent 执行结果
 */
interface SubAgentResult {
  subSessionId: string;
  status: "completed" | "error" | "running";
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
 * 2. 内部通过 startStream 的 callbacks 监听完成，自动广播 sub_agent_finish
 * 3. waitForComplete：供主 Agent 主动等待子 Agent 完成
 */
@Injectable()
export class SubAgentManager implements OnModuleInit {
  private readonly logger = new Logger(SubAgentManager.name);
  private readonly states = new Map<string, ParentSessionState>();

  constructor(
    private sessionRepo: SessionRepository,
    private chatRunnerService: ChatRunnerService,
    private eventBus: EventBusService,
    private characterRepo: CharacterRepository,
  ) {}

  onModuleInit() {
    this.logger.log("SubAgentManager initialized");
  }

  /**
   * 创建并启动子 Agent
   *
   * 前台模式（默认）：阻塞直到子 Agent 执行完毕并返回完整结果
   * 后台模式：立即返回 SubAgentResult（status=running），后续通过 waitForComplete 获取结果
   */
  async spawn(
    params: {
      parentContext: ISessionContext;
      name: string;
      task: string;
      characterId?: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const { parentContext } = params;
    const parentSessionId = parentContext.sessionId;
    const userId = parentContext.userId;

    // 限制子代理数量：一个会话最多创建 10 个
    const subAgentCount =
      await this.sessionRepo.countByParentId(parentSessionId);
    if (subAgentCount >= 10) {
      throw new Error(
        "The maximum number of sub-agents (10) for this session has been reached. Please close some sub-agents before creating new ones.",
      );
    }

    // 从父会话上下文提取已合并的工具配置
    // PersistentSessionContext.mergeSettings() 已自动处理
    // sessionSettings.xxx ?? characterSettings.xxx 回退
    const inheritedPlugins = parentContext.getSettings("plugins");
    const inheritedSkillsConfig = parentContext.getSettings("skills");

    // 角色驱动的子 Agent 创建
    let finalModelId: string | null = parentContext.getModelConfig().id;
    let finalCharacterId: string | null = null;
    let finalAvatarUrl: string | undefined;

    // 配置继承策略委托给 PersistentSessionContext.mergeSettings()，
    // 它自动处理 sessionSettings.xxx ?? characterSettings.xxx 回退。
    //
    // 有角色时: 角色设定自动生效，spawn 只需设 characterId，不设重复值
    // 无角色时: 显式设置父会话的继承值作为 sessionSettings
    const settings: Record<string, any> = {};

    // 思考强度：无论是否有角色，都从父会话继承
    settings.thinkingEffort = parentContext.getSettings("thinkingEffort");
    // 运行模式：从父会话继承，防止子代理权限逃逸（如 sandbox → normal）
    settings.runMode = parentContext.getRunMode();

    if (params.characterId && params.characterId !== "generic") {
      // ── 数据库角色模式 ──
      const character = await this.characterRepo.findById(params.characterId);
      if (!character) {
        throw new Error(
          `Character "${params.characterId}" does not exist. Please check if the ID is correct or if the character has been deleted.`,
        );
      }
      finalModelId = character.modelId || parentContext.getModelConfig().id;
      finalCharacterId = params.characterId;
      finalAvatarUrl = character.avatarUrl || undefined;
      this.logger.log(
        `子 Agent 将继承角色设定: ${character.title} (${params.characterId})`,
      );
    } else {
      // ── 通用子 Agent ──
      settings.systemPrompt = SUB_AGENT_DEFAULT_PROMPT;
      settings.plugins = inheritedPlugins;
      settings.skills = inheritedSkillsConfig;
      // finalCharacterId 保持 null（不走 characterRepo）
    }

    return this.createSubSessionAndRun(
      parentContext,
      params,
      mode,
      abortSignal,
      settings,
      finalModelId,
      finalCharacterId,
      finalAvatarUrl,
    );
  }

  /**
   * 创建子会话记录、广播事件并启动执行
   * 抽离为私有方法，供普通角色和轻量 Agent 共用
   */
  private async createSubSessionAndRun(
    parentContext: ISessionContext,
    params: {
      name: string;
      task: string;
      characterId?: string;
    },
    mode: "foreground" | "background",
    abortSignal: AbortSignal | undefined,
    settings: Record<string, any>,
    modelId: string | null,
    characterId: string | null,
    avatarUrl: string | undefined,
  ): Promise<SubAgentResult> {
    const parentSessionId = parentContext.sessionId;
    const userId = parentContext.userId;

    const subSession = await this.sessionRepo.create({
      userId,
      parentId: parentSessionId,
      title: params.name,
      characterId,
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
      userId,
      sessionId: parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId: subSession.id,
        name: params.name,
        mode,
        session: subSession,
      },
    });

    this.getOrCreateState(parentSessionId);

    return this.executeSubAgentStream(
      subSession.id,
      userId,
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
   */
  async sendMessage(
    params: {
      parentSessionId: string;
      userId: string;
      sessionId: string;
      message: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    // 1. 验证子会话存在且属于该父会话
    const subSession = await this.sessionRepo.findById(params.sessionId);
    if (!subSession) {
      throw new Error("Sub-agent session does not exist.");
    }
    if (subSession.parentId !== params.parentSessionId) {
      throw new Error("Sub-agent does not belong to this parent session.");
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

    // 3. 复用执行逻辑
    return this.executeSubAgentStream(
      params.sessionId,
      params.userId,
      params.message,
      params.parentSessionId,
      mode,
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
   */
  private async executeSubAgentStream(
    subSessionId: string,
    userId: string,
    content: string,
    parentSessionId: string,
    mode: "foreground" | "background",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const state = this.getOrCreateState(parentSessionId);
    state.running.add(subSessionId);

    const pending = this.runSubAgentStream(
      subSessionId,
      userId,
      content,
      parentSessionId,
      mode === "foreground" ? abortSignal : undefined,
    );

    // 后台完成后的统一处理（入队通知主 Agent）
    const onSettled = () => {
      pending
        .then((result) =>
          this.notifyComplete(subSessionId, result, userId, parentSessionId),
        )
        .catch(async (error) => {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          await this.notifyError(
            subSessionId,
            errorMsg,
            userId,
            parentSessionId,
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
        if (
          state.completed.length === 0 &&
          state.completers.length === 0 &&
          state.running.size === 0
        ) {
          this.states.delete(parentSessionId);
        }
        return raceResult.result;
      }

      if (raceResult.kind === "error") {
        // startStream 本身失败（如会话不存在）
        state.running.delete(subSessionId);
        if (
          state.completed.length === 0 &&
          state.completers.length === 0 &&
          state.running.size === 0
        ) {
          this.states.delete(parentSessionId);
        }
        return {
          subSessionId,
          status: "error",
          content: "",
          error: raceResult.error,
          finishReason: "error",
        };
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
    const session = await this.sessionRepo.findById(subSessionId);
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
      if (state.completers.length === 0 && state.running.size === 0) {
        this.states.delete(parentSessionId);
      }
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
   * 关闭子 Agent：删除会话数据、清理导出的历史文件并广播关闭事件。
   *
   * 如果子 Agent 仍在运行中，则拒绝关闭并返回错误。
   *
   * @param subSessionId 子 Agent 会话 ID
   * @param parentSessionId 父会话 ID
   * @param userId 用户 ID
   * @param workspacePath 工作目录路径（子 Agent 与父 Agent 共用）
   */
  async closeSubAgent(
    subSessionId: string,
    parentSessionId: string,
    userId: string,
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
    // 此时 finalizeSubAgent 已被跳过，notifyComplete 推入的条目需手动清理
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
      if (state.completed.length === 0 && state.running.size === 0) {
        this.states.delete(parentSessionId);
      }
    }

    // 删除会话数据
    await this.sessionRepo.deleteById(subSessionId);

    // 广播关闭事件
    this.eventBus.emit("subagent.closed", {
      userId,
      sessionId: parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId,
      },
    });

    this.logger.log(`子 Agent 已关闭: ${subSessionId}`);
  }

  /**
   * 获取当前父会话下的子 Agent 列表。
   *
   * 从数据库查询所有子 Agent 会话，结合内存状态判断是否正在运行。
   * 系统重启后内存状态丢失，但仍能从数据库获取子 Agent 列表（状态均为 completed）。
   *
   * @param parentSessionId 父会话 ID
   * @returns 子 Agent 列表，包含 subSessionId、名称、状态
   */
  async getSubAgents(
    parentSessionId: string,
  ): Promise<{ subSessionId: string; name: string; status: string }[]> {
    // 从数据库查询所有子 Agent 会话
    const dbSessions = await this.sessionRepo.findByParentId(parentSessionId);

    // 从内存状态获取已完成的子 Agent
    const state = this.states.get(parentSessionId);

    const agents: { subSessionId: string; name: string; status: string }[] = [];

    for (const session of dbSessions) {
      let status = "completed";
      if (this.isSubAgentRunning(session.id)) {
        status = "running";
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
    if (
      state.completed.length === 0 &&
      state.completers.length === 0 &&
      state.running.size === 0
    ) {
      this.states.delete(parentSessionId);
    }
  }

  /**
   * 通知子 Agent 完成
   */
  private async notifyComplete(
    subSessionId: string,
    result: SubAgentResult,
    userId: string,
    parentSessionId: string,
  ): Promise<void> {
    const state = this.states.get(parentSessionId);
    if (!state) return;

    const name = await this.getSubAgentName(subSessionId);
    state.completed.push({ subSessionId, name, result });

    await this.finalizeSubAgent(
      subSessionId,
      parentSessionId,
      userId,
      state,
      name,
      {
        result,
      },
    );
  }

  /**
   * 通知子 Agent 执行出错
   */
  private async notifyError(
    subSessionId: string,
    errorMsg: string,
    userId: string,
    parentSessionId: string,
  ): Promise<void> {
    const state = this.states.get(parentSessionId);
    if (!state) return;

    const name = await this.getSubAgentName(subSessionId);

    await this.finalizeSubAgent(
      subSessionId,
      parentSessionId,
      userId,
      state,
      name,
      {
        errorMsg,
      },
    );
  }

  /**
   * notifyComplete / notifyError 共同的收尾逻辑
   */
  private async finalizeSubAgent(
    subSessionId: string,
    parentSessionId: string,
    userId: string,
    state: ParentSessionState | undefined,
    name: string,
    options: {
      result?: SubAgentResult;
      errorMsg?: string;
    },
  ): Promise<void> {
    // 如果子 Agent 不在运行中集合（已被 closeSubAgent 移除），说明是主动关闭，跳过所有后续处理
    if (!state?.running.has(subSessionId)) return;

    // 从运行中集合移除
    state.running.delete(subSessionId);

    const isComplete = !!options.result;
    const isError = !isComplete;

    // 有等待者时直接通传，不投递消息
    if (state.completers.length > 0) {
      for (const completer of state.completers) {
        completer.resolve();
      }
      state.completers = [];

      if (state.completed.length === 0 && state.running.size === 0) {
        this.states.delete(parentSessionId);
      }
      return;
    }

    // 无等待者 → 投递消息到信箱
    const content = isComplete
      ? `${name} has completed its work.`
      : `Sub-task "${name}" failed. Error: ${options.errorMsg}`;

    const source: any = { type: "sub_agent" };
    if (isComplete) {
      source.systemPayload = [
        {
          subSessionId,
          subAgentName: name,
          status: options.result!.status,
          finishReason: options.result!.finishReason,
          content:
            safeTruncate(options.result!.content, 1000) +
            (options.result!.content.length > 1000 ? "..." : ""),
        },
      ];
    } else {
      source.subSessionId = subSessionId;
      source.subAgentName = name;
      source.status = "error";
      source.error = options.errorMsg;
    }

    await this.chatRunnerService
      .enqueueMessage({
        sessionId: parentSessionId,
        userId,
        content,
        source,
        isValid: () => {
          const s = this.states.get(parentSessionId);
          return (
            !!s && s.completed.some((c) => c.subSessionId === subSessionId)
          );
        },
        onConsumed: () => {
          const s = this.states.get(parentSessionId);
          if (!s) return;
          s.completed = s.completed.filter(
            (c) => c.subSessionId !== subSessionId,
          );
          if (
            s.completed.length === 0 &&
            s.completers.length === 0 &&
            s.running.size === 0
          ) {
            this.states.delete(parentSessionId);
          }
        },
      })
      .catch((error) => {
        this.logger.error(`投递子Agent结果失败: ${subSessionId}`, error);
      });
  }

  /**
   * 运行子 Agent 流式执行（内部方法）
   *
   * 监听 finish 事件捕获完整输出内容，返回 SubAgentResult。
   * 注意：Agent 每次工具调用迭代都会产生 finish，只保留最后一次的完整内容。
   */
  private async runSubAgentStream(
    subSessionId: string,
    userId: string,
    task: string,
    parentSessionId: string,
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve, reject) => {
      let capturedResult: SubAgentResult = {
        subSessionId,
        status: "completed",
        content: "",
      };

      // 父 Agent 中止时同步取消子 Agent 流
      if (abortSignal) {
        if (abortSignal.aborted) {
          resolve({
            subSessionId,
            status: "error",
            content: "",
            error: "Parent agent was aborted",
          });
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => {
            this.chatRunnerService.cancelStream(subSessionId);
            resolve({
              subSessionId,
              status: "error",
              content: capturedResult.content,
              error: "Parent agent was aborted",
              finishReason: capturedResult.finishReason,
            });
          },
          { once: true },
        );
      }

      this.chatRunnerService
        .startStream(
          {
            sessionId: subSessionId,
            userId: userId,
            userMessage: {
              content: task,
            },
            regenerationMode: "overwrite",
          },
          {
            onEvent: (event) => {
              // turn_end 事件携带整个 ReAct 循环结束后的完整 content + 归一化原因
              if (event.type === "turn_end") {
                capturedResult = {
                  subSessionId,
                  status: event.error ? "error" : "completed",
                  content: event.content || "",
                  finishReason: event.finishReason,
                  error: event.error,
                };
              }
            },
            onComplete: (reason) => {
              // 如果是用户取消或错误，构造对应的错误结果
              if (reason === "user_cancel" || reason === "error") {
                resolve({
                  subSessionId,
                  status: "error",
                  content: capturedResult.content,
                  error:
                    reason === "user_cancel"
                      ? "User cancelled"
                      : "Stream ended with error",
                  finishReason: capturedResult.finishReason || reason,
                });
              } else {
                // onComplete 触发时，最后一个 finish 事件已被捕获
                resolve(capturedResult);
              }
            },
            onError: (err: any) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              resolve({
                subSessionId,
                status: "error",
                content: capturedResult.content,
                error: errorMsg,
              });
            },
          },
        )
        .catch((err) => {
          // startStream 本身抛出异常（如会话不存在）
          const errorMsg = err instanceof Error ? err.message : String(err);
          reject(new Error(`Failed to start sub-agent stream: ${errorMsg}`));
        });
    });
  }
}
