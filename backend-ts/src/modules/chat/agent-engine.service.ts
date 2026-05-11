import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { SessionRepository } from "../../common/database/session.repository";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SessionLockService } from "./session-lock.service";
import { SessionContextService } from "./session-context.service";
import { MessageRecord, LLMResponseChunk } from "../llm-core/types/llm.types";
import { IConversationContext } from "./interfaces";

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

  constructor(
    private sessionRepo: SessionRepository,
    private toolOrchestrator: ToolOrchestrator,
    private llmService: LLMService,
    private sessionLockService: SessionLockService,
    private sessionContextService: SessionContextService,
  ) { }

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
   * @yields SSE 格式的事件对象（create / text / think / tool_call / finish 等）
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

    if (!this.sessionLockService.tryLock(sessionId)) {
      throw new ConflictException("Session is busy");
    }

    try {

      const session = isSessionObject ? sessionIdOrSession : await this.sessionRepo.findById(sessionId);

      // 如果未传入 session 对象，则查询数据库
      if (!session) {
        throw new Error("Session not found");
      }

      // 更新会话最后活跃时间，用于会话管理和清理策略
      await this.sessionRepo.updateLastActiveAt(sessionId);

      // 委托 SessionContextService 完成所有数据准备
      const { context, toolContext, thinkingEnabled } =
        await this.sessionContextService.buildContext(session, messageId);

      // 执行多轮工具调用循环，通过生成器逐轮产出响应事件
      yield* this.executeAgentLoop(
        context,
        session,
        messageId,
        toolContext,
        thinkingEnabled,
        regenerationMode,
        assistantMessageId,
        abortSignal,
      );
    } finally {
      this.sessionLockService.unlock(sessionId);
    }
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
    thinkingEnabled: boolean | undefined,
    regenerationMode: string,
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<any> {

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
        thinkingEnabled,
        abortSignal,
      );

      // 构建待保存的消息记录数组，包含助手回复和后续的工具响应
      const parts: MessageRecord[] = [assistantResponse];
      // 处理工具执行：若模型返回了工具调用指令，则批量执行所有工具
      // 不能使用ssistantResponse.metadata?.finishReason === "tool_calls"判断
      if (assistantResponse.toolCalls && toolContext) {
        const toolResponses = await this.toolOrchestrator.executeBatch(
          assistantResponse.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            arguments: this.safeJsonParse(tc.arguments),
          })),
          toolContext,
        );

        // Yield tool_calls_response 事件（与 Python 后端保持一致），向前端推送工具执行结果
        yield {
          type: "tool_calls_response",
          toolCallsResponse: toolResponses.map((tr) => ({
            name: tr.name,
            content: tr.content,
            toolCallId: tr.toolCallId,
          })),
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
   * @param thinkingEnabled 是否启用思维链功能
   * @param abortSignal 中断信号（可选）
   * @yields SSE 格式的事件对象（text / think / tool_call / finish）
   */
  private async *executeLLMStream(
    session: any,
    messages: MessageRecord[],
    tools: any[] | undefined,
    incrementMessage: MessageRecord,
    thinkingEnabled: boolean | undefined,
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
        thinkingEnabled, // 直接使用已计算的三种状态（true / false / undefined）
        abortSignal,
      });

      // 遍历流式响应块，逐个处理并累加到 incrementMessage 中
      for await (const chunk of stream as AsyncGenerator<LLMResponseChunk>) {
        // 增量累加逻辑：将每个块的 content 追加到总内容中
        if (chunk.content) incrementMessage.content += chunk.content;
        if (chunk.reasoningContent) {
          // 记录思考开始时间（第一次收到 reasoning_content 时），用于后续计算思维链耗时
          if (!currentTurnThinkingInfo.thinkingStartedAt) {
            currentTurnThinkingInfo.thinkingStartedAt = new Date();
            this.logger.debug("Thinking started");
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
          // this.logger.log(`Accumulated ${chunk.toolCalls.length} tool calls`);
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
    // 只有在有实际内容、推理内容、工具调用、结束原因或 usage 时才 yield，避免发送空事件
    if (
      !chunk.content &&
      !chunk.reasoningContent &&
      !chunk.toolCalls &&
      !chunk.finishReason &&
      !chunk.usage
    ) {
      return null;
    }

    // 更严谨的类型判断：确保 msg 不为 null，根据 chunk 的不同字段确定事件类型
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
   * 该方法负责将这些分片按 index 合并为完整的工具调用对象。
   *
   * @param target 目标消息记录，其 toolCalls 数组会被原地修改
   * @param deltaCalls 本次收到的增量工具调用分片数组
   */
  private accumulateToolCalls(target: any, deltaCalls: any[]) {
    if (!target.toolCalls) target.toolCalls = [];
    for (const delta of deltaCalls) {
      const index = delta.index;
      // 若该索引位置尚无工具调用对象，则创建新对象并初始化字段
      if (!target.toolCalls[index]) {
        target.toolCalls[index] = {
          id: delta.id,
          name: delta.name || "",
          arguments: delta.arguments || "",
        };
      }

      const tc = target.toolCalls[index];
      // 将本次分片的参数字符串追加到已有参数中，实现完整参数的重建
      if (delta?.arguments) tc.arguments += delta.arguments;
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
}
