export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolCallResponse {
  toolCallId: string;
  role: 'tool';
  name: string;
  content: string;
  isError?: boolean;
}

export interface IToolProvider {
  namespace: string;
  getToolsNamespaced(enabledIds?: string[] | boolean): Promise<any[]>;
  executeWithNamespace(request: ToolCallRequest, injectParams?: Record<string, any>): Promise<ToolCallResponse>;
  getPrompt(injectParams?: Record<string, any>): Promise<string>;
}
