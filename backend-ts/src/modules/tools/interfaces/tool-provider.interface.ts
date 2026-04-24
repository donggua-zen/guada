export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  toolCallId: string;
  role: "tool";
  name: string;
  content: string;
  isError?: boolean;
}

export interface ToolProviderMetadata {
  namespace: string;
  displayName: string;
  description: string;
  isMcp: boolean;
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
  getPrompt(context?: Record<string, any>): Promise<string>;
  getMetadata(): ToolProviderMetadata;
}
