export interface ToolParamSchema {
  type: string;
  description?: string;
  enum?: any[];
  default?: any;
  properties?: Record<string, ToolParamSchema>;
  required?: string[];
}

export interface SimpleToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParamSchema>;
    required?: string[];
  };
}

/**
 * 将简化的工具定义转换为 OpenAI 兼容的格式
 * @param namespace 命名空间，用于生成带前缀的工具名称
 * @param tool 简化的工具定义对象
 */
export function buildOpenAITool(namespace: string, tool: SimpleToolDef): any {
  return {
    type: 'function',
    function: {
      name: `${namespace}__${tool.name}`,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
