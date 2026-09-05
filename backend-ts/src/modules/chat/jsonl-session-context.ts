/**
 * JSONL 持久化 — 会话上下文（JSONL 版）
 *
 * 实现 ISessionContext 接口，消息持久化经 MESSAGE_STORE_TOKEN 注入的 IMessageStore 驱动。
 * 能力与 persistent-session-context.ts（DB 版）对齐：
 * - 设置合并（会话 > 角色）、模型解析、插件决议、提示词拼接（system/插件/tools）
 * - 细粒度 Token 统计 + provider 真值锚点（dsh 式）
 * - 运行模式切换检测（system 注入块）、reasoning content 策略、KIMI 兼容
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
import type { Message, FileRef, ContentBlock } from '../../common/types/conversation.types';
import { TokenBreakdown, TurnFinish } from './interfaces';
import { SettingsStorage } from '../../common/utils/settings-storage.util';
import { ModelRepository } from '../../common/database/model.repository';
import { PluginManager } from '../plugins/plugin.manager';
import { SessionStreamManager } from './session-stream.manager';
import { PromptCollector } from '../plugins/prompt-collector.service';
import { WorkspaceService } from '../../common/services/workspace.service';
import { TokenMeterService } from './token-meter.service';
import { generateOrderedMessageId } from '../../common/utils/ordered-id.util';
import { SummaryMode } from './compaction/compression-engine';
import {
  CompactionConfig,
  CompactionDataSource,
  CompactWrite,
  PruneWrite,
} from './compaction/types';
import { ToolOrchestrator } from '../tools/tool-orchestrator.service';
import { ResolvedPluginInfo } from '../plugins/types/plugin.types';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import {
  SG_MODELS,
  SK_MOD_CHAT,
  SK_MOD_COMPRESS_ENABLE_SUMMARY,
} from '../../constants/settings.constants';
import {
  TransformContext,
  isFullReasoningRelayModel,
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

/**
 * 上下文快照：以 store 版本号（lastProcessedSeq）为失效键的不可变视图缓存。
 * 消除一轮 agent 循环内的重复投影/变换/token 统计；append 走增量 O(Δ)。
 *
 * 单一数据源（对齐 DSH）：快照只持有 view（对话历史）。完整请求列表（prelude + view）
 * 是 getMessages() 组装时刻的派生表达式，不作为状态存储——两份同构列表的手动同步
 * 即双数据源，是必须消除的冗余。
 *
 * 不可变契约：view 为只读共享引用，消费方禁止就地修改；getMessages 每次返回新数组
 * （引用复制），外部对数组结构的修改天然不影响快照。
 */
export interface ContextSnapshot {
  /** 版本号 = messageStore.getLastProcessedSeq()，写入后必变 */
  revision: number;
  /** 变换上下文指纹：模型能力变化即失效重建 */
  transformKey: string;
  /** 变换后的可见消息（不含 prelude）——唯一数据源，与 store 折叠态同序 */
  view: readonly Message[];
  /** prelude 的启发式 token（prelude 不变则复用） */
  preludeTokens: number;
  /** 逐消息 token，与 view 同序 */
  perMessageTokens: readonly number[];
  /** perMessageTokens 前缀和：prefixTokens[i] = view[0..i] 的 token 累计（不含 prelude） */
  prefixTokens: readonly number[];
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
  /** system 提示词文本（envelope，与对话历史 surface 分离——对齐 DSH LlmCallConfig.system） */
  private systemText = '';
  private thinkingEffortValue!: string | undefined;
  /** 当前（最后一轮）回合 id：beginTurn 时记录，供 reasoning 策略判定「最后一轮」 */
  private currentTurnId: string | null = null;
  private resolvedPlugins: ResolvedPluginInfo[] = [];
  private effectiveSettings!: EffectiveSettings;
  /** 合并后的压缩配置（压缩侧经 CompactionDataSource.getCompressionConfig 消费） */
  private compactionConfig: CompactionConfig = {};
  private effectiveContextWindow!: number;
  private _workspacePath!: string;
  private conversationStateLoaded = false;

  /** 上下文快照缓存（见 ContextSnapshot 注释）；null = 未构建/已失效 */
  private snapshot: ContextSnapshot | null = null;
  /** prelude token 缓存（prelude 只在 initialize 构建一次，token 不变） */
  private preludeTokensValue: number | null = null;

  /** L1 消息变换管线（图片投影 / reasoning 策略 / 空 content 兼容，见 message-transform.pipeline.ts） */
  private readonly transformPipeline = createDefaultMessageTransformPipeline();

  // 消息视图直通 store（不再维护 this.history 双层缓存）：读取经
  // messageStore.loadContext（store 缓存写即更新，见 applyToCache）+ provider 变换（产生副本）。
  // prelude 保留缓存（构建贵：插件提示词收集 + 工具序列化；getPrelude/getTools 依赖）。
  /** prelude 构建时的分项 token（供 getTokenBreakdown 按需消费；history 每次现算） */
  private preludeTokenStats = {
    systemPrompt: 0,
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
    private readonly knowledgeBaseService: KnowledgeBaseService,
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
  // ═══ 消息读取（快照缓存：以 lastProcessedSeq 为版本号，一轮内重复读取 O(1)）═══

  /** 变换上下文（模型能力派生；与 buildSnapshot 共用，避免两处漂移） */
  private buildTransformCtx(): TransformContext {
    const shouldLoadReasoning =
      this.thinkingEffortValue && this.thinkingEffortValue !== 'none';
    return {
      supportsImageInput:
        this.modelConfig.config.inputCapabilities?.includes('image') ?? false,
      thinkingMode: !!shouldLoadReasoning,
      currentTurnId: this.currentTurnId,
      fullReasoningRelay: isFullReasoningRelayModel(
        this.modelConfig.modelName,
      ),
      providerProtocol: this.modelConfig.provider?.protocol,
      modelName: this.modelConfig.modelName,
    };
  }

  /** 变换上下文指纹：模型能力/思考模式/协议/回传策略/回合变化即失效重建 */
  private transformKey(): string {
    return [
      this.modelConfig.config.inputCapabilities?.includes('image')
        ? 'img'
        : 'noimg',
      this.thinkingEffortValue && this.thinkingEffortValue !== 'none'
        ? 'think'
        : 'nothink',
      this.currentTurnId ?? '-',
      isFullReasoningRelayModel(this.modelConfig.modelName)
        ? 'relay-all'
        : 'relay-last',
      this.modelConfig.provider?.protocol ?? '-',
    ].join('|');
  }

  /** 取快照：revision 与 transformKey 均未变则复用（O(1)），否则全量重建 */
  private async getSnapshot(): Promise<ContextSnapshot> {
    const revision = await this.messageStore.getLastProcessedSeq(this.sessionId);
    const key = this.transformKey();
    if (
      this.snapshot &&
      this.snapshot.revision === revision &&
      this.snapshot.transformKey === key
    ) {
      return this.snapshot;
    }
    this.snapshot = await this.buildSnapshot(revision, key);
    return this.snapshot;
  }

  /** 全量重建（唯一昂贵路径：冷启动 / 压缩 / 删除 / 切模型后） */
  private async buildSnapshot(
    revision: number,
    key: string,
  ): Promise<ContextSnapshot> {
    await this.ensureConversationStateLoaded();
    const ctx = this.buildTransformCtx();
    const rawMessages = await this.messageStore.loadContext({
      sessionId: this.sessionId,
      keepReasoningContent: ctx.thinkingMode,
    });
    const view = this.transformPipeline.run(rawMessages, ctx);
    const perMsg = await this.tokenMeter.estimatePerMessage(
      this.sessionId,
      this.currentModelName(),
      view,
    );
    return this.assembleSnapshot(
      revision,
      key,
      view,
      perMsg.map((x) => x.tokens),
      await this.getPreludeTokens(),
    );
  }

  /** 组装快照（前缀和由视图派生；request 是 getMessages 时刻的派生表达式，不在此存储） */
  private assembleSnapshot(
    revision: number,
    key: string,
    view: Message[],
    perMessageTokens: number[],
    preludeTokens: number,
  ): ContextSnapshot {
    const prefixTokens: number[] = [];
    let acc = 0;
    for (const t of perMessageTokens) {
      acc += t;
      prefixTokens.push(acc);
    }
    return {
      revision,
      transformKey: key,
      view,
      preludeTokens,
      perMessageTokens,
      prefixTokens,
    };
  }

  /** 增量更新：新消息已落库（fold 后权威节点），只变换新增部分，O(Δ)。
   *  revision 由调用方（写入返回值）提供，本方法不查询 store——版本号写入时确定。
   *  变换指纹（含 currentTurnId：回合切换、能力/模式变化）不一致时增量拼接口径错误
   *  → 作废快照，下次 getSnapshot 全量重建（正常生命周期内 context 限单回合，此分支不触发）。 */
  private async appendToSnapshot(
    added: Message[],
    revision: number,
  ): Promise<void> {
    if (!this.snapshot || added.length === 0) return;
    // if (this.snapshot.transformKey !== this.transformKey()) {
    //   this.snapshot = null;
    //   return;
    // }
    const ctx = this.buildTransformCtx();
    const addedView = this.transformPipeline.run(added, ctx);
    const perMsg = await this.tokenMeter.estimatePerMessage(
      this.sessionId,
      this.currentModelName(),
      addedView,
    );
    const addedTokens = perMsg.map((x) => x.tokens);
    this.snapshot = {
      revision,
      transformKey: this.snapshot.transformKey,
      view: [...this.snapshot.view, ...addedView],
      preludeTokens: this.snapshot.preludeTokens,
      perMessageTokens: [
        ...this.snapshot.perMessageTokens,
        ...addedTokens,
      ],
      prefixTokens: this.extendPrefixTokens(
        this.snapshot.prefixTokens,
        addedTokens,
      ),
    };
  }

  /** 前缀和增量扩展（O(k)，避免全量重算） */
  private extendPrefixTokens(
    prefixTokens: readonly number[],
    added: number[],
  ): number[] {
    const out = [...prefixTokens];
    let acc = prefixTokens.length > 0 ? prefixTokens[prefixTokens.length - 1] : 0;
    for (const t of added) {
      acc += t;
      out.push(acc);
    }
    return out;
  }

  /** system 文本 token（system 只构建一次，token 不变；懒算一次后缓存） */
  private async getPreludeTokens(): Promise<number> {
    if (this.preludeTokensValue === null) {
      await this.ensureConversationStateLoaded();
      this.preludeTokensValue = await this.tokenMeter.estimateTextTokens(
        this.currentModelName(),
        this.systemText,
      );
    }
    return this.preludeTokensValue;
  }

  /** system 提示词文本（envelope；builder 组装请求时消费） */
  getSystemText(): string {
    return this.systemText;
  }

  /**
   * 读取当前可见消息视图（变换后，不含 prelude）。
   * 共享快照引用——只读契约，消费方禁止就地修改。
   */
  private async loadVisibleMessages(): Promise<Message[]> {
    return (await this.getSnapshot()).view as Message[];
  }

  /** 可见消息视图（变换后，不含 prelude），压缩引擎数据源 */
  async getHistory(): Promise<Message[]> {
    return this.loadVisibleMessages();
  }

  /** 逐消息 token（与 getHistory() 同序，来自快照；供压缩预算 O(1) 取值） */
  async getPerMessageTokens(): Promise<number[]> {
    return [...(await this.getSnapshot()).perMessageTokens];
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
    const { turnId, revision } = await this.messageStore.beginTurn(this.sessionId, {
      replaceTurnId: options?.replaceTurnId,
      preGenTurnId: options?.preGenTurnId,
    });
    // 记录当前回合 id：reasoning 策略以 turnId 判定「最后一轮」（见 message-transform.pipeline.ts）
    this.currentTurnId = turnId;
    // turn/start 不改变消息视图，仅版本号前进 → 续期快照 revision（写入方提供），避免每轮误重建
    this.refreshSnapshotRevision(revision);
    return turnId;
  }

  /** 不改变视图的写入（turn/start、turn/finish）后：仅推进快照版本号，免全量重建。
   *  revision 由写入方返回值提供，不查询 store（版本号契约）。 */
  private refreshSnapshotRevision(revision: number): void {
    if (!this.snapshot) return;
    this.snapshot = {
      ...this.snapshot,
      revision,
    };
  }

  /**
   * 删除本轮对话:写 turn/delete 事件（store 折叠即 splice 移除）+ 失效快照。
   * 视图结构变化 → 快照作废；token 侧无需处理（TokenMeter 无状态，逐次现算）。
   */
  async deleteTurn(turnId: string): Promise<void> {
    await this.messageStore.deleteTurn(this.sessionId, turnId);
    this.snapshot = null;
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
      /** 原生内容块（S2：结构化入站消息，存在时优先于 content/files 构造） */
      blocks?: ContentBlock[];
      /**
       * 外部命令注入块（TagParserPipeline 解析产物，origin='system'）：
       * 已由管线冻结成形，原样追加在内部注入块之后（background first, material last）
       */
      injectedBlocks?: ContentBlock[];
      /** 显式消息来源（P4b：队列投递写入；缺省折叠时按 kind 推导） */
      source?: import('../../common/types/conversation.types').MessageSource;
    },
  ): Promise<{ messageId: string; userMessage: any }> {
    const replaceTurnId = options?.replaceTurnId;
    // 检测 sandbox 模式切换 → system 注入块（origin='system'，前端不渲染；LLM 按 <system_reminder> 文本处理）
    const modeNarration = await this.detectModeTransition(replaceTurnId);
    // sandboxMode 保留写入：下一条消息模式切换检测的 prevMode 基准（+审计）
    const enrichedMetadata: Record<string, any> = {
      ...options?.metadata,
      sandboxMode: this.sandboxMode,
    };

    // 注入块（消息伴随信息）：追加在用户 blocks 尾部（novel 区 → KV 前缀零损失）。
    // 顺序即 DSH 注入瀑布语义：背景在前（模式叙事 → KB 引用），材料在后（命令解析产物
    // ——用户要求做的事的上下文最贴近模型作答位置）
    const injectedBlocks: ContentBlock[] = [];
    if (modeNarration) {
      injectedBlocks.push({
        type: 'text',
        text: `<system_reminder>\n${modeNarration}\n</system_reminder>`,
        origin: 'system',
      });
    }
    if (options?.knowledgeBaseIds?.length) {
      // KB 明细展开（不存在的 id 静默跳过）；结构化落库为 KbRefBlock，
      // LLM 侧由 L1 管线投影为清单文本，前端按 chips 渲染
      const kbRefs = await this.knowledgeBaseService.findByIds(
        options.knowledgeBaseIds,
      );
      if (kbRefs.length > 0) {
        injectedBlocks.push({ type: 'kb-ref', kbRefs });
      }
    }
    if (options?.injectedBlocks?.length) {
      injectedBlocks.push(...options.injectedBlocks);
    }

    const { messageId, userMessage, revision } =
      await this.messageStore.addUserMessage(
        this.sessionId,
        content,
        files || [],
        {
          metadata: enrichedMetadata,
          blocks: options?.blocks,
          ...(injectedBlocks.length > 0 ? { injectedBlocks } : {}),
          source: options?.source,
        },
      );

    // 新 user 消息已入态：增量更新快照（返回值为 fold 后权威节点 + 写入后版本号），O(k)
    await this.appendToSnapshot([userMessage as Message], revision);

    return { messageId, userMessage };
  }

  async appendMessages(messages: Message[]): Promise<void> {
    if (!messages || messages.length === 0) return;

    // 原样写入（含 reasoning 内容）：思考内容属于数据，必须原样保存——
    // 若写侧按当前模式剥离/补占位，切换思考模式会永久丢失或污染真实思考内容。
    // 模式过滤只发生在读取侧（快照变换）。
    const { added, revision } = await this.messageStore.appendMessages(
      this.sessionId,
      messages,
    );
    // 增量更新快照（fold 后权威节点 + 写入时确定的版本号，O(k)）；
    // 无快照时由下次 getSnapshot 全量重建
    await this.appendToSnapshot(added, revision);
  }

  /**
   * 插件注入一条隐藏 user 消息（落库，成为历史的一部分；模型可见，前端可据 source/metadata 隐藏）。
   * 折叠形态：role='user' + kind='model' + source={kind:'plugin', plugin} + metadata.hidden（replayer 支持）。
   */
  async injectUserPrompt(content: string, plugin: string): Promise<void> {
    if (!content) return;
    const message: Message = {
      id: this.generateMessageId(),
      role: 'user',
      kind: 'model',
      source: { kind: 'plugin', plugin },
      metadata: { plugin, hidden: true },
      content: [{ type: 'text', text: content }],
    };
    await this.appendMessages([message]);
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
    // 上下文占用锚点：回合全部消息已 append（finalizeTurn 时序在流结束后）→ 统计即回合后占用
    // （含视图消息数与细分，供前端重开会话时逆向扫描免 REST）
    const anchor = await this.getContextStats();
    const revision = await this.messageStore.finalizeTurn(
      this.sessionId,
      turnId,
      durationMs,
      { ...finish, ...anchor },
    );
    // turn/finish 不改变消息视图，仅版本号前进 → 续期快照 revision（写入方提供）
    this.refreshSnapshotRevision(revision);
  }

  generateId(): string {
    // 与 messageStore.genId 保持一致的前缀/格式（通用 id：contentId/attachmentId/turnId）
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 生成下一个有序消息 id（ULID 基座，同步；m_<ULID> 按时间单调，遮蔽分界点标记依据） */
  generateMessageId(): string {
    return generateOrderedMessageId('m');
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

  /** KV 前缀消息（兼容压缩摘要前缀组装：system 文本合成单条消息；envelope 改造后见 3.5 重构为 {system, tools}） */
  getPrelude(): Promise<Message[]> {
    return this.ensureConversationStateLoaded().then(() =>
      this.systemText
        ? [
            {
              id: 'system',
              role: 'system',
              kind: 'model',
              source: { kind: 'plugin', plugin: 'system-prompt' },
              metadata: {},
              content: [{ type: 'text', text: this.systemText }],
            } as Message,
          ]
        : [],
    );
  }

  getTools(): import('../tools/interfaces/tool-provider.interface').ToolDefinition[] {
    return this.resolvedPlugins.length > 0
      ? ToolOrchestrator.toFlatToolDefs(this.resolvedPlugins)
      : [];
  }

  // ═══ 压缩写（v1.4：写路径与读路径同层解耦；落库经 messageStore，快照统一失效重建）═══

  /**
   * 一级裁剪写入：直接落库。
   * 不就地改写快照视图——裁剪语义（tool-result/text 如何应用 newContent）唯一在 replayer
   * 折叠时应用（单一事实源），会话层不维护第二份改写逻辑。
   * 写入后 store revision 推进 → 快照 revision 滞后 → 下次 getSnapshot 全量重建。
   */
  async appendPrune(data: PruneWrite): Promise<void> {
    await this.messageStore.appendPrune(this.sessionId, data);
  }

  /**
   * 二级遮蔽写入：落库。
   * 遮蔽范围删除与摘要置头语义唯一在 replayer 折叠时应用（不就地 splice 快照视图）。
   * 写入后 store revision 推进 → 快照 revision 滞后 → 下次 getSnapshot 全量重建。
   */
  async appendCompact(
    data: CompactWrite,
  ): Promise<{ summaryMessageId: string; endSeq: number }> {
    // 压缩后占用锚点（写前模拟）：当前全量 − 遮蔽区 token + 摘要 token → compaction/end 携带。
    // 时序：此刻快照已含尾部 prune、未遮蔽 → getTokenCount 即"压缩前占用"；
    // 摘要节点与 replayer 生成的同构，token 估算同口径。
    const contextStats = await this.computePostCompactStats(data);
    const out = await this.messageStore.appendCompact(this.sessionId, {
      ...data,
      ...(contextStats ? contextStats : {}),
    });
    return out;
  }

  /** 压缩后完整请求 token 模拟结算（写前计算，供 compaction/end 锚点） */
  private async computePostCompactStats(
    data: CompactWrite,
  ): Promise<{
    usedTokens?: number;
    effectiveContextWindow?: number;
    messageCount?: number;
    breakdown?: TokenBreakdown;
  }> {
    const effectiveContextWindow = this.getEffectiveContextWindow();
    const shadowedCount = data.shadowedCount;
    if (!this.snapshot || shadowedCount <= 0) {
      // 快照不可得（冷路径）或无遮蔽：不提供锚点（调用方省略字段）
      return { effectiveContextWindow };
    }
    const perMessageTokens = this.snapshot.perMessageTokens;
    let shadowedTokens = 0;
    for (let i = 0; i < shadowedCount && i < perMessageTokens.length; i++) {
      shadowedTokens += perMessageTokens[i];
    }
    const preTotal = await this.getTokenCount();
    // 摘要文本节点（与 replayer eventMessageFromData 生成的摘要节点同构）
    const summaryTokens = data.summary
      ? await this.tokenMeter.estimateMessages(
          this.sessionId,
          this.currentModelName(),
          [
            {
              id: '',
              role: 'user' as const,
              kind: 'model' as const,
              source: { kind: 'plugin' as const, plugin: 'compact' },
              metadata: {},
              content: [
                {
                  type: 'text' as const,
                  text: data.summary,
                },
              ],
            },
          ],
        )
      : 0;
    const snap = await this.getSnapshot();
    return {
      usedTokens: Math.max(0, preTotal - shadowedTokens + summaryTokens),
      effectiveContextWindow,
      messageCount: snap.view.length,
      breakdown: await this.getTokenBreakdown(),
    };
  }

  /** 纯裁剪（无括号）压缩路径的上下文占用锚点：写一条独立 compaction/end 携带当前占用。
   *  compacted 路径的锚点已由 appendCompact 的 compaction/end 承载，无需此调用。 */
  async recordContextAnchor(): Promise<void> {
    const revision = await this.messageStore.recordContextAnchor(this.sessionId, {
      ...(await this.getContextStats()),
    });
    // 不改变消息视图，仅版本号前进 → 续期快照 revision
    this.refreshSnapshotRevision(revision);
  }

  private async ensureConversationStateLoaded(): Promise<void> {
    if (!this.conversationStateLoaded) {
      this.systemText = await this.buildSystemText();
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
   * O(1)：基于快照的前缀和（preludeTokens + prefixTokens 末项）与锚点前缀和，
   * 不再逐次遍历视图。
   */
  async getTokenCount(): Promise<number> {
    const model = this.currentModelName();
    const snap = await this.getSnapshot();
    const heuristicNow =
      snap.preludeTokens +
      (snap.prefixTokens.length > 0
        ? snap.prefixTokens[snap.prefixTokens.length - 1]
        : 0);

    const anchor = this.findUsageAnchor(snap.view);
    if (anchor && anchor.model === model) {
      const heuristicAtAnchor =
        snap.preludeTokens + (snap.prefixTokens[anchor.index] ?? 0);
      return Math.max(
        0,
        anchor.promptTokens + (heuristicNow - heuristicAtAnchor),
      );
    }
    return heuristicNow;
  }

  async getTokenBreakdown(): Promise<TokenBreakdown> {
    // prelude 统计懒构建（压缩等路径的实例可能尚未触发 buildSystemText）
    await this.ensureConversationStateLoaded();
    const snap = await this.getSnapshot();
    const historyTokens =
      snap.prefixTokens.length > 0
        ? snap.prefixTokens[snap.prefixTokens.length - 1]
        : 0;
    return {
      systemPrompt: this.preludeTokenStats.systemPrompt,
      history: historyTokens,
      tools: this.preludeTokenStats.tools,
    };
  }

  /** 会话上下文统计聚合：占用 + 窗口 + 视图消息数 + 细分。流事件与持久化锚点统一取数。 */
  async getContextStats(): Promise<{
    usedTokens: number;
    effectiveContextWindow: number;
    messageCount: number;
    breakdown: TokenBreakdown;
  }> {
    const [usedTokens, breakdown] = await Promise.all([
      this.getTokenCount(),
      this.getTokenBreakdown(),
    ]);
    const snap = await this.getSnapshot();
    return {
      usedTokens,
      effectiveContextWindow: this.getEffectiveContextWindow(),
      messageCount: snap.view.length,
      breakdown,
    };
  }

  /** 视图中最后一条带 provider usage 的 assistant 消息（返回其 promptTokens / 归属模型 / 索引） */
  private findUsageAnchor(
    view: readonly Message[],
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
      (m) =>
        m.role === 'user' &&
        // 排除注入消息（图片注入等 hidden user 消息 kind='model'，
        // 其 metadata.sandboxMode 为空会把 prevMode 错误回退为默认值）
        m.kind !== 'model' &&
        m.id !== replaceTurnId,
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
      compressionRetainRatio: memory?.compressionRetainRatio,
      // 兼容遗留（不再承担验收/保留语义）
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
   * 构建系统提示词文本（envelope，与对话历史 surface 分离——对齐 DSH LlmCallConfig.system）。
   * 含：角色 systemPrompt + 插件 eager 提示词。插件 user 型提示（type="user"）已废弃——
   * todo 状态改由压缩后落库注入（见 todo.plugin MEMORY_COMPACTED 处理器）。
   */
  private async buildSystemText(): Promise<string> {
    const systemPrompts: string[] = [this.effectiveSettings.systemPrompt];
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
    }

    const systemText = systemPrompts.filter(Boolean).join('\n\n');
    this.preludeTokenStats.systemPrompt =
      await this.tokenMeter.estimateTextTokens(modelName, systemText);

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

    return systemText;
  }
}
