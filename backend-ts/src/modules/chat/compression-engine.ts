import { Injectable, Logger } from "@nestjs/common";
import { LLMService } from "../llm-core/llm.service";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { MessageRecord } from "../llm-core/types/llm.types";
import { SessionContextStateRepository } from "../../common/database/session-context-state.repository";
import { ICompressionStrategy, CompressionConfig, CompressionResult, CompressionCheckpoint } from "./interfaces";
import { resolveThinkingEffort } from "../llm-core/utils/model-config.helper";

/**
 * 压缩配置常量
 *
 * 定义消息压缩过程中的关键阈值和保护策略，平衡 Token 优化与上下文完整性。
 */
const PRUNING_TOOL_RESULT_MAX_LENGTH = 1000; // 工具结果裁剪阈值：超过此长度的工具调用结果将被截断
const PROTECTED_RECENT_TOOL_RESULTS_COUNT = 3; // 最近受保护的工具调用条数：最近的 N 条工具结果不被裁剪，确保最新上下文完整
const MIN_RETAINED_MESSAGES = 3; // 最小保留消息数：无论 Token 压力多大，始终保留最新的 N 条原始消息

/**
 * 摘要生成模式枚举
 */
export enum SummaryMode {
  /** 关闭摘要：直接丢弃待压缩内容，不生成摘要 */
  DISABLED = 'disabled',
  /** 快速摘要：传统单次调用方式，快速生成摘要 */
  FAST = 'fast',
  /** 迭代摘要：使用 Agent 循环进行多轮迭代优化，质量最高但耗时较长 */
  ITERATIVE = 'iterative',
}

/**
 * 两级压缩引擎
 *
 * 实现会话上下文的两阶段压缩策略：
 * - 第一阶段（Pruning）：识别并裁剪冗长的工具调用结果，采用"保留头部+尾部"策略，减少 Token 占用同时保持关键信息
 * - 第二阶段（Compaction）：当裁剪不足以达到目标时，调用 LLM 生成历史对话摘要，将长历史浓缩为简洁概要
 *
 * 核心设计原则：
 * - 分离存储：摘要和原始消息分别管理，避免数据耦合
 * - 增量处理：基于检查点状态跳过已处理的消息，提升重复加载效率
 * - 容错降级：摘要生成失败时自动回退到仅裁剪模式，保证系统可用性
 */
@Injectable()
export class CompressionEngine implements ICompressionStrategy {
  private readonly logger = new Logger(CompressionEngine.name);

  constructor(
    private llmService: LLMService,
    private contextStateRepo: SessionContextStateRepository,
    private tokenizerService: TokenizerService,
  ) { }

  /**
   * 判断是否需要触发压缩
   *
   * 基于当前 Token 总数与上下文窗口的比例进行判断。
   * 优先使用缓存的 Token 计数以避免重复计算开销。
   *
   * @param messages 待评估的消息列表
   * @param config 压缩配置，包含上下文窗口和触发阈值（contextWindow 已是实际生效值）
   * @param cachedTokenCount 可选的缓存 Token 计数，若提供则直接使用
   * @returns 是否达到压缩触发条件
   */
  async shouldCompress(messages: MessageRecord[], config: CompressionConfig, cachedTokenCount?: number): Promise<boolean> {
    // 优先使用缓存的 Token 计数，避免重复计算
    const modelName = config.chatModelName || "gpt4";
    const totalTokens = cachedTokenCount ?? await this.tokenizerService.countTokens(modelName, messages);
    const ratio = totalTokens / config.contextWindow;
    this.logger.debug(
      `Token stats: ${totalTokens}/${config.contextWindow} (${(ratio * 100).toFixed(1)}%), trigger at ${config.triggerRatio}${cachedTokenCount ? ' (cached)' : ''}`
    );
    return ratio >= config.triggerRatio;
  }

  /**
   * 执行完整的压缩流程
   *
   * 该方法协调两阶段压缩策略的执行：先尝试轻量级的裁剪操作，若无法满足目标则升级为摘要压缩。
   * 压缩完成后会持久化更新会话状态检查点，包括游标位置、摘要内容和元数据。
   *
   * @param sessionId 会话 ID，用于定位和更新压缩状态
   * @param messages 待压缩的原始消息列表（不含 system 消息）
   * @param config 压缩配置，包含目标比例、模型等信息
   * @returns 压缩结果，包含处理后的消息、摘要（若有）、使用的策略和最终 Token 计数
   */
  async execute(
    sessionId: string,
    messages: MessageRecord[],
    config: CompressionConfig,
    currentTokenCount?: number, // 当前缓存的 Token 数，避免重复计算
  ): Promise<CompressionResult> {
    const state = await this.contextStateRepo.findBySessionId(sessionId);

    const cleanMessages = messages.filter(msg => msg.role !== 'system');

    // 记录压缩前的状态：优先使用传入的缓存 Token 数，避免实时计算的开销
    const beforeTokenCount = currentTokenCount ?? await this.tokenizerService.countTokens(config.chatModelName || "gpt4", cleanMessages);
    const beforeMessageCount = cleanMessages.length;

    this.logger.log('Executing Stage 1: Pruning');
    // 执行第一阶段：裁剪冗长的工具调用结果，返回裁剪后的消息和元数据
    const { prunedMessages, metadata, lastPrunedContentId } =
      this.pruneMessages(
        cleanMessages,
        state?.lastPrunedContentId,
      );

    const prunedTokens = await this.tokenizerService.countTokens(config.chatModelName || "gpt4", prunedMessages);
    const targetTokens = Math.floor(config.contextWindow * config.targetRatio);

    this.logger.debug(`After pruning: ${prunedTokens} tokens (target: ${targetTokens})`);

    // 初始化压缩结果变量，将在后续逻辑中更新
    let resultMessages: MessageRecord[] = prunedMessages;
    let resultSummary: string | undefined = undefined;
    let resultTokenCount = prunedTokens;
    let compressionStats = {
      beforeTokenCount,
      afterTokenCount: prunedTokens,
      beforeMessageCount,
      afterMessageCount: prunedMessages.length,
    };

    // 初始化压缩状态（基于数据库中的旧状态，后续会更新为最新状态）
    const compressionState = {
      cleaningStrategy: 'pruned_only' as 'pruned_only' | 'summarized',
      lastCompactedMessageId: state?.lastCompactedMessageId,
      lastCompactedContentId: state?.lastCompactedContentId,
      summaryContent: state?.summaryContent,
      lastPrunedContentId: lastPrunedContentId || state?.lastPrunedContentId,
      pruningMetadata: { ...state?.pruningMetadata, ...metadata },
      compressionStats,
    };

    // 若裁剪后已达到目标 Token 数，则跳过耗时的摘要生成步骤，直接返回裁剪结果
    // 这种降级策略显著降低了压缩成本，同时保持了较好的上下文质量
    if (prunedTokens <= targetTokens) {
      this.logger.log('Pruning satisfied the target, skipping compaction.');
      // 保持默认值不变，直接使用初始化的结果
    } else {
      this.logger.log('Pruning insufficient, triggering Stage 2: Compaction');
      try {
        // 执行第二阶段：调用 LLM 生成摘要，将超出部分的历史对话浓缩为简洁概要
        const { summary, retained, lastCompactedContentId, lastCompactedMsgId, retainedTokens } =
          await this.compactMessages(
            prunedMessages,
            prunedTokens,
            targetTokens,
            compressionState.summaryContent, // 直接使用压缩状态中的摘要内容
            config.model,
            config.summaryMode ?? SummaryMode.ITERATIVE, // 从配置中读取摘要模式，默认迭代优化
            config.chatModelName, // 传递对话模型名称用于 Token 计算
          );

        // 检查是否实际进行了压缩：如果没有返回压缩游标，说明所有消息都在保护范围内
        // 此时应回退到仅裁剪模式，避免误标记为已压缩导致下次加载时丢失所有消息
        if (!lastCompactedContentId) {
          this.logger.log('No messages were compressed (all in protected range), falling back to pruned_only strategy.');
          // 保持默认的 pruned_only 策略，不更新结果变量
        } else {
          // 成功生成摘要，更新结果为摘要模式
          resultMessages = retained;
          resultSummary = summary;
          resultTokenCount = retainedTokens;
          compressionStats = {
            beforeTokenCount,
            afterTokenCount: retainedTokens,
            beforeMessageCount,
            afterMessageCount: retained.length,
          };

          // 更新压缩状态为摘要模式
          compressionState.cleaningStrategy = 'summarized';
          compressionState.summaryContent = summary;
          compressionState.lastCompactedMessageId = lastCompactedMsgId;
          compressionState.lastCompactedContentId = lastCompactedContentId;
          // 保留 lastPrunedContentId，因为物理裁剪边界可能与逻辑摘要边界不一致

          // 清理 pruningMetadata：剔除所有已处理（<= lastCompactedContentId）的元数据，防止无限膨胀
          if (compressionState.pruningMetadata && lastCompactedContentId) {
            const cleanedMetadata: Record<string, any> = {};
            for (const [key, value] of Object.entries(compressionState.pruningMetadata)) {
              // 只保留 contentId 大于 lastCompactedContentId 的元数据
              if (key > lastCompactedContentId) {
                cleanedMetadata[key] = value;
              }
            }
            compressionState.pruningMetadata = Object.keys(cleanedMetadata).length > 0 ? cleanedMetadata : null;
          }

          compressionState.compressionStats = compressionStats;
        }
      } catch (error) {
        // 摘要生成失败时的容错处理：回退到仅裁剪模式，确保系统不会因 LLM 调用失败而中断
        this.logger.error('Compaction failed:', error);
        // 保持默认的 pruned_only 策略，不更新结果变量
      }
    }

    // 统一更新会话压缩状态到数据库
    this.logger.log(`Saving compression state for session ${sessionId}:`);
    this.logger.log(`  cleaningStrategy: ${compressionState.cleaningStrategy}`);
    this.logger.log(`  lastCompactedMessageId: ${compressionState.lastCompactedMessageId || 'NULL'}`);
    this.logger.log(`  lastCompactedContentId: ${compressionState.lastCompactedContentId || 'NULL'}`);
    this.logger.log(`  lastPrunedContentId: ${compressionState.lastPrunedContentId || 'NULL'}`);
    await this.contextStateRepo.create(sessionId, compressionState);

    // 统一返回结果（strategy 从 compressionState 获取，确保与数据库状态一致）
    return {
      messages: resultMessages,
      summary: resultSummary,
      didCompress: true,
      strategy: compressionState.cleaningStrategy,
      tokenCount: resultTokenCount,
      compressionStats,
    };
  }

  /**
   * 第一阶段：Pruning（修剪）
   *
   * 识别并裁剪冗长的工具调用结果，采用"保留头部+尾部"策略。
   * 该策略在减少 Token 占用的同时，保留了工具结果的开头和结尾部分，确保关键信息不丢失。
   *
   * 保护机制：
   * - 最近的 N 条工具结果不受裁剪影响，保证最新上下文的完整性
   * - 基于检查点游标跳过已处理的消息，避免重复裁剪
   *
   * @param messages 待处理的消息列表
   * @param lastProcessedContentId 上次已处理的 Content ID，用于跳过已修剪的消息
   * @returns 裁剪后的消息列表、裁剪元数据和最后一个被裁剪的 Content ID
   */
  pruneMessages(
    messages: MessageRecord[],
    lastProcessedContentId?: string,
  ): { prunedMessages: MessageRecord[]; metadata: Record<string, any>; lastPrunedContentId?: string } {
    const prunedMessages = [...messages];
    const metadata: Record<string, any> = {};
    let protectedCount = 0;
    let lastPrunedContentId: string | undefined;

    // 根据上次处理点的游标确定起始索引，跳过已经裁剪过的消息，实现增量处理
    let startIndex = 0;
    if (lastProcessedContentId) {
      const idx = messages.findIndex(m => m.contentId === lastProcessedContentId);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    // 从后往前遍历消息列表，保护最近的 N 条工具结果不被裁剪
    // 倒序遍历确保最新的重要上下文得到优先保护
    for (let i = prunedMessages.length - 1; i >= startIndex; i--) {
      const msg = prunedMessages[i];
      if (msg.role === "tool") {
        if (protectedCount < PROTECTED_RECENT_TOOL_RESULTS_COUNT) {
          protectedCount++;
          continue;
        }

        const content = typeof msg.content === "string" ? msg.content : "";
        if (content.length > PRUNING_TOOL_RESULT_MAX_LENGTH) {
          // 采用"头部+尾部"保留策略：各保留一半长度，中间用省略号替代
          // 这样既减少了 Token 占用，又保留了工具结果的开头标识和结尾关键数据
          const headLength = Math.floor(PRUNING_TOOL_RESULT_MAX_LENGTH / 2);
          const tailLength = PRUNING_TOOL_RESULT_MAX_LENGTH - headLength;
          const prunedContent = `${content.substring(0, headLength)}...[omitted ${content.length - PRUNING_TOOL_RESULT_MAX_LENGTH} characters]...${content.substring(content.length - tailLength)}`;

          // 记录裁剪元数据，用于后续恢复或调试；同时更新最后裁剪的 Content ID 游标
          // 游标选择逻辑：确保记录的是消息列表中位置最靠后的被裁剪项
          if (msg.contentId) {
            metadata[msg.contentId] = {
              contentId: msg.contentId,
              messageId: msg.messageId,
              originalLength: content.length,
              prunedLength: prunedContent.length,
              prunedContent: prunedContent,
              prunedAt: new Date().toISOString(),
            };
            // 记录最后一个被裁剪的 ContentId
            if (!lastPrunedContentId || messages.findIndex(m => m.contentId === msg.contentId) > messages.findIndex(m => m.contentId === lastPrunedContentId)) {
              lastPrunedContentId = msg.contentId;
            }
          }

          prunedMessages[i] = {
            ...msg,
            content: prunedContent,
          };
          this.logger.debug(`Pruned tool result for message ${msg.messageId}, length: ${content.length} -> ${prunedContent.length}`);
        }
      }
    }

    return { prunedMessages, metadata, lastPrunedContentId };
  }

  /**
   * 执行摘要生成的迭代优化循环
   *
   * 通过工具调用机制让 AI 自检并优化摘要质量,最多循环 3 次。
   * 每次迭代 AI 需要调用 write_summary 提交草稿并进行自我审查,
   * 当满意时调用 confirm_submit 结束流程。
   *
   * @param promptParts 提示词片段数组
   * @param compressionModel 压缩模型配置
   * @returns 最终生成的摘要内容
   */
  private async executeSummaryIteration(
    promptParts: string[],
    compressionModel?: any,
  ): Promise<string> {
    // 定义摘要压缩专用的工具定义(使用 InternalToolDefinition 格式)
    const summaryTools = [
      {
        name: "write_summary",
        description: "写入当前版本的摘要草稿。每次调用都会覆盖之前的草稿,用于迭代优化。",
        parameters: {
          type: "object" as const,
          properties: {
            summary: {
              type: "string",
              description: "摘要内容,应遵循压缩原则,简洁准确地概括对话要点",
            },
          },
          required: ["summary"],
        },
      },
      {
        name: "confirm_submit",
        description: "确认提交最终摘要。调用此工具表示摘要已达到满意质量,不再需要进一步优化。",
        parameters: {
          type: "object" as const,
          properties: {
            final_summary: {
              type: "string",
              description: "最终确认的摘要内容",
            },
          },
          required: ["final_summary"],
        },
      },
    ];

    // 迭代优化摘要,最多循环 3 次
    let finalSummary = "";
    let iterationCount = 0;
    const maxIterations = 3;
    let currentDraft = "";

    // 维护完整的对话历史,让 AI 能看到自己的调用过程
    const conversationHistory: MessageRecord[] = [
      {
        role: "system", content: `你正在生成对话摘要。请使用提供的工具来提交摘要:

**工作流程:**
1. 调用 write_summary 写入摘要草稿
2. 自我审查:检查摘要是否符合压缩原则(简洁、完整、准确)
3. 决策:
   - 符合要求 → 调用 confirm_submit 提交
   - 需要优化 → 返回步骤 1,重新生成摘要

**重要提醒:**
- 请尽可能在一次迭代内完成高质量摘要,避免多次调用工具
- 只有在确实需要优化时才进行下一轮迭代
- 最多允许 3 次迭代,超过后将自动使用最后一次结果

**注意:**
- 每次调用 write_summary 时,必须提供 summary 参数
- 只有在确实满意时才调用 confirm_submit
- 不要在没有调用任何工具的情况下直接返回文本` },
      { role: "user", content: promptParts.join("\n") },
    ];

    while (iterationCount < maxIterations) {
      iterationCount++;
      this.logger.log(`摘要生成迭代第 ${iterationCount}/${maxIterations} 次`);

      try {
        // 调用 LLM,启用工具调用
        const response = await this.llmService.completions({
          model: compressionModel?.modelName || "gpt-3.5-turbo",
          messages: conversationHistory,
          temperature: 0.3,
          maxTokens: 1500,
          thinkingEffort: resolveThinkingEffort(compressionModel, 'off'),
          stream: false,
          providerConfig: compressionModel.provider,
          tools: summaryTools,
        });

        // 调试日志:记录响应结构
        this.logger.debug(`LLM 响应 - content: ${response.content ? '有' : '无'}, toolCalls: ${response.toolCalls ? response.toolCalls.length : 0} 个`);
        if (response.content) {
          this.logger.log(`第 ${iterationCount} 次迭代 - AI 输出内容:\n${response.content}`);
        }
        if (response.toolCalls && response.toolCalls.length > 0) {
          this.logger.debug(`工具调用详情: ${JSON.stringify(response.toolCalls.map(tc => ({ name: tc.name, hasArgs: !!tc.arguments })))}`);
        }

        // 检查是否有工具调用
        if (response.toolCalls && response.toolCalls.length > 0) {
          const lastToolCall = response.toolCalls[response.toolCalls.length - 1];

          // 将 AI 的助手消息添加到对话历史
          conversationHistory.push({
            role: "assistant",
            content: response.content || null,
            toolCalls: response.toolCalls,
          });

          try {
            const toolArgs = JSON.parse(lastToolCall.arguments);

            if (lastToolCall.name === "write_summary") {
              // 记录草稿
              currentDraft = toolArgs.summary;
              this.logger.log(`第 ${iterationCount} 次迭代 - 草稿已记录`);

              // 模拟工具返回成功,添加到对话历史
              conversationHistory.push({
                role: "tool",
                content: `摘要草稿已成功保存。当前是第 ${iterationCount} 次迭代。如果需要优化,请再次调用 write_summary;如果满意,请调用 confirm_submit。`,
                toolCallId: lastToolCall.id,
                name: lastToolCall.name,
              });

              // 如果不是最后一次迭代,继续循环
              if (iterationCount < maxIterations) {
                continue;
              } else {
                // 达到最大迭代次数,使用当前草稿
                finalSummary = currentDraft;
                this.logger.log('达到最大迭代次数,使用最后一次草稿');
                break;
              }
            } else if (lastToolCall.name === "confirm_submit") {
              // 确认提交,结束迭代
              finalSummary = toolArgs.final_summary;
              this.logger.log(`摘要已确认提交(第 ${iterationCount} 次迭代)`);

              // 模拟工具返回成功
              conversationHistory.push({
                role: "tool",
                content: `摘要已成功提交!这是最终版本。`,
                toolCallId: lastToolCall.id,
                name: lastToolCall.name,
              });

              break;
            }
          } catch (parseError) {
            this.logger.error(`解析工具参数失败: ${parseError}`);
            // 解析失败时,尝试使用响应内容作为摘要
            if (response.content) {
              finalSummary = response.content.trim();
              this.logger.log('使用响应内容作为摘要(工具参数解析失败)');
            }
            break;
          }
        } else {
          // 没有工具调用,直接使用响应内容
          if (response.content) {
            finalSummary = response.content.trim();
            this.logger.log('未检测到工具调用,使用响应内容作为摘要');
          }
          break;
        }
      } catch (error) {
        this.logger.error(`第 ${iterationCount} 次迭代失败:`, error);
        // 如果已有草稿,使用草稿;否则回退到传统方式
        if (currentDraft) {
          finalSummary = currentDraft;
        }
        break;
      }
    }

    return finalSummary;
  }

  /**
   * 第二阶段:Compaction(摘要压缩)
   *
   * 当裁剪不足以达到目标 Token 数时,调用 LLM 生成历史对话摘要。
   * 该方法采用滑动窗口策略:从最新消息向前累加,确定需要保留的原始消息范围,剩余部分交由 LLM 压缩。
   *
   * 摘要生成策略:
   * - 合并历史摘要与新增对话内容,生成连贯的更新摘要
   * - 强制保留最新的 N 条原始消息,确保近期对话细节不丢失
   * - 禁用思维链功能,降低摘要生成的 Token 成本和延迟
   * - 支持三种摘要模式:关闭、快速、迭代
   *
   * @param messages 裁剪后的消息列表
   * @param prunedTokens 裁剪后的 Token 总数
   * @param targetTokens 目标 Token 数(上下文窗口 × 目标比例)
   * @param previousSummary 之前生成的摘要内容(可选)
   * @param compressionModel 用于生成摘要的专用模型配置
   * @param summaryMode 摘要生成模式,默认为 ITERATIVE(迭代优化)
   * @param chatModelName 对话模型名称,用于 Token 计算
   * @returns 新生成的摘要、保留的原始消息、压缩游标和保留部分的 Token 数
   */
  async compactMessages(
    messages: MessageRecord[],
    prunedTokens: number,
    targetTokens: number,
    previousSummary?: string,
    compressionModel?: any,
    summaryMode: SummaryMode = SummaryMode.ITERATIVE,
    chatModelName?: string,
  ): Promise<{ summary: string; retained: MessageRecord[]; lastCompactedContentId?: string; lastCompactedMsgId?: string; retainedTokens: number } | null> {


    // 1. 消息分组：将 user 消息分为一组，assistant 及其后续的 tool 消息合并为一组
    // 这样可以确保工具调用的完整性，避免 assistant 和 tool 被分割到不同区域
    const messageGroups: MessageRecord[][] = [];
    let currentGroup: MessageRecord[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (currentGroup.length > 0) {
          messageGroups.push(currentGroup);
          currentGroup = [];
        }
        messageGroups.push([msg]); // user 消息独立成组
      } else {
        // assistant 或 tool 消息加入当前组
        currentGroup.push(msg);
      }
    }
    if (currentGroup.length > 0) {
      messageGroups.push(currentGroup);
    }

    if (messages.length <= MIN_RETAINED_MESSAGES) {
      // 消息数量过少时无需压缩,直接返回原有摘要和全部消息
      // 返回 undefined 表示没有实际压缩发生，调用方应回退到仅裁剪模式
      this.logger.log("messages is too short, no compression needed, returning original summary and all messages")
      return { summary: previousSummary || "", retained: messages, lastCompactedContentId: undefined, retainedTokens: prunedTokens };
    }

    // 2. 从后往前以"组"为单位累加 Token，确定保留范围
    let retainedTokens = 0;
    // 强制保留最后 MIN_RETAINED_GROUPS 个分组（例如最后 3 组对话）
    const minRetainGroupIndex = Math.max(0, messageGroups.length - MIN_RETAINED_MESSAGES);
        
    // 首先计算强制保留区的 Token 数
    for (let i = messageGroups.length - 1; i >= minRetainGroupIndex; i--) {
      retainedTokens += await this.tokenizerService.countTokens(chatModelName || "gpt4", messageGroups[i]);
    }
        
    let retainGroupIndex = minRetainGroupIndex; // 默认从强制保留区的起点开始
    // 从强制保留区的前一组开始向前判断
    for (let i = minRetainGroupIndex - 1; i >= 0; i--) {
      const group = messageGroups[i];
      const groupTokens = await this.tokenizerService.countTokens(chatModelName || "gpt4", group);
    
      if (retainedTokens + groupTokens > targetTokens) {
        break;
      }
    
      retainedTokens += groupTokens;
      retainGroupIndex = i;
    }

    // 3. 根据分组索引直接分割消息列表
    // retainGroupIndex 是保留区的第一个组的索引
    const toCompress = messageGroups.slice(0, retainGroupIndex).flat();
    const retained = messageGroups.slice(retainGroupIndex).flat();

    if (toCompress.length === 0) {
      // 所有消息都在保留区内,无需调用 LLM 生成摘要
      // 返回 undefined 表示没有实际压缩发生，调用方应回退到仅裁剪模式
      this.logger.log("all messages are within the retention range, no compression needed, returning original summary and all messages")
      return { summary: previousSummary || "", retained: messages, lastCompactedContentId: undefined, retainedTokens: retainedTokens };
    }

    // 记录被压缩部分的最后一条消息 ID,作为压缩游标用于下次增量处理
    const lastCompactedMsgId = toCompress[toCompress.length - 1]?.messageId;
    const lastCompactedContentId = toCompress[toCompress.length - 1]?.contentId;
    // 如果关闭摘要功能,则直接丢弃待压缩内容,仅保留最近的消息
    // 这种模式适用于希望快速减少 Token 占用但不需要保留历史语义的场景
    if (summaryMode === SummaryMode.DISABLED) {
      this.logger.log('Summary generation is disabled, discarding compressed messages directly.');
      // 记录被丢弃部分的最后一条消息 ID,作为压缩游标用于下次增量处理
      return { summary: previousSummary || "", retained, lastCompactedContentId, lastCompactedMsgId, retainedTokens };
    }


    // 构造发送给 LLM 的提示词,包含历史摘要(若有)和待压缩的新增对话内容
    // 通过清晰的分区标记帮助模型理解不同部分的作用
    const promptParts = [];
    promptParts.push(`你是一个对话摘要压缩专家。你的任务是将【历史对话摘要】与【待压缩的新增对话】合并为一份新的会话摘要。

## 压缩原则
1. **去重合并**:相同主题的信息合并,避免重复。
2. **保留关键**:保留决策结论、待办事项、用户偏好、重要事实和数据。
3. **丢弃冗余**:省略寒暄、重复表述、已解决的中间讨论过程、具体的讨论/代码细节。
4. **时间有序**:按对话发生的时间线组织,保持因果和逻辑连贯。
5. **控制长度**:合并历史摘要时,用更精炼的语言概括旧内容,避免摘要随迭代不断累积变长

## 输出结构
- 使用自然段落形式,不设标题或编号。
- 若无历史摘要,则仅基于新增对话生成摘要。
- 直接输出摘要正文,不附加任何解释、前言或后缀。

## 输出示例(仅供参考风格)
用户询问了 Python 多线程的 GIL 限制,助手解释了 GIL 原理并推荐使用多进程替代。用户确认理解后,要求给出一个 multiprocessing 的代码示例。最终决定了使用 Pool 方案,待办:下周完成性能测试。`);

    if (previousSummary) {
      promptParts.push(`\n\n【历史对话摘要】\n${previousSummary}\n`);
    }

    promptParts.push("【待压缩的新增对话内容】");
    toCompress.forEach((msg) => {
      // 构建简化的消息对象
      const simplifiedMsg: any = {
        role: msg.role,
      };

      // 处理 content 字段
      let contentStr = "";
      if (typeof msg.content === "string") {
        // 精简处理:去除多余换行和空白
        contentStr = msg.content.replace(/\n\s*\n/g, '\n').trim();
      } else if (Array.isArray(msg.content)) {
        // 数组类型:提取文本部分
        const textParts = msg.content.filter((part: any) => part.type === "text").map((part: any) => part.text);
        contentStr = textParts.join("\n").replace(/\n\s*\n/g, '\n').trim();
      }
      // 其他未知类型直接跳过,不处理

      if (contentStr) {
        simplifiedMsg.content = contentStr;
      }

      // 处理 tool_calls 字段(仅保留 name 数组)
      if (msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        simplifiedMsg.tool_calls = msg.toolCalls.map((tc: any) => tc.function?.name).filter(Boolean);
      }

      // 若 content 和 tool_calls 都为空,则跳过该消息
      if (!simplifiedMsg.content && !simplifiedMsg.tool_calls) {
        return;
      }

      promptParts.push(JSON.stringify(simplifiedMsg));
    });

    this.logger.debug(promptParts.join("\n"));

    promptParts.push("\n\n开始压缩，不超过2000字");

    // 如果是快速模式,使用传统单次调用方式
    if (summaryMode === SummaryMode.FAST) {
      this.logger.log('Using fast summary mode (single call)');
      const response = await this.llmService.completions({
        model: compressionModel?.modelName || "gpt-3.5-turbo",
        messages: [{ role: "user", content: promptParts.join("\n") }],
        temperature: 0.4,
        maxTokens: 2000,
        thinkingEffort: resolveThinkingEffort(compressionModel, 'off'),
        stream: false,
        providerConfig: compressionModel.provider,
      });
      const finalSummary = response.content?.trim() || "";
      return { summary: finalSummary, retained, lastCompactedContentId, lastCompactedMsgId, retainedTokens };
    }

    // 迭代模式:执行迭代优化生成摘要
    this.logger.log('Using iterative summary mode (agent loop)');
    let finalSummary = await this.executeSummaryIteration(promptParts, compressionModel);

    // 如果迭代后仍没有摘要,回退到传统单次调用方式
    if (!finalSummary) {
      this.logger.log('迭代优化未产生结果,回退到传统单次调用');
      const response = await this.llmService.completions({
        model: compressionModel?.modelName || "gpt-3.5-turbo",
        messages: [{ role: "user", content: promptParts.join("\n") }],
        temperature: 0.4,
        maxTokens: 2000,
        thinkingEffort: resolveThinkingEffort(compressionModel, 'off'),
        stream: false,
        providerConfig: compressionModel.provider,
      });
      finalSummary = response.content?.trim() || "";
    }

    return { summary: finalSummary, retained, lastCompactedContentId: toCompress[toCompress.length - 1]?.contentId, lastCompactedMsgId, retainedTokens };
  }

  /**
   * 获取压缩检查点状态
   *
   * 从持久化存储中读取会话的压缩状态，用于恢复之前的压缩进度。
   * 检查点包含游标位置、摘要内容、裁剪元数据等关键信息。
   *
   * @param sessionId 会话 ID
   * @returns 压缩状态检查点，如果不存在返回 null
   */
  async getCheckpoint(sessionId: string): Promise<import("./interfaces").CompressionCheckpoint | null> {
    const state = await this.contextStateRepo.findBySessionId(sessionId);
    if (!state) {
      return null;
    }

    return {
      lastCompactedMessageId: state.lastCompactedMessageId,
      lastCompactedContentId: state.lastCompactedContentId,
      lastPrunedContentId: state.lastPrunedContentId,
      pruningMetadata: state.pruningMetadata || undefined,
      summaryContent: state.summaryContent || undefined,
      cleaningStrategy: state.cleaningStrategy || undefined,
    };
  }

  /**
   * 预处理原始消息，应用压缩变换
   *
   * 在会话初始化时调用，根据检查点状态恢复之前的压缩结果。
   * 该方法仅应用裁剪覆盖层（将裁剪后的内容替换到对应消息），不注入摘要。
   * 摘要是由上层调用者在构建最终消息时统一注入到 system prompt 中。
   *
   * @param rawMessages 从数据库加载的原始消息列表
   * @param checkpoint 压缩检查点状态
   * @returns 处理后的消息列表和提取的摘要内容（分离返回）
   */
  preprocess(
    rawMessages: MessageRecord[],
    checkpoint: CompressionCheckpoint,
  ): { messages: MessageRecord[]; summary?: string } {
    const messages = [...rawMessages];

    // 若存在裁剪元数据和边界，则在内存中应用裁剪覆盖层
    // 仅处理边界之前的消息，边界之后的消息保持原始状态，提高处理效率
    if (checkpoint.pruningMetadata && checkpoint.lastPrunedContentId) {
      this.applyPruningOverlay(messages, checkpoint.pruningMetadata, checkpoint.lastPrunedContentId);
    }

    // 返回分离的摘要和消息，由上层调用者负责组装
    return {
      messages,
      summary: checkpoint.summaryContent,
    };
  }

  /**
   * 在内存中应用裁剪结果（不修改数据库原文）
   *
   * @param messages 待应用裁剪的消息列表
   * @param metadata 裁剪元数据
   * @param boundaryId 裁剪边界 ID，只处理小于等于该 ID 的消息
   */
  applyPruningOverlay(messages: MessageRecord[], metadata: Record<string, any>, boundaryId: string) {
    for (const msg of messages) {
      // 一旦超过边界，后续消息均无需处理（假设 contentId 递增）
      // if (msg.contentId && msg.contentId > boundaryId) break;

      if (msg.contentId && metadata[msg.contentId]) {
        msg.content = metadata[msg.contentId].prunedContent || msg.content;
      }
    }
  }
}
