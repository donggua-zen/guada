import { Logger } from "@nestjs/common";
import { MessageRecord } from "../llm-core/types/llm.types";
import { v4 as uuidv4 } from "uuid";
import {
  IConversationContext,
  IMessageStore,
  ICompressionStrategy,
  ContextInitConfig,
  CompressionConfig,
} from "./interfaces";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ModelRepository } from "../../common/database/model.repository";
import { SK_MOD_COMPRESS_MODEL, SK_MOD_COMPRESS_ENABLE_SUMMARY, SG_MODELS } from "../../constants/settings.constants";
import { TokenizerService } from "../../common/utils/tokenizer.service";

/**
 * 会话上下文管理器
 *
 * 负责管理单个会话的对话历史、系统提示词和压缩状态。
 * 核心职责包括：
 * - 初始化时从存储层加载历史消息并应用压缩检查点恢复状态
 * - 在对话过程中动态维护 Token 计数缓存，避免重复计算开销
 * - 根据配置的上下文窗口阈值自动触发消息压缩策略
 * - 将摘要、系统提示词和原始消息组装成最终发送给 LLM 的消息列表
 */
export class ConversationContext implements IConversationContext {
  private readonly logger = new Logger(ConversationContext.name);

  private sessionId: string;
  /** 纯对话历史，不含 system 消息（system prompt 单独存储在 systemPrompt） */
  private history: MessageRecord[] = [];
  private systemPrompt: string = "";
  private systemPromptTokenCount: number = 0;
  /** 当前生效的压缩摘要内容，由压缩策略生成并在构建最终消息时注入到 system prompt */
  private currentSummary?: string;
  private compressionConfig: CompressionConfig | null = null;
  /** 缓存的当前 Token 总数，通过增量更新维护，避免每次请求都重新计算全量 Token */
  private currentTokenCount: number = 0;
  /** 对话模型名称，用于 Token 计算 */
  private chatModelName: string = "gpt4";

  constructor(
    sessionId: string,
    private messageStore: IMessageStore,
    private compressionStrategy: ICompressionStrategy,
    private settingsStorage: SettingsStorage,
    private modelRepository: ModelRepository,
    private tokenizerService: TokenizerService,
  ) {
    this.sessionId = sessionId;
  }

  /**
   * 初始化会话上下文
   *
   * 从持久化存储中恢复会话状态，包括历史消息、压缩检查点和摘要信息。
   * 支持专用压缩模型配置，若未配置则回退使用对话模型。
   * 针对 DeepSeek-V4 等支持思维链的模型，会根据工具调用情况决定是否保留 reasoning content。
   *
   * @param config 初始化配置，包含系统提示词、上下文窗口、模型信息等
   */
  async initialize(config: ContextInitConfig): Promise<void> {
    this.logger.log(`Initializing conversation context for ${this.sessionId}`);

    this.systemPrompt = config.systemPrompt || "You are a helpful assistant.";
    this.logger.debug(`Using system prompt: ${this.systemPrompt}`);
    // 保存对话模型名称，用于 Token 计算
    this.chatModelName = config.model?.modelName || config.model?.name || "gpt4";
    this.logger.debug(`Using chat model for tokenization: ${this.chatModelName}`);

    // 获取压缩模型配置：优先使用专用的压缩模型，若未配置则回退到对话模型
    // 专用压缩模型通常选择成本更低、速度更快的模型，以优化压缩阶段的性能和费用
    const compressionModelId = this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_MODEL,
      null,
    );

    let compressionModel = config.model; // 默认使用对话模型
    if (compressionModelId) {
      try {
        const model = await this.modelRepository.findById(compressionModelId);
        if (model) {
          compressionModel = model;
          this.logger.debug(`Using dedicated compression model: ${model.modelName}`);
        } else {
          this.logger.warn(`Compression model ${compressionModelId} not found, falling back to chat model`);
        }
      } catch (error) {
        this.logger.error(`Failed to load compression model ${compressionModelId}:`, error);
      }
    }

    // 读取摘要模式配置，优先使用角色级别配置，其次使用全局配置
    const memoryConfig = config.memory || {};
    let summaryMode: string = 'fast'; // 默认快速模式

    if (memoryConfig.summaryMode) {
      // 优先使用角色级别的 summaryMode 配置
      summaryMode = memoryConfig.summaryMode;
      this.logger.debug(`Using role-level summaryMode: ${summaryMode}`);
    } else {
      // 回退到全局配置
      const globalEnableSummary = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_COMPRESS_ENABLE_SUMMARY,
        true,
      );
      const enabled = globalEnableSummary === true || globalEnableSummary === 'true' || globalEnableSummary === 1;
      summaryMode = enabled ? 'fast' : 'disabled';
      this.logger.debug(`Using global enableSummary setting, converted to summaryMode: ${summaryMode}`);
    }

    this.compressionConfig = {
      contextWindow: config.contextWindow, // Agent 层已计算好实际生效值
      triggerRatio: memoryConfig.compressionTriggerRatio ?? 0.8,
      targetRatio: memoryConfig.compressionTargetRatio ?? 0.5,
      model: compressionModel,
      summaryMode: summaryMode as any, // 传递摘要模式
      chatModelName: this.chatModelName, // 传递对话模型名称用于 Token 计算
    };

    // 从压缩策略中获取检查点状态，用于恢复之前的压缩进度和游标位置
    const checkpoint = await this.compressionStrategy.getCheckpoint(this.sessionId);

    const modelName = config.model?.modelName || config.model?.name || "";
    const isDeepSeekV4 = modelName.includes("deepseek-v4");
    const shouldLoadReasoning = isDeepSeekV4 && config.thinkingEnabled === true;

    if (shouldLoadReasoning) {
      this.logger.debug(`Model ${modelName} with thinking enabled, will check for tool calls`);
    }

    // 加载原始消息时传入检查点中的游标，确保只加载未被压缩的历史消息，避免重复加载已压缩部分
    const rawMessages = await this.messageStore.loadMessages({
      sessionId: this.sessionId,
      userMessageId: config.userMessageId,
      maxMessages: memoryConfig.maxMemoryLength, // 使用分组后的配置
      supportsImageInput: true,
      keepReasoningContent: shouldLoadReasoning,
      lastCompactedMessageId: checkpoint?.lastCompactedMessageId,
      lastCompactedContentId: checkpoint?.lastCompactedContentId,
    });

    // 应用压缩预处理：根据检查点中的游标裁剪历史消息，并提取之前生成的摘要内容
    // 这一步实现了压缩状态的恢复，确保会话可以在中断后继续正常进行
    const preprocessResult = checkpoint
      ? this.compressionStrategy.preprocess(rawMessages, checkpoint)
      : { messages: rawMessages, summary: undefined };

    this.history = preprocessResult.messages;
    this.currentSummary = preprocessResult.summary;

    // 针对 DeepSeek-V4 等支持思维链的模型，根据是否存在工具调用来决定是否保留 reasoning content
    // 当存在工具调用时，reasoning content 包含了模型的推理过程，对后续对话有参考价值；否则可以移除以节省 Token
    if (shouldLoadReasoning) {
      const hasToolCalls = this.history.some(msg => msg.toolCalls && msg.toolCalls.length > 0);

      if (hasToolCalls) {
        this.logger.debug(`Found tool calls in history, keeping reasoning content`);
        // 显式保留 reasoningContent 字段，确保其值不为 undefined 时被过滤掉
        this.history = this.history.map(msg => ({
          ...msg,
          reasoningContent: msg.reasoningContent ?? "",
        }));
      } else {
        this.logger.debug(`No tool calls found in history, removing reasoning content`);
        // 通过解构赋值移除 reasoningContent 字段，减少不必要的 Token 消耗
        this.history = this.history.map(msg => {
          const { reasoningContent, ...rest } = msg as any;
          return rest as MessageRecord;
        });
      }
    }

    this.logger.debug(`Loaded ${this.history.length} messages into context`);

    // 计算系统提示词的 Token 数
    this.systemPromptTokenCount = await this.tokenizerService.countTextTokens(this.chatModelName, this.systemPrompt);
    // 减去系统提示词的 Token 数，确保后续计算的上下文窗口是准确的
    this.compressionConfig.contextWindow -= this.systemPromptTokenCount;

    // 初始化时计算全量 Token 数并缓存，作为后续增量更新的基准值
    this.currentTokenCount = await this.tokenizerService.countTokens(this.chatModelName, this.history);
    this.logger.debug(`Initial token count: ${this.currentTokenCount}`);
  }

  /**
   * 获取当前会话历史（不含 system prompt 和摘要）
   *
   * @returns 纯对话历史消息数组
   */
  getHistory(): MessageRecord[] {
    return this.buildFinalMessages(this.history);
  }

  /**
   * 获取准备发送给 LLM 的完整消息列表
   *
   * 该方法会检查是否需要触发压缩策略，若需要则执行压缩并更新内部状态。
   * 最终返回的消息列表包含 system prompt（含注入的摘要）和经过处理的对话历史。
   *
   * @returns 完整的消息数组，可直接传递给 LLM API
   */
  async getMessages(): Promise<MessageRecord[]> {
    if (!this.compressionConfig) {
      this.logger.warn("Compression config not set, returning raw history");
      return this.buildFinalMessages(this.history);
    }

    let messages = this.history;

    // 基于缓存的 Token 计数判断是否达到压缩阈值，避免每次调用都重新计算全量 Token
    // 触发条件：当前 Token 数 >= 上下文窗口 * 触发比例（如 80%）
    if (await this.compressionStrategy.shouldCompress(messages, this.compressionConfig, this.currentTokenCount)) {
      this.logger.log(
        `Compression triggered: ${this.compressionConfig.contextWindow * this.compressionConfig.triggerRatio} tokens threshold exceeded`
      );
      const result = await this.compressionStrategy.execute(
        this.sessionId,
        messages,
        this.compressionConfig,
        this.currentTokenCount, // 传入缓存的 Token 数，避免重复计算
      );

      // 更新内部状态：替换历史消息为压缩后的结果，同时更新摘要内容
      messages = result.messages;
      this.history = messages;
      this.currentSummary = result.summary;

      // 压缩引擎已返回压缩后的 Token 计数，直接使用该值更新缓存，避免重新计算带来的性能开销
      if (result.tokenCount !== undefined) {
        this.currentTokenCount = result.tokenCount;
        this.logger.log(`Compression completed with strategy: ${result.strategy}, token count: ${result.tokenCount}`);
      } else {
        this.logger.log(`Compression completed with strategy: ${result.strategy}`);
      }
    }

    return this.buildFinalMessages(messages);
  }

  /**
   * 追加新的消息记录到会话历史并持久化存储
   *
   * 该方法采用增量更新策略维护 Token 计数缓存，仅计算新增消息的 Token 数，
   * 显著提升高频对话场景下的性能表现。
   *
   * @param records 待追加的消息记录数组
   */
  async appendParts(records: MessageRecord[]): Promise<void> {
    if (!records || records.length === 0) return;

    await this.messageStore.persistContent(records);

    for (const record of records) {
      this.history.push(record);
    }

    // 增量更新 Token 计数：仅计算新追加消息的 Token 数并累加到总计数中
    const newTokens = await this.tokenizerService.countTokens(this.chatModelName, records);
    this.currentTokenCount += newTokens;
    this.logger.debug(`Appended ${records.length} messages, added ${newTokens} tokens, total: ${this.currentTokenCount}`);
  }

  /**
   * 准备助手回复的消息 ID
   *
   * 委托给消息存储层处理，支持普通模式和再生模式的不同逻辑。
   *
   * @param parentId 父消息 ID
   * @param regenerationMode 再生模式标识
   * @param turnsId 轮次 ID
   * @param existingAssistantMessageId 已存在的助手消息 ID（可选）
   * @returns 新生成的助手消息 ID
   */
  async prepareAssistantResponse(
    parentId: string,
    regenerationMode: string,
    turnsId: string,
    existingAssistantMessageId?: string,
  ): Promise<string> {
    return this.messageStore.prepareAssistantResponse(
      this.sessionId,
      parentId,
      regenerationMode,
      turnsId,
      existingAssistantMessageId,
    );
  }

  generateId(): string {
    return uuidv4();
  }

  /**
   * 获取当前缓存的 Token 计数
   *
   * 该方法返回内部维护的 Token 计数缓存值，避免外部重复计算带来的性能开销。
   * Token 计数在 initialize 时初始化，并在 appendParts 和压缩操作时增量更新。
   *
   * @returns 当前会话的 Token 总数
   */
  getTokenCount(): number {
    return this.currentTokenCount + this.systemPromptTokenCount;
  }

  /**
   * 强制触发压缩，不受 Token 阈值限制
   *
   * 该方法会临时修改上下文窗口为当前 Token 数，确保 shouldCompress 判断通过。
   * 主要用于手动压缩场景，保证100%触发压缩逻辑。
   *
   * @returns 压缩后的完整消息列表
   */
  async forceCompress(): Promise<MessageRecord[]> {
    if (!this.compressionConfig) {
      this.logger.warn("Compression config not set, cannot force compress");
      return this.buildFinalMessages(this.history);
    }

    const currentTokens = this.currentTokenCount;
    this.logger.log(`Force compressing session ${this.sessionId} with ${currentTokens} tokens`);

    // 临时保存原始的 contextWindow
    const originalContextWindow = this.compressionConfig.contextWindow;

    try {
      // 临时修改 contextWindow 为当前 Token 数，确保触发压缩
      // 这样 triggerRatio 的判断条件就会满足：currentTokens >= currentTokens * triggerRatio
      this.compressionConfig.contextWindow = currentTokens;

      // 调用 getMessages 触发压缩逻辑
      const compressedMessages = await this.getMessages();

      return compressedMessages;
    } finally {
      // 恢复原始的 contextWindow，避免影响后续的正常对话流程
      this.compressionConfig.contextWindow = originalContextWindow;
      this.logger.debug(`Restored contextWindow to ${originalContextWindow}`);
    }
  }

  /**
   * 构建最终发送给 LLM 的消息列表
   *
   * 将 system prompt、压缩摘要和对话历史组装成完整的消息数组。
   * 摘要是通过压缩策略生成的历史对话概要，注入到 system prompt 中以帮助模型理解上下文。
   *
   * 注意：history 本身不包含 system 消息，此方法会额外过滤以确保数据纯净性。
   *
   * @param messages 待处理的对话历史消息数组（不含 system 消息）
   * @returns 包含 system prompt 和对话历史的完整消息数组
   */
  private buildFinalMessages(messages: MessageRecord[]): MessageRecord[] {
    // 防御性过滤：确保 messages 中不包含意外的 system 消息，保持数据一致性
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');

    let finalSystemPrompt = this.systemPrompt;

    // 将压缩摘要注入到 system prompt 末尾，这是摘要信息的唯一注入点
    // 摘要帮助模型在有限的上下文窗口内理解更长的历史对话背景
    if (this.currentSummary) {
      finalSystemPrompt += `\n\n[历史对话摘要]\n${this.currentSummary}`;
    }

    finalSystemPrompt = finalSystemPrompt.replace("{time}", new Date().toISOString());

    return [
      { role: "system" as const, content: finalSystemPrompt },
      ...nonSystemMessages,
    ];
  }
}
