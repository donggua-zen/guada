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
import { SummaryMode } from "./compression-engine";
import { ResolvedPluginInfo } from "../plugins/types/plugin.types";
import { SessionTokenTracker } from "./utils/session-token-tracker";

/**
 * 合并后的会话设置
 */
interface MergedSettings {
  systemPrompt: string;
  thinkingEffort?: string;
  memory: any;
  model: {
    temperature?: number;
    topP?: number;
    frequencyPenalty?: number;
  };
  // modelTemperature?: number;
  // modelTopP?: number;
  // modelFrequencyPenalty?: number;
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

  private readonly logger = new Logger(PersistentSessionContext.name);

  // 初始化后构建完成的 DTO（在 initialize() 中一次性填充）
  private modelConfig!: ModelConfig;
  /** system prompt 各部件：base / team / tool / summary */
  private systemPromptParts: Record<string, string> = {};
  private thinkingEffortValue!: string | undefined;
  private toolApprovalConfig!: ToolApprovalConfig;
  private resolvedPlugins: ResolvedPluginInfo[] = [];
  private skillsConfig: any;
  private agentsConfig: any;
  private mergedSettings!: any;
  private memoryConfig!: MemoryConfig;
  private effectiveContextWindow!: number;
  private _workspacePath!: string;
  get workspacePath(): string {
    return this._workspacePath;
  }

  // 对话状态
  private history: MessageRecord[] = [];
  private pendingPersistRecords: MessageRecord[] = [];
  private systemPromptTokenCount: number = 0;
  private compressionModel: any;

  private currentTokenCount: number = 0;
  private conversationStateLoaded: boolean = false;

  /** 消息加载游标：第一次 getMessages 时传给 loadMessages，只加载到此消息为止 */
  private messageCursor: string | undefined = undefined;
  /** 会话级 Token 消费追踪器 */
  private tokenTracker: SessionTokenTracker | null = null;

  /** 当前会话运行模式（默认 normal） */
  private runMode: SessionRunMode = "normal";
  /** memory 模式强制插件缓存（initialize 时预计算） */
  private forcedMemoryPlugins: ResolvedPluginInfo[] = [];

  constructor(
    private readonly session: any,
    private readonly modelRepository: ModelRepository,
    private readonly settingsStorage: SettingsStorage,
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
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
    // 先解析工作目录，后续 prepareSessionData 直接使用 this._workspacePath
    this._workspacePath =
      await this.workspaceService.resolveSessionWorkspaceDir(this.session);

    const prep = await this.prepareSessionData();
    const model = prep.model;

    // 一次性构建所有 DTO，避免 getter 中的延迟计算和缓存逻辑
    this.modelConfig = this.buildModelConfig(model, prep.mergedSettings);
    this.systemPromptParts = {
      base: prep.mergedSettings.systemPrompt || "",
    };
    this.thinkingEffortValue = prep.features.includes("thinking")
      ? prep.mergedSettings.thinkingEffort || "off"
      : undefined;
    this.resolvedPlugins = prep.resolvedPlugins;
    this.skillsConfig = prep.mergedSettings.skills;
    this.agentsConfig = prep.mergedSettings.agents;
    this.mergedSettings = prep.mergedSettings;
    this.toolApprovalConfig = this.buildToolApprovalConfig();
    this.memoryConfig = await this.buildMemoryConfig(
      prep.mergedSettings.memory,
    );
    this.effectiveContextWindow = prep.effectiveContextWindow;
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
    if (preprocessResult.summary) {
      this.systemPromptParts.summary = preprocessResult.summary;
    }

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
      this.buildSystemPrompt(),
    );
    // compressionConfig.contextWindow -= this.systemPromptTokenCount;

    // 初始化时计算全量 Token 数并缓存
    this.currentTokenCount = await this.tokenizerService.countTokens(
      modelName,
      this.history,
    );
    this.logger.debug(`Initial token count: ${this.currentTokenCount}`);
  }

  /**
   * 获取准备发送给 LLM 的完整消息列表。
   *
   * 在首次调用时触发懒加载（loadConversationState），后续复用缓存的历史数据。
   * 每次调用前会检查是否达到压缩阈值，若达到则自动执行压缩策略。
   *
   * @returns 包含 system prompt 和对话历史的消息数组，可直接传递给 LLM API
   */
  async getMessages(options?: {
    exclude?: string[];
  }): Promise<MessageRecord[]> {
    // 每次调用时动态搜集插件提示词（必须在 loadConversationState 之前）
    const modePlugins = this.getResolvedPlugins();
    if (!options?.exclude?.includes("plugins") && modePlugins.length > 0) {
      const promptPieces = await this.promptCollector.collectPrompts(
        modePlugins,
        { session: this },
      );
      this.systemPromptParts.plugins = promptPieces
        .map((p) => p.content)
        .filter(Boolean)
        .join("\n\n");
    }

    if (!this.conversationStateLoaded) {
      await this.loadConversationState();
      this.conversationStateLoaded = true;
    }

    // 压缩由外部（AgentEngine）通过 shouldCompress/compress 控制，
    // getMessages 仅负责组装消息，不再触发压缩
    return this.buildFinalMessages(this.history, options);
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
   * 执行压缩，不受 Token 阈值限制。
   *
   * 将 contextWindow 临时设置为当前 Token 数，确保 shouldCompress 判断通过。
   * 压缩完成后恢复原始 contextWindow。
   */
  async compress(onStage2?: () => Promise<void>): Promise<MessageRecord[]> {
    if (!this.conversationStateLoaded) {
      await this.loadConversationState();
      this.conversationStateLoaded = true;
    }

    const currentTokens = this.currentTokenCount;
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
      contextWindow: currentTokens,
      triggerRatio: memoryConfig.compressionTriggerRatio ?? 0.8,
      targetRatio: memoryConfig.compressionTargetRatio ?? 0.5,
      model: this.compressionModel,
      summaryMode: (memoryConfig.summaryMode || SummaryMode.DEFAULT) as any,
      chatModelName,
    };

    const result = await this.compressionStrategy.execute(
      this.sessionId,
      this.history,
      compressionConfig,
      this.currentTokenCount,
      onStage2,
    );

    this.history = result.messages;
    if (result.summary) {
      this.systemPromptParts.summary = result.summary;
    }

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

    return await this.getMessages();
  }

  /**
   * 检查是否达到压缩阈值。
   *
   * 通过 compressionStrategy.shouldCompress 判断当前 Token 数是否达到阈值。
   * 由 AgentEngine 在每轮循环前调用，决定是否进入 shadow_save 或 compress 状态。
   */
  async shouldCompress(): Promise<boolean> {
    const memoryConfig = this.memoryConfig;
    const modelConfig = this.modelConfig;
    const chatModelName = modelConfig.modelName || modelConfig.name || "gpt4";

    const config: CompressionConfig = {
      contextWindow: this.effectiveContextWindow - this.systemPromptTokenCount,
      triggerRatio: memoryConfig.compressionTriggerRatio ?? 0.8,
      targetRatio: memoryConfig.compressionTargetRatio ?? 0.5,
      chatModelName,
    };

    return this.compressionStrategy.shouldCompress(
      this.history,
      config,
      this.currentTokenCount,
    );
  }

  private async buildFinalMessages(
    messages: MessageRecord[],
    options?: { exclude?: string[] },
  ): Promise<MessageRecord[]> {
    const nonSystemMessages = messages.filter((msg) => msg.role !== "system");

    const finalSystemPrompt = this.buildSystemPrompt(options?.exclude);
    return [
      { role: "system" as const, content: finalSystemPrompt },
      ...nonSystemMessages,
    ];
  }

  private buildModelConfig(
    model: any,
    mergedSettings: MergedSettings,
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
        // 二级链：会话设置（创建时已从角色继承）> 模型默认 > undefined（API自行决策）
        temperature:
          mergedSettings.model.temperature ??
          model.config?.temperature ??
          undefined,
        topP:
          mergedSettings.model.topP ??
          model.config?.modelTopP ??
          model.config?.topP ??
          undefined,
        frequencyPenalty:
          mergedSettings.model.frequencyPenalty ??
          model.config?.frequencyPenalty ??
          undefined,
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
   * 准备会话数据：解析模型、合并设置、注入工具提示词、计算上下文窗口。
   *
   * 这是 ISessionContext 初始化的核心方法，一次性完成所有数据准备工作。
   * 根据模型特性（tools / thinking）决定是否注入工具运行时。
   */
  private async prepareSessionData(): Promise<{
    model: any;
    mergedSettings: MergedSettings;
    effectiveContextWindow: number;
    thinkingEffort: string | undefined;
    resolvedPlugins: ResolvedPluginInfo[];
    pluginsConfig: any;
    features: string[];
  }> {
    const model = await this.resolveModel();

    const merged = this.mergeSettings();

    const features = model?.config?.features || [];
    const supportsTools = features.includes("tools");

    let resolvedPlugins: ResolvedPluginInfo[] = [];
    let pluginsConfig: any = undefined;

    if (supportsTools) {
      // 一次决议
      const resolved = await this.pluginManager.resolvePlugins(
        this,
        merged.plugins,
      );
      resolvedPlugins = resolved;
      pluginsConfig = merged.plugins;
    }

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
      effectiveContextWindow,
      thinkingEffort,
      resolvedPlugins,
      pluginsConfig,
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
   * - 模型参数（temperature/topP等）：仅从会话设置读取（创建会话时已从角色继承，见 filterAndMergeSessionSettings）
   * - tools / mcpServers：会话设置 > 角色设置
   */
  private mergeSettings(): MergedSettings {
    const sessionSettings = this.session.settings || {};
    const characterSettings = this.session.character?.settings || {};

    // 团队模式：从主理人获取角色设置
    let leaderSettings = characterSettings;
    if (this.session.team?.leader?.settings) {
      leaderSettings = this.session.team.leader.settings;
    }

    // 插件配置：会话设置优先于角色设置
    const mergedTools = sessionSettings.plugins ?? leaderSettings.plugins;
    const mergedSkills = sessionSettings.skills ?? leaderSettings.skills;
    const mergedAgents = sessionSettings.agents ?? leaderSettings.agents;

    // 系统提示词组装
    let systemPrompt =
      sessionSettings.systemPrompt || leaderSettings.systemPrompt || "";

    // 团队模式：拼接团队成员信息到提示词
    if (this.session.team) {
      const team = this.session.team;
      // const leader = team.leader;
      const members = team.members || [];

      // 从主理人获取基础提示词
      const leaderPrompt = leaderSettings.systemPrompt || "";
      if (leaderPrompt) {
        systemPrompt = leaderPrompt;
      }

      // 拼接团队成员信息
      const memberInfos = members
        .filter((m: any) => m.role !== "leader" && m.character)
        .map((m: any) => {
          const c = m.character;
          return `- ID: ${c.id}, 名称: ${c.title}${c.description ? `, 描述: ${c.description}` : ""}`;
        });

      if (memberInfos.length > 0) {
        const teamPromptParts = [
          "",
          "# 团队成员",
          `你是团队 "${team.name}" 的主理人，你的任务是协调和分配任务。当需求和以下的团队成员能力匹配的时候，*你必须加载subagent能力*，使用对应的角色ID创建子代理，并分配任务：`,
          ...memberInfos,
        ];
        systemPrompt = teamPromptParts.join("\n") + systemPrompt;
      }
    }

    const merged: MergedSettings = {
      systemPrompt,
      thinkingEffort: undefined,
      memory: {},
      model: {},
      plugins: mergedTools,
      skills: mergedSkills,
      agents: mergedAgents,
    };

    if (sessionSettings.modelOverrideEnabled && sessionSettings.model) {
      merged.model = {
        temperature: sessionSettings.model?.temperature,
        topP: sessionSettings.model?.topP,
        frequencyPenalty: sessionSettings.model?.frequencyPenalty,
      };
    }

    // 记忆/压缩配置（独立继承）
    const memoryEnabled = sessionSettings.memoryEnabled;
    const sessionMemory = sessionSettings.memory || {};
    const characterMemory = characterSettings.memory || {};

    if (memoryEnabled !== false) {
      merged.memory = { ...characterMemory, ...sessionMemory };
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

  private buildSystemPrompt(exclude?: string[]): string {
    const order = ["base", "plugins", "summary"];
    const filtered = exclude?.length
      ? order.filter((k) => !exclude.includes(k))
      : order;
    return filtered
      .map((k) => {
        const content = this.systemPromptParts[k];
        if (!content) return "";
        if (k === "summary") {
          return `# 历史对话摘要\n<summary>\n${content}\n</summary>`;
        }
        return content;
      })
      .filter(Boolean)
      .join("\n\n");
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

    // memory 模式：懒加载强制插件列表
    if (mode === "memory" && this.forcedMemoryPlugins.length === 0) {
      this.forcedMemoryPlugins = await this.pluginManager.resolvePlugins(this, {
        __default: false,
        memory: { enabled: true },
        file: { enabled: true },
      });
    }
  }

  /**
   * 根据运行模式返回插件列表。
   *
   * - normal: 返回全部已决议插件（受用户配置控制）
   * - memory: 返回强制插件列表（memory + file，无视用户开关）
   *           首次切换到 memory 模式时通过 resolvePlugins 懒加载。
   */
  getResolvedPlugins(): ResolvedPluginInfo[] {
    if (this.runMode === "memory") {
      return this.forcedMemoryPlugins;
    }
    return this.resolvedPlugins;
  }

  /**
   * 根据运行模式返回技能配置。
   *
   * - normal: 返回完整技能配置
   * - memory: 返回空（记忆模式下不需要技能提示词）
   */
  getSettings(field?: string): any {
    if (field) return (this.mergedSettings as any)[field];
    return this.mergedSettings;
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

  // === Token 消费追踪 ===

  async recordTokenUsage(
    promptTokens: number,
    completionTokens: number,
    cachedTokens?: number,
  ): Promise<void> {
    if (!this.tokenTracker) {
      this.tokenTracker = new SessionTokenTracker(this._workspacePath);
    }
    await this.tokenTracker.addUsage(
      promptTokens,
      completionTokens,
      cachedTokens,
    );
  }
}
