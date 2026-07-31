import { Logger } from "@nestjs/common";
import {
  ISessionContext,
  ModelConfig,
  ModelFeature,
  ToolApprovalConfig,
  MemoryConfig,
  SessionRunMode,
} from "./session-context";
import { SettingsStorage } from "../../common/utils/settings-storage.util";
import { ModelRepository } from "../../common/database/model.repository";
import { PluginManager } from "../plugins/plugin.manager";
import { PromptCollector } from "../plugins/prompt-collector.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { SG_MODELS, SK_MOD_CHAT } from "../../constants/settings.constants";
import { MessageRecord } from "../llm-core/types/llm.types";
import { cuid } from "../../common/utils/cuid.util";
import { MessageService } from "./message.service";
import {
  ICompressionStrategy,
  CompressionConfig,
  TokenBreakdown,
  CompressionCheckpoint,
  calcTotalTokens,
} from "./interfaces";
import {
  SK_MOD_COMPRESS_MODEL,
  SK_MOD_COMPRESS_ENABLE_SUMMARY,
} from "../../constants/settings.constants";
import { TokenizerService } from "../../common/utils/tokenizer.service";
import { SummaryMode } from "./compression-engine";
import { ResolvedPluginInfo } from "../plugins/types/plugin.types";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";

/**
 * 合并后的会话设置
 */
interface EffectiveSettings {
  systemPrompt: string;
  thinkingEffort?: string;
  memory: any;
  maxTokensLimit?: number | null;
  plugins?: any;
  skills?: Record<string, boolean>; // 角色级技能偏好 { skillId: true/false }
  agents?: Record<string, boolean>; // 角色级 Agent 偏好 { agentId: true/false }
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
  readonly parentSessionId?: string | null;
  get characterId(): string | null {
    return this.session.characterId || null;
  }

  private readonly logger = new Logger(PersistentSessionContext.name);

  // 初始化后构建完成的 DTO（在 initialize() 中一次性填充）
  private modelConfig!: ModelConfig;
  /** system prompt 各部件：base / team / tool / summary */
  private preludeParts: MessageRecord[] = [];
  private thinkingEffortValue!: string | undefined;
  private toolApprovalConfig!: ToolApprovalConfig;
  private resolvedPlugins: ResolvedPluginInfo[] = [];
  private effectiveSettings!: EffectiveSettings;
  private memoryConfig!: MemoryConfig;
  private effectiveContextWindow!: number;
  private _workspacePath!: string;
  private isMessagesLoaded: boolean = false;
  get workspacePath(): string {
    return this._workspacePath;
  }

  // 对话状态
  private history: MessageRecord[] = [];
  private pendingPersistRecords: MessageRecord[] = [];
  /** 细粒度 Token 统计 */
  private tokenBreakdown: TokenBreakdown = {
    systemPrompt: 0,
    summary: 0,
    userPrompt: 0,
    history: 0,
    tools: 0,
  };
  private compressionModel: any;

  private conversationStateLoaded: boolean = false;
  /** 最近一次加载的压缩断点，传给 execute 避免重复查库 */
  private loadedCheckpoint: CompressionCheckpoint | null = null;

  /** 消息加载游标：第一次 getMessages 时传给 loadMessages，只加载到此消息为止 */
  private messageCursor: string | undefined = undefined;

  /** 当前会话运行模式（默认 normal） */
  private runMode: SessionRunMode = "normal";

  constructor(
    private readonly session: any,
    private readonly modelRepository: ModelRepository,
    private readonly settingsStorage: SettingsStorage,
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
    private readonly workspaceService: WorkspaceService,
    private readonly messageStore: MessageService,
    private readonly compressionStrategy: ICompressionStrategy,
    private readonly tokenizerService: TokenizerService,
  ) {
    this.sessionId = session.id;
    this.userId = session.userId;
    this.sessionType = session.sessionType || "web";
    this.parentSessionId = session.parentId || null;
  }

  /**
   * 异步初始化
   *
   * 完成所有数据准备工作（模型解析、设置合并、工具提示词注入、历史消息加载）。
   * 由工厂在构造后调用。
   */
  async initialize(): Promise<void> {
    // 1. 解析工作目录
    this._workspacePath =
      await this.workspaceService.resolveSessionWorkspaceDir(this.session);

    // 2. 解析模型、合并设置
    const model = await this.resolveModel();
    const merged = this.buildEffectiveSettings();
    const features = model?.config?.features || [];

    // 3. 构建所有 DTO
    this.modelConfig = this.buildModelConfig(model, merged);
    this.thinkingEffortValue = features.includes("thinking")
      ? merged.thinkingEffort || "none"
      : undefined;
    this.effectiveSettings = merged;
    this.toolApprovalConfig = this.buildToolApprovalConfig();
    this.memoryConfig = await this.buildMemoryConfig(merged.memory);
    this.effectiveContextWindow = this.calcEffectiveContextWindow(
      model,
      merged.maxTokensLimit,
    );

    // 4. 从持久化设置恢复运行模式（memory 模式不持久化，仅恢复 plan/sandbox）
    const savedRunMode = this.session.settings?.runMode;
    if (savedRunMode === "plan" || savedRunMode === "sandbox") {
      this.runMode = savedRunMode;
    }

    // 5. 插件决议放在最后：所有字段已赋值，handler 可通过 getSettings() 正常读取
    if (features.includes("tools")) {
      this.resolvedPlugins = await this.pluginManager.resolvePlugins(
        this,
        merged.plugins,
      );
    }
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
  private async loadMessages(): Promise<void> {
    this.logger.log(`Initializing conversation state for ${this.sessionId}`);

    const modelConfig = this.modelConfig;
    const memoryConfig = this.memoryConfig;

    this.compressionModel = await this.resolveCompressionModel(modelConfig);

    const checkpoint = await this.compressionStrategy.getCheckpoint(
      this.sessionId,
    );
    this.loadedCheckpoint = checkpoint;

    const modelName = modelConfig.modelName || modelConfig.name || "";
    const isDeepSeekV4 = modelName.includes("deepseek-v4");
    const shouldLoadReasoning =
      this.thinkingEffortValue && this.thinkingEffortValue !== "none";

    if (shouldLoadReasoning) {
      this.logger.debug(
        `Model ${modelName} with thinking enabled (effort: ${this.thinkingEffortValue}), will check for tool calls`,
      );
    }

    const rawMessages = await this.messageStore.loadMessages({
      sessionId: this.sessionId,
      userMessageId: this.messageCursor,
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
            reasoningContent:
              msg.role === "assistant"
                ? (msg.reasoningContent ?? " ")
                : undefined,
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
          if (index >= startIndex && msg.role === "assistant") {
            return { ...msg, reasoningContent: msg.reasoningContent ?? " " };
          } else {
            const { reasoningContent, ...rest } = msg as any;
            return rest as MessageRecord;
          }
        });
      }
    }

    // KIMI 特殊处理

    for (const msg of this.history) {
      if (msg.role === "assistant" && msg.content === "") {
        msg.content = "\n";
      }
    }

    this.logger.debug(`Loaded ${this.history.length} messages into context`);

    // compressionConfig.contextWindow -= this.tokenBreakdown.total;

    // 初始化时计算历史消息 Token 数并缓存
    this.tokenBreakdown.history = await this.tokenizerService.countTokens(
      modelName,
      this.history,
    );
    this.logger.debug(
      `Initial history token count: ${this.tokenBreakdown.history}`,
    );
  }

  /**
   * 预加载历史消息（可选传入游标限制范围）。
   *
   * 供调用方在 addUserMessage 前提前加载历史，使模式切换检测能读取 this.history。
   * 若消息已加载则跳过（幂等）。
   */
  async loadHistory(cursor?: string): Promise<void> {
    if (cursor) this.messageCursor = cursor;
    if (!this.isMessagesLoaded) {
      await this.loadMessages();
      this.isMessagesLoaded = true;
    }
  }

  /**
   * 获取准备发送给 LLM 的完整消息列表。
   *
   * 在首次调用时触发懒加载（loadMessages），后续复用缓存的历史数据。
   * 每次调用前会检查是否达到压缩阈值，若达到则自动执行压缩策略。
   *
   * @warning 禁止在插件中调用，否则会导致无限递归
   *
   * @returns 包含 system prompt 和对话历史的消息数组，可直接传递给 LLM API
   */
  async getMessages(options?: {
    exclude?: string[];
  }): Promise<MessageRecord[]> {
    if (!this.isMessagesLoaded) {
      await this.loadMessages();
      this.isMessagesLoaded = true;
    }
    if (!this.conversationStateLoaded) {
      this.preludeParts = await this.buildPreludeMessages();
      this.conversationStateLoaded = true;
    }

    // 压缩由外部（AgentEngine）通过 shouldCompress/compress 控制，
    // getMessages 仅负责组装消息，不再触发压缩
    return [...this.preludeParts, ...this.history];
  }

  /**
   * 追加用户消息记录并持久化。
   *
   * @param content 用户消息内容
   * @param files 可选的文件列表
   * @param replaceMessageId 可选的替换消息 ID，用于更新或删除
   * @param knowledgeBaseIds 可选的知识知识库 ID列表
   * @param metadata 可选的元数据
   * @param preGenAssistantId 可选的预生成助手 ID
   * @returns 新添加的消息记录
   */
  async addUserMessage(
    content: string,
    files?: string[],
    replaceMessageId?: string | undefined,
    knowledgeBaseIds?: string[] | undefined,
    metadata?: Record<string, any>,
    preGenAssistantId?: string,
  ) {
    // 检测运行模式变化，将提示文案写入 message 级 metadata.systemReminder
    const systemReminder = this.detectModeTransition(replaceMessageId);
    const enrichedMetadata: Record<string, any> = {
      ...metadata,
      runMode: this.runMode,
    };
    if (systemReminder) {
      enrichedMetadata.systemReminder = systemReminder;
    }

    const message = await this.messageStore.addUserMessage(
      this.sessionId,
      content,
      files,
      replaceMessageId,
      knowledgeBaseIds,
      enrichedMetadata,
      preGenAssistantId,
    );

    if (this.isMessagesLoaded && message) {
      const record = await this.messageStore.transformContentStructure(
        message,
        true,
      );
      const chatModelName =
        this.modelConfig.modelName || this.modelConfig.name || "gpt4";
      if (replaceMessageId) {
        const index = this.history.findIndex(
          (msg) => msg.messageId === replaceMessageId,
        );
        if (index !== -1) {
          // 保留 index 之前的全部消息，删除 index 及之后的所有
          this.history = this.history.slice(0, index);
          this.tokenBreakdown.history -=
            await this.tokenizerService.countTokens(
              chatModelName,
              this.history.slice(index + 1),
            );
        }
      }
      this.history.push(...record);
      const newTokens = await this.tokenizerService.countTokens(
        chatModelName,
        record,
      );
      this.tokenBreakdown.history += newTokens;
    }
    return message;
  }

  /**
   * 检测运行模式是否发生切换（基于已加载的历史消息 metadata.runMode）。
   *
   * 纯内存读取，零额外 DB 查询。需在 loadHistory() 之后调用。
   *
   * @returns 切换时的提示文案 | null（无变化）
   */
  private detectModeTransition(replaceMessageId?: string): string | null {
    if (!this.isMessagesLoaded) return null;

    // 找最后一条 user 消息（排除正在被替换的）
    const userMsgs = this.history.filter(
      (m) => m.role === "user" && m.messageId !== replaceMessageId,
    );

    const prevRunMode =
      userMsgs.length > 0
        ? userMsgs[userMsgs.length - 1].metadata?.runMode || "normal"
        : "normal";
    const currentMode = this.runMode;

    if (currentMode === "plan" && prevRunMode !== "plan") {
      return "The user has enabled Plan mode. You are restricted to read-only tools (e.g.,read, grep, glob). The run_command is also available but runs in a read-only sandbox — all file writes are blocked. Use these tools to analyze requirements, formulate a plan, and discuss the approach with the user before any changes are made.";
    }
    if (currentMode !== "plan" && prevRunMode === "plan") {
      return "The user has disabled Plan mode. All tool restrictions have been lifted and you may proceed with normal operations.";
    }
    return null;
  }

  /**
   * 获取原始的对话历史消息列表（不含 system prompt / 摘要 / 插件提示词）。
   *
   * 与 getMessages() 的区别：
   * - getMessages() 返回完整消息列表（含 system prompt），禁止在插件中调用
   * - getHistory() 只返回 raw conversation messages，可在插件中安全使用
   *
   * 仅在消息已加载时返回；若未加载（如插件在初始化阶段调用）则返回空数组，
   * 避免触发 loadMessages 带来副作用。
   */
  async getHistory(): Promise<MessageRecord[]> {
    return [...this.history];
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
    this.tokenBreakdown.history += newTokens;
    this.logger.debug(
      `Appended ${records.length} messages, added ${newTokens} tokens, history: ${this.tokenBreakdown.history}`,
    );
  }

  async persist(): Promise<void> {
    await this.messageStore.persistContent(this.pendingPersistRecords);
    this.pendingPersistRecords = [];
  }

  async addAssistantMessageVersion(
    userMessageId: string,
    preGenAssistantId?: string,
  ): Promise<string> {
    return this.messageStore.addAssistantMessageVersion(
      this.sessionId,
      userMessageId,
      preGenAssistantId,
    );
  }

  generateId(): string {
    return cuid();
  }

  getTokenCount(): number {
    return calcTotalTokens(this.tokenBreakdown);
  }

  getTokenBreakdown(): TokenBreakdown {
    return { ...this.tokenBreakdown };
  }

  /**
   * 执行压缩，不受 Token 阈值限制。
   *
   * 将 contextWindow 临时设置为当前 Token 数，确保 shouldCompress 判断通过。
   * 压缩完成后恢复原始 contextWindow。
   */
  async compress(
    onBeforeCompaction?: () => Promise<void>,
  ): Promise<MessageRecord[]> {
    const currentTokens = this.tokenBreakdown.history;
    const memoryConfig = this.memoryConfig;
    const modelConfig = this.modelConfig;
    const chatModelName = modelConfig.modelName || modelConfig.name || "gpt4";

    // 检查是否已在目标范围内，避免反复压缩
    const targetTokens = Math.floor(
      this.effectiveContextWindow *
        (memoryConfig.compressionTargetRatio ?? 0.5),
    );
    if (currentTokens <= targetTokens) {
      this.logger.log(
        `Skipping compression: ${currentTokens} tokens <= target ${targetTokens}`,
      );
      return await this.getMessages();
    }

    const compressionConfig: CompressionConfig = {
      targetTokens,
      model: this.compressionModel,
      summaryMode: (memoryConfig.summaryMode || SummaryMode.DEFAULT) as any,
      chatModelName,
    };

    const result = await this.compressionStrategy.execute(
      this.sessionId,
      this.history,
      compressionConfig,
      this.tokenBreakdown,
      onBeforeCompaction,
      this.loadedCheckpoint,
    );

    // 更新缓存的 checkpoint，后续压缩直接复用无需查库
    if (result.checkpoint) {
      this.loadedCheckpoint = result.checkpoint;
    }

    this.history = result.messages;
    if (result.tokenCount !== undefined) {
      this.tokenBreakdown.history = result.tokenCount;
    }

    this.logger.log(
      `Force compression completed with strategy: ${result.strategy}, ` +
        `tokens: history=${this.tokenBreakdown.history}, sys=${this.tokenBreakdown.systemPrompt}, summary=${this.tokenBreakdown.summary}, tools=${this.tokenBreakdown.tools}`,
    );
    this.conversationStateLoaded = false;
    return await this.getMessages();
  }

  /**
   * 检查是否达到压缩阈值。
   *
   * 直接根据当前 Token 总数与上下文窗口的比例判断，不再委托给压缩引擎。
   */
  async shouldCompress(): Promise<boolean> {
    const memoryConfig = this.memoryConfig;
    const total = calcTotalTokens(this.tokenBreakdown);
    const ratio = total / this.effectiveContextWindow;
    const triggerRatio = memoryConfig.compressionTriggerRatio ?? 0.8;
    this.logger.debug(
      `Token stats: ${total}/${this.effectiveContextWindow} (${(ratio * 100).toFixed(1)}%), trigger at ${triggerRatio}`,
    );
    return ratio >= triggerRatio;
  }

  private buildModelConfig(
    model: any,
    _effectiveSettings: EffectiveSettings,
  ): ModelConfig {
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
        headers: model.provider?.attributes?.headers,
        config: model.provider?.config,
      },
      modelType: model.modelType,
      config: {
        contextWindow: model.config?.contextWindow,
        maxOutputTokens: model.config?.maxOutputTokens,
        features: model.config?.features || [],
        inputCapabilities: model.config?.inputCapabilities || [],
        // 模型原始配置（显式展开，避免意外覆盖下面运行时参数）
        ...(model.config || {}),
        // 模型参数：直接使用模型自身配置
        temperature: model.config?.temperature ?? undefined,
        topP: model.config?.topP ?? undefined,
        frequencyPenalty: model.config?.frequencyPenalty ?? undefined,
      },
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

  private async buildMemoryConfig(memory: any): Promise<MemoryConfig> {
    const summaryMode = await this.resolveSummaryMode(memory);

    return {
      compressionTriggerRatio: memory?.compressionTriggerRatio,
      compressionTargetRatio: memory?.compressionTargetRatio,
      summaryMode,
    };
  }

  /**
   * 解析摘要模式。
   *
   * 优先级：角色级别 summaryMode > 全局 enableSummary 设置 > 默认快速模式（fast）。
   * 当全局 enableSummary 为 false/disabled 时返回 disabled。
   */
  private async resolveSummaryMode(memory: any): Promise<string> {
    if (memory?.summaryMode) {
      this.logger.debug(`Using role-level summaryMode: ${memory.summaryMode}`);
      return memory.summaryMode;
    }

    const globalEnableSummary = await this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_ENABLE_SUMMARY,
      true,
    );
    const enabled =
      globalEnableSummary === true ||
      globalEnableSummary === "true" ||
      globalEnableSummary === 1;
    const summaryMode = enabled ? SummaryMode.DEFAULT : "disabled";
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
    const compressionModelId = await this.settingsStorage.getSettingValue(
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
   * 合并会话设置与角色默认配置。
   *
   * 优先级规则：
   * - systemPrompt：会话设置 > 角色设置 > 空字符串
   * - memory（记忆配置）：当 memoryEnabled !== false 时使用会话配置，否则继承角色配置
   * - thinkingEffort：仅从会话设置读取
   * - 模型参数（temperature/topP等）：仅从会话设置读取（创建会话时已从角色继承，见 filterAndMergeSessionSettings）
   * - tools / mcpServers：会话设置 > 角色设置
   */
  private buildEffectiveSettings(): EffectiveSettings {
    const sessionSettings = this.session.settings || {};
    const characterSettings = this.session.character?.settings || {};

    // 插件配置：会话设置优先于角色设置
    const mergedTools = sessionSettings.plugins ?? characterSettings.plugins;
    const mergedSkills = sessionSettings.skills ?? characterSettings.skills;
    const mergedAgents = sessionSettings.agents ?? characterSettings.agents;

    // 系统提示词组装
    let systemPrompt =
      sessionSettings.systemPrompt || characterSettings.systemPrompt || "";

    const merged: EffectiveSettings = {
      systemPrompt,
      thinkingEffort: undefined,
      memory: {},
      plugins: mergedTools,
      skills: mergedSkills,
      agents: mergedAgents,
    };

    // 记忆/压缩配置：始终从角色继承，会话不再覆盖
    merged.memory = { ...characterSettings.memory };

    // maxTokensLimit：会话级别独立配置
    merged.maxTokensLimit = sessionSettings.maxTokensLimit ?? null;

    // thinkingEffort
    merged.thinkingEffort = sessionSettings.thinkingEffort;

    return merged;
  }

  private calcEffectiveContextWindow(
    model: any,
    maxTokensLimit?: number | null,
  ): number {
    const modelContextWindow = model?.config?.contextWindow || 128000;
    return maxTokensLimit
      ? Math.min(modelContextWindow, maxTokensLimit)
      : modelContextWindow;
  }

  private async resolveModel() {
    let model = this.session.model;
    if (!model) {
      const modelId = await this.settingsStorage.getSettingValue(
        SG_MODELS,
        SK_MOD_CHAT,
      );
      if (modelId) {
        model = await this.modelRepository.findById(modelId);
      }
    }
    return model;
  }

  private async buildPreludeMessages(): Promise<MessageRecord[]> {
    const systemPrompts: string[] = [this.effectiveSettings.systemPrompt];
    const userPrompts: string[] = [];

    // 分别计算系统提示词和摘要的 Token 数
    const modelName = this.modelConfig.modelName || this.modelConfig.name || "";

    if (this.loadedCheckpoint?.summaryContent) {
      const summaryPrompt = `[CONTEXT COMPACTION — REFERENCE ONLY]\n${this.loadedCheckpoint.summaryContent}\n[CONTEXT COMPACTION — REFERENCE ONLY END]`;
      userPrompts.push(summaryPrompt);
      this.tokenBreakdown.summary = await this.tokenizerService.countTextTokens(
        modelName,
        summaryPrompt,
      );
    }

    // 每次调用时动态搜集插件提示词，因为插件可能在运行时加载
    const modePlugins = this.getResolvedPlugins();
    if (modePlugins.length > 0) {
      // eager → system prompt
      const promptPieces = await this.promptCollector.collectPrompts(
        modePlugins,
        { session: this },
      );
      systemPrompts.push(
        promptPieces
          .map((p) => p.content)
          .filter(Boolean)
          .join("\n\n"),
      );

      // user → user 消息（如工具包记忆）
      const userPieces = await this.promptCollector.collectUserPrompts(
        modePlugins,
        { session: this },
      );
      const userContent = userPieces
        .map((p) => p.content)
        .filter(Boolean)
        .join("\n\n");
      if (userContent) {
        userPrompts.push(userContent);
      }

      this.tokenBreakdown.userPrompt =
        await this.tokenizerService.countTextTokens(modelName, userContent);
    }

    const result: MessageRecord[] = [];

    if (systemPrompts.length > 0) {
      result.push({
        role: "system",
        content: systemPrompts.map((p) => p).join("\n\n"),
      } as MessageRecord);
    }
    this.tokenBreakdown.systemPrompt = await this.tokenizerService.countTokens(
      modelName,
      result.filter((p) => p.role === "system"),
    );
    if (userPrompts.length > 0) {
      result.push({
        role: "user",
        content: userPrompts.map((p) => p).join("\n\n"),
      } as MessageRecord);
    }

    // 计算工具定义（tool definitions）的 Token 数
    // 使用最详细格式（OpenAI: {type:"function", function:{name,description,parameters}}）
    // 确保不低估工具定义占用的上下文窗口
    const toolDefs = ToolOrchestrator.toFlatToolDefs(this.resolvedPlugins);
    if (toolDefs.length > 0) {
      const toolsJson = JSON.stringify(
        toolDefs.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      );
      this.tokenBreakdown.tools = await this.tokenizerService.countTextTokens(
        modelName,
        toolsJson,
        false, // 不缓存，避免挤占
      );
    } else {
      this.tokenBreakdown.tools = 0;
    }

    return result;
  }

  getModelConfig(): ModelConfig {
    return this.modelConfig;
  }

  supportsFeature(feature: ModelFeature): boolean {
    return this.modelConfig.config.features?.includes(feature) || false;
  }

  getThinkingEffort(): string | undefined {
    return this.thinkingEffortValue;
  }

  // === 运行模式 ===

  getRunMode(): SessionRunMode {
    return this.runMode;
  }

  async setRunMode(mode: SessionRunMode): Promise<void> {
    this.logger.debug(`Switching run mode: ${this.runMode} -> ${mode}`);
    this.runMode = mode;
  }

  /**
   * 获取已决议的插件列表。
   */
  getResolvedPlugins(): ResolvedPluginInfo[] {
    return this.resolvedPlugins;
  }

  /** 获取合并后的会话设置（指定字段或全部） */
  getSettings(field?: string): any {
    if (field) return (this.effectiveSettings as any)[field];
    return this.effectiveSettings;
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

  setMessageCursor(messageId: string): void {
    this.messageCursor = messageId;
  }
}
