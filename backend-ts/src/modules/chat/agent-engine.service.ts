import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolDisplayInfo } from "../tools/interfaces/tool-provider.interface";
import { SessionLockService } from "./session-lock.service";
import { SessionContextService } from "./session-context.service";
import { MessageRecord, LLMResponseChunk } from "../llm-core/types/llm.types";
import { IConversationContext } from "./interfaces";
import { RequestContext } from "../../common/context/request-context";
import * as fs from 'fs';
import * as path from 'path';

/**
 * 思考时间信息（简单数据容器）
 *
 * 用于保存消息内容的思考开始和结束时间，避免依赖 MessageContent 的临时属性。
 * 这样可以确保即使 messageContent 是重新查询的，思考时间信息也不会丢失。
 */
class ThinkingTimeInfo {
  thinkingStartedAt: Date | null = null;
  thinkingFinishedAt: Date | null = null;
}

/**
 * 工具调用展示文案管理器
 * 
 * 负责管理流式工具调用的展示文案生成。
 * 文案会直接注入到 toolCalls 的 metadata 中，随 MessageContent 一起持久化。
 */
class ToolCallDisplayManager {
  private readonly logger = new Logger(ToolCallDisplayManager.name);

  // 存储每个工具调用的状态（仅用于流式阶段）
  private states = new Map<number, {
    displayInfo: ToolDisplayInfo;  // 结构化的展示信息
    toolNameExtracted: boolean;
    argsParamExtracted: boolean;
    paramExtracted: boolean;
  }>();

  constructor(private toolOrchestrator: ToolOrchestrator) { }

  /**
   * 初始化工具调用状态（收到第一个 chunk 时）
   */
  initialize(index: number, toolId: string, toolName: string): void {
    const displayInfo = this.toolOrchestrator.generateDisplayMessage(
      { id: toolId, name: toolName, arguments: {} },
      true
    );

    this.states.set(index, {
      displayInfo: displayInfo,
      toolNameExtracted: false,
      argsParamExtracted: false,
      paramExtracted: false
    });

    this.logger.log(`[ToolCall #${index}] Initialized: ${displayInfo.action}`);
  }

  /**
   * 从流式 chunk 更新文案
   * @param accumulatedArgs 外部已累积的完整参数字符串
   * @returns 是否需要更新文案
   */
  updateFromChunk(
    index: number,
    toolName: string,
    accumulatedArgs: string
  ): boolean {
    const state = this.states.get(index);
    if (!state) return false;

    const updated = this.tryUpdateDisplayMessage(index, toolName, accumulatedArgs, state);

    if (updated) {
      this.logger.log(`[ToolCall #${index}] Updated: ${state.displayInfo.action}`);
    }

    return updated;
  }

  /**
   * 获取当前展示信息（流式阶段使用）
   */
  getDisplayMessage(index: number): ToolDisplayInfo | undefined {
    return this.states.get(index)?.displayInfo;
  }

  /**
   * 获取所有工具调用的完成状态文案（工具执行完成后使用）
   * 同时更新内部状态为完成状态的文案
   */
  finalizeAll(toolCalls: any[]): ToolDisplayInfo[] {
    return toolCalls.map((tc, index) => {
      const state = this.states.get(index);

      // 从 arguments 重新生成完成状态的文案（isStreaming = false）
      const parsedArgs = this.safeJsonParse(tc.arguments);
      const completedInfo = this.toolOrchestrator.generateDisplayMessage(
        { id: tc.id, name: tc.name, arguments: parsedArgs },
        false  // isStreaming = false，生成"已..."状态
      );

      // 更新内部状态为完成状态的文案
      if (state) {
        state.displayInfo = completedInfo;
      }

      // 同时更新 toolCall 的 metadata（如果存在）
      if (tc.metadata) {
        tc.metadata.displayMessage = completedInfo;
      }

      // 返回完整的 ToolDisplayInfo 对象
      return completedInfo;
    });
  }

  /**
   * 将文案注入到 toolCalls 的 metadata 中（持久化前调用）
   */
  injectDisplayMessages(toolCalls: any[]): void {
    toolCalls.forEach((tc, index) => {
      const state = this.states.get(index);
      if (state && state.displayInfo) {
        // 确保 metadata 存在
        if (!tc.metadata) {
          tc.metadata = {};
        }
        // 保存结构化的展示信息到 metadata
        tc.metadata.displayMessage = state.displayInfo;

        this.logger.debug(`[ToolCall #${index}] Saved displayInfo to metadata: ${JSON.stringify(state.displayInfo)}`);
      }
    });
  }

  /**
   * 清理所有状态
   */
  clear(): void {
    this.states.clear();
  }

  // ==================== 私有方法 ====================

  private tryUpdateDisplayMessage(
    index: number,
    toolName: string,
    accumulatedArgs: string,
    state: any
  ): boolean {
    let extractedParams: Record<string, string> = {};

    if (toolName === 'tool_call') {
      // tool_call 特殊处理：先提取 tool_name，再提取 arguments 内的参数
      if (!state.toolNameExtracted) {
        const firstKV = this.extractTopLevelKV(accumulatedArgs);
        if (firstKV?.key === 'tool_name') {
          state.toolNameExtracted = true;
          state.displayInfo = this.buildRequestFromPartialData(
            index,
            toolName,
            firstKV,
            accumulatedArgs,
            state
          );
          return true;
        }
      } else if (!state.argsParamExtracted) {
        const firstKV = this.extractNestedKV(accumulatedArgs);
        if (firstKV) {
          state.argsParamExtracted = true;
          // 重新提取 tool_name
          const toolNameMatch = accumulatedArgs.match(/"tool_name"\s*:\s*"([^"]+)"/);
          const actualToolName = toolNameMatch ? toolNameMatch[1] : toolName;
          extractedParams[firstKV.key] = firstKV.value;
          const request = {
            id: '',
            name: actualToolName,
            arguments: extractedParams
          };
          state.displayInfo = this.toolOrchestrator.generateDisplayMessage(request, true);
          return true;
        }
      }
    } else {
      // 普通工具：提取所有 KV 对
      const allKV = this.extractAllTopLevelKV(accumulatedArgs);
      for (const kv of allKV) {
        extractedParams[kv.key] = kv.value;
      }

      // 只要有参数就更新
      if (Object.keys(extractedParams).length > 0) {
        const request = {
          id: '',
          name: toolName,
          arguments: extractedParams
        };
        state.displayInfo = this.toolOrchestrator.generateDisplayMessage(request, true);
        return true;
      }
    }

    return false;
  }

  private extractAllTopLevelKV(jsonStr: string): { key: string; value: string }[] {
    const results: { key: string; value: string }[] = [];
    let remaining = jsonStr.trim();

    // 移除开头的 {
    if (remaining.startsWith('{')) {
      remaining = remaining.slice(1);
    }
    // 移除结尾的 }
    if (remaining.endsWith('}')) {
      remaining = remaining.slice(0, -1);
    }

    // 循环提取所有 KV 对
    while (remaining.length > 0) {
      const match = remaining.match(/^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*/);
      if (!match) break;

      results.push({ key: match[1], value: match[2] });
      remaining = remaining.slice(match[0].length);
    }

    return results;
  }

  private extractTopLevelKV(jsonStr: string): { key: string; value: string } | null {
    // 支持值中包含转义引号（如 \"）的情况，也处理流式传输时末尾反斜杠导致的不完整匹配
    const match = jsonStr.match(/"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
    return match ? { key: match[1], value: match[2] } : null;
  }

  private extractNestedKV(jsonStr: string): { key: string; value: string } | null {
    const argsMatch = jsonStr.match(/"arguments"\s*:\s*\{(.*)/s);
    if (!argsMatch) return null;

    const argsContent = argsMatch[1];
    // 支持值中包含转义引号（如 \"）的情况，也处理流式传输时末尾反斜杠导致的不完整匹配
    const kvMatch = argsContent.match(/"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
    return kvMatch ? { key: kvMatch[1], value: kvMatch[2] } : null;
  }

  private buildRequestFromPartialData(
    index: number,
    toolName: string,
    firstKV: { key: string; value: string },
    accumulatedArgs: string,
    state: any
  ): any {
    if (toolName === 'tool_call') {
      if (firstKV.key === 'tool_name') {
        return {
          id: '',
          name: firstKV.value,
          arguments: {}
        };
      } else {
        const toolNameMatch = accumulatedArgs.match(/"tool_name"\s*:\s*"([^"]+)"/);
        const actualToolName = toolNameMatch ? toolNameMatch[1] : toolName;
        return {
          id: '',
          name: actualToolName,
          arguments: { [firstKV.key]: firstKV.value }
        };
      }
    }

    return {
      id: '',
      name: toolName,
      arguments: { [firstKV.key]: firstKV.value }
    };
  }

  private safeJsonParse(jsonString: string): any {
    if (!jsonString || typeof jsonString !== 'string') {
      return {};
    }
    try {
      return JSON.parse(jsonString) || {};
    } catch {
      return { _raw_arguments: jsonString };
    }
  }
}

/**
 * Agent 推理引擎
 *
 * 负责协调会话级别的 AI 代理执行流程，包括多轮工具调用循环、流式响应管理。
 * 不管理会话生命周期——配置合并、上下文构建等数据准备工作由 SessionContextService 统一提供。
 *
 * 核心职责：
 * - 管理会话级别的并发锁，防止同一会话的多次请求冲突
 * - 协调 LLM 流式请求、工具执行和消息持久化的完整生命周期
 * - 处理思维链（Reasoning Content）的时间追踪和时长计算
 * - 实现安全的 JSON 解析和工具调用参数累加机制
 * - 支持对话再生模式（overwrite / multi_version）
 *
 * 设计原则：
 * - 异步生成器模式：通过 yield 实现流式数据推送，降低内存占用
 * - 容错降级：完善的错误捕获和分类处理机制，确保异常不会导致会话崩溃
 * - 防御性编程：多重安全检查（迭代次数限制、JSON 解析容错、空值保护）
 */
@Injectable()
export class AgentEngine {
  private readonly logger = new Logger(AgentEngine.name);

  // 流式输出限流间隔（毫秒）：缓存内的 chunk 会在该时间窗口内合并后统一刷新
  private readonly THROTTLE_MS = 100;

  // 文案管理器（替代原来的 currentTurnToolCallStates）
  private displayManager: ToolCallDisplayManager;

  constructor(
    private sessionRepo: SessionRepository,
    private toolOrchestrator: ToolOrchestrator,
    private llmService: LLMService,
    private sessionLockService: SessionLockService,
    private sessionContextService: SessionContextService,
  ) {
    // 初始化文案管理器
    this.displayManager = new ToolCallDisplayManager(this.toolOrchestrator);
  }

  /**
   * 执行会话补全请求（主入口）
   *
   * 该方法采用异步生成器模式，实时向前端推送 LLM 的流式响应。
   * 整个流程受会话锁保护，确保同一时刻只有一个请求在处理该会话。
   *
   * 执行流程：
   * - 获取会话锁，若会话繁忙则抛出冲突异常
   * - 加载会话并更新最后活跃时间
   * - 委托 SessionContextService 完成所有数据准备
   * - 进入多轮工具调用循环，逐轮生成响应
   * - 释放会话锁（无论成功或失败）
   *
   * @param sessionIdOrSession 会话 ID 或会话对象（传入对象可避免重复查询）
   * @param messageId 触发本次补全的用户消息 ID
   * @param regenerationMode 再生模式（"overwrite" 覆盖旧回复 / "multi_version" 保留多版本）
   * @param assistantMessageId 现有助手消息 ID（仅 multi_version 模式使用）
   * @param abortSignal 中断信号，用于客户端断开连接时中止 LLM 请求
   * @yi 的事件对象（create / text / think / tool_call / finish 等）
   */
  async *completions(
    sessionIdOrSession: string | any,
    messageId: string,
    regenerationMode: string = "overwrite", // 再生模式：'overwrite' | 'multi_version'
    assistantMessageId?: string, // 现有助手消息 ID（用于 multi_version 模式）
    abortSignal?: AbortSignal, // 中断信号（用于客户端断开连接时中止 LLM 请求）
  ) {
    // 判断传入的是 sessionId 还是 session 对象
    const isSessionObject = typeof sessionIdOrSession !== 'string';
    const sessionId = isSessionObject ? sessionIdOrSession.id : sessionIdOrSession;

    // 在 AsyncLocalStorage 上下文中执行整个请求
    // 这样内部所有服务都可以自动访问 abortSignal，无需层层透传
    const generatorFn = async function* (this: AgentEngine) {
      if (!this.sessionLockService.tryLock(sessionId)) {
        // 获取锁状态信息，提供更友好的错误提示
        const lockStatus = this.sessionLockService.getLockStatus(sessionId);
        let errorMessage = "会话正在处理中，请稍后再试";

        if (lockStatus.lockedAt) {
          const lockedDuration = Math.floor((Date.now() - lockStatus.lockedAt.getTime()) / 1000);
          errorMessage += `（已持续 ${lockedDuration} 秒）`;
        }

        errorMessage += "。后台可能有长时间运行的任务（如文件操作、命令执行等），请等待完成后重试。";

        this.logger.warn(`Session ${sessionId} is busy. ${errorMessage}`);
        throw new ConflictException(errorMessage);
      }

      try {
        let session = isSessionObject ? sessionIdOrSession : await this.sessionRepo.findById(sessionId);

        // 如果未传入 session 对象，则查询数据库
        if (!session) {
          throw new Error("Session not found");
        }

        // 更新会话最后活跃时间，用于会话管理和清理策略
        await this.sessionRepo.updateLastActiveAt(sessionId);

        // 委托 SessionContextService 完成所有数据准备
        // 现在 buildContext 内部可以通过 RequestContext.abortSignal() 自动获取信号
        const { context, toolContext, thinkingEffort } =
          await this.sessionContextService.buildContext(session, messageId);

        // 执行多轮工具调用循环，通过生成器逐轮产出响应事件
        yield* this.executeAgentLoop(
          context,
          session,
          messageId,
          toolContext,
          thinkingEffort,
          regenerationMode,
          assistantMessageId,
          abortSignal, // 仍然显式传递给工具层，用于控制外部资源
        );
      } finally {
        this.sessionLockService.unlock(sessionId);
      }
    }.bind(this);

    // 在 AsyncLocalStorage 上下文中执行生成器
    const wrappedGenerator = RequestContext.run(
      {
        abortSignal,
        sessionId,
        requestId: crypto.randomUUID(),
      },
      () => generatorFn()
    );

    yield* wrappedGenerator;
  }

  /**
   * 执行 Agent 多轮工具调用循环
   *
   * 该方法实现了一个完整的 ReAct（Reasoning + Acting）循环：
   * - 初始化会话上下文并加载历史消息
   * - 根据模型特性决定是否启用思维链和工具调用
   * - 在循环中交替执行 LLM 推理和工具调用，直到不再需要继续
   * - 每轮迭代都会持久化助手回复和工具响应
   *
   * 安全机制：
   * - 最大迭代次数限制（40 次），防止无限循环
   * - 会话锁保护，确保并发安全
   *
   * @param conversationContext 已初始化的会话上下文管理器
   * @param session 会话对象，包含模型配置和设置
   * @param userMessageId 触发本次循环的用户消息 ID
   * @param toolContext 工具执行上下文（内部按需获取 tools）
   * @param thinkingEnabled 是否启用思维链功能
   * @param regenerationMode 再生模式标识
   * @param assistantMessageId 现有助手消息 ID（可选）
   * @param abortSignal 中断信号（可选）
   * @yields SSE 格式的事件对象
   */
  private async *executeAgentLoop(
    conversationContext: IConversationContext,
    session: any,
    userMessageId: string,
    toolContext: any,
    thinkingEffort: string | undefined,
    regenerationMode: string,
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<any> {

    // 清理上一轮的工具调用状态
    this.displayManager.clear();

    // 按需获取 tools（仅在需要时查询）
    const tools = toolContext
      ? await this.toolOrchestrator.getAllTools(toolContext)
      : undefined;

    // 生成本次对话轮次的唯一 ID，用于关联同一轮中的所有消息和工具调用
    const turnsId = conversationContext.generateId();

    // 准备助手回复的消息容器，根据再生模式决定是覆盖旧回复还是创建新版本
    const responseMessageId =
      await conversationContext.prepareAssistantResponse(
        userMessageId,
        regenerationMode,
        turnsId,
        assistantMessageId,
      );

    let needToContinue = false;

    // 防止无限循环的安全机制：设置最大迭代次数上限
    let iterationCount = 0;
    const MAX_ITERATIONS = 100;

    do {
      iterationCount++;
      needToContinue = false;

      // 安全检查：超过最大迭代次数时强制终止循环，避免资源耗尽
      if (iterationCount > MAX_ITERATIONS) {
        this.logger.warn(
          `Agent loop exceeded maximum iterations (${MAX_ITERATIONS}), stopping...`,
        );
        break;
      }

      this.logger.debug(`Agent iteration ${iterationCount}/${MAX_ITERATIONS}`);

      // 从会话上下文中获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史）
      const historyMessages = await conversationContext.getMessages();

      // 生成本轮助手回复的内容 ID，用于唯一标识该轮次的输出
      const contentId = conversationContext.generateId();

      // Yield create 事件（每轮都发送，通知前端新的 contentId），用于前端初始化消息容器
      yield {
        type: "create",
        messageId: responseMessageId,
        turnsId: turnsId,
        contentId,
        modelName: session.model?.modelName,
        requestId: RequestContext.current()?.requestId, // 添加 requestId 便于追踪
      };

      // 执行单次 LLM 流式请求，实时接收并转发模型输出的文本块、思维链和工具调用
      const assistantResponse: MessageRecord = {
        role: "assistant",
        content: "",
        messageId: responseMessageId, // 设置 messageId 以满足外键约束
        turnsId: turnsId, // 设置 turnsId
        metadata: {
          modelName: session.model?.modelName,
        } // 初始化 metadata 以避免后续访问 undefined
      };

      yield* this.executeLLMStream(
        session,
        historyMessages, // 直接使用准备好的消息
        tools,
        assistantResponse,
        thinkingEffort,
        abortSignal,
      );

      // 构建待保存的消息记录数组，包含助手回复和后续的工具响应
      const parts: MessageRecord[] = [assistantResponse];
      // 处理工具执行：若模型返回了工具调用指令，则批量执行所有工具
      // 不能使用ssistantResponse.metadata?.finishReason === "tool_calls"判断
      if (assistantResponse.toolCalls && toolContext) {
        // 工具执行完成后，生成"已..."状态的展示文案
        const completedDisplayMessages = this.displayManager.finalizeAll(
          assistantResponse.toolCalls
        );

        const toolResponses = await this.toolOrchestrator.executeBatch(
          assistantResponse.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            arguments: this.safeJsonParse(tc.arguments),
          })),
          toolContext,
          abortSignal,
        );

        // Yield tool_calls_response 事件（与 Python 后端保持一致），向前端推送工具执行结果
        yield {
          type: "tool_calls_response",
          toolCallsResponse: toolResponses.map((tr) => ({
            name: tr.name,
            content: tr.content,
            toolCallId: tr.toolCallId,
          })),
          displayMessages: completedDisplayMessages,  // 添加完成状态的文案
          // usage: assistantResponse.metadata?.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };

        needToContinue = true;
        // 将每个工具的响应转换为 message record 并添加到待保存数组中
        for (const res of toolResponses) {
          parts.push({
            role: "tool",
            name: res.name,
            content: res.content,
            toolCallId: res.toolCallId,
            messageId: responseMessageId, // 工具响应与 assistant 消息共享同一个 messageId，保持关联关系
            turnsId: turnsId, // 使用相同的 turnsId，确保同轮次的所有消息归属于同一对话轮次
          });
        }
      }

      // 在持久化前，将最终的文案注入到 toolCalls 的 metadata 中
      if (assistantResponse.toolCalls) {
        this.displayManager.injectDisplayMessages(assistantResponse.toolCalls);
      }

      // 将本轮产生的所有消息（助手回复 + 工具响应）追加到会话上下文并持久化存储
      await conversationContext.appendParts(parts);

      this.logger.debug(
        `Iteration ${iterationCount} cleanup completed. Finish reason: ${assistantResponse.metadata?.finishReason}`,
      );
    } while (needToContinue);
  }

  /**
   * 执行单次 LLM 流式请求
   *
   * 该方法负责调用 LLM API 并实时处理流式响应，包括：
   * - 累加文本内容、思维链内容和工具调用参数
   * - 追踪思维链的开始和结束时间，用于计算思考时长
   * - 捕获并分类处理各类异常（用户中止、超时、API 错误）
   * - 将每个响应块转换为 SSE 格式并 yield 给前端
   *
   * @param session 会话对象
   * @param messages 发送给 LLM 的完整消息列表
   * @param tools 可用工具定义数组（可选）
   * @param incrementMessage 用于累加响应的消息记录对象（会被原地修改）
   * @param thinkingEffort 思考强度级别：'off' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
   * @param abortSignal 中断信号（可选）
   * @yields SSE 格式的事件对象（text / think / tool_call / finish）
   */
  private async *executeLLMStream(
    session: any,
    messages: MessageRecord[],
    tools: any[] | undefined,
    incrementMessage: MessageRecord,
    thinkingEffort: string | undefined,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<any, any, unknown> {
    // 为当前轮次创建思考时间信息对象，用于独立追踪本轮的思维链耗时
    const currentTurnThinkingInfo = new ThinkingTimeInfo();

    // 用于跟踪当前轮次的完整数据（包括错误信息）
    let streamError: Error | null = null;

    try {
      const config = (session.model?.config as any) || {};

      // 调用 LLM 服务发起流式请求，传递所有必要的配置参数
      const stream = this.llmService.completions({
        model: session.model?.modelName,
        messages,
        tools,
        temperature: session.settings.modelTemperature, // 控制输出的随机性
        topP: session.settings.modelTopP, // 核采样参数
        frequencyPenalty: session.settings.modelFrequencyPenalty, // 频率惩罚，降低重复内容
        maxTokens: config.maxOutputTokens, // 最大输出 Token 数限制
        providerConfig: session.model.provider,
        stream: true,
        thinkingEffort, // 传递思考强度
        abortSignal,
      });

      // 使用限流流包装原始流，合并高频 chunk 并按时间窗口刷新
      const throttled = this.throttledStream(
        stream as AsyncGenerator<LLMResponseChunk>,
        abortSignal,
      );



      // 遍历限流后的响应块，处理合并后的 chunk
      for await (const chunk of throttled) {
        // 增量累加逻辑：将每个块的 content 追加到总内容中
        if (chunk.content) incrementMessage.content += chunk.content;
        if (chunk.reasoningContent) {
          // 记录思考开始时间（第一次收到 reasoning_content 时），用于后续计算思维链耗时
          if (!currentTurnThinkingInfo.thinkingStartedAt) {
            currentTurnThinkingInfo.thinkingStartedAt = new Date();
          }

          if (incrementMessage.reasoningContent === undefined) {
            incrementMessage.reasoningContent = chunk.reasoningContent;
          } else {
            incrementMessage.reasoningContent += chunk.reasoningContent;
          }
        }
        if (chunk.toolCalls) {
          // 记录思考结束时间（第一次收到 tool_calls 时），标记推理阶段完成、工具调用阶段开始
          this.recordThinkingFinished(
            currentTurnThinkingInfo,
            "first tool_calls chunk",
          );

          this.accumulateToolCalls(incrementMessage, chunk.toolCalls);
        }

        if (chunk.content) {
          // 记录思考结束时间（第一次收到 content 时），标记推理阶段完成、文本生成阶段开始
          this.recordThinkingFinished(
            currentTurnThinkingInfo,
            "first content chunk",
          );
        }

        // 累加 usage 统计和 finishReason，这些通常在最后一个块中返回
        if (chunk.usage) {
          incrementMessage.metadata.usage = chunk.usage;
        }
        if (chunk.finishReason) {
          incrementMessage.metadata.finishReason = chunk.finishReason;
        }

        // 实时 Yield 给前端（过滤空 chunk），实现真正的流式体验
        const yieldEvent = this.buildYieldEvent(chunk);
        if (yieldEvent) {
          yield yieldEvent;
        }
      }
    } catch (error) {
      // 捕获流式过程中的异常，区分不同类型的错误并采取相应的处理策略
      streamError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Stream error in agent loop:`,
        streamError,
      );

      // 根据错误类型设置 finishReason 和 error 信息，便于前端展示和用户理解
      this.handleStreamError(incrementMessage, currentTurnThinkingInfo, streamError);

      // 向前端发送错误事件，除非是用户主动中止（避免在用户断开连接时推送额外数据）
      if (streamError.name !== "AbortError" && !streamError.message.includes("abort")) {
        yield {
          type: "finish",
          finishReason: "error",
          error: streamError.message,
          usage: incrementMessage.metadata.usage,
        };
      }
    }

    // 计算并保存思维链耗时（毫秒），用于性能分析和优化
    incrementMessage.metadata.thinkingDurationMs = this.calculateThinkingDuration(
      currentTurnThinkingInfo,
    );


  }

  /**
   * 构建 SSE Yield 事件
   *
   * 将 LLM 响应块转换为前端可识别的 SSE 事件格式。
   * 根据 chunk 的内容类型决定事件类型（text / think / tool_call / finish）。
   *
   * @param chunk LLM 响应块
   * @returns SSE 事件对象，若 chunk 为空则返回 null
   */
  private buildYieldEvent(chunk: LLMResponseChunk): any {

    let eventType: string;
    let msg: string | null = null;

    if (chunk.finishReason) {
      eventType = "finish";
    } else if (chunk.reasoningContent) {
      eventType = "think";
      msg = chunk.reasoningContent;
    } else if (chunk.content) {
      eventType = "text";
      msg = chunk.content;
    } else if (chunk.toolCalls) {
      eventType = "tool_call";

      // 从文案管理器获取展示文案
      const displayMessages = chunk.toolCalls.map(tc => {
        const message = this.displayManager.getDisplayMessage(tc.index);
        return message;
      });

      chunk.displayMessages = displayMessages;
    } else if (chunk.usage) {
      // 只有 usage 没有内容的情况（通常是最后一个块），跳过不发送以避免冗余
      return null;
    } else {
      // 其他未知情况，跳过不处理
      return null;
    }

    return {
      type: eventType,
      msg,
      toolCalls: chunk.toolCalls,
      displayMessages: chunk.displayMessages,
      finishReason: chunk.finishReason,
      usage: chunk.usage,
    };
  }

  /**
   * 处理流式错误
   *
   * 根据错误类型分类处理，设置相应的 finishReason 和 error 信息。
   * 支持的错误类型：
   * - 用户中止（AbortError）：客户端主动断开连接
   * - 超时错误：LLM 请求超过设定时间
   * - API 错误：模型服务商返回的错误或其他运行时异常
   *
   * @param currentChunk 当前正在构建的消息记录（会被原地修改）
   * @param currentTurnThinkingInfo 当前轮次的思考时间信息对象
   * @param streamError 捕获到的错误对象
   */
  private handleStreamError(
    currentChunk: MessageRecord,
    currentTurnThinkingInfo: ThinkingTimeInfo,
    streamError: Error,
  ): void {
    if (
      streamError.name === "AbortError" ||
      streamError.message.includes("abort")
    ) {
      // 用户主动中止（客户端断开连接），标记为 user_abort 以便前端展示友好提示
      currentChunk.metadata.finishReason = "user_abort";
      currentChunk.metadata.error = "User aborted the request";
      this.logger.debug("User stopped generation (AbortError)");

      // 记录思考结束时间，确保即使中途中止也能计算已产生的思维链耗时
      this.recordThinkingFinished(currentTurnThinkingInfo, "user abort");
    } else if (
      streamError.message.includes("timed out") ||
      streamError.message.includes("timeout")
    ) {
      // 超时错误，标记为 timeout 并记录详细错误信息
      currentChunk.metadata.finishReason = "timeout";
      currentChunk.metadata.error = streamError.message;
      this.logger.warn("LLM request timed out");

      // 记录思考结束时间，便于分析超时前的推理时长
      this.recordThinkingFinished(currentTurnThinkingInfo, "timeout");
    } else {
      // 其他 API 错误或运行时错误，标记为 error 并记录完整错误消息
      currentChunk.metadata.finishReason = "error";
      currentChunk.metadata.error = streamError.message;
      this.logger.error(`LLM API error: ${streamError.message}`);

      // 记录思考结束时间，确保错误发生时也能追踪已产生的推理时间
      this.recordThinkingFinished(currentTurnThinkingInfo, "api error");
    }
  }

  /**
   * 安全地解析JSON字符串，处理无效JSON的情况
   *
   * 该方法采用多层容错策略：
   * - 首先尝试标准 JSON.parse
   * - 若失败则尝试修复常见问题（重复输出、缺少引号、单引号等）
   * - 若仍失败则返回包含原始字符串的对象，供工具自行处理
   *
   * 这种设计提高了工具调用的鲁棒性，避免因模型输出格式不完美而导致执行失败。
   *
   * @param jsonString 要解析的JSON字符串
   * @returns 解析后的对象，如果解析失败则返回空对象或包含原始字符串的对象
   */
  private safeJsonParse(jsonString: string): any {
    if (!jsonString || typeof jsonString !== 'string') {
      return {};
    }

    try {
      const parsed = JSON.parse(jsonString);
      return parsed || {};
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to parse JSON arguments: ${jsonString.substring(0, 100)}... Error: ${errorMessage}`);

      // 尝试修复常见的JSON格式问题，提高对模型输出不完美的容忍度
      try {
        let fixedString = jsonString.trim();

        // 修复1: 检测并提取第一个完整的JSON对象（处理重复输出的情况）
        // 例如：模型可能输出 {"a":1}{"a":1}，我们只取第一个完整对象
        const firstBraceIndex = fixedString.indexOf('{');
        if (firstBraceIndex >= 0) {
          let braceCount = 0;
          let endIndex = -1;

          for (let i = firstBraceIndex; i < fixedString.length; i++) {
            if (fixedString[i] === '{') {
              braceCount++;
            } else if (fixedString[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                endIndex = i + 1;
                break;
              }
            }
          }

          if (endIndex > 0) {
            fixedString = fixedString.substring(firstBraceIndex, endIndex);
            this.logger.debug(`Extracted first complete JSON object: ${fixedString}`);
          }
        }

        // 修复2: 检查是否是未加引号的键值对格式，若是则包裹在花括号中
        if (fixedString.includes(':') && !fixedString.startsWith('{')) {
          fixedString = `{${fixedString}}`;
        }

        // 修复3: 替换单引号为双引号（简单的修复，处理 Python 风格的字典输出）
        fixedString = fixedString.replace(/'/g, '"');

        // 尝试再次解析
        const parsed = JSON.parse(fixedString);
        return parsed || {};
      } catch (secondError) {
        const secondErrorMessage = secondError instanceof Error ? secondError.message : String(secondError);
        this.logger.error(`Failed to fix and parse JSON arguments: ${secondErrorMessage}`);
        // 如果仍然失败，返回一个包含原始字符串的对象，以便工具可以自行解析或报错
        return { _raw_arguments: jsonString };
      }
    }
  }

  /**
   * 累加工具调用参数（处理流式分片）
   *
   * LLM 在流式输出工具调用时，会将参数分成多个块逐步发送。
   * 该方法负责将这些分片按 index 合并为完整的工具调用对象，
   * 并委托 ToolCallDisplayManager 管理展示文案的更新。
   *
   * @param target 目标消息记录，其 toolCalls 数组会被原地修改
   * @param deltaCalls 本次收到的增量工具调用分片数组
   */
  private accumulateToolCalls(target: MessageRecord, deltaCalls: any[]) {
    if (!target.toolCalls) target.toolCalls = [];

    for (const delta of deltaCalls) {
      const index = delta.index;

      // 若该索引位置尚无工具调用对象，则创建新对象并初始化字段
      if (!target.toolCalls[index]) {
        target.toolCalls[index] = {
          type: "function",
          id: delta.id,
          name: delta.name || "",
          arguments: "",
        };

        // 每个工具调用对象创建时都必须初始化状态
        // 如果 name 暂时为空，使用 toolName 字段，后续会在 name 到达时更新
        this.displayManager.initialize(index, delta.id, delta.name || "tool_call");
      }

      const tc = target.toolCalls[index];

      // 将本次分片的参数字符串追加到已有参数中，实现完整参数的重建
      if (delta?.arguments) {
        tc.arguments += delta.arguments;

        // 委托文案管理器更新展示文案（传入完整累积结果，而非增量）
        this.displayManager.updateFromChunk(index, tc.name, tc.arguments);
      }
    }
  }

  /**
   * 记录思考结束时间
   *
   * 仅在思考已开始但尚未结束时记录结束时间，避免重复设置。
   * 该方法被多处调用（收到 tool_calls、收到 content、发生错误等），确保在各种场景下都能正确追踪思维链耗时。
   *
   * @param currentTurnThinkingInfo 当前轮次的思考时间信息对象
   * @param reason 记录原因（用于日志，便于调试和问题排查）
   */
  private recordThinkingFinished(
    currentTurnThinkingInfo: ThinkingTimeInfo,
    reason: string,
  ): void {
    if (
      currentTurnThinkingInfo.thinkingStartedAt &&
      !currentTurnThinkingInfo.thinkingFinishedAt
    ) {
      currentTurnThinkingInfo.thinkingFinishedAt = new Date();
      this.logger.debug(`Thinking finished at ${reason}`); // 记录触发思考结束的具体事件
    }
  }

  /**
   * 计算思考时长（毫秒）
   *
   * 根据思考开始和结束时间计算差值，用于性能分析和优化。
   * 若时间戳不完整（例如模型未产生思维链内容），则返回 null。
   *
   * @param currentTurnThinkingInfo 当前轮次的思考时间信息对象
   * @returns 思考时长（毫秒），如果时间不完整则返回 null
   */
  private calculateThinkingDuration(
    currentTurnThinkingInfo: ThinkingTimeInfo,
  ): number | null {
    if (
      currentTurnThinkingInfo.thinkingStartedAt &&
      currentTurnThinkingInfo.thinkingFinishedAt
    ) {
      const durationMs = Math.floor(
        currentTurnThinkingInfo.thinkingFinishedAt.getTime() -
        currentTurnThinkingInfo.thinkingStartedAt.getTime(),
      );
      this.logger.log(`Thinking duration calculated: ${durationMs}ms`);
      return durationMs;
    } else {
      this.logger.warn(
        `Thinking timestamps incomplete. ` +
        `Has start: ${currentTurnThinkingInfo.thinkingStartedAt !== null}, ` +
        `Has finish: ${currentTurnThinkingInfo.thinkingFinishedAt !== null}`,
      );
      return null;
    }
  }

  /**
   * 限流流式输出
   *
   * 包装原始 LLM 流，在指定时间窗口内合并同类 chunk，降低前端渲染压力。
   * 合并规则：content 和 reasoningContent 分别累加，toolCalls 按 index 累加 arguments。
   * 刷新触发：定时器到期、finishReason 到达、流结束、abort 信号触发。
   *
   * @param stream 原始 LLM 流式生成器
   * @param abortSignal 中断信号
   * @yields 合并后的 LLMResponseChunk
   */
  private async *throttledStream(
    stream: AsyncGenerator<LLMResponseChunk>,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LLMResponseChunk> {
    // 当前缓存的合并 chunk
    let buffer: LLMResponseChunk | null = null;
    // 定时器句柄
    let flushTimer: NodeJS.Timeout | null = null;
    // 流是否已结束
    let streamDone = false;
    // 获取流的异步迭代器
    const iterator = stream[Symbol.asyncIterator]();
    // 记录开始时间，用于计算相对时间戳
    const startTime = Date.now();

    /**
     * 立即刷新缓存并返回 chunk，同时清除定时器
     */
    const flush = (): LLMResponseChunk | null => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (buffer) {
        const chunk = buffer;
        buffer = null;
        return chunk;
      }
      return null;
    };

    /**
     * 调度一次定时刷新，返回一个 Promise，超时后 resolve
     */
    const scheduleFlush = (): Promise<void> => {
      return new Promise((resolve) => {
        flushTimer = setTimeout(() => {
          resolve();
        }, this.THROTTLE_MS);
      });
    };

    /**
     * 判断 chunk 的事件类型（用于区分不同类型的 chunk 是否能合并）
     */
    const getChunkEventType = (chunk: LLMResponseChunk): string => {
      if (chunk.finishReason) return "finish";
      if (chunk.reasoningContent) return "think";
      if (chunk.content) return "text";
      if (chunk.toolCalls && chunk.toolCalls.length > 0) return "tool_call";
      if (chunk.usage) return "usage";
      return "unknown";
    };

    /**
     * 将新 chunk 合并到缓存中
     * 注意：不同类型的事件不能合并，会先刷新旧缓存
     * @returns 如果因为类型冲突而刷新了旧缓存，返回被刷新的 chunk；否则返回 null
     */
    const mergeChunk = (chunk: LLMResponseChunk): LLMResponseChunk | null => {
      const newType = getChunkEventType(chunk);

      if (!buffer) {
        // 首次缓存，创建副本避免修改原始对象
        buffer = {
          content: chunk.content || null,
          reasoningContent: chunk.reasoningContent || null,
          finishReason: chunk.finishReason || null,
          toolCalls: chunk.toolCalls ? this.cloneToolCalls(chunk.toolCalls) : undefined,
          usage: chunk.usage || null,
        };
        return null;
      }

      // 判断当前 buffer 的类型
      const bufferType = getChunkEventType(buffer);

      // 不同类型不能合并：先刷新旧缓存，再开始新缓存
      if (bufferType !== newType && bufferType !== "unknown") {
        const flushedChunk = flush();
        // 开始新缓存
        buffer = {
          content: chunk.content || null,
          reasoningContent: chunk.reasoningContent || null,
          finishReason: chunk.finishReason || null,
          toolCalls: chunk.toolCalls ? this.cloneToolCalls(chunk.toolCalls) : undefined,
          usage: chunk.usage || null,
        };
        return flushedChunk;
      }

      // 同类型可以合并
      // 累加文本内容
      if (chunk.content) {
        buffer.content = (buffer.content || "") + chunk.content;
      }

      // 累加思考内容
      if (chunk.reasoningContent) {
        buffer.reasoningContent = (buffer.reasoningContent || "") + chunk.reasoningContent;
      }

      // 累加工具调用（按 index 分组，合并 arguments）
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        if (!buffer.toolCalls) {
          buffer.toolCalls = [];
        }
        for (const tc of chunk.toolCalls) {
          const existing = buffer.toolCalls.find((t) => t.index === tc.index);
          if (existing) {
            // 同一工具调用的增量分片，累加 arguments
            if (tc.arguments) {
              existing.arguments = (existing.arguments || "") + tc.arguments;
            }
            // 更新 name（可能后续才到达）
            if (tc.name && !existing.name) {
              existing.name = tc.name;
            }
          } else {
            // 新的工具调用
            buffer.toolCalls.push({ ...tc });
          }
        }
      }

      // 更新 finishReason（通常只在最后一个 chunk 中出现）
      if (chunk.finishReason) {
        buffer.finishReason = chunk.finishReason;
      }

      // 更新 usage（通常只在最后一个 chunk 中出现）
      if (chunk.usage) {
        buffer.usage = chunk.usage;
      }

      return null;
    };

    try {
      let chunkPromise: Promise<IteratorResult<LLMResponseChunk>> | undefined = undefined;
      let chunkPromiseWait: Promise<{ type: "chunk"; value: IteratorResult<LLMResponseChunk> }> | undefined = undefined;
      
      while (!streamDone) {
        // 检查 abort 信号
        if (abortSignal?.aborted) {
          const finalChunk = flush();
          if (finalChunk) {
            yield finalChunk;
          }
          throw new Error("AbortError");
        }

        // 竞争：等待下一个 chunk 或定时器到期
        if (chunkPromise == undefined) {
          chunkPromise = iterator.next();
          chunkPromiseWait = chunkPromise.then((r) => ({
            type: "chunk" as const,
            value: r
          }));
        }
        // const chunkPromise = iterator.next();
        const timerPromise = scheduleFlush();

        const result = await Promise.race([
          chunkPromiseWait,
          timerPromise.then(() => ({ type: "timer" as const, value: null })),
        ]);

        if (result.type === "chunk") {
          const { value, done } = result.value;
          chunkPromise = undefined;
          if (done) {
            streamDone = true;
            // 流结束，刷新剩余缓存
            const finalChunk = flush();
            if (finalChunk) {
              yield finalChunk;
            }
            break;
          }

          const chunk = value as LLMResponseChunk;



          // 合并到缓存（包含 finishReason、usage 等）
          // 如果类型冲突，会返回需要立即刷新的旧缓存
          const flushed = mergeChunk(chunk);
          if (flushed) {
            yield flushed;
          }

          // finishReason 存在时立即刷新合并后的缓存
          if (chunk.finishReason) {
            const finishedChunk = flush();
            if (finishedChunk) {
              yield finishedChunk;
            }
            continue;
          }

          // 重置定时器：清除旧的，让下次循环重新调度
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
        } else {
          // 定时器到期，刷新缓存
          const flushedChunk = flush();
          if (flushedChunk) {
            yield flushedChunk;
          }
        }
      }
    } finally {
      // 清理资源
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    }
  }

  /**
   * 深拷贝工具调用数组
   */
  private cloneToolCalls(toolCalls: any[]): any[] {
    return toolCalls.map((tc) => ({
      id: tc.id,
      index: tc.index,
      type: tc.type,
      name: tc.name,
      arguments: tc.arguments,
    }));
  }
}
