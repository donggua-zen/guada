import { Logger } from "@nestjs/common";
import { ToolCallRequest, ToolCallResponse, IToolProvider, ToolDefinition, ProviderContext } from "./interfaces/tool-provider.interface";

/**
 * 通用工具定义
 */
export const UNIVERSAL_TOOLS: ToolDefinition[] = [
  {
    name: "tool_load",
    description: "加载指定工具集的详细说明，获取该工具集下所有工具的参数定义和使用示例。在首次使用某类工具前，建议先调用此工具了解使用方法。",
    parameters: {
      type: "object",
      properties: {
        toolSet: {
          type: "string",
          description: "工具集名称，例如：subagent、browser、session 等",
        },
      },
      required: ["toolSet"],
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
