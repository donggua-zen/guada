import { ToolDisplayInfo, ToolCallRequest } from "../../tools/interfaces/tool-provider.interface";
import { ToolRuntime } from "../../tools/tool-context";
import { ToolHandlerDef } from "../types/plugin.types";

/**
 * 生成工具调用的展示文案
 * 独立于 ToolOrchestrator，可在任何地方使用
 */
export function generateDisplayMessage(
  request: ToolCallRequest,
  isExecuting: boolean = true,
  runtime?: ToolRuntime,
  toolEntry?: ToolHandlerDef,
): ToolDisplayInfo {
  try {
    // 递归解析 tool_call 包装
    if (request.name === "tool_call" && request.arguments?.tool_name) {
      return generateDisplayMessage(
        { id: request.id, name: request.arguments.tool_name, arguments: request.arguments.arguments || {} },
        isExecuting,
        runtime,
      );
    }
    if (request.name === "tool_call") {
      return { action: isExecuting ? "正在调用工具" : "已调用工具", args: request.arguments?.pluginId, toolName: request.name, toolType: "generic" };
    }
    if (request.name === "tool_load") {
      return { action: isExecuting ? "正在加载工具" : "已加载工具", args: request.arguments?.pluginId, toolName: request.name, toolType: "generic" };
    }

    // 从 @Tool 装饰器的 action/argsKey/icon 生成
    if (toolEntry?.action) {
      const prefix = isExecuting ? "正在" : "已";
      let argsSummary: string | undefined;
      if (toolEntry.argsKey && request.arguments?.[toolEntry.argsKey]) {
        const val = request.arguments[toolEntry.argsKey];
        argsSummary = typeof val === "string" ? (val.length > 60 ? val.substring(0, 60) + "..." : val) : String(val);
      } else if (request.arguments && typeof request.arguments === "object") {
        for (const value of Object.values(request.arguments)) {
          if (typeof value === "string" && value.length > 0) {
            argsSummary = value.includes("/") || value.includes("\\") ? value.split(/[\/\\]/).pop() || value : value;
            break;
          }
        }
      }
      return {
        action: `${prefix}${toolEntry.action}`,
        args: argsSummary,
        toolName: request.name,
        toolType: toolEntry.icon || "generic",
      };
    }

    // 自定义展示文案（旧式方法级）
    if (toolEntry?.formatDisplayMessage) {
      const customAction = toolEntry.formatDisplayMessage(request.arguments, isExecuting);
      return { action: customAction, toolName: request.name, toolType: toolEntry.icon || "generic" };
    }

    // 通用降级
    return generateGenericDisplayInfo(request.name, request.arguments, isExecuting);
  } catch {
    return { action: isExecuting ? "正在调用工具" : "已调用工具", toolName: request.name, toolType: "generic" };
  }
}

function generateGenericDisplayInfo(toolName: string, args: Record<string, any>, isExecuting: boolean): ToolDisplayInfo {
  const readableName = toolName.split("__").pop()?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || toolName;
  let argsSummary: string | undefined;
  if (args && typeof args === "object") {
    for (const value of Object.values(args)) {
      if (typeof value === "string" && value.length > 0) {
        argsSummary = value.includes("/") || value.includes("\\") ? value.split(/[\/\\]/).pop() || value : value;
        break;
      }
    }
  }
  return { action: `${readableName}`, args: argsSummary, toolName, toolType: "generic" };
}
