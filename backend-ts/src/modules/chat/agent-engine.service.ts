import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { PluginContext } from "../plugins/types/plugin.types";
import {
  MessageRecord,
  MessagePart,
  LLMResponseChunk,
} from "../llm-core/types/llm.types";
import { RequestContext } from "../../common/context/request-context";
import { throttledStream } from "./utils/stream-throttle.util";
import { partialParse } from "partial-json-parser";
import { SessionTokenTracker } from "./utils/session-token-tracker";
import { ISessionContext, ModelConfig } from "./session-context";
import { EventChunk } from "./types/event-chunk.types";
import { SummaryMode } from "./compression-engine";
import { RateLimitError } from "../llm-core/utils/retry.util";

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
 * 不管理会话生命周期——配置合并、上下文构建等数据准备工作由 ISessionContext 统一提供。
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
  private readonly THROTTLE_MS = 80;

  constructor(
    private toolOrchestrator: ToolOrchestrator,
    private llmService: LLMService,
    private tokenTracker: SessionTokenTracker,
  ) {}

  /**
   * 执行会话补全请求（主入口）
   *
   * 该方法采用异步生成器模式，实时向前端推送 LLM 的流式响应。
   * 整个流程受会话锁保护，确保同一时刻只有一个请求在处理该会话。
   *
   * 执行流程：
   * - 加载会话并更新最后活跃时间
   * - 委托 ISessionContext 提供所有运行配置
   * - 进入多轮工具调用循环，逐轮生成响应
   *
   * @param sessionContext 类型安全的会话上下文
   * @param messageId 触发本次补全的用户消息 ID
   * @param regenerationMode 再生模式（"overwrite" 覆盖旧回复 / "multi_version" 保留多版本 / "resume" 断点续传）
   * @param assistantMessageId 现有助手消息 ID（仅 multi_version 模式使用）
   * @param abortSignal 中断信号，用于客户端断开连接时中止 LLM 请求
   * @param resumeData 断点续传数据（如审批决策、表单数据等）
   * @yields SSE 的事件对象（create / text / think / tool_call / finish 等）
   */
  async *run(
    sessionContext: ISessionContext,
    userMessage: {
      id?: string;
      content?: string;
      files?: string[];
      replaceMessageId?: string;
      knowledgeBaseIds?: string[];
      metadata?: Record<string, any>;
    },
    regenerationMode: string = "overwrite",
    abortSignal?: AbortSignal,
    resumeData?: any,
  ): AsyncGenerator<EventChunk> {
    const sessionId = sessionContext.sessionId;

    // 预加载历史（统一提前，供 addUserMessage 做模式切换检测）
    // multi_version 模式用 userMessage.id 作为游标，限制加载范围
    const historyCursor =
      regenerationMode === "multi_version" ? userMessage?.id : undefined;
    await sessionContext.loadHistory(historyCursor);

    // 创建用户消息
    const createdUserMessage =
      regenerationMode === "overwrite"
        ? await sessionContext.addUserMessage(
            userMessage?.content,
            userMessage?.files || [],
            userMessage?.replaceMessageId,
            userMessage?.knowledgeBaseIds,
            userMessage?.metadata,
            undefined,
          )
        : null;

    // 必须在用户消息之后创建预生成助手消息 ID
    const preGenAssistantId = sessionContext.generateId();

    // 广播用户消息事件
    if (createdUserMessage) {
      yield {
        type: "user_message",
        messageId: createdUserMessage.id,
        contentId: createdUserMessage.contents[0].id,
        userMessage: createdUserMessage,
      };
    }

    const userMessageId = userMessage?.id || createdUserMessage?.id;
    if (!userMessageId) {
      throw new Error("userMessageId is required");
    }
    if (regenerationMode !== "resume") {
      sessionContext.setMessageCursor(userMessageId);
    }

    const generatorFn = async function* (this: AgentEngine) {
      yield* this.executeAgentLoop(
        sessionContext,
        userMessageId,
        regenerationMode,
        abortSignal,
        resumeData,
        preGenAssistantId,
      );
    }.bind(this);

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
   * - 最大迭代次数限制（100 次），防止无限循环
   * - SessionStreamManager 确保同一会话不会同时启动多个流
   *
   * @param sessionContext 类型安全的会话上下文（包含对话状态）
   * @param userMessageId 触发本次循环的用户消息 ID
   * @param regenerationMode 再生模式标识（'overwrite' | 'multi_version' | 'resume'）
   * @param assistantMessageId 现有助手消息 ID（可选）
   * @param abortSignal 中断信号（可选）
   * @param resumeData 断点续传数据（如审批决策、表单数据等）
   * @yields SSE 格式的事件对象
   */
  private async *executeAgentLoop(
    sessionContext: ISessionContext,
    userMessageId: string,
    regenerationMode: string,
    abortSignal?: AbortSignal,
    resumeData?: any,
    preGenAssistantId?: string,
  ): AsyncGenerator<EventChunk> {
    const resolved = sessionContext.getResolvedPlugins();
    const tools =
      resolved.length > 0
        ? ToolOrchestrator.toFlatToolDefs(resolved)
        : undefined;

    // 判断是否为断点模式

    let isResumeMode = regenerationMode === "resume";
    let responseMessageId: string;
    if (!isResumeMode) {
      // 创建新版本的助手消息
      responseMessageId = await sessionContext.addAssistantMessageVersion(
        userMessageId,
        preGenAssistantId,
      );
    }
    let needToContinue = false;

    // 记录 ReAct 循环开始时间，用于计算总耗时
    const loopStartTime = Date.now();

    // 工具调用轮次计数器
    let iterationCount = 0;
    // 回合拦截器触发次数（防止无限循环）
    let interceptorCount = 0;
    const MAX_INTERCEPTOR_ITERATIONS = 3;
    let finalFinishReason = "stop";
    let finalError: string | undefined;
    let finalUsage: any;
    do {
      iterationCount++;
      needToContinue = false;

      // 从会话上下文中获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史）
      let historyMessages = await sessionContext.getMessages();

      // 消息已加载，此时检查是否需要进入保存/压缩状态
      if (await sessionContext.shouldCompress()) {
        // onBeforeCompaction 回调：仅在需要二级压缩（摘要/丢弃）时触发
        const onBeforeCompaction = async () => {
          this.logger.debug(
            `onBeforeCompaction ${JSON.stringify(sessionContext.getMemoryConfig())}`,
          );
          if (
            sessionContext.getMemoryConfig().summaryMode ===
            SummaryMode.MEMORY_SYNC
          ) {
            this.logger.debug("run memory save shadow turn");
            await this.runMemorySaveShadowTurn(sessionContext, abortSignal);
            this.logger.debug("memory save shadow turn done");
          }
        };
        historyMessages = await sessionContext.compress(onBeforeCompaction);
        // 必须继续循环，确保压缩完成后再继续
        // needToContinue = true;
        // continue;
      }

      // 生成本轮助手回复的内容 ID，用于唯一标识该轮次的输出
      const assistantResponse: MessageRecord = {
        role: "assistant",
        content: "",
        messageId: responseMessageId,
        contentId: sessionContext.generateId(),
        metadata: {
          modelName: sessionContext.getModelConfig().modelName,
        },
      };
      if (isResumeMode) {
        const lastMessage = historyMessages[historyMessages.length - 1];
        if (
          lastMessage.metadata?.finishReason === "rate_limited" &&
          lastMessage.role === "assistant"
        ) {
          historyMessages.pop();
          isResumeMode = false;
          needToContinue = true;
          continue;
        }
        Object.assign(assistantResponse, lastMessage);
        responseMessageId = lastMessage.messageId;
        if (lastMessage.role === "tool") {
          isResumeMode = false;
          needToContinue = true;
          continue;
        } else if (lastMessage.role === "user") {
          this.logger.warn("invalid resume mode, last message is user");
          continue;
        }
        this.logger.debug("Enter resume mode");
      }

      // 断点模式：发送 update 事件
      yield {
        type: isResumeMode ? "update" : "create",
        messageId: responseMessageId,
        contentId: assistantResponse.contentId,
        modelName: sessionContext.getModelConfig().modelName,
        requestId: RequestContext.current()?.requestId,
        parentId: userMessageId,
      };

      // 构建待保存的消息记录数组
      const parts: MessageRecord[] = [];

      // 【关键】如果不是断点模式，或者需要继续循环，才调用 LLM
      if (isResumeMode) {
        isResumeMode = false;
      } else {
        const currentTurnThinkingInfo = new ThinkingTimeInfo();
        let streamAborted = false;

        try {
          const streamResult = this.executeLLMStream(
            historyMessages,
            sessionContext.getModelConfig(),
            ToolOrchestrator.toFlatToolDefs(
              sessionContext.getResolvedPlugins(),
            ),
            sessionContext.getThinkingEffort(),
            abortSignal,
          );
          for await (const { chunk, accumulated } of streamResult) {
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

            const yieldEvent = this.toEventChunk(
              chunk,
              accumulated,
              undefined,
              assistantResponse.contentId,
            );
            if (yieldEvent) {
              if (yieldEvent.type === "finish") {
                yieldEvent.contextStats = {
                  usedTokens: sessionContext.getTokenCount(),
                  effectiveContextWindow:
                    sessionContext.getEffectiveContextWindow(),
                };
              }
              yield yieldEvent;
            }

            // 直接写入 assistantResponse，无需中间变量
            assistantResponse.content = accumulated.content || "";
            if (accumulated.reasoningContent) {
              assistantResponse.reasoningContent = accumulated.reasoningContent;
            }
            if (accumulated.toolCalls) {
              assistantResponse.toolCalls = accumulated.toolCalls;
            }
            if (accumulated.usage) {
              assistantResponse.metadata.usage = accumulated.usage;
            }
            if (accumulated.signature) {
              assistantResponse.metadata.signature = accumulated.signature;
            }
            if (accumulated.redactedData) {
              assistantResponse.metadata.redactedData =
                accumulated.redactedData;
            }
            if (accumulated.finishReason) {
              assistantResponse.metadata.finishReason =
                accumulated.finishReason;
            }
          }
        } catch (error) {
          streamAborted = true;
          const streamError =
            error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Stream error in agent loop:${streamError.message}`,
            streamError.stack,
          );
          this.handleStreamError(
            assistantResponse,
            currentTurnThinkingInfo,
            streamError,
          );
        }

        // LLM SDK 收到 abort 信号后可能直接关闭流（不抛异常），需手动检测
        if (!streamAborted && abortSignal?.aborted) {
          streamAborted = true;
          this.handleStreamError(
            assistantResponse,
            currentTurnThinkingInfo,
            new Error("AbortError"),
          );
        }

        // 流结束后计算思考时长（仅一次，确保在所有 recordThinkingFinished 调用之后）
        assistantResponse.metadata.thinkingDurationMs =
          this.calculateThinkingDuration(currentTurnThinkingInfo);

        // 中止时修复不完整的 toolCalls
        if (streamAborted && assistantResponse.toolCalls) {
          assistantResponse.toolCalls = assistantResponse.toolCalls.map(
            (tc: any) => ({
              ...tc,
              arguments: this.repairToolCallArguments(tc.arguments),
              outcome: "aborted",
            }),
          );
        }

        // 共享后处理：token 统计（正常和中止都需要，如果 usage 已到达）
        if (assistantResponse.metadata?.usage) {
          this.tokenTracker.addUsage(
            sessionContext.getWorkspacePath(),
            assistantResponse.metadata.usage.promptTokens,
            assistantResponse.metadata.usage.completionTokens,
            assistantResponse.metadata.usage.cachedTokens?.read,
          );
        }

        // 先将 assistantResponse 和合成工具响应放入 parts
        if (assistantResponse.metadata?.finishReason !== "rate_limited") {
          parts.push(assistantResponse);
        }
        // 中止时在助手消息之后注入合成工具响应（保证顺序：assistant → tool）
        if (streamAborted && assistantResponse.toolCalls) {
          for (const tc of assistantResponse.toolCalls) {
            parts.push({
              role: "tool",
              name: tc.name,
              content:
                "<system_reminder>Request aborted by user</system_reminder>",
              toolCallId: tc.id,
              messageId: responseMessageId,
            });
          }
          await sessionContext.appendParts(parts);
          parts.length = 0;
        }

        // 发送 finish 事件
        yield {
          type: "finish",
          finishReason: assistantResponse.metadata?.finishReason || "error",
          error: streamAborted
            ? assistantResponse.metadata?.error || "Stream aborted"
            : undefined,
          usage: assistantResponse.metadata?.usage,
          contentId: assistantResponse.contentId,
          contextStats: {
            usedTokens: sessionContext.getTokenCount(),
            effectiveContextWindow: sessionContext.getEffectiveContextWindow(),
          },
        };
      }

      // 处理工具执行：若模型返回了工具调用指令，则批量执行所有工具
      // 中止时不执行工具（已在 catch 中注入合成响应）
      if (assistantResponse.toolCalls && tools && !abortSignal?.aborted) {
        // 【工具轮次限制】检查是否达到最大工具调用轮次
        const MAX_TOOL_ITERATIONS = 100;
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
            contextStats: {
              usedTokens: sessionContext.getTokenCount(),
              effectiveContextWindow:
                sessionContext.getEffectiveContextWindow(),
            },
          };

          // 持久化当前消息（包含断点元数据），确保刷新后仍能显示继续按钮
          await sessionContext.appendParts(parts);
          finalFinishReason = "max_iterations_reached";
          finalUsage = assistantResponse.metadata?.usage;
          break;
        }

        // 【关键】将工具分为三组并执行
        const execResult = await this.executeToolsAndBuildParts(
          assistantResponse,
          sessionContext,
          abortSignal,
        );

        // 【原子性审批】需要审批时提前终止
        if (execResult.approvalContext) {
          assistantResponse.metadata.approvalContext =
            execResult.approvalContext;
          yield {
            type: "finish",
            finishReason: "approval_required",
            usage: assistantResponse.metadata?.usage,
            contextStats: {
              usedTokens: sessionContext.getTokenCount(),
              effectiveContextWindow:
                sessionContext.getEffectiveContextWindow(),
            },
          };
          needToContinue = false;
        } else if (execResult.toolParts.length > 0) {
          yield execResult.toolEvent!;
          parts.push(...execResult.toolParts);
          needToContinue = true;
        }
      }

      // 将本轮产生的所有消息（助手回复 + 工具响应）追加到会话上下文并持久化存储
      if (parts.length > 0) {
        await sessionContext.appendParts(parts);
      }

      this.logger.debug(
        `Iteration ${iterationCount} completed. reason: ${assistantResponse.metadata?.finishReason} continue=${needToContinue}`,
      );

      // 开发模式下每次迭代完成后保存对话历史到 .guada/logs 便于审计
      this.saveTranscript(
        historyMessages,
        parts,
        sessionContext.getWorkspacePath(),
        sessionContext.sessionId,
      );

      // 【回合拦截器】仅在正常结束时检查
      const finishReason = assistantResponse.metadata?.finishReason;
      const isNormalFinish =
        !needToContinue &&
        !abortSignal?.aborted &&
        (finishReason === "stop" || !finishReason);

      if (
        isNormalFinish &&
        interceptorCount < MAX_INTERCEPTOR_ITERATIONS &&
        (await this.runTurnInterceptors(sessionContext, responseMessageId))
      ) {
        interceptorCount++;
        this.logger.log(
          `Turn interceptor injected hidden message (count=${interceptorCount})`,
        );
        needToContinue = true;
      }

      finalFinishReason = assistantResponse.metadata?.finishReason || "stop";
      finalError = assistantResponse.metadata?.error;
      finalUsage = assistantResponse.metadata?.usage;
    } while (needToContinue);

    // 保存结束信息到 Message 级别 metadata
    const loopDuration = Date.now() - loopStartTime;
    const finishMeta: Record<string, any> = {
      finishReason: finalFinishReason,
      ...(finalError ? { error: finalError } : {}),
      ...(finalUsage ? { usage: finalUsage } : {}),
    };
    await sessionContext.finalizeMessage(
      responseMessageId,
      loopDuration,
      finishMeta,
    );

    await sessionContext.persist();
  }

  /**
   * 执行回合拦截器
   *
   * 收集所有已启用插件的 TurnInterceptor，并行调用。
   * 如果任一拦截器返回非 null，则合并为一条 hidden user 消息追加到当前
   * assistant 消息下（同 responseMessageId），返回 true 表示需要继续对话。
   *
   * @param sessionContext 会话上下文
   * @param responseMessageId 当前 assistant 消息 ID
   * @returns 是否注入了拦截消息（true → 触发新一轮 LLM 调用）
   */
  private async runTurnInterceptors(
    sessionContext: ISessionContext,
    responseMessageId: string,
  ): Promise<boolean> {
    const resolved = sessionContext.getResolvedPlugins();
    const allInterceptors = resolved
      .filter((rp) => rp.enabled && rp.interceptors.length > 0)
      .flatMap((rp) => rp.interceptors);

    if (allInterceptors.length === 0) return false;

    const pluginCtx: PluginContext = { session: sessionContext };
    const results = await Promise.all(
      allInterceptors.map((i) =>
        i.intercept(pluginCtx).catch((err) => {
          this.logger.warn(`Interceptor ${i.name} error: ${err.message}`);
          return null;
        }),
      ),
    );
    const messages = results.filter((r): r is string => r != null);
    if (messages.length === 0) return false;

    await sessionContext.appendParts([
      {
        role: "user",
        content: messages.join("\n\n"),
        messageId: responseMessageId,
        contentId: sessionContext.generateId(),
        metadata: { hidden: true },
      },
    ]);
    return true;
  }

  /**
   * 执行 LLM 流式请求，返回累积的响应块。
   *
   * @param messages 发送给 LLM 的消息列表
   * @param modelConfig 模型配置（含运行时调用参数）
   * @param tools 工具定义列表
   * @param thinkingEffort 思考强度
   * @param abortSignal 中断信号
   * @yields { chunk: LLMResponseChunk; accumulated: LLMResponseChunk }
   */
  private async *executeLLMStream(
    messages: MessageRecord[],
    modelConfig: ModelConfig,
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

    this.logger.debug(
      `[LLM] ${modelConfig.modelName} temperature=${modelConfig.config.temperature} topP=${modelConfig.config.topP} frequencyPenalty=${modelConfig.config.frequencyPenalty}`,
    );

    // 调用 LLM 服务发起流式请求，传递所有必要的配置参数
    const stream = this.llmService.completions({
      model: modelConfig.modelName,
      messages,
      tools,
      temperature: modelConfig.config.temperature,
      topP: modelConfig.config.topP,
      frequencyPenalty: modelConfig.config.frequencyPenalty,
      maxTokens: modelConfig.config.maxOutputTokens,
      providerConfig: modelConfig.provider,
      stream: true,
      thinkingEffort,
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
      // 累加 Anthropic thinking signature（来自 signature_delta 事件）
      if (chunk.signature) {
        accumulated.signature = chunk.signature;
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
   * @param contentId 内容标识符
   * @returns SSE 事件对象，若 chunk 为空则返回 null
   */
  private toEventChunk(
    chunk: LLMResponseChunk,
    accumulated?: LLMResponseChunk,
    runtime?: any,
    contentId?: string,
  ): EventChunk | null {
    // 优先使用显式 type，兼容旧数据无 type 时的字段推断
    let eventType: EventChunk["type"];

    if (chunk.type === "finish" || chunk.finishReason) {
      eventType = "finish";
    } else if (chunk.type === "think" || chunk.reasoningContent) {
      eventType = "think";
    } else if (chunk.type === "tool_call" || chunk.toolCalls) {
      eventType = "tool_call";
    } else if (chunk.type === "text" || chunk.content) {
      eventType = "text";
    } else if (chunk.usage) {
      // 只有 usage 没有内容的情况（通常是最后一个块）
    } else {
      // 其他未知情况，跳过不处理
      return null;
    }

    const isFinish = eventType === "finish";

    return {
      type: eventType,
      content: isFinish ? accumulated?.content : chunk.content,
      reasoningContent: isFinish
        ? accumulated?.reasoningContent
        : chunk.reasoningContent,
      toolCalls: isFinish ? accumulated?.toolCalls : chunk.toolCalls,
      finishReason: chunk.finishReason,
      usage: chunk.usage,
      contentId: contentId,
    } as EventChunk;
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
      streamError.message.toLowerCase().includes("abort")
    ) {
      // 用户主动中止（客户端断开连接），标记为 user_cancel 以便前端展示友好提示
      currentChunk.metadata.finishReason = "user_cancel";
      currentChunk.metadata.error = undefined;
    } else if (
      streamError.message.includes("timed out") ||
      streamError.message.includes("timeout")
    ) {
      // 超时错误，标记为 timeout 并记录详细错误信息
      currentChunk.metadata.finishReason = "timeout";
      currentChunk.metadata.error = streamError.message;
    } else if (streamError instanceof RateLimitError) {
      // 429 限流错误（重试已耗尽），标记为 rate_limited 以便前端展示继续按钮
      currentChunk.metadata.finishReason = "rate_limited";
      currentChunk.metadata.error = streamError.message;
    } else {
      // 其他 API 错误或运行时错误，标记为 error 并记录完整错误消息
      currentChunk.metadata.finishReason = "error";
      currentChunk.metadata.error = streamError.message;
    }
    this.recordThinkingFinished(currentTurnThinkingInfo, "api error");
  }

  /**
   * 累加工具调用参数（处理流式分片）
   *
   * LLM 在流式输出工具调用时，会将参数分成多个块逐步发送。
   * 该方法负责将这些分片按 index 合并为完整的工具调用对象。
   *
   * @param target 目标 LLM 响应块，其 toolCalls 数组会被原地修改
   * @param deltaCalls 本次收到的增量工具调用分片数组
   */
  private accumulateToolCalls(target: LLMResponseChunk, deltaCalls: any[]) {
    if (!target.toolCalls) target.toolCalls = [];

    for (const delta of deltaCalls) {
      const index = delta.index;

      // 若该索引位置尚无工具调用对象，则创建新对象并初始化字段
      // 注意：只在新创建时设置 id/name，后续 delta 事件（如 content_block_stop）不覆盖
      if (!target.toolCalls[index]) {
        target.toolCalls[index] = {
          type: "function",
          id: delta.id || "",
          name: delta.name || "",
          arguments: "",
          index: index,
        };
      }

      const tc = target.toolCalls[index];

      // 将本次分片的参数字符串追加到已有参数中，实现完整参数的重建
      if (delta?.arguments) {
        tc.arguments += delta.arguments;
      }
    }

    // 清理数组空洞（thinking block 可能占用了低索引但未创建 toolCalls 条目）
    // 使用 filter 去除 undefined 条目，保持连续
    target.toolCalls = target.toolCalls.filter(Boolean);
  }

  /**
   * 修复不完整的工具调用参数 JSON
   *
   * 用户中止流式输出时，toolCall.arguments 可能是截断的 JSON 字符串。
   * 使用 partialParse 解析后重新序列化为合法 JSON，确保下游消费方（LLM 回传、持久化）不报错。
   *
   * @param args 原始参数字符串（可能不完整）
   * @returns 合法 JSON 字符串
   */
  private repairToolCallArguments(args: string): string {
    if (!args || typeof args !== "string") return "{}";
    try {
      JSON.parse(args);
      return args;
    } catch {
      try {
        const parsed = partialParse(args);
        return JSON.stringify(parsed);
      } catch {
        return "{}";
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
    }

    // 两个时间戳都为空：模型未产生思维链，属于正常情况，无需告警
    if (
      !currentTurnThinkingInfo.thinkingStartedAt &&
      !currentTurnThinkingInfo.thinkingFinishedAt
    ) {
      return null;
    }

    // 仅一个时间戳存在：思考时间追踪不完整，可能存在逻辑问题
    this.logger.warn(
      `Thinking timestamps incomplete. ` +
        `Has start: ${currentTurnThinkingInfo.thinkingStartedAt !== null}, ` +
        `Has finish: ${currentTurnThinkingInfo.thinkingFinishedAt !== null}`,
    );
    return null;
  }

  /**
   * 开发模式下保存当前对话历史到 .guada/logs（每次覆盖，便于审计）
   */
  private saveTranscript(
    historyMessages: MessageRecord[],
    newParts: MessageRecord[],
    workspacePath: string,
    sessionId: string,
  ): void {
    // 仅开发模式下保存
    if (process.env.NODE_ENV === "production" || !workspacePath || !sessionId) {
      return;
    }
    try {
      const transcriptDir = path.join(workspacePath, ".guada", "logs");
      fs.mkdirSync(transcriptDir, { recursive: true });
      const filePath = path.join(transcriptDir, `${sessionId}_transcript.json`);
      const allMessages = [...historyMessages, ...newParts];
      const data = allMessages.map((m) => ({
        role: m.role,
        metadata: m.metadata,
        content:
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        toolCalls: m.toolCalls
          ? m.toolCalls.map((tc) => ({
              name: tc.name,
              arguments: tc.arguments,
            }))
          : undefined,
        toolCallId: m.toolCallId,
        name: m.name,
        reasoningContent: m.reasoningContent,
      }));
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      this.logger.warn(
        `保存对话历史失败: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * 将工具按审批状态分类
   *
   * @param toolCalls 所有工具调用
   * @param metadata 消息的 metadata（包含 approvalContext）
   * @param sessionContext 会话上下文（用于获取审批配置）
   * @returns 三类工具：pendingTools（需要审批但未决策）、approvedTools（已通过/不需要审批）、rejectedTools（被拒绝）
   */
  private classifyToolsByApproval(
    toolCalls: any[],
    metadata?: any,
    sessionContext?: ISessionContext,
  ): {
    pendingTools: any[];
    approvedTools: any[];
    rejectedTools: any[];
  } {
    const pendingTools: any[] = [];
    const approvedTools: any[] = [];
    const rejectedTools: any[] = [];

    // 防御：过滤掉 undefined 或无效的工具调用
    const validToolCalls = (toolCalls || []).filter((tc: any) => tc && tc.name);

    // 检查是否有审批上下文
    const approvalContext = metadata?.approvalContext;

    if (approvalContext && approvalContext.status !== "pending") {
      // 已审批场景：根据 decisions 分类
      const decisions = approvalContext.decisions || [];

      for (const tc of validToolCalls) {
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
      const approvalConfig = sessionContext?.getToolApprovalConfig();
      const requiresApprovalTools = approvalConfig?.requiresApproval || [];

      for (const tc of validToolCalls) {
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

    return false;
  }

  /**
   * 执行影子轮次：在压缩前静默调用 LLM 保存记忆。
   *
   * 使用对话模型 + 仅文件读写工具，让 AI 自行判断需要保存的内容。
   * 整个交互不入库，不 yield SSE 事件。
   * 最多 5 轮工具调用，无工具调用即提前结束。
   */
  async runMemorySaveShadowTurn(
    sessionContext: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // 切换到 memory 模式：getResolvedPlugins() 只返回 memory 插件，
    // getSettings('skills') 返回空，确保 LLM 和工具执行层一致受限
    const originalMode = sessionContext.getRunMode();
    await sessionContext.setRunMode("memory");
    try {
      // 跳过工具提示词注入（影子轮次只需要记忆和文件工具，不需要 skill 描述等）
      const messages = await sessionContext.getMessages();
      const shadowMessages: MessageRecord[] = [];

      const modelConfig = sessionContext.getModelConfig();

      // 组装指令消息（history 中不含系统提示词，此处自行注入）
      const instructionParts: string[] = [
        `<system>
[BEGIN SILENT SYSTEM PROCESS - MEMORY MAINTENANCE]
⚠️ CRITICAL MODE SWITCH: You are currently executing a background system routine. 
You are NOT in a conversation with the user. Do not attempt to answer the user's previous prompt in this specific turn.
Your output will be parsed by the system, not read by the user.

【OBJECTIVE】
The context is too long and will be compressed. The conversation history may be trimmed or discarded.
Scan the conversation history to see if there is any content that needs long-term memory. If there is, use the memory tool to save it.

【EVALUATION LOGIC】
Scan history. ONLY trigger an update if:
- New explicit long-term preferences/habits found.
- Critical factual corrections provided.
- Existing memory conflicts or is outdated.
(Note: If <factual-memory/> is already accurate, do nothing.)

【EXECUTION PROTOCOL】
1. IF NO update needed:
   - Output EXACTLY: DONE
   - STOP immediately.

2. IF update IS needed:
   - Use memory tool ('memory') to update memory.
   - Max 5 tool calls.
   - After tools finish, Output EXACTLY: DONE
   - STOP immediately.

【STRICT OUTPUT FORMAT】
- The ONLY valid output string is "DONE".
- Any other text (including explanations, apologies, or reasoning) will cause a system error.
- Do not worry about the user's pending questions; the system will return to normal mode after receiving "DONE".
[END SILENT SYSTEM PROCESS]
</system>`,
      ];

      shadowMessages.push({
        role: "user",
        content: instructionParts.join("\n"),
      });

      // 与主循环共用 executeLLMStream，保证参数一致
      const MAX_ROUNDS = 5;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        try {
          const streamResult = this.executeLLMStream(
            messages.concat(shadowMessages),
            modelConfig,
            ToolOrchestrator.toFlatToolDefs(
              sessionContext.getResolvedPlugins(),
            ),
            sessionContext.getThinkingEffort(),
            abortSignal,
          );

          let accumulated: LLMResponseChunk = {};
          for await (const { accumulated: acc } of streamResult) {
            accumulated = acc;
          }

          shadowMessages.push({
            role: "assistant",
            reasoningContent: accumulated.reasoningContent || null,
            content: accumulated.content || null,
            toolCalls: accumulated.toolCalls,
          });
          if (!accumulated.toolCalls?.length) break;

          const responses = await this.toolOrchestrator.executeBatch(
            accumulated.toolCalls.map((tc: any) => ({
              id: tc.id,
              name: tc.name,
              arguments: (() => {
                try {
                  return typeof tc.arguments === "string"
                    ? JSON.parse(tc.arguments)
                    : tc.arguments;
                } catch {
                  return {};
                }
              })(),
            })),
            sessionContext,
          );
          for (const r of responses) {
            shadowMessages.push({
              role: "tool",
              content: r.content,
              toolCallId: r.toolCallId,
              name: r.name,
            });
          }
        } catch (error: any) {
          this.logger.error(`记忆保存第${round}轮失败: ${error.message}`);
          break;
        }
      }
      // 落盘原始交互记录
      try {
        const logDir = path.join(
          sessionContext.getWorkspacePath(),
          ".guada",
          "logs",
        );
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(
          path.join(logDir, "compression.jsonl"),
          JSON.stringify({
            time: new Date().toISOString(),
            sessionId: sessionContext.sessionId,
            records: [messages[0] || {}].concat(shadowMessages),
          }) + "\n",
        );
      } catch (e) {
        // 非关键
      }
      // 不入库，不 yield
    } finally {
      await sessionContext.setRunMode(originalMode);
    }
  }

  /**
   * 执行工具并构建入库数据和事件（不 yield，不入库）
   *
   * 由 executeAgentLoop 调用，返回执行结果后由调用方负责 yield 和 persist。
   */
  private async executeToolsAndBuildParts(
    assistantResponse: MessageRecord,
    sessionContext: ISessionContext,
    abortSignal?: AbortSignal,
  ): Promise<{
    toolParts: MessageRecord[];
    toolEvent?: EventChunk;
    approvalContext?: any;
  }> {
    const toolCalls = assistantResponse.toolCalls;
    if (!toolCalls) return { toolParts: [] };
    // 1. 分为三组
    const { pendingTools, approvedTools, rejectedTools } =
      this.classifyToolsByApproval(
        toolCalls,
        assistantResponse.metadata,
        sessionContext,
      );

    // 2. 需要审批 → 返回 approvalContext
    if (pendingTools.length > 0) {
      return {
        toolParts: [],
        approvalContext: {
          type: "approval",
          status: "pending",
          pendingToolCallIds: pendingTools.map((tc: any) => tc.id),
          createdAt: new Date().toISOString(),
        },
      };
    }

    // 3. 执行 approved + 为 rejected 生成错误响应
    const toolResponses: any[] = [];

    if (approvedTools.length > 0) {
      const results = await this.toolOrchestrator.executeBatch(
        approvedTools.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          arguments: (() => {
            try {
              return typeof tc.arguments === "string"
                ? JSON.parse(tc.arguments)
                : tc.arguments;
            } catch {
              return {};
            }
          })(),
        })),
        sessionContext,
        abortSignal,
      );
      toolResponses.push(...results);

      for (let i = 0; i < approvedTools.length; i++) {
        const at = approvedTools[i];
        const tc = assistantResponse.toolCalls?.find(
          (t: any) => t.id === at.id,
        );
        if (tc) {
          if (!tc.metadata) tc.metadata = {};
          const result = results[i];
          tc.outcome = result?.isError ? "error" : "success";
          if (result) result.outcome = tc.outcome;
        }
      }
    }

    for (const rejected of rejectedTools) {
      const decision =
        assistantResponse.metadata?.approvalContext?.decisions?.find(
          (d: any) => d.toolCallId === rejected.id,
        );
      let errorMessage = "用户拒绝了工具执行";
      if (decision?.reason) errorMessage += `，原因：${decision.reason}`;
      toolResponses.push({
        toolCallId: rejected.id,
        name: rejected.name,
        content: JSON.stringify({ success: false, message: errorMessage }),
        isError: true,
        outcome: "rejected",
      });
      const tc = assistantResponse.toolCalls?.find(
        (t: any) => t.id === rejected.id,
      );
      if (tc) tc.outcome = "rejected";
    }

    if (toolResponses.length === 0) {
      return { toolParts: [] };
    }

    // 构建事件
    const toolEvent: EventChunk = {
      type: "tool_calls_response",
      toolCallsResponse: toolResponses.map((tr: any) => ({
        name: tr.name,
        content: tr.content,
        toolCallId: tr.toolCallId,
        outcome: tr.outcome,
      })),
      contentId: assistantResponse.contentId,
    };

    // 构建 parts（tool 消息 + 图片消息）
    const toolParts: MessageRecord[] = [];
    const pendingImageParts: MessagePart[] = [];

    for (const res of toolResponses) {
      toolParts.push({
        role: "tool",
        name: res.name,
        content: res.content,
        toolCallId: res.toolCallId,
        messageId: assistantResponse.messageId,
      });

      if (res.images && res.images.length > 0) {
        pendingImageParts.push(
          { type: "text", text: res.content || "" },
          ...res.images.map((img) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${img.media_type};base64,${img.data}`,
            },
          })),
        );
      }
    }

    if (pendingImageParts.length > 0) {
      toolParts.push({
        role: "user",
        content: pendingImageParts,
        messageId: assistantResponse.messageId,
        contentId: sessionContext.generateId(),
        metadata: { hidden: true },
      });
    }

    return { toolParts, toolEvent };
  }
}
