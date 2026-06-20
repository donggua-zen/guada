/**
 * 工具参数属性定义
 */
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: any[];
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  items?: ToolParameterProperty;
  default?: any;
  maxLength?: number;
}

/**
 * 系统内部使用的扁平化工具定义（不带 function 包装层）
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: "object";
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
  /** 前端展示动作描述（如"读取文件"） */
  action?: string;
  /** 前端展示图标标识 */
  icon?: string;
  /** 从 args 中提取摘要的字段名 */
  argsKey?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/**
 * 工具调用展示信息（结构化）
 */
export interface ToolDisplayInfo {
  /** 动作描述（如：“正在写入文件”、“已读取文件”） */
  action: string;
  /** 关键参数摘要（如：“xxxxxx.txt”） */
  args?: string;
  /** 原始工具名 */
  toolName?: string;
  /**
   * 工具类型标识（用于前端图标映射）
   * 默认使用 pluginId，仅在需要特殊图标时显式指定
   */
  toolType?: string;
  /** 额外信息（可选，用于扩展） */
  extra?: Record<string, any>;
}

/**
 * 工具加载模式
 */
export type ToolLoadMode = 'eager' | 'lazy' | 'none';

/**
 * 工具提供者分类
 * - core: 核心工具，默认启用，提供基础能力
 * - extended: 扩展工具，默认禁用，提供进阶或特定场景能力
 */
export type ToolProviderType = 'core' | 'extended';

/**
 * 提示词在 system prompt 中的变动频率
 * - STATIC:   完全静态，内容不随会话变化（如 file/shell 的使用指南）
 * - REGULAR:  偶尔变化，通常由配置或角色设定触发（如知识库说明、子代理提示词）
 * - VOLATILE: 每次对话都可能不同（如 memory 的记忆内容）
 */
export type PromptFrequency = 'STATIC' | 'REGULAR' | 'VOLATILE';

export interface ToolProviderMetadata {
  pluginId: string;
  displayName: string;
  description: string;
  isMcp: boolean;
  /**
   * 工具定义加载模式（控制是否在 LLM 的 tools 参数中提供）
   * - eager: 始终在 tools 参数中提供完整定义（默认）
   * - lazy: 不在 tools 参数中提供，通过 tool_load 获取详细说明后使用 tool_call 调用
   * - none: 完全不加载，工具在任何情况下都不可用
   */
  loadMode?: ToolLoadMode;
  /**
   * 工具提供者分类，用于控制默认启用状态
   * - core: 默认启用（兼容已有行为）
   * - extended: 默认禁用，需用户手动开启
   * 未配置时默认为 core，保持向后兼容
   */
  type?: ToolProviderType;
  /**
   * 提示词变动频率，用于排序优化 KV cache 命中率。
   * 排序规则：STATIC → REGULAR → VOLATILE（越静态越靠前）。
   * 未配置时默认 REGULAR，保持向后兼容。
   */
  promptFrequency?: PromptFrequency;
}

/**
 * 工具提供者运行上下文（由 ISessionContext 等实现，结构兼容）
 */
export interface ProviderContext {
  sessionId: string;
  sessionType: string;
  workspacePath: string;
  userId?: string;
  [key: string]: any;
}

export interface IToolProvider {
  pluginId: string;
  /**
   * 获取工具定义列表
   * @param enabled 启用状态或启用的工具名称列表
   * @param context 上下文信息（session_id, user_id, session_type 等）
   * @returns 工具定义数组
   */
  getTools(enabled?: boolean | string[], context?: ProviderContext): Promise<ToolDefinition[]>;
  /**
   * 执行工具调用
   * @param request 工具调用请求
   * @param context 上下文信息（session_id, user_id, session_type 等）
   * @param abortSignal 中断信号（可选），用于客户端断开时中止长时间运行的工具
   * @returns 工具执行结果内容字符串
   * @throws Error 如果执行失败，抛出异常由 ToolOrchestrator 捕获
   */
  execute(request: ToolCallRequest, context?: ProviderContext, abortSignal?: AbortSignal): Promise<string>;
  /**
   * 获取工具的完整提示词（包含工具说明和使用指南）
   * 可选实现。如果模块不需要额外提示词（如 MCP），可以不实现此方法。
   * @param context 上下文信息
   * @returns 工具提示词字符串，不需要则返回空字符串
   */
  getPrompt?(context?: ProviderContext): Promise<string>;
  /**
   * 获取需要持续注入的提示词内容（如记忆内容、动态上下文等）
   * 这部分内容会始终注入到 System Prompt 中，不受 loadMode 影响
   * @param context 上下文信息
   * @returns 持续注入的提示词字符串，如不需要则返回空字符串
   */
  getPersistentPrompt?(context?: ProviderContext): Promise<string>;
  /**
   * 获取提供者的元数据信息
   * @param context 上下文信息
   * @returns 提供者元数据
   */
  getMetadata(context?: ProviderContext): ToolProviderMetadata;
  /**
   * 获取工具的简要说明（用于 system prompt 中的元信息展示）
   * @param context 上下文信息
   * @returns 简短的工具类别描述
   */
  getBriefDescription?(context?: ProviderContext): Promise<string>;
  /**
   * 生成工具调用的展示文案（在 LLM 输出参数后立即调用）
   * @param toolName 工具名称
   * @param args 工具参数（可能不完整，流式累积中）
   * @param isExecuting 工具是否正在执行（true=正在进行，false=已完成）
   * @returns 结构化的展示信息或自然语言字符串（向后兼容）
   */
  formatDisplayMessage?(toolName: string, args: Record<string, any>, isExecuting: boolean): ToolDisplayInfo | string;
}
