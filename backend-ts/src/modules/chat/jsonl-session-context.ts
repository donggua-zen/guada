/**
 * JSONL 持久化 — 会话上下文（JSONL 版）
 *
 * 实现 ISessionContext 接口，消息持久化经 MESSAGE_STORE_TOKEN 注入的 IMessageStore 驱动。
 * 能力与 persistent-session-context.ts（DB 版）对齐：
 * - 设置合并（会话 > 角色）、模型解析、插件决议、提示词拼接（system/插件/tools）
 * - 细粒度 Token 统计 + provider 真值锚点（dsh 式）
 * - 运行模式切换检测（systemReminder）、reasoning content 策略、KIMI 兼容
 * - 压缩接入统一 CompressionEngine（一级裁剪 prune）
 */
import { Inject, Logger } from '@nestjs/common';
import {
  ISessionContext,
  ModelConfig,
  ModelFeature,
  SessionSandboxMode,
  GetMessagesOptions,
} from './session-context';
import {
  IMessageStore,
  MESSAGE_STORE_TOKEN,
} from '../../common/persistence/message-store.interface';
import type { Message, FileRef } from '../../common/types/conversation.types';
import { TokenBreakdown, TurnFinish } from './interfaces';
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { ModelRepository } from '../../common/database/model.repository';
import { PluginManager } from '../plugins/plugin.manager';
import { SessionStreamManager } from './session-stream.manager';
import { PromptCollector } from '../plugins/prompt-collector.service';
import { WorkspaceService } from '../../common/services/workspace.service';
import { TokenMeterService } from './token-meter.service';
import { SummaryMode } from './compression-engine';
import {
  CompactionConfig,
  CompactionDataSource,
} from './compaction/types';
import { ToolOrchestrator } from '../tools/tool-orchestrator.service';
import { ResolvedPluginInfo } from '../plugins/types/plugin.types';
import {
  SG_MODELS,
  SK_MOD_CHAT,
  SK_MOD_COMPRESS_ENABLE_SUMMARY,
} from '../../constants/settings.constants';
import {
  TransformContext,
  createDefaultMessageTransformPipeline,
} from './message-transform.pipeline';

/**
 * 合并后的会话设置（与 DB 版一致）
 */
interface EffectiveSettings {
  systemPrompt: string;
  thinkingEffort?: string;
  memory: any;
  maxTokensLimit?: number | null;
  plugins?: any;
  skills?: Record<string, boolean>;
  agents?: Record<string, boolean>;
  attachments?: Record<string, string[]>;
  sandboxMode?: string;
  referencedKbs?: string[];
  modelName?: string | null;
}

export class JsonlSessionContext implements ISessionContext, CompactionDataSource {
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionType: 'web' | 'bot' | 'sub_agent';
  readonly parentSessionId?: string | null;
  readonly characterId?: string | null;
  readonly botId?: string | null;
  readonly externalId?: string | null;

  private readonly logger = new Logger(JsonlSessionContext.name);

  // 初始化后构建完成的 DTO
  private modelConfig!: ModelConfig;
  /** system prompt 各部件：base / team / tool / summary */
  private preludeParts: Message[] = [];
  private thinkingEffortValue!: string | undefined;
  private resolvedPlugins: ResolvedPluginInfo[] = [];
  private effectiveSettings!: EffectiveSettings;
  /** 合并后的压缩配置（压缩侧经 CompactionDataSource.getCompressionConfig 消费） */
  private compactionConfig: CompactionConfig = {};
  private effectiveContextWindow!: number;
  private _workspacePath!: string;
  private conversationStateLoaded = false;

  /** L1 消息变换管线（图片投影 / reasoning 策略 / 空 content 兼容，见 message-transform.pipeline.ts） */
  private readonly transformPipeline = createDefaultMessageTransformPipeline();

  // 消息视图直通 store（不再维护 this.history 双层缓存）：读取经
  // messageStore.loadContext（store 缓存写即更新，见 applyToCache）+ provider 变换（产生副本）。
  // prelude 保留缓存（构建贵：插件提示词收集 + 工具序列化；getPrelude/getTools 依赖）。
  /** prelude 构建时的分项 token（供 getTokenBreakdown 按需消费；history 每次现算） */
  private preludeTokenStats = {
    systemPrompt: 0,
    userPrompt: 0,
    tools: 0,
  };

  private sandboxMode: SessionSandboxMode = 'workspace-write';

  /** 工具范围锁定（瞬态、不入库）：影子轮次等场景仅允许指定插件的工具 */
  private toolScope: string | null = null;

  constructor(
    private readonly session: any,
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly settingsStorage: SettingsStorage,
    private readonly modelRepository: ModelRepository,
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
    private readonly workspaceService: WorkspaceService,
    private readonly tokenMeter: TokenMeterService,
    private readonly streamManager: SessionStreamManager,
  ) {
    this.sessionId = session.id;
    this.userId = session.userId;
    this.sessionType = session.sessionType || 'web';
    this.parentSessionId = session.parentId || null;
    this.characterId = session.characterId || null;
    this.botId = session.botId || null;
    this.externalId = session.externalId || null;
  }

  // ═══ 初始化 ═══

  async initialize(): Promise<void> {
    // 1. 解析工作目录
    this._workspacePath =
      await this.workspaceService.resolveSessionWorkspaceDir(this.session);

    // 2. 解析模型、合并设置
    const model = await this.resolveModel();
    const merged = this.buildEffectiveSettings();
    const features = model?.config?.features || [];

    // 3. 构建 DTO
    this.modelConfig = this.buildModelConfig(model, merged);
    this.thinkingEffortValue = features.includes('thinking')
      ? merged.thinkingEffort || 'none'
      : undefined;
    this.effectiveSettings = merged;
    this.compactionConfig = await this.buildCompactionConfig(merged.memory);
    this.effectiveContextWindow = this.calcEffectiveContextWindow(
      model,
      merged.maxTokensLimit,
    );

    // 4. 恢复持久化的安全模式（三档词表持久化于 settings.sandboxMode，未知值回退默认）
    const savedSandboxMode = this.session.settings?.sandboxMode;
    if (
      savedSandboxMode === 'read-only' ||
      savedSandboxMode === 'workspace-write' ||
      savedSandboxMode === 'danger-full-access'
    ) {
      this.sandboxMode = savedSandboxMode;
    }

    // 5. 插件决议放在最后：所有字段已赋值，handler 可通过 getSettings() 正常读取
    if (features.includes('tools')) {
      this.resolvedPlugins = await this.pluginManager.resolvePlugins(
        this,
        merged.plugins,
      );
    }
  }

  // ═══ 消息读取（直通 store：每次从当前折叠视图派生，无会话层历史缓存）═══

  /**
   * 读取当前可见消息视图：直通 messageStore.loadContext（store 缓存写即更新——
   * appendCompact/appendPrune/appendMessages 等均经 applyToCache 增量折叠），
   * 再经 L1 消息变换管线归一化（图片投影 / reasoning 策略 / 空 content 兼容）。
   *
   * 管线步骤均为纯函数，在副本上执行，不污染 store 缓存态（loadContext 返回缓存对象引用）。
   */
  private async loadVisibleMessages(): Promise<Message[]> {
    const modelConfig = this.modelConfig;

    const shouldLoadReasoning =
      this.thinkingEffortValue && this.thinkingEffortValue !== 'none';

    const rawMessages = await this.messageStore.loadContext({
      sessionId: this.sessionId,
      keepReasoningContent: shouldLoadReasoning,
    });

    const transformCtx: TransformContext = {
      supportsImageInput:
        modelConfig.config.inputCapabilities?.includes('image') ?? false,
      thinkingMode: !!shouldLoadReasoning,
      providerProtocol: modelConfig.provider?.protocol,
      modelName: modelConfig.modelName,
    };

    return this.transformPipeline.run(rawMessages, transformCtx);
  }

  async getMessages(options?: GetMessagesOptions): Promise<Message[]> {
    await this.ensureConversationStateLoaded();
    return [...this.preludeParts, ...(await this.loadVisibleMessages())];
  }

  async getHistory(): Promise<Message[]> {
    return this.loadVisibleMessages();
  }

  // ═══ 消息写入 ═══

  /**
   * 开回合:写 turn/start(先于 user/message,对齐 DSH 回合定界)。
   * 整轮次重答(replaceTurnId):先 turn/delete 遮蔽旧轮次,再开新回合。
   * 返回回合 turnId,作为后续 appendMessages / finalizeTurn 的归属游标。
   */
  async beginTurn(options?: {
    replaceTurnId?: string;
    preGenTurnId?: string;
  }): Promise<string> {
    // 整轮次重答的删除由 run() 先调 deleteTurn 完成(先删除再加载),beginTurn 只写 turn/start。
    return this.messageStore.beginTurn(this.sessionId, {
      replaceTurnId: options?.replaceTurnId,
      preGenTurnId: options?.preGenTurnId,
    });
  }

  /**
   * 删除本轮对话:写 turn/delete 事件（store 折叠即 splice 移除）+ 失效块级 token 缓存。
   * 读取直通 store，删除后 getMessages 自然不再含该回合。
   */
  async deleteTurn(turnId: string): Promise<void> {
    await this.messageStore.deleteTurn(this.sessionId, turnId);
    this.tokenMeter.invalidate(this.sessionId);
  }

  /**
   * 追加用户消息:写 user/message(后于 turn/start,归属由当前回合括号界定)。
   * 事件实时落盘,返回用户消息(三层 Message,供广播 user_message 事件)。
   */
  async addUserMessage(
    content: string,
    files?: FileRef[],
    options?: {
      replaceTurnId?: string;
      knowledgeBaseIds?: string[];
      metadata?: Record<string, any>;
    },
  ): Promise<{ messageId: string; userMessage: any }> {
    const replaceTurnId = options?.replaceTurnId;
    // 检测运行模式变化，将提示文案写入 message 级 metadata.systemReminder
    const systemReminder = await this.detectModeTransition(replaceTurnId);
    const enrichedMetadata: Record<string, any> = {
      ...options?.metadata,
      sandboxMode: this.sandboxMode,
    };
    if (systemReminder) {
      enrichedMetadata.systemReminder = systemReminder;
    }

    const { messageId, userMessage } =
      await this.messageStore.addUserMessage(
        this.sessionId,
        content,
        files || [],
        {
          knowledgeBaseIds: options?.knowledgeBaseIds,
          metadata: enrichedMetadata,
        },
      );

    return { messageId, userMessage };
  }

  async appendMessages(messages: Message[]): Promise<void> {
    if (!messages || messages.length === 0) return;

    // 原样写入（含 reasoning 内容）：思考内容属于数据，必须原样保存——
    // 若写侧按当前模式剥离/补占位，切换思考模式会永久丢失或污染真实思考内容。
    // 模式过滤只发生在读取侧（loadVisibleMessages）。
    await this.messageStore.appendMessages(this.sessionId, messages);
  }

  async persist(): Promise<void> {
    // JSONL append 即实时落盘;persist 不再承担 flush,仅作为分卷判断点:
    // 活跃段 bytes 超阈值 → 先写快照(原子)再分卷(新日志写新文件)。
    await this.messageStore.maybeSplit(this.sessionId);
  }

  async finalizeTurn(
    turnId: string,
    durationMs: number,
    finish: TurnFinish,
  ): Promise<void> {
    await this.messageStore.finalizeTurn(
      this.sessionId,
      turnId,
      durationMs,
      finish,
    );
  }

  generateId(): string {
    // 与 messageStore.genId 保持一致的前缀/格式
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ═══ 身份与安全模式 ═══

  getSandboxMode(): SessionSandboxMode {
    return this.sandboxMode;
  }

  async setSandboxMode(mode: SessionSandboxMode): Promise<void> {
    this.logger.debug(`Switching sandbox mode: ${this.sandboxMode} -> ${mode}`);
    this.sandboxMode = mode;
  }

  setToolScope(pluginId: string | null): void {
    this.toolScope = pluginId;
  }

  getToolScope(): string | null {
    return this.toolScope;
  }

  // ═══ 模型配置 ═══

  getModelConfig(): ModelConfig {
    return this.modelConfig;
  }

  supportsFeature(feature: ModelFeature): boolean {
    return this.modelConfig?.config?.features?.includes(feature) || false;
  }

  getThinkingEffort(): string | undefined {
    return this.thinkingEffortValue;
  }

  // ═══ 工具与设置 ═══

  getResolvedPlugins(): ResolvedPluginInfo[] {
    return this.resolvedPlugins;
  }

  getSettings(field?: string): any {
    if (field) return (this.effectiveSettings as any)[field];
    return this.effectiveSettings;
  }

  /** 记录交互请求事件（透传 messageStore，审计源；统一 Ask） */
  async appendAskAsked(
    data: import('../../common/persistence/types').AskAskedData,
  ): Promise<void> {
    await this.messageStore.appendAskAsked(this.sessionId, data);
  }

  /** 记录交互应答事件（透传 messageStore，审计配对：每次 asked 必有 answered） */
  async appendAskAnswered(
    data: import('../../common/persistence/types').AskAnsweredData,
  ): Promise<void> {
    await this.messageStore.appendAskAnswered(this.sessionId, data);
  }

  /**
   * 发布流式事件（唯一发布面：引擎/钩子/审批等深层模块直发入口）。
   *
   * 组装 prevSeq 续传游标（"先入库后发事件"：读本会话最后一条已入库事件的 seq）
   * 后交 SessionStreamManager.publish（缓存+进程内扇出+SSE 直投合一）；无活跃流时静默丢弃。
   */
  async publishStream(
    chunk: import('./types/event-chunk.types').SessionStreamEvent,
  ): Promise<void> {
    const prevSeq = await this.messageStore.getLastProcessedSeq(this.sessionId);
    this.streamManager.publish(this.sessionId, {
      ...chunk,
      prevSeq,
    } as import('./types/event-chunk.types').WireStreamEvent);
  }

  getEffectiveContextWindow(): number {
    return this.effectiveContextWindow;
  }

  // ═══ 压缩数据源（CompactionDataSource：压缩侧唯一访问入口）═══

  getCompressionConfig(): CompactionConfig {
    return this.compactionConfig;
  }

  getPrelude(): Promise<Message[]> {
    return this.ensureConversationStateLoaded().then(() => this.preludeParts);
  }

  getTools(): import('../tools/interfaces/tool-provider.interface').ToolDefinition[] {
    return this.resolvedPlugins.length > 0
      ? ToolOrchestrator.toFlatToolDefs(this.resolvedPlugins)
      : [];
  }

  /** 压缩后会话状态恢复：store 缓存写即更新（applyToCache 覆盖 compaction/prune 事件），
   *  此处仅失效块级 token 缓存；返回含 prelude 的刷新请求列表 */
  async refreshAfterCompaction(): Promise<Message[]> {
    this.tokenMeter.invalidate(this.sessionId);
    return this.getMessages();
  }

  private async ensureConversationStateLoaded(): Promise<void> {
    if (!this.conversationStateLoaded) {
      this.preludeParts = await this.buildPreludeMessages();
      this.conversationStateLoaded = true;
    }
  }

  getWorkspacePath(): string {
    return this._workspacePath;
  }

  get workspacePath(): string {
    return this._workspacePath;
  }

  // ═══ Token 统计（dsh 式：provider 真值锚点 + 启发式增量）═══

  private currentModelName(): string {
    return this.modelConfig?.modelName || this.modelConfig?.name || 'gpt4';
  }

  /**
   * 当前完整请求 token（全量：prelude + 可见视图），provider 真值锚点 + 启发式增量（dsh 式）。
   *
   * 每次从当前视图按需计算（不再维护累计账本）：
   * - heuristicNow = 当前 prelude + 视图的启发式估算
   * - 锚点 = 视图中最后一条带 metadata.usage.promptTokens 的 assistant 消息（provider 真值）
   * - 锚点模型匹配时：promptTokens + (heuristicNow - heuristicAtAnchor)，heuristicAtAnchor 为
   *   锚点时刻（视图截至锚点消息）的启发式估算；块级缓存命中，前缀重估近零成本
   */
  async getTokenCount(): Promise<number> {
    const model = this.currentModelName();
    const view = await this.loadVisibleMessages();
    const heuristicNow = await this.estimateFullRequestTokens(view);

    const anchor = this.findUsageAnchor(view);
    if (anchor && anchor.model === model) {
      const heuristicAtAnchor = await this.estimateFullRequestTokens(
        view.slice(0, anchor.index + 1),
      );
      return Math.max(0, anchor.promptTokens + (heuristicNow - heuristicAtAnchor));
    }
    return heuristicNow;
  }

  async getTokenBreakdown(): Promise<TokenBreakdown> {
    const modelName = this.currentModelName();
    await this.ensureConversationStateLoaded();
    const view = await this.loadVisibleMessages();
    const historyTokens = await this.tokenMeter.estimateMessages(
      this.sessionId,
      modelName,
      view,
    );
    return {
      systemPrompt: this.preludeTokenStats.systemPrompt,
      summary: 0,
      userPrompt: this.preludeTokenStats.userPrompt,
      history: historyTokens,
      tools: this.preludeTokenStats.tools,
    };
  }

  /** prelude + 给定视图的启发式估算（全量请求口径） */
  private async estimateFullRequestTokens(view: Message[]): Promise<number> {
    await this.ensureConversationStateLoaded();
    return this.tokenMeter.estimateMessages(
      this.sessionId,
      this.currentModelName(),
      [...this.preludeParts, ...view],
    );
  }

  /** 视图中最后一条带 provider usage 的 assistant 消息（返回其 promptTokens / 归属模型 / 索引） */
  private findUsageAnchor(
    view: Message[],
  ): { promptTokens: number; model: string; index: number } | undefined {
    for (let i = view.length - 1; i >= 0; i--) {
      const msg = view[i];
      if (msg.role !== 'assistant') continue;
      const meta = (msg.metadata || {}) as any;
      const promptTokens = meta?.usage?.promptTokens;
      if (promptTokens != null) {
        const pt = Number(promptTokens);
        if (Number.isFinite(pt) && pt >= 0) {
          return {
            promptTokens: pt,
            // 锚点归属模型：usage 内 modelName 优先，其次消息级 metadata.modelName，最后当前模型
            model: meta?.usage?.modelName ?? meta?.modelName ?? this.currentModelName(),
            index: i,
          };
        }
      }
    }
    return undefined;
  }

  // ═══ 内部工具 ═══

  /**
   * 检测安全模式是否发生切换（基于当前可见视图的最后一条 user 消息 metadata.sandboxMode）。
   * 叙事按方向组合：进入/退出 read-only 与进入/退出 danger-full-access 可叠加。
   */
  private async detectModeTransition(replaceTurnId?: string): Promise<string | null> {
    const history = await this.loadVisibleMessages();

    const userMsgs = history.filter(
      (m) => m.role === 'user' && m.id !== replaceTurnId,
    );

    const prevMode =
      userMsgs.length > 0
        ? userMsgs[userMsgs.length - 1].metadata?.sandboxMode || 'workspace-write'
        : 'workspace-write';
    const currentMode = this.sandboxMode;

    if (prevMode === currentMode) return null;

    const narrations: string[] = [];
    if (currentMode === 'read-only' && prevMode !== 'read-only') {
      narrations.push(
        'The user has enabled read-only mode. File writes are denied and run_command executes in a read-only sandbox — all file modifications are blocked. Use the available tools to analyze, plan, and discuss with the user; if a modification is required, explain what needs to change.',
      );
    }
    if (prevMode === 'read-only' && currentMode !== 'read-only') {
      narrations.push(
        'The user has disabled read-only mode. File writes are available again under the session sandbox policy.',
      );
    }
    if (currentMode === 'danger-full-access' && prevMode !== 'danger-full-access') {
      narrations.push(
        'The user has enabled unrestricted editing (danger-full-access). All path restrictions on file tools are lifted — you may read and write ANY file on the system outside the working directory. This is a high-risk operation: be extra careful, double-check the target path before writing, and never modify system-critical files unless explicitly requested.',
      );
    }
    if (prevMode === 'danger-full-access' && currentMode !== 'danger-full-access') {
      narrations.push(
        'The user has disabled unrestricted editing. File tools are once again confined to the session sandbox policy.',
      );
    }
    return narrations.length > 0 ? narrations.join('\n\n') : null;
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
        id: model.provider?.id || '',
        provider: model.provider?.provider || '',
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
        ...(model.config || {}),
        temperature: model.config?.temperature ?? undefined,
        topP: model.config?.topP ?? undefined,
        frequencyPenalty: model.config?.frequencyPenalty ?? undefined,
      },
    };
  }

  private async buildCompactionConfig(memory: any): Promise<CompactionConfig> {
    const summaryMode = await this.resolveSummaryMode(memory);

    return {
      compressionTriggerRatio: memory?.compressionTriggerRatio,
      compressionTargetRatio: memory?.compressionTargetRatio,
      summaryMode,
    };
  }

  private async resolveSummaryMode(memory: any): Promise<SummaryMode> {
    if (memory?.summaryMode) {
      this.logger.debug(`Using role-level summaryMode: ${memory.summaryMode}`);
      return memory.summaryMode as SummaryMode;
    }

    const globalEnableSummary = await this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_COMPRESS_ENABLE_SUMMARY,
      true,
    );
    const enabled =
      globalEnableSummary === true ||
      globalEnableSummary === 'true' ||
      globalEnableSummary === 1;
    const summaryMode = enabled ? SummaryMode.DEFAULT : SummaryMode.DISABLED;
    return summaryMode;
  }


  /**
   * 合并会话设置与角色默认配置（优先级：会话 > 角色）。
   */
  private buildEffectiveSettings(): EffectiveSettings {
    const sessionSettings = this.session.settings || {};
    const characterSettings = this.session.character?.settings || {};

    const mergedTools = sessionSettings.plugins ?? characterSettings.plugins;
    const mergedSkills = sessionSettings.skills ?? characterSettings.skills;
    const mergedAgents = sessionSettings.agents ?? characterSettings.agents;

    let systemPrompt =
      sessionSettings.systemPrompt || characterSettings.systemPrompt || '';

    const merged: EffectiveSettings = {
      systemPrompt,
      thinkingEffort: undefined,
      memory: {},
      plugins: mergedTools,
      skills: mergedSkills,
      agents: mergedAgents,
    };

    merged.memory = { ...characterSettings.memory };
    merged.maxTokensLimit = sessionSettings.maxTokensLimit ?? null;
    merged.thinkingEffort = sessionSettings.thinkingEffort;
    merged.attachments = sessionSettings.attachments ?? {};
    merged.referencedKbs = sessionSettings.referencedKbs ?? [];
    merged.sandboxMode = sessionSettings.sandboxMode ?? 'workspace-write';
    merged.modelName = sessionSettings.modelName ?? null;

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

  private async resolveModel(): Promise<any> {
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

  /**
   * 构建发送给 LLM 的前置消息（system prompt + 插件提示词）。
   * 注：JSONL 版摘要（compact）已由重放注入 history（hidden user 消息），无需在此重复。
   */
  private async buildPreludeMessages(): Promise<Message[]> {
    const systemPrompts: string[] = [this.effectiveSettings.systemPrompt];
    const userPrompts: string[] = [];
    const modelName = this.currentModelName();

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
          .join('\n\n'),
      );

      // user → user 消息（如工具包记忆）
      const userPieces = await this.promptCollector.collectUserPrompts(
        modePlugins,
        { session: this },
      );
      const userContent = userPieces
        .map((p) => p.content)
        .filter(Boolean)
        .join('\n\n');
      if (userContent) {
        userPrompts.push(userContent);
      }

      this.preludeTokenStats.userPrompt =
        await this.tokenMeter.estimateTextTokens(modelName, userContent);
    }

    const result: Message[] = [];

    if (systemPrompts.length > 0) {
      result.push({
        id: 'system',
        role: 'system',
        kind: 'model',
        source: { kind: 'user' },
        metadata: {},
        content: [
          {
            type: 'text',
            contentId: 'system',
            text: systemPrompts.filter(Boolean).join('\n\n'),
          },
        ],
      });
    }
    this.preludeTokenStats.systemPrompt = await this.tokenMeter.estimateMessages(
      this.sessionId,
      modelName,
      result.filter((p) => p.role === 'system'),
    );
    if (userPrompts.length > 0) {
      result.push({
        id: 'user_prompt',
        role: 'user',
        kind: 'user',
        source: { kind: 'user' },
        metadata: {},
        content: [
          {
            type: 'text',
            contentId: 'user_prompt',
            text: userPrompts.join('\n\n'),
          },
        ],
      });
    }

    // 工具定义 token（最详细格式，确保不低估）
    const toolDefs = ToolOrchestrator.toFlatToolDefs(this.resolvedPlugins);
    if (toolDefs.length > 0) {
      const toolsJson = JSON.stringify(
        toolDefs.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      );
      this.preludeTokenStats.tools = await this.tokenMeter.estimateTextTokens(
        modelName,
        toolsJson,
        false,
      );
    } else {
      this.preludeTokenStats.tools = 0;
    }

    return result;
  }
}
