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
  /** 工具执行结果状态，由 agent-engine 在执行后设置 */
  outcome?: "success" | "error" | "rejected";
  /** 工具返回的图片（base64），由 agent-engine 注入为隐藏 user 消息 */
  images?: import("../../plugins/api/plugin-api").ImageContent[];
}
