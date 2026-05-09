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
 * 工具加载模式
 */
export type ToolLoadMode = 'eager' | 'lazy';

export interface ToolProviderMetadata {
  namespace: string;
  displayName: string;
  description: string;
  isMcp: boolean;
  /**
   * 工具定义加载模式（控制是否在 LLM 的 tools 参数中提供）
   * - eager: 始终在 tools 参数中提供完整定义（默认）
   * - lazy: 不在 tools 参数中提供，通过 tool_load 获取详细说明后使用 tool_call 调用
   */
  loadMode?: ToolLoadMode;
}

export interface IToolProvider {
  namespace: string;
  getTools(enabled?: boolean | string[]): Promise<any[]>;
  /**
   * 执行工具调用
   * @param request 工具调用请求
   * @param context 上下文信息（session_id, user_id 等）
   * @returns 工具执行结果内容字符串
   * @throws Error 如果执行失败，抛出异常由 ToolOrchestrator 捕获
   */
  execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string>;
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
  getMetadata(): ToolProviderMetadata;
  /**
   * 获取工具的简要说明（用于 system prompt 中的元信息展示）
   * @returns 简短的工具类别描述
   */
  getBriefDescription?(): Promise<string>;
}
