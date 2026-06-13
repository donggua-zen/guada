import { MessageRecord } from "../llm-core/types/llm.types";

// ============================================================================
// DTO: 模型配置
// ============================================================================

/**
 * 模型特性标识
 */
export type ModelFeature = "tools" | "thinking" | "vision" | "image";

/**
 * 模型配置
 *
 * 包含 Agent 循环所需的模型元数据，屏蔽底层 model 结构差异。
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
    config?: Record<string, any>;
  };
  /** 模型类型 */
  modelType: string;
  /** 模型原生配置（contextWindow、features、inputCapabilities 等） */
  config: {
    contextWindow?: number;
    maxOutputTokens?: number;
    features?: ModelFeature[];
    inputCapabilities?: string[];
    [key: string]: any;
  };
}

// ============================================================================
// DTO: 模型调用参数
// ============================================================================

/**
 * 模型调用参数
 *
 * 直接传递给 LLMService.completions() 的参数子集。
 */
export interface ModelParams {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  maxTokens?: number;
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

// ============================================================================
// DTO: 工具上下文
// ============================================================================

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

  // === 模型配置 ===
  /** 获取完整模型配置 */
  getModelConfig(): ModelConfig;
  /** 获取模型调用参数（temperature、topP 等） */
  getModelParams(): ModelParams;
  /** 检查模型是否支持指定特性 */
  supportsFeature(feature: ModelFeature): boolean;

  // === 提示词与上下文 ===
  /** 获取完整的 system prompt（已合并工具提示词） */
  getSystemPrompt(): string;
  /** 获取思考强度配置 */
  getThinkingEffort(): string | undefined;

  // === 工具相关 ===
  /** 获取工具执行上下文（未定义表示不支持工具调用） */
  getToolContext(): any;
  /** 获取工具审批配置 */
  getToolApprovalConfig(): ToolApprovalConfig;

  // === 压缩与记忆 ===
  /** 获取记忆与压缩配置 */
  getMemoryConfig(): MemoryConfig;
  /** 获取实际生效的上下文窗口大小 */
  getEffectiveContextWindow(): number;

  // === 工作目录 ===
  /** 获取会话工作目录路径 */
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
  /** 获取准备发送给 LLM 的完整消息列表（含 system prompt、摘要和历史） */
  getMessages(): Promise<MessageRecord[]>;
  /** 获取当前对话历史（不含 system prompt 和摘要） */
  getHistory(): MessageRecord[];
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
  /** 强制触发压缩 */
  forceCompress(): Promise<MessageRecord[]>;
}
