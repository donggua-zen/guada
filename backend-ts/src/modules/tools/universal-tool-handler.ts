import { Logger } from "@nestjs/common";
import { ToolCallRequest, ToolCallResponse, IToolProvider } from "./interfaces/tool-provider.interface";
import { ToolContext, ProviderConfig } from "./tool-context";

/**
 * 通用工具定义
 */
export const UNIVERSAL_TOOLS = [
  {
    name: "tool_load",
    description: "加载指定工具命名空间的详细说明，获取该类别下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
    parameters: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description: "工具命名空间，例如：knowledge_base、memory、shell 等",
        },
      },
      required: ["namespace"],
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
          description: "完整的工具名称，格式为：namespace__tool_name，例如：knowledge_base__search",
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
    context: ToolContext,
    getProvider: (namespace: string) => IToolProvider | undefined,
    getProviderConfig: (namespace: string) => ProviderConfig | undefined
  ): Promise<ToolCallResponse> {
    const { namespace } = request.arguments;
  
    if (!namespace || typeof namespace !== "string") {
      return {
        toolCallId: request.id,
        name: request.name,
        content: "Error: 无效的参数：namespace 必须是字符串",
        isError: true,
      };
    }
  
    const provider = getProvider(namespace);
    if (!provider) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 未知的命名空间: ${namespace}`,
        isError: true,
      };
    }

    const providerConfig = getProviderConfig(namespace);
    if (!providerConfig) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 未找到命名空间 ${namespace} 的配置`,
        isError: true,
      };
    }
    if (providerConfig.enabledTools === false) {
      return {
        toolCallId: request.id,
        name: request.name,
        content: `Error: 工具提供者 ${namespace} 已禁用`,
        isError: true,
      };
    }

    try {
      // 根据配置获取可用的工具
      const tools = await provider.getTools(providerConfig.enabledTools, context.injectParams);
    
      // 构建详细的工具说明
      const toolDescriptions = tools.map((tool: any) => {
        const fullName = `${namespace}__${tool.name}`;
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
          `### ${fullName}`,
          `**功能**: ${tool.description}`,
          `**参数**:\n${paramList}`,
          "",
        ].join("\n");
      }).join("\n");
    
      // 获取工具使用说明（如果提供者实现了 getPrompt）
      let toolUsagePrompt = "";
      try {
        toolUsagePrompt = await provider.getPrompt(context.injectParams);
      } catch (error: any) {
        this.logger.warn(`Failed to get prompt for namespace ${namespace}: ${error.message}`);
      }
    
      const responseParts: string[] = [
        `# ${namespace} 工具集详细说明`,
        "",
        `该命名空间包含以下 ${tools.length} 个工具：`,
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
        "直接调用工具，格式为：`namespace__tool_name`,或者使用`tool_call`间接调用",
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
  parseToolCall(request: ToolCallRequest): { namespace: string; coreName: string; toolArgs: any } {
    const { tool_name, arguments: toolArgs } = request.arguments;

    if (!tool_name || typeof tool_name !== "string") {
      throw new Error("无效的参数：tool_name 必须是字符串");
    }

    if (!toolArgs || typeof toolArgs !== "object") {
      throw new Error("无效的参数：arguments 必须是对象");
    }

    // 解析工具名称
    const parts = tool_name.split("__");
    if (parts.length < 2) {
      throw new Error(`无效的工具名称格式: ${tool_name}，应为 namespace__tool_name`);
    }

    const namespace = parts[0];
    const coreName = parts.slice(1).join("__");

    return { namespace, coreName, toolArgs };
  }
}
