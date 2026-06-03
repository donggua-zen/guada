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
   * 默认使用 namespace，仅在需要特殊图标时显式指定
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

export interface ToolProviderMetadata {
  namespace: string;
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
}

export interface IToolProvider {
  namespace: string;
  /**
   * 获取工具定义列表
   * @param enabled 启用状态或启用的工具名称列表
   * @param context 上下文信息（session_id, user_id, session_type 等）
   * @returns 工具定义数组
   */
  getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]>;
  /**
   * 执行工具调用
   * @param request 工具调用请求
   * @param context 上下文信息（session_id, user_id, session_type 等）
   * @param abortSignal 中断信号（可选），用于客户端断开时中止长时间运行的工具
   * @returns 工具执行结果内容字符串
   * @throws Error 如果执行失败，抛出异常由 ToolOrchestrator 捕获
   */
  execute(request: ToolCallRequest, context?: Record<string, any>, abortSignal?: AbortSignal): Promise<string>;
  /**
   * 获取工具的完整提示词（包含工具说明和使用指南）
   * @param context 上下文信息
   * @returns 工具提示词字符串
   */
  getPrompt(context?: Record<string, any>): Promise<string>;
  /**
   * 获取需要持续注入的提示词内容（如记忆内容、动态上下文等）
   * 这部分内容会始终注入到 System Prompt 中，不受 loadMode 影响
   * @param context 上下文信息
   * @returns 持续注入的提示词字符串，如不需要则返回空字符串
   */
  getPersistentPrompt?(context?: Record<string, any>): Promise<string>;
  /**
   * 获取提供者的元数据信息
   * @param context 上下文信息
   * @returns 提供者元数据
   */
  getMetadata(context?: Record<string, any>): ToolProviderMetadata;
  /**
   * 获取工具的简要说明（用于 system prompt 中的元信息展示）
   * @param context 上下文信息
   * @returns 简短的工具类别描述
   */
  getBriefDescription?(context?: Record<string, any>): Promise<string>;
  /**
   * 生成工具调用的展示文案（在 LLM 输出参数后立即调用）
   * @param toolName 工具名称（不含命名空间前缀）
   * @param args 工具参数（可能不完整，流式累积中）
   * @param isStreaming 是否处于流式状态
   * @returns 结构化的展示信息或自然语言字符串（向后兼容）
   */
  formatDisplayMessage?(toolName: string, args: Record<string, any>, isStreaming: boolean): ToolDisplayInfo | string;
}
