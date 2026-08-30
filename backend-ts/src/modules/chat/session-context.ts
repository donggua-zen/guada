import { TokenBreakdown, TurnFinish } from "./interfaces";
import type { Message, FileRef } from "../../common/types/conversation.types";

// ============================================================================
// DTO: 模型配置
// ============================================================================

/**
 * 模型特性标识
 */
export type ModelFeature = "tools" | "thinking" | "vision" | "image";

/**
 * 模型调用参数
 *
 * 合并到 ModelConfig 中，避免调用方分别获取两份配置。
 */
export interface ModelConfig {
  /** 模型唯一标识 */
  id: string;
  /** 模型名称（用于 API 调用） */
  modelName: string;
  /** 显示名称 */
  name: string;
  /** 供应商配置 */
  provider: {
    id: string;
    provider: string;
    protocol: string;
    apiUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    config?: Record<string, any>;
  };
  /** 模型类型 */
  modelType: string;
  /** 完整模型参数（含原生配置和运行时调用参数） */
  config: {
    contextWindow?: number;
    maxOutputTokens?: number;
    features?: ModelFeature[];
    inputCapabilities?: string[];
    // 运行时调用参数（与会话设置合并）
    temperature: number;
    topP: number;
    frequencyPenalty: number;
    [key: string]: any;
  };
}

// ============================================================================
// 会话运行模式
// ============================================================================

/**
 * 会话安全模式（三档词表，与 DSH SandboxMode 同构，对 shell 与文件工具同时生效）
 *
 * - read-only: 只读——文件写入被拒绝，run_command 经沙盒 --read-only 执行（全盘只读）
 * - workspace-write: 工作区可写（默认）——文件工具限工作区内，shell 命令经沙盒
 *                    限制写入仅在工作目录内
 * - danger-full-access: 自由编辑——不启用沙盒，文件工具不限制工作目录，
 *                       可读写任意路径（高风险，UI 以红色警示）
 *
 * 提权 = 模型带 sandbox_permissions + justification 经审批 one-shot 放宽
 * （read-only < workspace-write < danger-full-access 严格放宽阶梯）。
 *
 * 计划模式（原 plan）已从安全词表移除，列入后续待办——计划协作本质是只读执行的
 * 软引导，后续以独立协作状态回归，不与安全词表混同（对齐 DSH plan-mode 正交设计）。
 */
export type SessionSandboxMode = import("../../common/services/sandbox-policy").SandboxMode;

/**
 * 获取消息选项
 */
export interface GetMessagesOptions {
  /** 排除的提示词部件（如 ["tool"] 跳过工具提示词） */
  exclude?: string[];
}

// ============================================================================
// ISessionContext: Agent 循环唯一依赖的会话抽象
// ============================================================================

/**
 * 会话上下文
 *
 * 为 Agent 循环提供类型安全、结构稳定的运行环境配置。
 * 屏蔽底层 session 结构差异，支持"持久化会话"和"内存虚拟会话"两种模式。
 *
 * 聚合了会话配置（模型、工具、提示词）和对话状态（消息历史、压缩），
 * 是 Agent 循环的唯一依赖接口。
 *
 * 设计原则：
 * - 只读视图：Agent 循环不应修改会话配置，所有方法返回快照或常量
 * - 懒加载：工具列表等昂贵操作按需执行
 * - 零泄漏：不暴露原始 session 对象，防止越界访问
 */
export interface ISessionContext {
  // === 身份标识 ===
  readonly sessionId: string;
  readonly userId: string;
  readonly sessionType: "web" | "bot" | "sub_agent";
  /** 父会话 ID（子代理场景下为主会话 ID，主会话场景下为 null） */
  readonly parentSessionId?: string | null;
  /** 当前会话绑定的角色 ID（无角色时为 null） */
  readonly characterId?: string | null;
  /** 机器人 ID（仅 bot 会话有值） */
  readonly botId?: string | null;
  /** 外部 ID（bot 会话中为 "platform:type:nativeId"，nativeId 即平台 conversationId） */
  readonly externalId?: string | null;

  // === 安全模式 ===
  /** 获取当前会话安全模式（read-only | workspace-write | danger-full-access） */
  getSandboxMode(): SessionSandboxMode;
  /** 设置会话安全模式（运行时切换，如 UI 政策控件） */
  setSandboxMode(mode: SessionSandboxMode): Promise<void>;
  /** 工具范围锁定（瞬态、不入库，正交于安全模式）：仅允许指定插件的工具；null = 不限制（影子轮次等场景使用） */
  setToolScope(pluginId: string | null): void;
  /** 读取当前工具范围锁定 */
  getToolScope(): string | null;

  // === 模型配置 ===
  /** 获取完整模型配置（含运行时调用参数） */
  getModelConfig(): ModelConfig;
  /** 检查模型是否支持指定特性 */
  supportsFeature(feature: ModelFeature): boolean;

  // === 提示词与上下文 ===
  /** 获取思考强度配置 */
  getThinkingEffort(): string | undefined;

  // === 工具相关 ===
  /** 获取已决议的插件列表（resolvePlugins 的结果快照） */
  getResolvedPlugins(): import("../plugins/types/plugin.types").ResolvedPluginInfo[];
  /** 获取合并后的会话设置（指定字段或全部） */
  getSettings(field?: string): any;
  // === 统一交互（审批/询问/迭代暂停共用 ask/* 审计；无超时） ===
  /** 记录交互请求事件（发起 ask 时写日志，审计源） */
  appendAskAsked(
    data: import("../../common/persistence/types").AskAskedData,
  ): Promise<void>;
  /** 记录交互应答事件（应答/取消后写日志；每次 asked 必有 answered） */
  appendAskAnswered(
    data: import("../../common/persistence/types").AskAnsweredData,
  ): Promise<void>;

  // === 流事件发布（唯一发布面，对齐 DSH session.append 直发） ===
  /**
   * 发布流式事件到会话活跃流（deep 层模块直发入口：引擎、钩子订阅者、审批服务等）。
   *
   * 实现内组装 prevSeq 续传游标（"先入库后发事件"契约）后交 SessionStreamManager.publish
   * （eventBuffer 缓存 + 进程内扇出 + SSE 直投三合一）。无活跃流时静默丢弃。
   */
  publishStream(chunk: import("./types/event-chunk.types").SessionStreamEvent): Promise<void>;

  // === 压缩数据源 ===
  /** 获取实际生效的上下文窗口大小（压缩决策等场景使用） */
  getEffectiveContextWindow(): number;

  // === 工作目录 ===
  /** 获取会话工作目录路径 */
  readonly workspacePath: string;
  getWorkspacePath(): string;

  // === 游标控制 ===
  // === 对话状态管理 ===
  /** 初始化：加载历史消息、恢复压缩状态 */
  initialize(): Promise<void>;
  /**
   * 获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史），返回三层 Message[]。
   *
   * ⚠️ 禁止在插件中调用，否则会导致无限递归！插件应使用 getHistory()
   */
  getMessages(options?: GetMessagesOptions): Promise<Message[]>;
  /**
   * 获取原始的对话历史消息列表（不含 system prompt / 摘要 / 插件提示词）。
   *
   * 与 getMessages() 的区别：
   * - getMessages() 返回完整消息列表（含 system prompt），禁止在插件中调用
   * - getHistory() 只返回 raw conversation messages，可在插件中安全使用
   *
   * 返回的数组是浅拷贝，修改不会影响内部状态。
   */
  getHistory(): Promise<Message[]>;
  /** 追加一次 LLM 调用/注入到历史并持久化（Message[]，三层） */
  appendMessages(messages: Message[]): Promise<void>;
  /**
   * 持久化待保存的消息。
   *
   * ⚠️ 历史遗留：JSONL append 即实时落盘,persist 不再承担真实落盘职责,
   * 保留为空实现,未来可用于分卷/整理等杂活。
   */
  persist(): Promise<void>;
  /** 原子累加轮次总耗时并保存结束信息到 Turn.metadata */
  finalizeTurn(turnId: string, durationMs: number, finish: TurnFinish): Promise<void>;

  /**
   * agent 开始消费该回合时开回合:写 turn/start(先于 user/message,对齐 DSH 回合定界)。
   * 返回回合 turnId,作为后续 appendMessages / finalizeTurn 的归属游标。
   * @param options.replaceTurnId 整轮次重答:先写 turn/delete 遮蔽旧轮次,再开新回合
   */
  beginTurn(options?: {
    replaceTurnId?: string;
    preGenTurnId?: string;
  }): Promise<string>;

  /**
   * 删除本轮对话:写 turn/delete 事件(append-only),replayer 重放时 splice 移除该回合。
   * 与压缩遮蔽(visible=false,前端保留占位)语义区分:删除 = 视图彻底移除。
   */
  deleteTurn(turnId: string): Promise<void>;

  /**
   * 追加用户消息:写 user/message(后于 turn/start),不建回合外壳、不返回三层结构。
   * 返回用户消息(三层 Message),供 agent-engine 广播 user_message 事件。
   */
  addUserMessage(
    content: string,
    files?: FileRef[],
    options?: {
      replaceTurnId?: string;
      knowledgeBaseIds?: string[];
      metadata?: Record<string, any>;
    },
  ): Promise<{ messageId: string; userMessage: any }>;

  /** 生成唯一 ID */
  generateId(): string;
  /** 获取当前 Token 计数（当前视图按需估算，provider 真值锚点 + 启发式增量） */
  getTokenCount(): Promise<number>;
  /** 获取细粒度 Token 统计（系统提示词/摘要/用户提示/历史/工具定义，按需计算） */
  getTokenBreakdown(): Promise<TokenBreakdown>;
}
