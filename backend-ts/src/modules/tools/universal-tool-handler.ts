import { Logger } from "@nestjs/common";
import { ToolCallRequest, ToolCallResponse, IToolProvider, ToolDefinition } from "./interfaces/tool-provider.interface";


/**
 * 通用工具定义
 */
export const UNIVERSAL_TOOLS: ToolDefinition[] = [
  {
    name: "tool_load",
    description: "加载指定工具插件的详细说明，获取该类别下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
    parameters: {
      type: "object",
      properties: {
        pluginId: {
          type: "string",
          description: "工具插件标识，例如：knowledge_base、memory、shell 等",
        },
      },
      required: ["pluginId"],
    },
  },
  {
    name: "tool_call",
    description: "调用任意工具。这是通用的工具调用接口，可以执行系统中所有已注册的工具。",
    parameters: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "完整的工具名称，由工具提供者保证全局唯一",
        },
        arguments: {
          type: "object",
          description: "工具调用的参数，根据具体工具的要求提供相应的参数对象",
        },
      },
      required: ["tool_name", "arguments"],
    },
  },
];

/**
 * 通用工具处理器
 * 
 * 负责处理 tool_load 和 tool_call 两个系统级通用工具。
 * 不作为标准的 IToolProvider 实现，而是由 ToolOrchestrator 直接调用。
 */
export class UniversalToolHandler {
  private readonly logger = new Logger(UniversalToolHandler.name);

  constructor() {}

  /**
   * 处理 tool_load 请求
   */
  async handleToolLoad(
    request: ToolCallRequest,
    injectParams: Record<string, any>,
    getProvider: (pluginId: string) => IToolProvider | undefined,
    isPluginEnabled: (pluginId: string) => boolean,
  ): Promise<ToolCallResponse> {
    const { pluginId } = request.arguments;

    if (!pluginId || typeof pluginId !== "string") {
      return {
        toolCallId: request.id,
        name: request.name,
        content: "Error: 无效的参数：pluginId 必须是字符串",
        isError: true,
      };
    }

    const provider = getProvider(pluginId);
    if (!provider) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 未知的插件: ${pluginId}`,
        isError: true,
      };
    }

    if (!isPluginEnabled(pluginId)) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 工具提供者 ${pluginId} 已禁用`,
        isError: true,
      };
    }

    try {
      // 获取该插件下的所有工具
      const tools = await provider.getTools(true, injectParams);
    
      // 构建详细的工具说明
      const toolDescriptions = tools.map((tool: any) => {
        const params = tool.parameters?.properties || {};
        const required = tool.parameters?.required || [];
    
        const paramList = Object.entries(params)
          .map(([key, value]: [string, any]) => {
            const isRequired = required.includes(key) ? "（必填）" : "（可选）";
            const defaultValue = value.default !== undefined ? ` 默认值: ${value.default}` : "";
            return `  - ${key}: ${value.description || "无描述"} ${isRequired}${defaultValue}`;
          })
          .join("\n");
    
        return [
          `### ${tool.name}`,
          `**功能**: ${tool.description}`,
          `**参数**:\n${paramList}`,
          "",
        ].join("\n");
      }).join("\n");
    
      // 获取工具使用说明（如果提供者实现了 getPrompt）
      let toolUsagePrompt = "";
      try {
        toolUsagePrompt = await provider.getPrompt(injectParams);
      } catch (error: any) {
        this.logger.warn(`Failed to get prompt for plugin ${pluginId}: ${error.message}`);
      }
    
      const responseParts: string[] = [
        `# ${pluginId} 工具集详细说明`,
        "",
        `该插件包含以下 ${tools.length} 个工具：`,
        "",
        toolDescriptions,
      ];
    
      // 如果有工具使用说明，添加到响应中
      if (toolUsagePrompt) {
        responseParts.push("---", "", toolUsagePrompt);
      }
    
      responseParts.push(
        "---",
        "",
        "**使用方式**:",
        "直接调用工具，格式为：`tool_name`，或者使用`tool_call`间接调用",
        "",
        "现在你可以根据上述说明调用相应的工具了。"
      );
    
      return {
        toolCallId: request.id,
        name: request.name,
        content: responseParts.join("\n"),
        isError: false,
      };
    } catch (error: any) {
      this.logger.error(`Error executing tool_load`, error);
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: ${error.message}`,
        isError: true,
      };
    }
  }

  /**
   * 处理 tool_call 请求（通用调用接口）
   * 注意：此方法现在只负责解析和验证，返回转换后的参数，由编排器统一执行
   */
  parseToolCall(request: ToolCallRequest): { fullToolName: string; toolArgs: any } {
    const { tool_name, arguments: toolArgs } = request.arguments;

    if (!tool_name || typeof tool_name !== "string") {
      throw new Error("无效的参数：tool_name 必须是字符串");
    }

    if (!toolArgs || typeof toolArgs !== "object") {
      throw new Error("无效的参数：arguments 必须是对象");
    }

    return { fullToolName: tool_name, toolArgs };
  }
}
