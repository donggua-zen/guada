import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs";
import { LLMService } from "../llm-core/llm.service";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { PluginManager } from "../plugins/plugin.manager";
import { MessageRecord, LLMResponseChunk } from "../llm-core/types/llm.types";
import { RequestContext } from "../../common/context/request-context";
import { throttledStream } from "./utils/stream-throttle.util";
import { ToolCallDisplayUtil } from "./utils/tool-call-display.util";
import { ISessionContext, ModelConfig } from "./session-context";
import { ToolRuntime } from "../tools/tool-context";
import { EventChunk } from "./types/event-chunk.types";
import { partialParse } from "partial-json-parser";
import { SummaryMode } from "./compression-engine";

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
    private pluginManager: PluginManager,
    private llmService: LLMService,
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
    messageId: string,
    regenerationMode: string = "overwrite",
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
    resumeData?: any,
  ): AsyncGenerator<EventChunk> {
    const sessionId = sessionContext.sessionId;

    const generatorFn = async function* (this: AgentEngine) {
      try {
        yield* this.executeAgentLoop(
          sessionContext,
          messageId,
          regenerationMode,
          assistantMessageId,
          abortSignal,
          resumeData,
        );
      } catch (error) {
        throw error;
      }
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
   * - 最大迭代次数限制（40 次），防止无限循环
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
    assistantMessageId?: string,
    abortSignal?: AbortSignal,
    resumeData?: any,
  ): AsyncGenerator<EventChunk> {
    const toolContext = sessionContext.getToolContext();
    const tools = toolContext?.getFlatTools();

    // 判断是否为断点模式

    let isResumeMode = regenerationMode === "resume";
    let assistantResponse: MessageRecord | null = null;
    let turnsId: string;
    let responseMessageId: string;

    if (!isResumeMode) {
      // 【正常模式】生成新的 turnsId 和 messageId

      // 生成本次对话轮次的唯一 ID，用于关联同一轮中的所有消息和工具调用
      turnsId = sessionContext.generateId();

      // 准备助手回复的消息容器，根据再生模式决定是覆盖旧回复还是创建新版本
      responseMessageId = await sessionContext.prepareAssistantResponse(
        userMessageId,
        regenerationMode,
        turnsId,
        assistantMessageId,
      );
    }
    let needToContinue = false;

    // 工具调用轮次计数器
    let iterationCount = 0;
    sessionContext.setMessageCursor(userMessageId);
    do {
      iterationCount++;
      needToContinue = false;

      // 从会话上下文中获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史）
      const historyMessages = await sessionContext.getMessages();

      // 消息已加载，此时检查是否需要进入保存/压缩状态
      if (await sessionContext.shouldCompress()) {
        // onStage2 回调：仅在需要二级压缩（摘要/丢弃）时触发
        const onStage2 = async () => {
          console.log("onStage2", sessionContext.getMemoryConfig());
          if (
            sessionContext.getMemoryConfig().summaryMode ===
            SummaryMode.MEMORY_SYNC
          ) {
            console.log("run memory save shadow turn");
            await this.runMemorySaveShadowTurn(sessionContext, abortSignal);
            console.log("memory save shadow turn done");
          }
        };
        await sessionContext.compress(onStage2);
        // 必须继续循环，确保压缩完成后再继续
        needToContinue = true;
        continue;
      }

      // 生成本轮助手回复的内容 ID，用于唯一标识该轮次的输出
      let contentId = sessionContext.generateId();
      assistantResponse = {
        role: "assistant",
        content: "",
        messageId: responseMessageId,
        contentId: contentId,
        turnsId: turnsId,
        metadata: {
          modelName: sessionContext.getModelConfig().modelName,
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
        let lastAcc: LLMResponseChunk | undefined;

        try {
          // 执行 LLM 流式请求，获取原始 chunk 和累加结果
          const streamResult = this.executeLLMStream(
            historyMessages,
            sessionContext.getModelConfig(),
            sessionContext.getToolContext()?.getFlatTools(),
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
              toolContext,
              contentId,
            );
            if (yieldEvent) {
              yield yieldEvent;
            }

            // 保存最新累加状态，流结束后写入 assistantResponse
            lastAcc = { ...accumulated };
          }

          // 流结束后，将 accumulated 写入 assistantResponse
          if (lastAcc) {
            assistantResponse.content = lastAcc.content || "";
            if (lastAcc.reasoningContent) {
              assistantResponse.reasoningContent = lastAcc.reasoningContent;
            }
            if (lastAcc.toolCalls) {
              assistantResponse.toolCalls = lastAcc.toolCalls;
            }
            if (lastAcc.usage) {
              assistantResponse.metadata.usage = lastAcc.usage;
            }
            // 保存 Anthropic thinking signature，用于后续多轮回传
            if (lastAcc.signature) {
              assistantResponse.metadata.signature = lastAcc.signature;
            }
            if (lastAcc.redactedData) {
              assistantResponse.metadata.redactedData = lastAcc.redactedData;
            }
            assistantResponse.metadata = {
              ...assistantResponse.metadata,
              finishReason: lastAcc.finishReason,
              thinkingDurationMs: this.calculateThinkingDuration(
                currentTurnThinkingInfo,
              ),
            };
          }
        } catch (error) {
          // 由外部捕获并处理流式异常
          const streamError =
            error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Stream error in agent loop:${streamError.message}`,
            streamError.stack,
          );
          // 使用 handleStreamError 分类处理错误并设置状态
          this.handleStreamError(
            assistantResponse,
            currentTurnThinkingInfo,
            streamError,
          );
          if (!abortSignal || !abortSignal.aborted) {
            yield {
              type: "finish",
              finishReason: "error",
              error: streamError.message,
              usage: lastAcc?.usage,
              contentId,
            };
          }
        }

        parts.push(assistantResponse);
      }

      // 处理工具执行：若模型返回了工具调用指令，则批量执行所有工具
      if (assistantResponse.toolCalls && tools) {
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
          };

          // 持久化当前消息（包含断点元数据），确保刷新后仍能显示继续按钮
          await sessionContext.appendParts(parts);
          break;
        }

        // 【关键】将工具分为三组
        const { pendingTools, approvedTools, rejectedTools } =
          this.classifyToolsByApproval(
            assistantResponse.toolCalls,
            assistantResponse.metadata,
            sessionContext,
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

          await sessionContext.appendParts(parts);

          break;
        }

        // 【已处理场景】执行 approved 工具 + 为 rejected 工具生成错误响应
        // 工具执行完毕后，重新格式化展示文案（此时已完成状态），更新到 assistant metadata，
        // 再通过 tool_calls_response 事件传送给前端（工具结果本身不持久化文案）

        // 执行 approved 工具（包括已通过审批和不需要审批的）
        let toolResponses: any[] = [];
        if (approvedTools.length > 0) {
          const toolContext = sessionContext.getToolContext();
          toolResponses = await this.toolOrchestrator.executeBatch(
            approvedTools.map((tc: any) => ({
              id: tc.id,
              name: tc.name,
              arguments: partialParse(tc.arguments) || {},
            })),
            toolContext,
            abortSignal,
          );

          // 工具执行完毕，重新格式化文案（已完成状态）并更新到 assistant toolCalls metadata
          const toolCallDisplayMessages = approvedTools.map((at: any) => {
            const tc = assistantResponse.toolCalls?.find(
              (t: any) => t.id === at.id,
            );
            if (tc) {
              if (!tc.metadata) tc.metadata = {};
              tc.metadata.displayMessage = this.displayManager.format(
                tc.name,
                tc.arguments,
                false,
                toolContext,
              );
              return tc.metadata.displayMessage;
            }
            return undefined;
          });

          yield {
            type: "tool_calls_response",
            toolCallsResponse: toolResponses.map((tr) => ({
              name: tr.name,
              content: tr.content,
              toolCallId: tr.toolCallId,
            })),
            displayMessages: toolCallDisplayMessages,
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
        needToContinue = true;
      }

      // 将本轮产生的所有消息（助手回复 + 工具响应）追加到会话上下文并持久化存储
      await sessionContext.appendParts(parts);

      this.logger.debug(
        `Iteration ${iterationCount} cleanup completed. Finish reason: ${assistantResponse.metadata?.finishReason}`,
      );
    } while (needToContinue);
    await sessionContext.persist();
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
      if (accumulated.toolCalls) {
        // LLM 流式结束但工具尚未执行，标记为"正在进行"（isExecuting=true）
        // 等工具执行完毕后（executeAgentLoop 中）再更新为"已完成"（isExecuting=false）
        accumulated.toolCalls.forEach((tc) => {
          if (!tc.metadata) tc.metadata = {};
          tc.metadata.displayMessage = this.displayManager.format(
            tc.name,
            tc.arguments,
            true,
            runtime,
          );
        });
      }
    } else if (chunk.type === "think" || chunk.reasoningContent) {
      eventType = "think";
    } else if (chunk.type === "tool_call" || chunk.toolCalls) {
      eventType = "tool_call";
      // 将文案注入到 toolCalls 的 metadata 中，确保刷新后仍可显示
      chunk.toolCalls!.forEach((tc) => {
        if (!tc.metadata) tc.metadata = {};
        tc.metadata.displayMessage = this.displayManager.format(
          tc.name,
          tc.arguments,
          true,
          runtime,
        );
      });
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
   * 检查工具是否需要审批
   */
  private needsApproval(
    toolCalls: any[],
    sessionContext: ISessionContext,
  ): boolean {
    const approvalConfig = sessionContext.getToolApprovalConfig();

    // 如果全局禁用审批，返回 false
    if (approvalConfig.enabled === false) {
      return false;
    }

    const requiresApprovalTools = approvalConfig.requiresApproval;

    return toolCalls.some((tc: any) => {
      const toolName = tc.name;

      // 精确匹配
      if (requiresApprovalTools.includes(toolName)) {
        return true;
      }

      return false;
    });
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
    // 跳过工具提示词注入（影子轮次只需要记忆和文件工具，不需要 skill 描述等）
    const messages = await sessionContext.getMessages({ exclude: ["tool"] });
    const shadowMessages: MessageRecord[] = [];

    const modelConfig = sessionContext.getModelConfig();

    // 通过 PluginManager 获取记忆提示词（guide=静态说明, content=动态记忆内容）
    const memoryGuide =
      (
        await this.pluginManager.collectPluginLazyPrompts(
          "memory",
          sessionContext,
        )
      )
        .map((p) => p.content)
        .join("\n") || "";

    const memoryContent =
      (await this.pluginManager.collectPluginPrompts("memory", sessionContext))
        .map((p) => p.content)
        .join("\n") || "";

    // console.log("memoryGuide", memoryGuide);
    if (!memoryGuide) return;

    // 构建专属运行时：仅含受限的文件工具，不依赖原会话的 toolContext
    const allGroups = await this.pluginManager.getTools(sessionContext);
    const allFileTools =
      allGroups.find((g) => g.pluginId === "file")?.tools || [];
    const fileTools = allFileTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    }));
    // console.log("fileTools", fileTools);
    if (fileTools.length === 0) return;

    const shadowRuntime = new ToolRuntime(
      sessionContext,
      new Map(fileTools.map((t) => [t.name, t])),
      new Map(),
    );

    // 组装指令消息（history 中不含系统提示词，此处自行注入）
    const instructionParts: string[] = [
      `<system_message>`,
      `这是一条系统消息，即将进行上下文压缩，请检查你的记忆文件是否需要更新。`,
      `如果有新的重要信息（用户偏好、决策、待办等），请使用文件工具写入记忆。`,
      ``,
      memoryGuide,
    ];

    // 注入当前已保存的记忆内容（避免 AI 额外花一轮工具调用读取）
    if (memoryContent) {
      instructionParts.push(
        ``,
        `---`,
        `以下是当前已保存的记忆内容：`,
        memoryContent,
      );
    }

    instructionParts.push(
      ``,
      `操作原则：`,
      `- 已保存的内容无需重复写入`,
      `- 发现冲突、冗余、过时的记忆需要进行对应的更正和简化`,
      `- 只保存重要的、持久的、未来需要的信息`,
      `- 写入完成后不需要回复用户`,
      `- 最多操作 5 轮工具调用，工作流程如下：`,
      `  1. LLM 调用文件工具批量读取记忆文件，判断是否需要保存记忆`,
      `  2. 若需要保存，调用文件工具批量写入记忆`,
      `  3. 若无需要保存或者保存完毕，回复"DONE"`,
      `</system_message>`,
    );

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
          fileTools,
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

        // 收集本轮所有工具调用，批量执行
        const batch: { id: string; name: string; arguments: any }[] = [];
        const errors: { id: string; name: string; content: string }[] = [];

        for (const tc of accumulated.toolCalls) {
          let args: any;
          try {
            args =
              typeof tc.arguments === "string"
                ? JSON.parse(tc.arguments)
                : tc.arguments;
          } catch {
            continue;
          }

          // 路径校验：影子轮次只允许操作记忆相关目录
          const targetPath = args.path || args.file_path || "";
          const workspacePath = sessionContext.workspacePath;
          const allowedPrefixes =
            sessionContext.sessionType === "sub_agent"
              ? [
                  `.guada/subagents/${sessionContext.sessionId}/memory/`,
                  `.guada/subagents/${sessionContext.sessionId}/memos/`,
                ]
              : [`.guada/memory/`, `.guada/memos/`];

          const normalizeForComparison = (p: string): string => {
            let normalized = path.normalize(p).replace(/\\/g, "/");
            if (!path.isAbsolute(normalized)) {
              normalized = path.join(workspacePath, normalized);
            }
            return normalized;
          };

          const normalizedTarget = normalizeForComparison(targetPath);
          const isAllowed =
            normalizedTarget &&
            allowedPrefixes.some((prefix) => {
              const normalizedPrefix = normalizeForComparison(prefix);
              return normalizedTarget.startsWith(normalizedPrefix);
            });
          if (!isAllowed) {
            errors.push({
              id: tc.id,
              name: tc.name,
              content: `ERROR: 不允许操作 ${targetPath}，记忆操作仅限于 memory/ 和 memos/ 目录`,
            });
            continue;
          }

          batch.push({ id: tc.id, name: tc.name, arguments: args });
        }

        // 先推入拒绝的路径错误
        for (const e of errors) {
          shadowMessages.push({
            role: "tool",
            content: e.content,
            toolCallId: e.id,
            name: e.name,
          });
        }

        // 批量执行合法的工具调用
        if (batch.length > 0) {
          const responses = await this.toolOrchestrator.executeBatch(
            batch,
            shadowRuntime,
          );
          for (const r of responses) {
            shadowMessages.push({
              role: "tool",
              content: r.content,
              toolCallId: r.toolCallId,
              name: r.name,
            });
          }
        }
      } catch (error: any) {
        this.logger.warn(`记忆保存第${round}轮失败: ${error.message}`);
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
      fs.appendFileSync(
        path.join(logDir, "compression.jsonl"),
        JSON.stringify({
          time: new Date().toISOString(),
          sessionId: sessionContext.sessionId,
          records: shadowMessages,
        }) + "\n",
      );
    } catch (e) {
      // 非关键
    }
    // 不入库，不 yield
  }
}
