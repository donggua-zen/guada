import { MessageRecord } from "../llm-core/types/llm.types";
import { TokenBreakdown } from "./interfaces";

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
// DTO: 工具审批配置
// ============================================================================

/**
 * 工具审批配置
 */
export interface ToolApprovalConfig {
  /** 是否启用审批 */
  enabled: boolean;
  /** 需要审批的工具列表（支持命名空间通配，如 file__*） */
  requiresApproval: string[];
}

// ============================================================================
// DTO: 记忆与压缩配置
// ============================================================================

/**
 * 记忆与压缩配置
 */
export interface MemoryConfig {
  maxMemoryLength?: number;
  compressionTriggerRatio?: number;
  compressionTargetRatio?: number;
  summaryMode?: string;
  maxTokensLimit?: number;
}

/**
 * 会话运行模式
 *
 * - normal: 默认模式，所有插件、技能完整可用
 * - memory: 记忆模式，仅暴露 file 插件工具，技能为空
 *           用于影子轮次等需要限制工具范围的场景
 * - plan: 计划模式，仅允许 safe 等级的只读工具，
 *         危险工具（write/edit/shell等）在运行时被拦截
 *
 * 后续可扩展 readonly(只读)、minimal(最小) 等模式
 */
export type SessionRunMode = "normal" | "memory" | "plan";

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

  // === 运行模式 ===
  /** 获取当前会话运行模式 */
  getRunMode(): SessionRunMode;
  /** 设置会话运行模式（运行时切换，如影子轮次临时切换为 memory） */
  setRunMode(mode: SessionRunMode): Promise<void>;

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
  /** 获取工具审批配置 */
  getToolApprovalConfig(): ToolApprovalConfig;

  // === 压缩与记忆 ===
  /** 获取记忆与压缩配置 */
  getMemoryConfig(): MemoryConfig;
  /** 获取实际生效的上下文窗口大小 */
  getEffectiveContextWindow(): number;

  // === 工作目录 ===
  /** 获取会话工作目录路径 */
  readonly workspacePath: string;
  getWorkspacePath(): string;

  // === 虚拟会话扩展 ===
  /** 是否为虚拟会话（非持久化） */
  isVirtual(): boolean;

  // === 游标控制 ===
  /** 设置消息游标：第一次 getMessages 时从数据库只加载**到此消息为止**的历史（含该消息） */
  setMessageCursor(messageId: string): void;

  // === 对话状态管理 ===
  /** 初始化：加载历史消息、恢复压缩状态 */
  initialize(): Promise<void>;
  /**
   * 获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史）
   *
   * ⚠️ 禁止在插件中调用，否则会导致无限递归！插件应使用 getHistory()
   */
  getMessages(options?: GetMessagesOptions): Promise<MessageRecord[]>;
  /**
   * 获取原始的对话历史消息列表（不含 system prompt / 摘要 / 插件提示词）。
   *
   * 与 getMessages() 的区别：
   * - getMessages() 返回完整消息列表（含 system prompt），禁止在插件中调用
   * - getHistory() 只返回 raw conversation messages，可在插件中安全使用
   *
   * 返回的数组是浅拷贝，修改不会影响内部状态。
   */
  getHistory(): Promise<MessageRecord[]>;
  /** 追加消息记录到历史并持久化 */
  appendParts(records: MessageRecord[]): Promise<void>;
  /** 持久化待保存的消息 */
  persist(): Promise<void>;
  /** 准备助手回复的消息 ID */
  prepareAssistantResponse(
    parentId: string,
    regenerationMode: string,
    turnsId: string,
    existingAssistantMessageId?: string,
  ): Promise<string>;
  /** 生成唯一 ID */
  generateId(): string;
  /** 获取当前 Token 计数 */
  getTokenCount(): number;
  /** 获取细粒度 Token 统计（系统提示词/摘要/用户提示/历史/工具定义） */
  getTokenBreakdown(): TokenBreakdown;
  /** 检查是否达到压缩阈值 */
  shouldCompress(): Promise<boolean>;
  /** 执行压缩 */
  compress(onBeforeCompaction?: () => Promise<void>): Promise<MessageRecord[]>;

  // === Token 消费追踪 ===
  /** 记录一次 LLM 调用的 token 消耗（prompt + completion），累加到会话累计中 */
  recordTokenUsage(
    promptTokens: number,
    completionTokens: number,
    cachedTokens?: number,
  ): Promise<void>;
}
