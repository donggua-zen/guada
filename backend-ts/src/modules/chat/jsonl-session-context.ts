/**
 * JSONL 持久化 — 会话上下文（JSONL 版）
 *
 * 实现 ISessionContext 接口，消息持久化经 MESSAGE_STORE_TOKEN 注入的 IMessageStore 驱动。
 * 能力与 persistent-session-context.ts（DB 版）对齐：
 * - 设置合并（会话 > 智能体）、模型解析、插件决议、提示词拼接（system/插件/tools）
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
import { ProviderFileStore } from '../llm-core/provider-file.store';
import { PluginManager } from '../plugins/plugin.manager';
import { SessionStreamManager } from './session-stream.manager';
import { PromptCollector } from '../plugins/prompt-collector.service';
import { WorkspaceService } from '../../common/services/workspace.service';
import { TokenMeterService } from './token-meter.service';
import { generateOrderedMessageId } from '../../common/utils/ordered-id.util';
import { ID_PREFIXES, mintId } from '../../common/utils/id.util';
import {
  CompactionConfig,
  CompactionDataSource,
  CompactWrite,
  CompressionSaving,
  ContextAnchorWrite,
  PruneWrite,
  TokenDiagnostics,
} from './compaction/types';
import type { OccupancyAnchor } from '../../common/persistence/types';
import {
  COMPRESSION_TIER_PRESETS,
  resolveCompressionTier,
} from './compaction/compression-tiers';
import { ToolExecutor } from '../tools/tool-executor.service';
import { toRuntimeProviderConfig } from '../llm-core/utils/provider-runtime.util';
import { ModelNotResolvedError } from '../llm-core/model-not-resolved.error';
import {
  clampThinkingEffort,
  defaultThinkingEffort,
} from '../llm-core/thinking/thinking-effort-policy';
import type { ThinkingEffort } from '../llm-core/thinking/thinking-vocabulary';
import { ResolvedPluginInfo } from '../plugins/types/plugin.types';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { RemoteBindingStateService } from '../remote-workspace/remote-binding-state.service';
import { SessionMetaStore } from './session-meta.store';
import {
  pickBaselineUserMessage,
  resolveBindingBaseline,
} from './injection-baseline.util';
import {
  SG_MODELS,
  SK_MOD_CHAT,
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
  /** 计划模式（协作状态，正交于 sandboxMode；布尔而非档位） */
  planEnabled?: boolean;
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
  /**
   * 视图占用锚点（回放态派生，见 OccupancyAnchor）：
   * usage = 以最后一条带 provider usage 的助手消息为基准；
   * compaction = 以压缩纠正值（usedTokens + 配套启发式总量）为基准——压缩改写了锚点之前的
   * 内容，provider 增量口径会把裁剪收益抵消掉，必须以纠正值为基准。
   */
  occupancyAnchor: OccupancyAnchor | null;
}

export class JsonlSessionContext implements ISessionContext, CompactionDataSource {
  readonly sessionId: string;
  readonly sessionType: 'web' | 'bot' | 'sub_agent';
  readonly parentSessionId?: string | null;
  readonly agentId?: string | null;
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

  /**
   * 计划模式（协作状态，正交于 sandboxMode）。
   * 开启后由 ToolExecutor 的计划门强制只读，并由引擎每轮临时注入引导提示。
   */
  private planEnabled = false;

  /** 刚退出计划模式（瞬态、不入库）：下一个迭代注入一次退出提醒后清除 */
  private planModeExitReminderPending = false;

  /** 工具范围锁定（瞬态、不入库）：影子轮次等场景仅允许指定插件的工具 */
  private toolScope: string | null = null;

  /** 路径牢笼（瞬态、不入库）：设置后文件工具只能访问该根内的路径，且牢笼内写入不受只读安全模式限制 */
  private pathJail: string | null = null;

  constructor(
    private readonly session: any,
    @Inject(MESSAGE_STORE_TOKEN) private readonly messageStore: IMessageStore,
    private readonly settingsStorage: SettingsStorage,
    private readonly modelStore: ProviderFileStore,
    private readonly pluginManager: PluginManager,
    private readonly promptCollector: PromptCollector,
    private readonly workspaceService: WorkspaceService,
    private readonly tokenMeter: TokenMeterService,
    private readonly streamManager: SessionStreamManager,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly bindingState: RemoteBindingStateService,
    /** 会话元数据存储（可选）：仅用于持久化运行期需要落库的会话设置（计划模式开关） */
    private readonly sessionMetaStore?: SessionMetaStore,
    /**
     * "有人能应答审批"的探针（可选，由 SessionEventsService 提供：前端 SSE 是否有在线连接）。
     * 用回调而不是直接注入服务，避免上下文对事件服务的直接依赖与潜在循环。
     */
    private readonly answerSurfaceProbe?: () => boolean,
  ) {
    this.sessionId = session.id;
    this.sessionType = session.sessionType || 'web';
    this.parentSessionId = session.parentId || null;
    this.agentId = session.agentId || null;
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
    // 能力 = 档位菜单（唯一信号）：菜单为空即不能思考，不发参数也不回传 reasoning。
    // 存量设置与当前模型不匹配时（换模型后档位不在菜单里）用请求侧同一套策略调整，
    // 使「回传判定」与「实际发出的档位」始终一致。
    const menu = this.modelConfig.thinkingEfforts as ThinkingEffort[];
    this.thinkingEffortValue =
      menu.length > 0
        ? clampThinkingEffort(
            menu,
            // 会话从未选过档位 → 默认中间档（不是 none）：默认开启思考
            merged.thinkingEffort ?? defaultThinkingEffort(menu),
          ).effort
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

    // 4b. 恢复持久化的计划模式（布尔，缺省关；与 sandboxMode 各读各的，互不影响）
    this.planEnabled = this.session.settings?.planEnabled === true;

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
      fullReasoningRelay: this.resolveFullReasoningRelay(),
      providerProtocol: this.modelConfig.provider?.protocol,
      modelName: this.modelConfig.modelName,
      // 'workspace' 形态附件引用的桥接基准（见 file-path-bridge 步骤）
      workspaceDir: this._workspacePath ?? null,
    };
  }

  /**
   * 全量思考回传判定：声明式 compat（requiresReasoningContentOnAssistantMessages）
   * 优先，未声明回退 deepseek-v4 名字启发式（存量行为兜底）。
   */
  private resolveFullReasoningRelay(): boolean {
    const declared = this.modelConfig.requiresReasoningRelay;
    if (declared !== undefined) return declared;
    return isFullReasoningRelayModel(this.modelConfig.modelName);
  }

  /** 变换上下文指纹：模型能力/思考模式/协议/回传策略/回合/工作目录变化即失效重建 */
  private transformKey(): string {
    return [
      this.modelConfig.config.inputCapabilities?.includes('image')
        ? 'img'
        : 'noimg',
      this.thinkingEffortValue && this.thinkingEffortValue !== 'none'
        ? 'think'
        : 'nothink',
      this.currentTurnId ?? '-',
      this.resolveFullReasoningRelay() ? 'relay-all' : 'relay-last',
      this.modelConfig.provider?.protocol ?? '-',
      // 工作目录参与指纹：'workspace' 形态附件引用桥接出的绝对路径由它派生，
      // 沿用旧快照会让模型拿到已经失效的路径。
      this._workspacePath ?? '-',
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
      await this.readOccupancyAnchor(),
    );
  }

  /** 读取回放态的最新占用锚点（store 未实现该能力时视为无锚点 → 回退 usage 口径） */
  private async readOccupancyAnchor(): Promise<OccupancyAnchor | null> {
    if (!this.messageStore.getOccupancyAnchor) return null;
    return (await this.messageStore.getOccupancyAnchor(this.sessionId)) ?? null;
  }

  /** 组装快照（前缀和由视图派生；request 是 getMessages 时刻的派生表达式，不在此存储） */
  private assembleSnapshot(
    revision: number,
    key: string,
    view: Message[],
    perMessageTokens: number[],
    preludeTokens: number,
    occupancyAnchor: OccupancyAnchor | null,
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
      occupancyAnchor,
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
    // 增量追加的助手消息带 provider usage → 它比此前的压缩锚点更新，接管为 usage 锚点
    const hasUsage = addedView.some((m) => {
      if (m.role !== 'assistant') return false;
      const pt = (m.metadata?.usage as { promptTokens?: unknown } | undefined)
        ?.promptTokens;
      return typeof pt === 'number' && Number.isFinite(pt) && pt >= 0;
    });
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
      occupancyAnchor: hasUsage
        ? { kind: 'usage' }
        : this.snapshot.occupancyAnchor,
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
      // 模型名随 turn/start 落库：与实时 turn_start 广播字段对齐，
      // 保证流式中打开会话（历史页重建在途回合）也能立即显示模型
      modelName: this.modelConfig?.modelName,
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
    // 注入检测（模式叙事 / 绑定变更）共用一次可见视图读取：两者都以「上一条真实 user 消息」为基准
    const prevUserMsg = pickBaselineUserMessage(
      await this.loadVisibleMessages(),
      replaceTurnId,
    );
    // 检测 sandbox 模式切换 → system 注入块（origin='system'，前端不渲染；LLM 按 <system_reminder> 文本处理）
    const modeNarration = this.detectModeTransition(prevUserMsg);
    // 检测远程连接绑定变更 → system 注入块（基准随消息落库/删除，重答后自动重新注入）
    const bindingReminder = await this.detectBindingTransition(prevUserMsg);
    // 保留写入：下一条消息的模式切换 / 绑定变更检测基准（+审计）。
    // sshBindings 空数组也要写——缺字段会回退系统提示词快照，无法区分「当时确实没绑定」
    const enrichedMetadata: Record<string, any> = {
      ...options?.metadata,
      sandboxMode: this.sandboxMode,
      planEnabled: this.planEnabled,
      sshBindings: this.liveBindingIds(),
    };

    // 注入块（消息伴随信息）：追加在用户 blocks 尾部（novel 区 → KV 前缀零损失）。
    // 顺序即 DSH 注入瀑布语义：背景在前（模式叙事 → 绑定变更 → KB 引用），材料在后（命令解析产物
    // ——用户要求做的事的上下文最贴近模型作答位置）
    const injectedBlocks: ContentBlock[] = [];
    if (modeNarration) {
      injectedBlocks.push({
        type: 'text',
        text: `<system_reminder>\n${modeNarration}\n</system_reminder>`,
        origin: 'system',
      });
    }
    if (bindingReminder) {
      injectedBlocks.push(bindingReminder);
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
    // JSONL 内通用 id（contentId/attachmentId）：统一铸造入口
    // （id-<uuid>，前缀见 ID_PREFIXES.id；与消息域 m_ ULID 分域，见 id.util.ts）
    return mintId(ID_PREFIXES.id);
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

  getPlanEnabled(): boolean {
    return this.planEnabled;
  }

  consumePlanModeExitReminder(): boolean {
    const pending = this.planModeExitReminderPending;
    this.planModeExitReminderPending = false;
    return pending;
  }

  /**
   * 设置计划模式并**持久化**（重启后据此恢复；与 sandboxMode 不同——后者只由界面写设置，
   * 而计划模式还会被模型经 ExitPlanMode 审批通过后关闭，那条路径必须自己落库）。
   *
   * SessionMetaStore.update 是顶层浅合并（settings 整体替换），因此必须读改写——
   * 只传 { planEnabled } 会抹掉同一会话的其它设置。
   */
  async setPlanEnabled(enabled: boolean): Promise<void> {
    if (this.planEnabled === enabled) return;
    this.logger.debug(`Switching plan mode: ${this.planEnabled} -> ${enabled}`);
    this.planEnabled = enabled;
    // 退出后给模型一次明确的"可以动手了"信号（用户开关那条路径由模式叙事承担，
    // 这里覆盖模型经 ExitPlanMode 退出的场景）
    if (!enabled) this.planModeExitReminderPending = true;

    if (!this.sessionMetaStore) return;
    try {
      const current = this.sessionMetaStore.getMeta(this.sessionId);
      const settings: Record<string, any> = {
        ...((current?.settings as Record<string, any>) ?? this.session?.settings ?? {}),
      };
      settings.planEnabled = enabled;
      await this.sessionMetaStore.update(this.sessionId, { settings });
      // 同步内存里的会话记录，避免同一上下文后续读取拿到旧值
      if (this.session) this.session.settings = settings;
    } catch (error: any) {
      // 落库失败不阻断本次切换（内存态已生效，用户可再次切换纠正）
      this.logger.warn(`Failed to persist plan mode (${enabled}): ${error?.message}`);
    }
  }

  setToolScope(pluginId: string | null): void {
    this.toolScope = pluginId;
  }

  getToolScope(): string | null {
    return this.toolScope;
  }

  setPathJail(root: string | null): void {
    this.pathJail = root;
  }

  getPathJail(): string | null {
    return this.pathJail;
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

  /** 记录会话模式变更事件（透传 messageStore；审计/切换历史，事实源仍是 session.settings） */
  async appendSessionModeChanged(
    data: import('../../common/persistence/types').SessionModeChangedData,
  ): Promise<void> {
    await this.messageStore.appendSessionModeChanged(this.sessionId, data);
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

  /**
   * 是否有"人能应答审批"的面（命令策略层 fail-closed 的判据）。
   *
   * 两个来源任一为真即可：
   *  1. 前端 SSE 在线（probe 由 SessionEventsService 提供）——审批卡经它直投到界面；
   *     注意**不能**用 streamManager.subscribers 判这个：那里只有进程内消费者（runner 的
   *     callbacks 订阅），前端连接登记在 SessionEventsService，两套注册表互不可见。
   *  2. 进程内有消费者在位（如后台续跑经 chatRunner 带 callbacks 订阅）。
   *
   * bot / 子代理会话没有可见应答面（子代理的审批卡只在用户主动打开该子会话标签时可见），
   * 一律按"无人应答"处理，避免审批无限期挂住。
   */
  hasAnswerSurface(): boolean {
    if (this.sessionType === "bot" || this.sessionType === "sub_agent") return false;
    if (this.answerSurfaceProbe?.()) return true;
    return (this.streamManager.getStreamStatus?.(this.sessionId)?.subscriberCount ?? 0) > 0;
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
      ? ToolExecutor.toFlatToolDefs(this.resolvedPlugins)
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
    // 压缩后占用锚点（写前模拟）：当前全量 − 本次节省 + 摘要 token → compaction/end 携带。
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
    heuristicTokens?: number;
    effectiveContextWindow?: number;
    messageCount?: number;
    breakdown?: TokenBreakdown;
    beforeTokens?: number;
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
    // 压缩前实测占用（尾部 prune 已写入、遮蔽尚未写入）
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
    // 保留尾裁剪中"被 provider 增量口径抵消"的收益需显式扣减（锚点之前的条目）
    const cancelled = this.cancelledSavings(
      snap.view,
      snap.occupancyAnchor,
      data.savings,
      shadowedCount,
    );
    // 遮蔽区整体移除 + 摘要置头（此刻尚未写入 → 不受增量口径影响，直接扣减）
    const shadowedSaving = shadowedTokens - summaryTokens;
    const usedTokens = Math.max(0, preTotal - cancelled - shadowedSaving);
    // 与 usedTokens 配套的启发式总量 = 压缩后视图（摘要节点替换遮蔽前缀）的启发式总量，
    // 供后续 getTokenCount 以"锚点 + 增量"继续推进
    const historyNow =
      snap.prefixTokens.length > 0
        ? snap.prefixTokens[snap.prefixTokens.length - 1]
        : 0;
    const historyAfter = Math.max(0, historyNow - shadowedTokens + summaryTokens);
    const breakdown = await this.getTokenBreakdown();
    return {
      usedTokens,
      heuristicTokens: snap.preludeTokens + historyAfter,
      effectiveContextWindow,
      // 细分与消息数按压缩后视图结算（避免 usedTokens 已降、细分/条数仍是压缩前）
      messageCount: Math.max(0, snap.view.length - shadowedCount + 1),
      breakdown: { ...breakdown, history: historyAfter },
      beforeTokens: preTotal,
    };
  }

  /**
   * 本批节省中已被 provider 增量口径"抵消"的 token 量（需从锚点口径总量显式扣减）。
   *
   * 仅 usage 锚点会抵消：其增量基准是"锚点消息处的视图前缀和"，锚点之前的裁剪会等额降低
   * `heuristicNow` 与 `heuristicAtAnchor` → 总量恒定不变。compaction 锚点与无锚点路径的基准
   * 都是当前视图的历史总量，裁剪已自然吸收，不重复扣减（anchor 缺省视为 usage 口径）。
   * @param minIndex 只统计 >= 该 index 的条目（压缩路径传 shadowedCount：遮蔽区由 shadowedSaving 结算）
   */
  private cancelledSavings(
    view: readonly Message[],
    anchor: OccupancyAnchor | null,
    savings: readonly CompressionSaving[] | undefined,
    minIndex = 0,
  ): number {
    if (!savings?.length || anchor?.kind === 'compaction') return 0;
    const anchorIndex = this.findUsageAnchor(view)?.index ?? -1;
    if (anchorIndex < 0) return 0;
    let sum = 0;
    for (const s of savings) {
      if (s.index >= minIndex && s.index <= anchorIndex) sum += s.tokens;
    }
    return sum;
  }

  /** 纯裁剪（无括号）压缩路径的上下文占用锚点：写一条独立 compaction/end 携带当前占用。
   *  compacted 路径的锚点已由 appendCompact 的 compaction/end 承载，无需此调用。
   *  @param opts.beforeTokens 压缩前实测占用（压缩历史 before/after 对比）；
   *         opts.savings 本次裁剪节省（锚点之前者被显式扣减，否则 provider 锚点会抵消裁剪收益） */
  async recordContextAnchor(opts?: ContextAnchorWrite): Promise<void> {
    const snap = await this.getSnapshot();
    // 裁剪已写入 → 当前总量已含"锚点之后的"收益，只需补扣被抵消的部分
    const currentTotal = await this.getTokenCount();
    const cancelled = this.cancelledSavings(
      snap.view,
      snap.occupancyAnchor,
      opts?.savings,
    );
    const usedTokens = Math.max(0, currentTotal - cancelled);
    const historyTokens =
      snap.prefixTokens.length > 0
        ? snap.prefixTokens[snap.prefixTokens.length - 1]
        : 0;
    const heuristicTokens = snap.preludeTokens + historyTokens;
    const revision = await this.messageStore.recordContextAnchor(this.sessionId, {
      usedTokens,
      heuristicTokens,
      effectiveContextWindow: this.getEffectiveContextWindow(),
      messageCount: snap.view.length,
      breakdown: await this.getTokenBreakdown(),
      ...(opts?.beforeTokens !== undefined
        ? { beforeTokens: opts.beforeTokens }
        : {}),
    });
    // 不改变消息视图，仅版本号前进 → 续期快照 revision；并把新锚点写进缓存快照，
    // 避免紧随其后的 getContextStats()/getTokenCount() 又读回被抵消的旧值
    this.refreshSnapshotRevision(revision);
    if (this.snapshot) {
      this.snapshot = {
        ...this.snapshot,
        occupancyAnchor: { kind: 'compaction', usedTokens, heuristicTokens },
      };
    }
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
   *
   * 锚点优先级：压缩纠正锚点（compaction/end 的 usedTokens + heuristicTokens）> provider usage
   * 锚点。压缩会改写锚点**之前**的内容，usage 增量口径下两个启发式项同额下降 → 裁剪收益被
   * 抵消（压缩后占用不降）；故压缩后必须以纠正值为基准，待新回合写入新的 usage 锚点再切回。
   */
  async getTokenCount(): Promise<number> {
    return (await this.computeTokenAccounting()).total;
  }

  /** token 账目诊断（压缩排查）：返回总数、命中路径与三方口径的中间量（只读，无额外估算开销） */
  async getTokenDiagnostics(): Promise<TokenDiagnostics> {
    return this.computeTokenAccounting();
  }

  /**
   * token 账目计算（getTokenCount 与诊断共用）：
   * 视图口径（viewTokens/perMessageTokens）与展示口径（total）在此对齐，
   * `path`/`anchor`/`rejectedAnchor` 暴露锚点命中与静默降级。
   */
  private async computeTokenAccounting(): Promise<TokenDiagnostics> {
    const model = this.currentModelName();
    const snap = await this.getSnapshot();
    const viewTokens =
      snap.prefixTokens.length > 0
        ? snap.prefixTokens[snap.prefixTokens.length - 1]
        : 0;
    const heuristicNow = snap.preludeTokens + viewTokens;
    const common = {
      preludeTokens: snap.preludeTokens,
      viewTokens,
      viewMessageCount: snap.view.length,
      prefixSumLast: viewTokens,
    };

    const compactionAnchor = snap.occupancyAnchor;
    if (compactionAnchor?.kind === 'compaction') {
      return {
        ...common,
        total: Math.max(
          0,
          compactionAnchor.usedTokens +
            (heuristicNow - compactionAnchor.heuristicTokens),
        ),
        path: 'compaction_anchor',
      };
    }

    const anchor = this.findUsageAnchor(snap.view);
    if (anchor && anchor.model === model) {
      const heuristicAtAnchor =
        snap.preludeTokens + (snap.prefixTokens[anchor.index] ?? 0);
      return {
        ...common,
        total: Math.max(
          0,
          anchor.promptTokens + (heuristicNow - heuristicAtAnchor),
        ),
        path: 'usage_anchor',
        anchor: {
          model: anchor.model,
          promptTokens: anchor.promptTokens,
          messageIndex: anchor.index,
        },
      };
    }
    return {
      ...common,
      total: heuristicNow,
      path: 'heuristic',
      ...(anchor
        ? {
            rejectedAnchor: {
              model: anchor.model,
              promptTokens: anchor.promptTokens,
              messageIndex: anchor.index,
            },
          }
        : {}),
    };
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

  /** 当前会话绑定的远程连接 id（session.settings.attachments['ssh-connection']） */
  private liveBindingIds(): string[] {
    const ids = this.session?.settings?.attachments?.['ssh-connection'];
    return Array.isArray(ids) ? ids : [];
  }

  /**
   * 检测远程连接绑定是否变化：基准 = 上一条可见用户消息 metadata.sshBindings。
   * 基准随消息落库、随消息删除消失——重答（回合删除）或手工删轮次后基准自然回退到更早的消息，
   * 变更被重新判定，reminder 重新注入（修复「重答后绑定提醒丢失」）。
   * 无基准（冷启动 / 旧会话消息无该字段）→ 回退系统提示词冻结快照（模型仅剩的认知来源）。
   */
  private async detectBindingTransition(
    prevUserMsg: Message | undefined,
  ): Promise<ContentBlock | null> {
    const liveIds = this.liveBindingIds();
    const before = resolveBindingBaseline(
      prevUserMsg?.metadata?.sshBindings,
      await this.bindingState.getSnapshotIds(this.sessionId, liveIds),
    );
    return this.bindingState.buildChangeReminder(this.sessionId, before, liveIds);
  }

  /**
   * 检测安全模式是否发生切换（基准 = 上一条真实 user 消息 metadata.sandboxMode）。
   * 叙事按方向组合：进入/退出 read-only 与进入/退出 danger-full-access 可叠加。
   */
  private detectModeTransition(prevUserMsg?: Message): string | null {
    const narrations: string[] = [];

    // ── 安全档位（三档词表）──
    const prevMode = prevUserMsg?.metadata?.sandboxMode || 'workspace-write';
    const currentMode = this.sandboxMode;

    if (prevMode !== currentMode) {
      if (currentMode === 'read-only' && prevMode !== 'read-only') {
        narrations.push(
          process.platform === 'win32'
            ? 'The user has enabled read-only mode. File writes are denied, and run_command only allows verified read-only commands (the tool will name the allowlist when it denies one). Use the available tools to analyze, plan, and discuss with the user; if a modification is required, explain what needs to change.'
            : 'The user has enabled read-only mode. File writes are denied and run_command executes in a read-only sandbox — all file modifications are blocked. Use the available tools to analyze, plan, and discuss with the user; if a modification is required, explain what needs to change.',
        );
      }
      if (prevMode === 'read-only' && currentMode !== 'read-only') {
        narrations.push(
          process.platform === 'win32'
            ? 'The user has disabled read-only mode. File writes are available again under the session policy, and commands outside the read-only allowlist will now ask the user for approval.'
            : 'The user has disabled read-only mode. File writes are available again under the session sandbox policy.',
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
    }

    // ── 计划模式（协作状态，与安全档位各自独立判定）──
    // 缺字段视为"与当前一致"：旧会话消息没有 planEnabled，不能把第一条带上该字段的消息
    // 误判成一次切换（冷启动时尤其明显）。
    const prevPlan =
      prevUserMsg?.metadata?.planEnabled === undefined
        ? this.planEnabled
        : prevUserMsg.metadata.planEnabled === true;
    if (prevPlan !== this.planEnabled) {
      narrations.push(
        this.planEnabled
          ? process.platform === 'win32'
            ? 'The user has enabled plan mode. You are in a read-only planning phase: write/edit and other state-changing tools are blocked, and run_command only allows verified read-only commands. Investigate the codebase, then present your plan with ExitPlanMode for approval. Do not ask for plan approval in plain text.'
            : 'The user has enabled plan mode. You are in a read-only planning phase: write/edit and other state-changing tools are blocked, and run_command executes in a read-only sandbox. Investigate the codebase, then present your plan with ExitPlanMode for approval. Do not ask for plan approval in plain text.'
          : 'The user has disabled plan mode. You can make edits and run commands again.',
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
      provider: toRuntimeProviderConfig(model.provider),
      modelType: model.modelType,
      thinkingEfforts: model.thinkingEfforts || [],
      requiresReasoningRelay:
        model.thinkingCompat?.requiresReasoningContentOnAssistantMessages,
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

  /**
   * 合并压缩配置（档位折算）：智能体 settings.memory.compressionTier 决定
   * enabled/trigger/retain/summaryMode 四元组（见 compression-tiers.ts）；
   * 旧自由比例/摘要模式配置读时映射到档位，不写库。
   */
  private async buildCompactionConfig(memory: any): Promise<CompactionConfig> {
    const preset = COMPRESSION_TIER_PRESETS[resolveCompressionTier(memory)];

    return {
      enabled: preset.enabled,
      compressionTriggerRatio: preset.triggerRatio,
      compressionRetainRatio: preset.retainRatio,
      summaryMode: preset.summaryMode,
    };
  }


  /**
   * 合并会话设置与智能体默认配置（优先级：会话 > 智能体）。
   */
  private buildEffectiveSettings(): EffectiveSettings {
    const sessionSettings = this.session.settings || {};
    const agentSettings = this.session.agent?.settings || {};

    const mergedTools = sessionSettings.plugins ?? agentSettings.plugins;
    const mergedSkills = sessionSettings.skills ?? agentSettings.skills;
    const mergedAgents = sessionSettings.agents ?? agentSettings.agents;

    let systemPrompt =
      sessionSettings.systemPrompt || agentSettings.systemPrompt || '';

    const merged: EffectiveSettings = {
      systemPrompt,
      thinkingEffort: undefined,
      memory: {},
      plugins: mergedTools,
      skills: mergedSkills,
      agents: mergedAgents,
    };

    merged.memory = { ...agentSettings.memory };
    merged.maxTokensLimit = sessionSettings.maxTokensLimit ?? null;
    merged.thinkingEffort = sessionSettings.thinkingEffort;
    merged.attachments = sessionSettings.attachments ?? {};
    merged.referencedKbs = sessionSettings.referencedKbs ?? [];
    merged.sandboxMode = sessionSettings.sandboxMode ?? 'workspace-write';
    merged.planEnabled = sessionSettings.planEnabled === true;
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

  /**
   * 解析会话使用的模型：内存挂载（bot 路径已 enrich）→ 会话自选 modelId → 全局默认。
   *
   * 三级都解析不到即抛 ModelNotResolvedError（fail-loud）——静默换用另一个模型
   * 会让模型、成本与行为在用户不知情时改变，比直接报错危险得多。
   */
  private async resolveModel(): Promise<any> {
    if (this.session.model) return this.session.model;

    const sessionModelId = this.session.modelId as string | undefined;
    if (sessionModelId) {
      const model = this.modelStore.findModel(sessionModelId);
      if (model) return model;
      throw new ModelNotResolvedError(this.sessionId, sessionModelId);
    }

    const defaultModelId = await this.settingsStorage.getSettingValue(
      SG_MODELS,
      SK_MOD_CHAT,
    );
    const fallback = defaultModelId
      ? this.modelStore.findModel(defaultModelId)
      : undefined;
    if (fallback) return fallback;

    throw new ModelNotResolvedError(this.sessionId, defaultModelId || null);
  }

  /**
   * 构建系统提示词文本（envelope，与对话历史 surface 分离——对齐 DSH LlmCallConfig.system）。
   * 含：智能体 systemPrompt + 插件 eager 提示词。
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
    const toolDefs = ToolExecutor.toFlatToolDefs(this.resolvedPlugins);
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
