import { Injectable, Logger } from "@nestjs/common";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { SessionContextService } from "./session-context.service";
import { MessageRecord, LLMResponseChunk } from "../llm-core/types/llm.types";
import { IConversationContext } from "./interfaces";
import { RequestContext } from "../../common/context/request-context";
import { throttledStream } from "./utils/stream-throttle.util";
import { ToolCallDisplayUtil } from "./utils/tool-call-display.util";

/**
 * 审批上下文
 */
interface ApprovalContext {
  type: "approval";
  status: "pending" | "completed";
  token?: string; // 用于验证（可选）
  pendingToolCallIds?: string[]; // pending 状态时保存需要审批的工具 ID 列表
  decisions?: Array<{
    // completed 状态时保存
    toolCallId: string;
    decision: "approve" | "reject";
    reason?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

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
 * 扩展的 LLM 响应块（累加器使用）
 *
 * 在标准 LLMResponseChunk 基础上增加思考时长字段，
 * 用于 executeLLMStream 返回完整的累加状态。
 */
interface AccumulatedChunk extends LLMResponseChunk {
  thinkingDurationMs?: number | null;
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

  // 流式输出限流间隔（毫秒）
  private readonly THROTTLE_MS = 100;

  constructor(
    private toolOrchestrator: ToolOrchestrator,
    private llmService: LLMService,
    private sessionContextService: SessionContextService,
    private displayManager: ToolCallDisplayUtil,
  ) {}

  /**
   * 执行会话补全请求（主入口）
   *
   * 该方法采用异步生成器模式，实时向前端推送 LLM 的流式响应。
   * 整个流程受会话锁保护，确保同一时刻只有一个请求在处理该会话。
   *
   * 执行流程：
   * - 加载会话并更新最后活跃时间
   * - 委托 SessionContextService 完成所有数据准备
   * - 进入多轮工具调用循环，逐轮生成响应
   *
   * @param session 会话对象
   * @param messageId 触发本次补全的用户消息 ID
   * @param regenerationMode 再生模式（"overwrite" 覆盖旧回复 / "multi_version" 保留多版本 / "resume" 断点续传）
   * @param assistantMessageId 现有助手消息 ID（仅 multi_version 模式使用）
   * @param abortSignal 中断信号，用于客户端断开连接时中止 LLM 请求
   * @param resumeData 【新增】断点续传数据（如审批决策、表单数据等）
   * @yields SSE 的事件对象（create / text / think / tool_call / finish 等）
   */
  async *completions(
    session: any,
    messageId: string,
    regenerationMode: string = "overwrite", // 再生模式：'overwrite' | 'multi_version' | 'resume'
    assistantMessageId?: string, // 现有助手消息 ID（用于 multi_version 和 resume 模式）
    abortSignal?: AbortSignal, // 中断信号（用于客户端断开连接时中止 LLM 请求）
    resumeData?: any, // 【新增】断点续传数据
  ) {
    const sessionId = session.id;

    // 在 AsyncLocalStorage 上下文中执行整个请求
    // 这样内部所有服务都可以自动访问 abortSignal，无需层层透传
    const generatorFn = async function* (this: AgentEngine) {
      try {
        // 委托 SessionContextService 完成所有数据准备
        // 现在 buildContext 内部可以通过 RequestContext.abortSignal() 自动获取信号
        const { context, toolContext, thinkingEffort } =
          await this.sessionContextService.buildContext(
            session,
            regenerationMode !== "resume" ? messageId : undefined,
          );

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
          resumeData, // 【新增】传递断点续传数据
        );
      } catch (error) {
        throw error;
      }
    }.bind(this);

    // 在 AsyncLocalStorage 上下文中执行生成器
    const wrappedGenerator = RequestContext.run(
      {
        abortSignal,
        sessionId,
        requestId: crypto.randomUUID(),
      },
      () => generatorFn(),
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
   * - SessionStreamManager 确保同一会话不会同时启动多个流
   *
   * @param conversationContext 已初始化的会话上下文管理器
   * @param session 会话对象，包含模型配置和设置
   * @param userMessageId 触发本次循环的用户消息 ID
   * @param toolContext 工具执行上下文（内部按需获取 tools）
   * @param thinkingEffort 思考强度级别
   * @param regenerationMode 再生模式标识（'overwrite' | 'multi_version' | 'resume'）
   * @param assistantMessageId 现有助手消息 ID（可选）
   * @param abortSignal 中断信号（可选）
   * @param resumeData 断点续传数据（如审批决策、表单数据等）
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
    resumeData?: any, // 【新增】断点续传数据
  ): AsyncGenerator<any> {
    // 清理上一轮的工具调用状态
    this.displayManager.clear();

    // 【新增】判断是否为断点模式

    let isResumeMode = regenerationMode === "resume";
    let assistantResponse: MessageRecord | null = null;
    let turnsId: string;
    let responseMessageId: string;

    if (!isResumeMode) {
      // 【正常模式】生成新的 turnsId 和 messageId

      // 生成本次对话轮次的唯一 ID，用于关联同一轮中的所有消息和工具调用
      turnsId = conversationContext.generateId();

      // 准备助手回复的消息容器，根据再生模式决定是覆盖旧回复还是创建新版本
      responseMessageId = await conversationContext.prepareAssistantResponse(
        userMessageId,
        regenerationMode,
        turnsId,
        assistantMessageId,
      );
    }
    // 按需获取 tools（仅在需要时查询）
    const tools = toolContext
      ? await this.toolOrchestrator.getAllTools(toolContext)
      : undefined;
    let needToContinue = false;

    // 工具调用轮次计数器
    let iterationCount = 0;

    do {
      iterationCount++;
      needToContinue = false;

      // 从会话上下文中获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史）
      const historyMessages = await conversationContext.getMessages();
      // 生成本轮助手回复的内容 ID，用于唯一标识该轮次的输出
      let contentId = conversationContext.generateId();
      assistantResponse = {
        role: "assistant",
        content: "",
        messageId: responseMessageId,
        contentId: contentId,
        turnsId: turnsId,
        metadata: {
          modelName: session.model?.modelName,
        },
      };
      const lastMessage = historyMessages[historyMessages.length - 1];
      if (isResumeMode) {
        assistantResponse = lastMessage;
        contentId = lastMessage.contentId;
        responseMessageId = lastMessage.messageId;
        turnsId = lastMessage.turnsId;
        if (lastMessage.role === "tool") {
          isResumeMode = false;
          continue;
        }
      }

      // 断点模式：发送 update 事件
      yield {
        type: isResumeMode ? "update" : "create",
        messageId: responseMessageId,
        turnsId: turnsId,
        contentId: contentId,
        modelName: session.model?.modelName,
        requestId: RequestContext.current()?.requestId,
        parentId: userMessageId,
      };

      // 构建待保存的消息记录数组
      const parts: MessageRecord[] = [];

      // 【关键】如果不是断点模式，或者需要继续循环，才调用 LLM
      if (isResumeMode) {
        isResumeMode = false;
      } else {
        // 将 accumulated 转换为 MessageRecord 格式用于后续处理
        const accumulatedChunk: LLMResponseChunk = {};
        let streamError: Error | null = null;
        const currentTurnThinkingInfo = new ThinkingTimeInfo();

        try {
          // 执行 LLM 流式请求，获取原始 chunk 和累加结果
          const streamResult = this.executeLLMStream(
            session,
            historyMessages,
            tools,
            thinkingEffort,
            abortSignal,
          );
          for await (const { chunk, accumulated } of streamResult) {
            // 保存最新累加状态
            Object.assign(accumulatedChunk, accumulated);

            // 记录思考时间：第一次收到 reasoningContent 时标记思考开始
            if (
              accumulated.reasoningContent &&
              !currentTurnThinkingInfo.thinkingStartedAt
            ) {
              currentTurnThinkingInfo.thinkingStartedAt = new Date();
            }
            // 记录思考时间：reasoningContent 结束后标记思考结束
            if (
              !chunk.reasoningContent &&
              currentTurnThinkingInfo.thinkingStartedAt &&
              !currentTurnThinkingInfo.thinkingFinishedAt
            ) {
              currentTurnThinkingInfo.thinkingFinishedAt = new Date();
            }
            // 将 accumulated 转换为 MessageRecord 保存到 assistantResponse
            assistantResponse.content = accumulatedChunk.content || "";
            if (accumulatedChunk.reasoningContent) {
              assistantResponse.reasoningContent =
                accumulatedChunk.reasoningContent;
            }
            if (accumulatedChunk.toolCalls) {
              assistantResponse.toolCalls = accumulatedChunk.toolCalls;
            }
            if (accumulatedChunk.usage) {
              assistantResponse.metadata.usage = accumulatedChunk.usage;
            }
            // 给每个 chunk 加上 contentId，用于聚合和 lastContentId 过滤
            const chunkWithId = { ...chunk, contentId };
            const yieldEvent = this.buildYieldEvent(chunkWithId);
            if (yieldEvent) {
              yield yieldEvent;
            }
          }

          assistantResponse.metadata = {
            ...assistantResponse.metadata,
            finishReason: accumulatedChunk.finishReason,
            thinkingDurationMs: this.calculateThinkingDuration(
              currentTurnThinkingInfo,
            ),
          };
        } catch (error) {
          // 由外部捕获并处理流式异常
          streamError =
            error instanceof Error ? error : new Error(String(error));
          this.logger.error(`Stream error in agent loop:`, streamError);
          // 使用 handleStreamError 分类处理错误并设置状态
          this.handleStreamError(
            assistantResponse,
            currentTurnThinkingInfo,
            streamError,
          );
          if (!abortSignal || !abortSignal.aborted) {
            yield {
              type: "finish",
              finishReason: 'error',
              error: streamError.message,
              usage: accumulatedChunk.usage,
              contentId,
            };
          }
        }

        parts.push(assistantResponse);
      }

      // 处理工具执行：若模型返回了工具调用指令，则批量执行所有工具
      if (assistantResponse.toolCalls && toolContext) {
        // 【工具轮次限制】检查是否达到最大工具调用轮次
        const MAX_TOOL_ITERATIONS = 40;
        if (iterationCount >= MAX_TOOL_ITERATIONS) {
          this.logger.warn(
            `工具调用达到最大轮次限制 (${MAX_TOOL_ITERATIONS})，暂停执行等待用户确认`,
          );

          // 保存断点标记到 metadata
          if (!assistantResponse.metadata) {
            assistantResponse.metadata = {};
          }
          assistantResponse.metadata.finishReason = "max_iterations_reached";

          // 发送特殊 finish 事件，通知前端显示继续按钮
          yield {
            type: "finish",
            finishReason: "max_iterations_reached",
            message: `已达到最大工具调用轮次限制（${MAX_TOOL_ITERATIONS} 轮），是否继续执行？`,
            progress: {
              completedIterations: iterationCount,
              maxIterations: MAX_TOOL_ITERATIONS,
            },
            usage: assistantResponse.metadata?.usage,
          };

          // 在持久化前，将最终的文案注入到 toolCalls 的 metadata 中
          this.displayManager.injectDisplayMessages(
            assistantResponse.toolCalls,
          );
          // 持久化当前消息（包含断点元数据），确保刷新后仍能显示继续按钮
          await conversationContext.appendParts(parts);
          break;
        }

        // 【关键】将工具分为三组
        const { pendingTools, approvedTools, rejectedTools } =
          this.classifyToolsByApproval(
            assistantResponse.toolCalls,
            assistantResponse.metadata,
            session,
          );

        // 【原子性审批】只要有需要审批且未审批的工具，就触发审批请求
        if (pendingTools.length > 0) {
          // 保存审批上下文到 metadata
          if (!assistantResponse.metadata) {
            assistantResponse.metadata = {};
          }

          assistantResponse.metadata.approvalContext = {
            type: "approval",
            status: "pending",
            pendingToolCallIds: pendingTools.map((tc: any) => tc.id),
            createdAt: new Date().toISOString(),
          } as ApprovalContext;

          // 提前终止，发送审批请求
          yield {
            type: "finish",
            finishReason: "approval_required",
            usage: assistantResponse.metadata?.usage,
          };

          await conversationContext.appendParts(parts);

          break;
        }

        // 【已处理场景】执行 approved 工具 + 为 rejected 工具生成错误响应
        const completedDisplayMessages = this.displayManager.finalizeAll(
          assistantResponse.toolCalls,
        );

        // 执行 approved 工具（包括已通过审批和不需要审批的）
        if (approvedTools.length > 0) {
          const toolResponses = await this.toolOrchestrator.executeBatch(
            approvedTools.map((tc: any) => ({
              id: tc.id,
              name: tc.name,
              arguments: this.safeJsonParse(tc.arguments),
            })),
            toolContext,
            abortSignal,
          );

          yield {
            type: "tool_calls_response",
            toolCallsResponse: toolResponses.map((tr) => ({
              name: tr.name,
              content: tr.content,
              toolCallId: tr.toolCallId,
            })),
            displayMessages: completedDisplayMessages.filter((_, index) => {
              const tc = assistantResponse.toolCalls[index];
              return approvedTools.some((at: any) => at.id === tc.id);
            }),
            contentId,
          };

          for (const res of toolResponses) {
            parts.push({
              role: "tool",
              name: res.name,
              content: res.content,
              toolCallId: res.toolCallId,
              messageId: responseMessageId,
              turnsId: turnsId,
            });
          }
        }

        // 为 rejected 工具生成错误响应
        if (rejectedTools.length > 0) {
          for (const rejected of rejectedTools) {
            // 从 decisions 中获取拒绝原因
            const decision =
              assistantResponse.metadata?.approvalContext?.decisions?.find(
                (d: any) => d.toolCallId === rejected.id,
              );

            // 构建错误消息：固定前缀 + 可选的原因
            let errorMessage = "用户拒绝了工具执行";
            if (decision?.reason) {
              errorMessage += `，原因：${decision.reason}`;
            }

            const errorResponse = {
              toolCallId: rejected.id,
              name: rejected.name,
              content: JSON.stringify({
                success: false,
                message: errorMessage,
              }),
              isError: true,
            };

            yield {
              type: "tool_calls_response",
              toolCallsResponse: [errorResponse],
            };

            parts.push({
              role: "tool",
              name: errorResponse.name,
              content: errorResponse.content,
              toolCallId: errorResponse.toolCallId,
              messageId: responseMessageId,
              turnsId: turnsId,
            });
          }
        }

        // 在持久化前，将最终的文案注入到 toolCalls 的 metadata 中
        this.displayManager.injectDisplayMessages(assistantResponse.toolCalls);
        needToContinue = true;
      }

      // 将本轮产生的所有消息（助手回复 + 工具响应）追加到会话上下文并持久化存储
      await conversationContext.appendParts(parts);

      this.logger.debug(
        `Iteration ${iterationCount} cleanup completed. Finish reason: ${assistantResponse.metadata?.finishReason}`,
      );
    } while (needToContinue);
    await conversationContext.persist();
  }

  /**
   * 执行单次 LLM 流式请求
   *
   * 该方法负责调用 LLM API 并实时处理流式响应，包括：
   * - 累加文本内容、思维链内容和工具调用参数到 accumulated
   * - 追踪思维链的开始和结束时间，用于计算思考时长
   * - 返回原始 chunk 和累加后的 accumulated（均为 LLMResponseChunk 格式）
   *
   * 注意：
   * - 该方法不直接 yield SSE 事件，由调用方负责转换和 yield
   * - 该方法不捕获异常，异常由调用方处理
   *
   * @param session 会话对象
   * @param messages 发送给 LLM 的完整消息列表
   * @param tools 可用工具定义数组（可选）
   * @param thinkingEffort 思考强度级别：'off' | 'on' | 'low' | 'medium' | 'high' | 'max' 等
   * @param abortSignal 中断信号（可选）
   * @yields { chunk: LLMResponseChunk; accumulated: LLMResponseChunk } 原始块和累加块
   */
  private async *executeLLMStream(
    session: any,
    messages: MessageRecord[],
    tools: any[] | undefined,
    thinkingEffort: string | undefined,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<
    { chunk: LLMResponseChunk; accumulated: LLMResponseChunk },
    any,
    unknown
  > {
    // 累加器：使用 LLMResponseChunk 格式保存累积状态
    const accumulated: LLMResponseChunk = {};

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
    }) as AsyncGenerator<LLMResponseChunk>;

    // 使用限流包装器合并高频 chunk，降低前端渲染压力
    const throttled = throttledStream(stream, this.THROTTLE_MS, abortSignal);

    // 遍历限流后的响应块
    for await (const chunk of throttled) {
      // 增量累加逻辑：将每个块的 content 追加到总内容中
      if (chunk.content) {
        accumulated.content = (accumulated.content || "") + chunk.content;
      }
      if (chunk.reasoningContent) {
        accumulated.reasoningContent =
          (accumulated.reasoningContent || "") + chunk.reasoningContent;
      }
      if (chunk.toolCalls) {
        this.accumulateToolCalls(accumulated, chunk.toolCalls);
      }

      // 累加 usage 统计和 finishReason，这些通常在最后一个块中返回
      if (chunk.usage) {
        accumulated.usage = chunk.usage;
      }
      if (chunk.finishReason) {
        accumulated.finishReason = chunk.finishReason;
      }

      // 返回原始 chunk 和累加后的 accumulated（由调用方决定如何 yield）
      yield { chunk, accumulated: { ...accumulated } };
    }
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
      const displayMessages = chunk.toolCalls.map((tc) => {
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
      contentId: (chunk as any).contentId,
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
    if (!currentChunk.metadata) {
      currentChunk.metadata = {};
    }

    if (
      streamError.name === "AbortError" ||
      streamError.message.includes("abort")
    ) {
      // 用户主动中止（客户端断开连接），标记为 user_abort 以便前端展示友好提示
      currentChunk.metadata.finishReason = "user_abort";
      currentChunk.metadata.error = "User aborted the request";
    } else if (
      streamError.message.includes("timed out") ||
      streamError.message.includes("timeout")
    ) {
      // 超时错误，标记为 timeout 并记录详细错误信息
      currentChunk.metadata.finishReason = "timeout";
      currentChunk.metadata.error = streamError.message;
    } else {
      // 其他 API 错误或运行时错误，标记为 error 并记录完整错误消息
      currentChunk.metadata.finishReason = "error";
      currentChunk.metadata.error = streamError.message;
    }
    this.recordThinkingFinished(currentTurnThinkingInfo, "api error");
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
    if (!jsonString || typeof jsonString !== "string") {
      return {};
    }

    try {
      const parsed = JSON.parse(jsonString);
      return parsed || {};
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to parse JSON arguments: ${jsonString.substring(0, 100)}... Error: ${errorMessage}`,
      );

      // 尝试修复常见的JSON格式问题，提高对模型输出不完美的容忍度
      try {
        let fixedString = jsonString.trim();

        // 修复1: 检测并提取第一个完整的JSON对象（处理重复输出的情况）
        // 例如：模型可能输出 {"a":1}{"a":1}，我们只取第一个完整对象
        const firstBraceIndex = fixedString.indexOf("{");
        if (firstBraceIndex >= 0) {
          let braceCount = 0;
          let endIndex = -1;

          for (let i = firstBraceIndex; i < fixedString.length; i++) {
            if (fixedString[i] === "{") {
              braceCount++;
            } else if (fixedString[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                endIndex = i + 1;
                break;
              }
            }
          }

          if (endIndex > 0) {
            fixedString = fixedString.substring(firstBraceIndex, endIndex);
            this.logger.debug(
              `Extracted first complete JSON object: ${fixedString}`,
            );
          }
        }

        // 修复2: 检查是否是未加引号的键值对格式，若是则包裹在花括号中
        if (fixedString.includes(":") && !fixedString.startsWith("{")) {
          fixedString = `{${fixedString}}`;
        }

        // 修复3: 替换单引号为双引号（简单的修复，处理 Python 风格的字典输出）
        fixedString = fixedString.replace(/'/g, '"');

        // 尝试再次解析
        const parsed = JSON.parse(fixedString);
        return parsed || {};
      } catch (secondError) {
        const secondErrorMessage =
          secondError instanceof Error
            ? secondError.message
            : String(secondError);
        this.logger.error(
          `Failed to fix and parse JSON arguments: ${secondErrorMessage}`,
        );
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
   * 并委托 ToolCallDisplayUtil 管理展示文案的更新。
   *
   * @param target 目标 LLM 响应块，其 toolCalls 数组会被原地修改
   * @param deltaCalls 本次收到的增量工具调用分片数组
   */
  private accumulateToolCalls(target: LLMResponseChunk, deltaCalls: any[]) {
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
        this.displayManager.initialize(
          index,
          delta.id,
          delta.name || "tool_call",
        );
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
   * 【新增】检查工具是否需要审批
   */
  private needsApproval(toolCalls: any[], session: any): boolean {
    const settings = session.settings || {};
    const approvalConfig = settings.toolApproval || {};

    // 如果全局禁用审批，返回 false
    if (approvalConfig.enabled === false) {
      return false;
    }

    const requiresApprovalTools = approvalConfig.requiresApproval || [];

    return toolCalls.some((tc: any) => {
      const toolName = tc.name;

      // 精确匹配
      if (requiresApprovalTools.includes(toolName)) {
        return true;
      }

      // 命名空间匹配（如 file__*）
      const namespace = toolName.split("__")[0];
      if (requiresApprovalTools.includes(`${namespace}__*`)) {
        return true;
      }

      return false;
    });
  }

  /**
   * 【新增】将工具按审批状态分类
   *
   * @param toolCalls 所有工具调用
   * @param metadata 消息的 metadata（包含 approvalContext）
   * @param session 会话对象（用于获取审批配置）
   * @returns 三类工具：pendingTools（需要审批但未决策）、approvedTools（已通过/不需要审批）、rejectedTools（被拒绝）
   */
  private classifyToolsByApproval(
    toolCalls: any[],
    metadata?: any,
    session?: any,
  ): {
    pendingTools: any[];
    approvedTools: any[];
    rejectedTools: any[];
  } {
    const pendingTools: any[] = [];
    const approvedTools: any[] = [];
    const rejectedTools: any[] = [];

    // 检查是否有审批上下文
    const approvalContext = metadata?.approvalContext;

    if (approvalContext && approvalContext.status !== "pending") {
      // 已审批场景：根据 decisions 分类
      const decisions = approvalContext.decisions || [];

      for (const tc of toolCalls) {
        const decision = decisions.find((d: any) => d.toolCallId === tc.id);

        if (!decision) {
          // 【异常】前端未对该工具做出决策，视为 pending
          pendingTools.push(tc);
        } else if (decision.decision === "approve") {
          approvedTools.push(tc);
        } else if (decision.decision === "reject") {
          rejectedTools.push(tc);
        }
      }
    } else {
      // 未审批场景：检查哪些工具需要审批
      const settings = session?.settings || {};
      const approvalConfig = settings.toolApproval || {};
      const requiresApprovalTools = approvalConfig.requiresApproval || [];

      for (const tc of toolCalls) {
        const needsApproval = this.isToolRequiresApproval(
          tc.name,
          requiresApprovalTools,
        );

        if (needsApproval) {
          pendingTools.push(tc);
        } else {
          approvedTools.push(tc); // 不需要审批的工具归为 approved
        }
      }
    }

    return { pendingTools, approvedTools, rejectedTools };
  }

  /**
   * 【辅助】检查单个工具是否需要审批
   */
  private isToolRequiresApproval(
    toolName: string,
    requiresApprovalTools: string[],
  ): boolean {
    // 精确匹配
    if (requiresApprovalTools.includes(toolName)) {
      return true;
    }

    // 命名空间匹配（如 file__*）
    const namespace = toolName.split("__")[0];
    if (requiresApprovalTools.includes(`${namespace}__*`)) {
      return true;
    }

    return false;
  }
}
