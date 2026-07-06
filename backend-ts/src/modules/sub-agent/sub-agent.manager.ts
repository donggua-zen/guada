import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import * as path from "path";
import * as fs from "fs/promises";
import { SessionRepository } from "../../common/database/session.repository";
import { MessageRepository } from "../../common/database/message.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { ChatRunnerService } from "../chat/chat-runner.service";
import { StreamFinishedEvent } from "../../common/events/stream.events";
import { EventBusService } from "../../common/events/event-bus.service";
import { AgentScannerService } from "./agent-scanner.service";

/**
 * 子 Agent 默认系统提示词
 *
 * 当子 Agent 没有自定义角色提示词时，使用此提示词作为基础身份定义。
 * 通过 session.settings.systemPrompt 注入，与工具配置走相同的继承机制。
 */
const SUB_AGENT_DEFAULT_PROMPT = `你是一个子 Agent（Sub Agent），被主 Agent 委派执行特定任务。

## 核心职责
- 专注于主 Agent 分配的任务，深入分析并独立完成
- 使用可用的工具收集信息、处理数据、执行操作
- 返回清晰、结构化的结果，便于主 Agent 整合

## 行为准则
- 主动使用工具完成任务，不要仅依赖已有知识
- 遇到复杂问题时，分解为多个步骤逐步解决
- 任务完成后，给出简洁的总结和关键结论
- 如果任务无法完成，说明原因和已尝试的方案

## 注意事项
- 你的工具权限由主 Agent 分配，请充分利用
- 工作目录与主 Agent 共享，注意文件操作的一致性
- 不要询问用户，自主决策并执行任务`;

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
    private messageRepo: MessageRepository,
    private chatRunnerService: ChatRunnerService,
    private eventBus: EventBusService,
    private characterRepo: CharacterRepository,
    private agentScanner: AgentScannerService,
  ) {}

  onModuleInit() {
    this.logger.log("SubAgentManager initialized");
  }

  /**
   * 监听全局 stream.finished 事件，自动导出子 Agent 对话历史到文件
   */
  @OnEvent("stream.finished")
  async handleStreamFinished(event: StreamFinishedEvent): Promise<void> {
    const payload = event.payload;
    // 只处理子 Agent 的流结束事件
    if (payload.sessionType !== "sub_agent") {
      return;
    }
    const subSessionId = event.sessionId;
    const workspacePath = payload.workspacePath;
    if (!subSessionId || !workspacePath) {
      return;
    }
    try {
      await this.exportSubAgentHistory(
        subSessionId,
        workspacePath,
        event.userId,
      );
    } catch (err) {
      this.logger.error(`导出子 Agent 历史记录失败: ${subSessionId}`, err);
    }
  }

  /**
   * 导出子 Agent 对话历史到文件
   */
  private async exportSubAgentHistory(
    subSessionId: string,
    workspacePath: string,
    userId: string,
  ): Promise<void> {
    try {
      const messages = await this.messageRepo.findRecentBySessionId(
        subSessionId,
        50,
        undefined,
        undefined,
        { onlyCurrentContent: true, withContents: true },
      );

      if (messages.length === 0) {
        return;
      }

      const markdown = this.formatMessagesAsMarkdown(
        messages.reverse(),
        subSessionId,
      );
      const filePath = path.join(
        workspacePath,
        ".guada",
        "subagents",
        `${subSessionId}.md`,
      );

      // 确保目录存在
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, markdown, "utf-8");

      this.logger.log(`子 Agent 历史记录已导出: ${filePath}`);
    } catch (error) {
      this.logger.error(`导出子 Agent 历史记录失败: ${subSessionId}`, error);
    }
  }

  /**
   * 将消息格式化为 Markdown
   *
   * 消息结构包含 contents 数组（MessageContent[]），
   * 提取 content（文本）和 metadata.toolCalls 中的 displayMessage（工具调用文案），
   * 不保存 reasoningContent（思考内容），不保存 tool 角色的消息。
   */
  private formatMessagesAsMarkdown(
    messages: any[],
    subSessionId: string,
  ): string {
    const lines: string[] = [
      "# 子 Agent 对话记录",
      "",
      `**会话 ID**: ${subSessionId}`,
      `**消息条数**: ${messages.length}`,
      "",
      "---",
      "",
    ];

    for (const msg of messages) {
      // 只保留 user 和 assistant 角色，跳过 tool 结果
      if (msg.role !== "user" && msg.role !== "assistant") {
        continue;
      }

      const role = msg.role === "user" ? "用户" : "助手";
      lines.push(`### ${role}`);
      lines.push("");

      // 处理 contents 数组（MessageContent[]）
      const contents = msg.contents || [];
      for (const content of contents) {
        // 主文本内容
        if (content.content) {
          lines.push(content.content);
        }

        // 提取工具调用的 displayMessage（从 metadata.toolCalls 中）
        const toolCalls = content.metadata?.toolCalls;
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          lines.push("");
          for (const tc of toolCalls) {
            const display = tc.metadata?.displayMessage;
            if (display && display.action) {
              const args = display.args ? ` ${display.args}` : "";
              lines.push(`tool:${display.action}${args}`);
            } else {
              // 极端情况：没有 displayMessage，使用工具名兜底
              lines.push(`tool:call ${tc.name || "unknown"}`);
            }
          }
        }
      }
      lines.push("---");
    }

    return lines.join("\n");
  }

  /**
   * 创建并启动子 Agent
   *
   * 前台模式（默认）：阻塞直到子 Agent 执行完毕并返回完整结果
   * 后台模式：立即返回 SubAgentResult（status=running），后续通过 waitForComplete 获取结果
   */
  async spawn(
    params: {
      parentSessionId: string;
      userId: string;
      name: string;
      task: string;
      characterId?: string;
    },
    mode: "foreground" | "background" = "foreground",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    // 1. 获取父会话信息（继承配置）
    const parentSession = await this.sessionRepo.findById(
      params.parentSessionId,
    );
    if (!parentSession) {
      throw new Error("父会话不存在");
    }

    // 限制子代理数量：一个会话最多创建 10 个
    const subAgentCount = await this.sessionRepo.countByParentId(
      params.parentSessionId,
    );
    if (subAgentCount >= 10) {
      throw new Error(
        "当前会话子代理数量已达上限（10个），请先关闭部分子代理后再创建",
      );
    }

    // 2. 提取父会话的工具配置
    const parentCharacterSettings = (parentSession.character?.settings ||
      {}) as any;
    const parentSessionSettings = (parentSession.settings || {}) as any;

    const inheritedPlugins =
      parentSessionSettings.plugins ?? parentCharacterSettings.plugins;
    const inheritedSkillsConfig =
      parentSessionSettings.skills ?? parentCharacterSettings.skills;

    // 3. 角色驱动的子 Agent 创建
    let characterSettings: any = {};
    let finalModelId: string | null = parentSession.modelId;
    let finalCharacterId: string | null = null;
    let finalAvatarUrl: string | undefined;

    // 配置继承策略委托给 PersistentSessionContext.mergeSettings()，
    // 它自动处理 sessionSettings.xxx ?? characterSettings.xxx 回退。
    //
    // 有角色时: 角色设定自动生效，spawn 只需设 characterId，不设重复值
    // 无角色时: 显式设置父会话的继承值作为 sessionSettings
    const settings: Record<string, any> = {};

    // 思考强度：无论是否有角色，都从父会话继承
    settings.thinkingEffort = parentSessionSettings.thinkingEffort;

    if (params.characterId && !params.characterId?.startsWith("agent-")) {
      // ── 数据库角色模式 ──
      // 仅设 thinkingEffort，其余由 mergeSettings 从 character.settings 自动读取
      const character = await this.characterRepo.findById(params.characterId);
      if (!character) {
        throw new Error(
          `角色 ${params.characterId} 不存在，请检查是否输入有误，或此角色已被删除`,
        );
      }
      finalModelId = character.modelId || parentSession.modelId;
      finalCharacterId = params.characterId;
      finalAvatarUrl = character.avatarUrl || undefined;
      this.logger.log(
        `子 Agent 将继承角色设定: ${character.title} (${params.characterId})`,
      );
    } else {
      if (params.characterId && params.characterId?.startsWith("agent-")) {
        // ── 轻量 Agent 模式 ──
        const agent = await this.agentScanner.getAgent(params.characterId);
        if (!agent) {
          throw new Error(
            `Agent ${params.characterId} 不存在，请检查是否输入有误，或此 Agent 已被删除`,
          );
        }
        this.logger.log(
          `子 Agent 使用轻量 Agent: ${agent.name} (${params.characterId})`,
        );
        settings.systemPrompt = agent.body;
      } else {
        settings.systemPrompt = SUB_AGENT_DEFAULT_PROMPT;
      }
      settings.plugins = inheritedPlugins;
      settings.skills = inheritedSkillsConfig;
      if (parentSessionSettings.modelOverrideEnabled) {
        settings.model = parentSessionSettings.model;
      } else {
        settings.model = {
          temperature: parentCharacterSettings.modelTemperature,
          topP: parentCharacterSettings.modelTopP,
          frequencyPenalty: parentCharacterSettings.modelFrequencyPenalty,
        };
      }
      settings.modelOverrideEnabled = true;
      if (parentSessionSettings.memoryEnabled) {
        settings.memory = parentSessionSettings.memory;
      } else {
        settings.memory = parentCharacterSettings.memory;
      }
      settings.memoryEnabled = true;
      // finalCharacterId 保持 null（不走 characterRepo）
    }

    return this.createSubSessionAndRun(
      params,
      mode,
      abortSignal,
      settings,
      parentSession,
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
    params: {
      parentSessionId: string;
      userId: string;
      name: string;
      task: string;
      characterId?: string;
    },
    mode: "foreground" | "background",
    abortSignal: AbortSignal | undefined,
    settings: Record<string, any>,
    parentSession: any,
    modelId: string,
    characterId: string | null,
    avatarUrl: string | undefined,
  ): Promise<SubAgentResult> {
    const subSession = await this.sessionRepo.create({
      userId: params.userId,
      parentId: params.parentSessionId,
      title: params.name,
      characterId,
      modelId,
      settings,
      sessionType: "sub_agent",
      workspacePath: parentSession.workspacePath,
      avatarUrl: avatarUrl || null,
    });

    this.logger.log(
      `子 Agent 会话创建成功: ${subSession.id}, 父会话: ${params.parentSessionId}, 模式: ${mode}`,
    );

    this.eventBus.emit("subagent.created", {
      userId: params.userId,
      sessionId: params.parentSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        subSessionId: subSession.id,
        name: params.name,
        mode,
        session: subSession,
      },
    });

    this.getOrCreateState(params.parentSessionId);

    return this.executeSubAgentStream(
      subSession.id,
      params.userId,
      params.task,
      params.parentSessionId,
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
      throw new Error("子 Agent 会话不存在");
    }
    if (subSession.parentId !== params.parentSessionId) {
      throw new Error("子 Agent 不属于该父会话");
    }

    // 2. 检查子 Agent 是否正在运行
    if (this.isSubAgentRunning(params.sessionId)) {
      throw new Error("子 Agent 正在运行中，请等待完成后再发送消息");
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
   * 供 spawn 和 sendMessage 复用的核心执行逻辑。
   */
  private async executeSubAgentStream(
    subSessionId: string,
    userId: string,
    content: string,
    parentSessionId: string,
    mode: "foreground" | "background",
    abortSignal?: AbortSignal,
  ): Promise<SubAgentResult> {
    // 加入运行中集合
    const state = this.getOrCreateState(parentSessionId);
    state.running.add(subSessionId);

    if (mode === "foreground") {
      // 前台模式：阻塞直到完成
      const result = await this.runSubAgentStream(
        subSessionId,
        userId,
        content,
        parentSessionId,
        abortSignal,
      );

      // 前台模式：状态清理 + 广播 UI 事件，不投递消息队列（避免重复接收）
      await this.notifyComplete(
        subSessionId,
        result,
        userId,
        parentSessionId,
        false,
      );

      return result;
    } else {
      // 后台模式：不阻塞，流在后台执行
      this.runSubAgentStream(subSessionId, userId, content, parentSessionId)
        .then(async (result) => {
          await this.notifyComplete(
            subSessionId,
            result,
            userId,
            parentSessionId,
          );
        })
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

      return {
        subSessionId,
        status: "running",
        content: "",
      };
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
    return session?.title || "未知子 Agent";
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
      // 从队列中移除已获取的消息
      for (const item of items) {
        this.chatRunnerService.peekQueuedMessage(
          parentSessionId,
          (q) =>
            q.source?.type === "sub_agent" &&
            q.source?.systemPayload?.some(
              (p: any) => p.subSessionId === item.subSessionId,
            ),
        );
      }
      return items;
    }

    // 确保状态存在，用于注册 completer
    const activeState = state;

    // 等待任意一个子 Agent 完成（支持 abortSignal 中止）
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeCompleter(parentSessionId, completer);
        reject(new Error("等待子 Agent 完成超时"));
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
    const state = this.states.get(parentSessionId);
    if (state) {
      state.completed = state.completed.filter(
        (c) => c.subSessionId !== subSessionId,
      );
      state.completers = [];
      if (state.completed.length === 0 && state.running.size === 0) {
        this.states.delete(parentSessionId);
      }
    }

    // 清理信箱中该子 Agent 的残留消息（如果有）
    this.chatRunnerService.peekQueuedMessage(
      parentSessionId,
      (q) =>
        q.source?.type === "sub_agent" &&
        (q.source?.systemPayload?.some(
          (p: any) => p.subSessionId === subSessionId,
        ) ||
          q.source?.subSessionId === subSessionId),
    );

    // 删除会话数据
    await this.sessionRepo.deleteById(subSessionId);

    // 删除自动导出的历史记录文件
    const historyFilePath = path.join(
      workspacePath,
      ".guada",
      "subagents",
      `${subSessionId}.md`,
    );
    try {
      await fs.unlink(historyFilePath);
      this.logger.log(`子 Agent 历史记录已删除: ${historyFilePath}`);
    } catch (err) {
      // 文件不存在时忽略错误
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.error(`删除子 Agent 历史记录失败: ${historyFilePath}`, err);
      }
    }

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
        name: session.title || "子 Agent",
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
    enqueueResult = true,
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
        enqueueResult,
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
      enqueueResult?: boolean;
    },
  ): Promise<void> {
    // 如果子 Agent 不在运行中集合（已被 closeSubAgent 移除），说明是主动关闭，跳过所有后续处理
    if (!state?.running.has(subSessionId)) return;

    // 从运行中集合移除
    state.running.delete(subSessionId);

    const isComplete = !!options.result;

    // 有等待者时直接通传，不投递消息
    if (state && state.completers.length > 0) {
      for (const completer of state.completers) {
        if (isComplete) {
          completer.resolve();
        } else {
          completer.reject(new Error(options.errorMsg));
        }
      }
      state.completers = [];

      // 清理空状态（completer.resolve 同步清空了 completed）
      if (state.completed.length === 0 && state.running.size === 0) {
        this.states.delete(parentSessionId);
      }
      return;
    }

    // 无等待者 → 投递消息到信箱
    if (isComplete && options.enqueueResult !== false) {
      const content = isComplete
        ? `${name} 已完成工作`
        : `子任务 "${name}" 执行失败，错误信息：${options.errorMsg}`;

      const source: any = { type: "sub_agent" };
      if (isComplete) {
        source.systemPayload = [
          {
            subSessionId,
            subAgentName: name,
            status: options.result!.status,
            finishReason: options.result!.finishReason,
            content:
              options.result!.content.substring(0, 1000) +
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
        .enqueueMessage({ sessionId: parentSessionId, userId, content, source })
        .catch((error) => {
          this.logger.error(`投递子Agent结果失败: ${subSessionId}`, error);
        });
    }

    // 清理空状态（有等待者时由 completer resolve 负责，无等待者时 completed 尚未消费，无需在此清理）
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
            onEvent: (data: string) => {
              try {
                const event = JSON.parse(data);
                // 只关注 finish 事件，它携带该轮迭代的完整累计内容
                if (event.type === "finish") {
                  capturedResult = {
                    subSessionId,
                    status: event.error ? "error" : "completed",
                    content: event.content || "",
                    finishReason: event.finishReason,
                    error: event.error,
                  };
                }
              } catch {
                // JSON 解析失败，忽略异常事件
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
          reject(new Error(`子 Agent 流启动失败: ${errorMsg}`));
        });
    });
  }
}
