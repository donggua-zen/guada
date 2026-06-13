import { Logger } from "@nestjs/common";
import {
  ISessionContext,
  ModelConfig,
  ModelFeature,
  ModelParams,
  ToolApprovalConfig,
  MemoryConfig,
} from "./session-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ModelRepository } from "../../common/database/model.repository";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { ToolRuntime } from "../tools/tool-context";
import { WorkspaceService } from "../../common/services/workspace.service";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";
import { MessageRecord } from "../llm-core/types/llm.types";
import { cuid } from "../../common/utils/cuid.util";
import {
  IMessageStore,
  ICompressionStrategy,
  CompressionConfig,
} from "./interfaces";
import {
  SK_MOD_COMPRESS_MODEL,
  SK_MOD_COMPRESS_ENABLE_SUMMARY,
} from "../../constants/settings.constants";
import { TokenizerService } from "../../common/utils/tokenizer.service";

/**
 * 合并后的会话设置
 */
interface MergedSettings {
  systemPrompt: string;
  thinkingEffort?: string;
  memory: any;
  modelTemperature?: number;
  modelTopP?: number;
  modelFrequencyPenalty?: number;
  tools?: any;
  mcpServers?: any;
}

/**
 * 持久化会话上下文实现
 *
 * 基于数据库查询返回的原始 session 对象构建，
 * 将分散在 session.model、session.settings、session.character 中的数据
 * 聚合为类型安全的访问接口。
 *
 * 包含完整的数据准备逻辑（模型解析、设置合并、工具提示词注入），
 * 工厂只负责注入依赖，构造时自动完成所有数据准备。
 *
 * 注意：构造函数接收的 session 应为已包含 model 和 character 关联数据的完整对象
 *（即 SessionRepository.findById 的查询结果）。
 *
 * 与未来可能扩展的虚拟会话（VirtualSessionContext）对应，
 * 后者可直接从内存配置构建，无需数据库。
 */
export class PersistentSessionContext implements ISessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionType: "web" | "bot" | "sub_agent";

  private readonly logger = new Logger(PersistentSessionContext.name);

  // 初始化后构建完成的 DTO（在 initialize() 中一次性填充）
  private modelConfig!: ModelConfig;
  private modelParams!: ModelParams;
  private systemPrompt!: string;
  private thinkingEffortValue!: string | undefined;
  private toolRuntime: ToolRuntime | undefined;
  private toolApprovalConfig!: ToolApprovalConfig;
  private memoryConfig!: MemoryConfig;
  private effectiveContextWindow!: number;
  private workspacePath!: string;

  // 对话状态
  private history: MessageRecord[] = [];
  private pendingPersistRecords: MessageRecord[] = [];
  private systemPromptTokenCount: number = 0;
  private currentSummary?: string;
  private compressionModel: any;

  private currentTokenCount: number = 0;
  private conversationStateLoaded: boolean = false;

  /** 消息加载游标：第一次 getMessages 时传给 loadMessages，只加载到此消息为止 */
  private messageCursor: string | undefined = undefined;

  constructor(
    private readonly session: any,
    private readonly modelRepository: ModelRepository,
    private readonly settingsStorage: SettingsStorage,
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly workspaceService: WorkspaceService,
    private readonly messageStore: IMessageStore,
    private readonly compressionStrategy: ICompressionStrategy,
    private readonly tokenizerService: TokenizerService,
  ) {
    this.sessionId = session.id;
    this.userId = session.userId;
    this.sessionType = session.sessionType || "web";
  }

  /**
   * 异步初始化
   *
   * 完成所有数据准备工作（模型解析、设置合并、工具提示词注入、历史消息加载）。
   * 由工厂在构造后调用。
   */
  async initialize(): Promise<void> {
    const prep = await this.prepareSessionData();
    const model = prep.model;

    // 一次性构建所有 DTO，避免 getter 中的延迟计算和缓存逻辑
    this.modelConfig = this.buildModelConfig(model);
    this.modelParams = this.buildModelParams(prep.mergedSettings, model);
    this.systemPrompt = prep.fullSystemPrompt || "";
    this.thinkingEffortValue = prep.features.includes("thinking")
      ? prep.mergedSettings.thinkingEffort || "off"
      : undefined;
    this.toolRuntime = prep.toolRuntime;
    this.toolApprovalConfig = this.buildToolApprovalConfig();
    this.memoryConfig = this.buildMemoryConfig(prep.mergedSettings.memory);
    this.effectiveContextWindow = prep.effectiveContextWindow;
    this.workspacePath = this.session.workspacePath || "";
  }

  /**
   * 懒加载会话状态：从数据库加载历史消息，恢复压缩检查点，处理 reasoning content。
   *
   * 包含以下逻辑：
   * - 从 messageStore 加载原始消息，根据压缩检查点裁剪历史
   * - 根据模型类型（DeepSeek-V4 / 其他）和 thinking 开关决定 reasoningContent 保留策略
   * - 对 Kimi 模型做空 content 兼容处理
   * - 计算 system prompt 和初始消息的 Token 计数（用于后续增量更新）
   */
  private async loadConversationState(): Promise<void> {
    this.logger.log(`Initializing conversation state for ${this.sessionId}`);

    const modelConfig = this.modelConfig;
    const memoryConfig = this.memoryConfig;

    this.compressionModel = await this.resolveCompressionModel(modelConfig);

    const checkpoint = await this.compressionStrategy.getCheckpoint(
      this.sessionId,
    );

    const modelName = modelConfig.modelName || modelConfig.name || "";
    const isDeepSeekV4 = modelName.includes("deepseek-v4");
    const shouldLoadReasoning =
      this.thinkingEffortValue && this.thinkingEffortValue !== "off";

    if (shouldLoadReasoning) {
      this.logger.debug(
        `Model ${modelName} with thinking enabled (effort: ${this.thinkingEffortValue}), will check for tool calls`,
      );
    }

    const rawMessages = await this.messageStore.loadMessages({
      sessionId: this.sessionId,
      userMessageId: this.messageCursor,
      maxMessages: memoryConfig.maxMemoryLength,
      supportsImageInput:
        modelConfig.config.inputCapabilities?.includes("image"),
      keepReasoningContent: shouldLoadReasoning,
      lastCompactedMessageId: checkpoint?.lastCompactedMessageId,
      lastCompactedContentId: checkpoint?.lastCompactedContentId,
    });

    const preprocessResult = checkpoint
      ? this.compressionStrategy.preprocess(rawMessages, checkpoint)
      : { messages: rawMessages, summary: undefined };

    this.history = preprocessResult.messages;
    this.currentSummary = preprocessResult.summary;

    // reasoning content 处理
    if (shouldLoadReasoning) {
      if (isDeepSeekV4) {
        const hasToolCalls = this.history.some(
          (msg) => msg.toolCalls && msg.toolCalls.length > 0,
        );
        if (hasToolCalls) {
          this.logger.debug(
            `Found tool calls in history, keeping all reasoning content (DeepSeek-V4 mode)`,
          );
          this.history = this.history.map((msg) => ({
            ...msg,
            reasoningContent: msg.reasoningContent ?? "",
          }));
        } else {
          this.logger.debug(
            `No tool calls found in history, removing reasoning content`,
          );
          this.history = this.history.map((msg) => {
            const { reasoningContent, ...rest } = msg as any;
            return rest as MessageRecord;
          });
        }
      } else {
        this.logger.debug(
          `Non-V4 mode: keeping reasoning content after last user message`,
        );
        const lastUserIndex = this.history
          .map((msg) => msg.role)
          .lastIndexOf("user");
        const startIndex = lastUserIndex >= 0 ? lastUserIndex : 0;
        this.history = this.history.map((msg, index) => {
          if (index >= startIndex) {
            return { ...msg, reasoningContent: msg.reasoningContent ?? " " };
          } else {
            const { reasoningContent, ...rest } = msg as any;
            return rest as MessageRecord;
          }
        });
      }
    }

    // KIMI 特殊处理
    const isKimi = modelName.includes("kimi");
    if (isKimi) {
      let replacedCount = 0;
      for (const msg of this.history) {
        if (msg.role === "assistant" && msg.content === "") {
          msg.content = "\n";
          replacedCount++;
        }
      }
      if (replacedCount > 0) {
        this.logger.debug(
          `Kimi model: replaced empty content for ${replacedCount} assistant messages`,
        );
      }
    }

    this.logger.debug(`Loaded ${this.history.length} messages into context`);

    // 计算系统提示词的 Token 数
    this.systemPromptTokenCount = await this.tokenizerService.countTextTokens(
      modelName,
      this.systemPrompt,
    );
    // compressionConfig.contextWindow -= this.systemPromptTokenCount;

    // 初始化时计算全量 Token 数并缓存
    this.currentTokenCount = await this.tokenizerService.countTokens(
      modelName,
      this.history,
    );
    this.logger.debug(`Initial token count: ${this.currentTokenCount}`);
  }

  getHistory(): MessageRecord[] {
    if (!this.conversationStateLoaded) {
      this.logger.warn(
        `getHistory called before conversation state loaded for ${this.sessionId}, returning empty`,
      );
    }
    return this.buildFinalMessages(this.history);
  }

  /**
   * 获取准备发送给 LLM 的完整消息列表。
   *
   * 在首次调用时触发懒加载（loadConversationState），后续复用缓存的历史数据。
   * 每次调用前会检查是否达到压缩阈值，若达到则自动执行压缩策略。
   *
   * @returns 包含 system prompt 和对话历史的消息数组，可直接传递给 LLM API
   */
  async getMessages(): Promise<MessageRecord[]> {
    if (!this.conversationStateLoaded) {
      await this.loadConversationState();
      this.conversationStateLoaded = true;
    }

    const memoryConfig = this.memoryConfig;
    const modelConfig = this.modelConfig;
    const chatModelName = modelConfig.modelName || modelConfig.name || "gpt4";

    const compressionConfig: CompressionConfig = {
      contextWindow: this.effectiveContextWindow - this.systemPromptTokenCount,
      triggerRatio: memoryConfig.compressionTriggerRatio ?? 0.8,
      targetRatio: memoryConfig.compressionTargetRatio ?? 0.5,
      model: this.compressionModel,
      summaryMode: (memoryConfig.summaryMode || "fast") as any,
      chatModelName,
    };

    let messages = this.history;

    if (
      await this.compressionStrategy.shouldCompress(
        messages,
        compressionConfig,
        this.currentTokenCount,
      )
    ) {
      this.logger.log(
        `Compression triggered: ${compressionConfig.contextWindow * compressionConfig.triggerRatio} tokens threshold exceeded`,
      );
      const result = await this.compressionStrategy.execute(
        this.sessionId,
        messages,
        compressionConfig,
        this.currentTokenCount,
      );

      messages = result.messages;
      this.history = messages;
      this.currentSummary = result.summary;

      if (result.tokenCount !== undefined) {
        this.currentTokenCount = result.tokenCount;
        this.logger.log(
          `Compression completed with strategy: ${result.strategy}, token count: ${result.tokenCount}`,
        );
      } else {
        this.logger.log(
          `Compression completed with strategy: ${result.strategy}`,
        );
      }
    }

    return this.buildFinalMessages(messages);
  }

  /**
   * 追加消息记录并持久化。
   *
   * 采用增量 Token 计数策略，只计算新增消息的 Token 数并累加，
   * 避免每次追加都全量重算。
   */
  async appendParts(records: MessageRecord[]): Promise<void> {
    if (!records || records.length === 0) return;

    this.history.push(...records);
    const chatModelName =
      this.modelConfig.modelName || this.modelConfig.name || "gpt4";
    const newTokens = await this.tokenizerService.countTokens(
      chatModelName,
      records,
    );
    await this.messageStore.persistContent(records);
    this.currentTokenCount += newTokens;
    this.logger.debug(
      `Appended ${records.length} messages, added ${newTokens} tokens, total: ${this.currentTokenCount}`,
    );
  }

  async persist(): Promise<void> {
    await this.messageStore.persistContent(this.pendingPersistRecords);
    this.pendingPersistRecords = [];
  }

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
    return cuid();
  }

  getTokenCount(): number {
    return this.currentTokenCount + this.systemPromptTokenCount;
  }

  /**
   * 强制触发压缩，不受 Token 阈值限制。
   *
   * 将 contextWindow 临时设置为当前 Token 数，确保 shouldCompress 判断通过。
   * 压缩完成后恢复原始 contextWindow。
   */
  async forceCompress(): Promise<MessageRecord[]> {
    if (!this.conversationStateLoaded) {
      await this.loadConversationState();
      this.conversationStateLoaded = true;
    }

    const currentTokens = this.currentTokenCount;
    this.logger.log(
      `Force compressing session ${this.sessionId} with ${currentTokens} tokens`,
    );

    const memoryConfig = this.memoryConfig;
    const modelConfig = this.modelConfig;
    const chatModelName = modelConfig.modelName || modelConfig.name || "gpt4";

    const compressionConfig: CompressionConfig = {
      contextWindow: currentTokens,
      triggerRatio: memoryConfig.compressionTriggerRatio ?? 0.8,
      targetRatio: memoryConfig.compressionTargetRatio ?? 0.5,
      model: this.compressionModel,
      summaryMode: (memoryConfig.summaryMode || "fast") as any,
      chatModelName,
    };

    const result = await this.compressionStrategy.execute(
      this.sessionId,
      this.history,
      compressionConfig,
      this.currentTokenCount,
    );

    this.history = result.messages;
    this.currentSummary = result.summary;

    if (result.tokenCount !== undefined) {
      this.currentTokenCount = result.tokenCount;
      this.logger.log(
        `Force compression completed with strategy: ${result.strategy}, token count: ${result.tokenCount}`,
      );
    } else {
      this.logger.log(
        `Force compression completed with strategy: ${result.strategy}`,
      );
    }

    return this.buildFinalMessages(result.messages);
  }

  /**
   * 将 system prompt、压缩摘要和对话历史组装成完整的 LLM 消息数组。
   *
   * 摘要是通过压缩策略生成的历史概要，注入到 system prompt 末尾以帮助模型理解上下文。
   * 支持 {time} 占位符替换为当前 ISO 时间。
   */
  private buildFinalMessages(messages: MessageRecord[]): MessageRecord[] {
    const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

    let finalSystemPrompt = this.systemPrompt;

    if (this.currentSummary) {
      finalSystemPrompt += `\n\n[历史对话摘要]\n${this.currentSummary}`;
    }

    finalSystemPrompt = finalSystemPrompt.replace(
      "{time}",
      new Date().toISOString(),
    );

    return [
      { role: "system" as const, content: finalSystemPrompt },
      ...nonSystemMessages,
    ];
  }

  private buildModelConfig(model: any): ModelConfig {
    if (!model) {
      throw new Error(`Session ${this.sessionId} has no resolved model`);
    }

    return {
      id: model.id,
      modelName: model.modelName,
      name: model.name,
      provider: {
        id: model.provider?.id || "",
        provider: model.provider?.provider || "",
        protocol: model.provider?.protocol,
        apiUrl: model.provider?.apiUrl,
        apiKey: model.provider?.apiKey,
        config: model.provider?.config,
      },
      modelType: model.modelType,
      config: {
        contextWindow: model.config?.contextWindow,
        maxOutputTokens: model.config?.maxOutputTokens,
        features: model.config?.features || [],
        inputCapabilities: model.config?.inputCapabilities || [],
        ...(model.config || {}),
      },
    };
  }

  private buildModelParams(
    mergedSettings: MergedSettings,
    model: any,
  ): ModelParams {
    return {
      temperature: mergedSettings.modelTemperature ?? 0.7,
      topP: mergedSettings.modelTopP ?? 1.0,
      frequencyPenalty: mergedSettings.modelFrequencyPenalty ?? 0,
      maxTokens: model?.config?.maxOutputTokens,
    };
  }

  private buildToolApprovalConfig(): ToolApprovalConfig {
    const settings = this.session.settings || {};
    const approvalConfig = settings.toolApproval || {};

    return {
      enabled: approvalConfig.enabled !== false,
      requiresApproval: approvalConfig.requiresApproval || [],
    };
  }

  private buildMemoryConfig(memory: any): MemoryConfig {
    const summaryMode = this.resolveSummaryMode(memory);

    return {
      maxMemoryLength: memory?.maxMemoryLength,
      compressionTriggerRatio: memory?.compressionTriggerRatio,
      compressionTargetRatio: memory?.compressionTargetRatio,
      summaryMode,
      maxTokensLimit: memory?.maxTokensLimit,
    };
  }

  /**
   * 解析摘要模式。
   *
   * 优先级：角色级别 summaryMode > 全局 enableSummary 设置 > 默认快速模式（fast）。
   * 当全局 enableSummary 为 false/disabled 时返回 disabled。
   */
  private resolveSummaryMode(memory: any): string {
    if (memory?.summaryMode) {
      this.logger.debug(`Using role-level summaryMode: ${memory.summaryMode}`);
      return memory.summaryMode;
    }

    const globalEnableSummary = this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_ENABLE_SUMMARY,
      true,
    );
    const enabled =
      globalEnableSummary === true ||
      globalEnableSummary === "true" ||
      globalEnableSummary === 1;
    const summaryMode = enabled ? "fast" : "disabled";
    this.logger.debug(
      `Using global enableSummary setting, converted to summaryMode: ${summaryMode}`,
    );

    return summaryMode;
  }

  /**
   * 解析压缩模型。
   *
   * 优先使用配置的专用压缩模型，若未配置或加载失败则回退到对话模型。
   * 专用压缩模型通常选择成本更低、速度更快的模型。
   */
  private async resolveCompressionModel(fallbackModel: any): Promise<any> {
    const compressionModelId = this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_MODEL,
      null,
    );

    if (!compressionModelId) {
      return fallbackModel;
    }

    try {
      const model = await this.modelRepository.findById(compressionModelId);
      if (model) {
        this.logger.debug(
          `Using dedicated compression model: ${model.modelName}`,
        );
        return model;
      } else {
        this.logger.warn(
          `Compression model ${compressionModelId} not found, falling back to chat model`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to load compression model ${compressionModelId}:`,
        error,
      );
    }

    return fallbackModel;
  }

  /**
   * 准备会话数据：解析模型、合并设置、注入工具提示词、计算上下文窗口。
   *
   * 这是 ISessionContext 初始化的核心方法，一次性完成所有数据准备工作。
   * 根据模型特性（tools / thinking）决定是否注入工具运行时。
   */
  private async prepareSessionData(): Promise<{
    model: any;
    mergedSettings: MergedSettings;
    fullSystemPrompt: string;
    effectiveContextWindow: number;
    thinkingEffort: string | undefined;
    toolRuntime: ToolRuntime | undefined;
    features: string[];
  }> {
    const sessionId = this.sessionId;
    const userId = this.userId;

    const model = await this.resolveModel();

    const merged = this.mergeSettings();

    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");

    // 注入工具提示词
    let toolPrompts = "";
    let toolRuntime: ToolRuntime | undefined;

    if (supportsTools) {
      const workspacePath = this.workspaceService.resolveSessionWorkspaceDir(
        this.session,
      );

      const injectParams = {
        sessionId,
        userId,
        sessionType: this.sessionType,
        workspacePath,
      };

      toolRuntime = await this.toolOrchestrator.buildToolRuntime(
        injectParams,
        merged.tools,
        merged.mcpServers,
      );

      toolPrompts = await this.toolOrchestrator.getPrompts(toolRuntime);
    }

    const fullSystemPrompt = [merged.systemPrompt, toolPrompts]
      .filter(Boolean)
      .join("\n");

    const effectiveContextWindow = this.calcEffectiveContextWindow(
      model,
      merged.memory,
    );

    const thinkingEffort = features.includes("thinking")
      ? merged.thinkingEffort || "off"
      : undefined;

    return {
      model,
      mergedSettings: merged,
      fullSystemPrompt,
      effectiveContextWindow,
      thinkingEffort,
      toolRuntime,
      features,
    };
  }

  /**
   * 合并会话设置与角色默认配置。
   *
   * 优先级规则：
   * - systemPrompt：会话设置 > 角色设置 > 空字符串
   * - memory（记忆配置）：当 memoryEnabled !== false 时使用会话配置，否则继承角色配置
   * - thinkingEffort：仅从会话设置读取
   * - 模型参数（temperature/topP等）：仅从角色设置读取
   * - tools / mcpServers：会话设置 > 角色设置
   */
  private mergeSettings(): MergedSettings {
    const sessionSettings = this.session.settings || {};
    const characterSettings = this.session.character?.settings || {};

    // 工具配置：会话设置优先于角色设置
    const mergedTools = sessionSettings.tools ?? characterSettings.tools;
    const mergedMcpServers =
      sessionSettings.mcpServers ?? characterSettings.mcpServers;

    const merged: MergedSettings = {
      systemPrompt:
        sessionSettings.systemPrompt || characterSettings.systemPrompt || "",
      thinkingEffort: undefined,
      memory: {},
      modelTemperature: characterSettings.modelTemperature,
      modelTopP: characterSettings.modelTopP,
      modelFrequencyPenalty: characterSettings.modelFrequencyPenalty,
      tools: mergedTools,
      mcpServers: mergedMcpServers,
    };

    // 记忆/压缩配置（独立继承）
    const memoryEnabled = sessionSettings.memoryEnabled;
    const sessionMemory = sessionSettings.memory || {};
    const characterMemory = characterSettings.memory || {};

    if (memoryEnabled !== false) {
      merged.memory = { ...sessionMemory };
    } else {
      merged.memory = { ...characterMemory };
    }

    // thinkingEffort
    merged.thinkingEffort = sessionSettings.thinkingEffort;

    return merged;
  }

  private calcEffectiveContextWindow(model: any, memoryConfig: any): number {
    const modelContextWindow = model?.config?.contextWindow || 128000;
    const maxTokensLimit = memoryConfig?.maxTokensLimit;
    return maxTokensLimit
      ? Math.min(modelContextWindow, maxTokensLimit)
      : modelContextWindow;
  }

  private async resolveModel() {
    let model = this.session.model;
    if (!model) {
      const modelId = this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
      if (modelId) {
        model = await this.modelRepository.findById(modelId);
      }
    }
    return model;
  }

  getModelConfig(): ModelConfig {
    return this.modelConfig;
  }

  getModelParams(): ModelParams {
    return this.modelParams;
  }

  supportsFeature(feature: ModelFeature): boolean {
    return this.modelConfig.config.features?.includes(feature) || false;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  getThinkingEffort(): string | undefined {
    return this.thinkingEffortValue;
  }

  getToolContext(): ToolRuntime | undefined {
    return this.toolRuntime;
  }

  getToolApprovalConfig(): ToolApprovalConfig {
    return this.toolApprovalConfig;
  }

  getMemoryConfig(): MemoryConfig {
    return this.memoryConfig;
  }

  getEffectiveContextWindow(): number {
    return this.effectiveContextWindow;
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  isVirtual(): boolean {
    return false;
  }

  setMessageCursor(messageId: string): void {
    this.messageCursor = messageId;
  }
}
