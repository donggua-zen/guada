import { ToolDisplayInfo, ToolCallRequest } from "../../tools/interfaces/tool-provider.interface";
import { ToolHandlerDef } from "../types/plugin.types";
import { PluginRegistry } from "../registry/plugin-registry";

/**
 * 生成工具调用的展示信息（静态配置）
 * 后端只返回语义结构，前端负责生成展示文案
 */
export function generateDisplayMessage(
  request: ToolCallRequest,
  isExecuting: boolean = true,
): ToolDisplayInfo {
  try {
    // 递归解析 tool_call 包装
    if (request.name === "tool_call" && request.arguments?.tool_name) {
      return generateDisplayMessage(
        { id: request.id, name: request.arguments.tool_name, arguments: request.arguments.arguments || {} },
        isExecuting,
      );
    }
    if (request.name === "tool_call") {
      return { actionType: "tool_call", toolType: "generic", toolName: request.name };
    }
    if (request.name === "tool_load") {
      return { actionType: "tool_load", toolType: "generic", toolName: request.name };
    }

    // 从 PluginRegistry 查找工具定义，提取 display 配置
    const toolEntry: ToolHandlerDef | undefined = PluginRegistry.findToolByName(request.name);
    if (toolEntry) {
      return {
        actionType: toolEntry.actionType || request.name,
        toolType: toolEntry.icon || "generic",
        argsKey: toolEntry.argsKey,
        toolName: request.name,
      };
    }

    // 通用降级
    return { actionType: request.name, toolType: "generic", toolName: request.name };
  } catch {
    return { actionType: "generic", toolType: "generic", toolName: request.name };
  }
}
