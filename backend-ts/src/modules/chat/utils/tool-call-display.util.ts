import { Injectable, Logger } from "@nestjs/common";
import { ToolOrchestrator } from "../../tools/tool-orchestrator.service";
import { ToolDisplayInfo } from "../../tools/interfaces/tool-provider.interface";
import { ToolRuntime } from "../../tools/tool-context";
import { partialParse } from "partial-json-parser";

/**
 * 工具调用展示文案工具类
 *
 * 纯函数式格式化，无状态管理。
 * 所有文案生成在调用时直接计算，不维护内部状态。
 */
@Injectable()
export class ToolCallDisplayUtil {
  private readonly logger = new Logger(ToolCallDisplayUtil.name);

  constructor(private toolOrchestrator: ToolOrchestrator) {}

  /**
   * 格式化工具调用的展示文案
   *
   * 纯函数，无状态，每次调用直接计算。
   * 支持不完整 JSON 参数解析（partial-json-parser）。
   *
   * @param toolName 工具名
   * @param args 工具参数字符串（JSON 格式，可能不完整）
   * @param isExecuting 工具是否正在执行（true=正在进行，false=已完成）
   * @param runtime 工具运行时上下文（可选，用于解析 namespace）
   * @returns 结构化的展示信息
   */
  format(
    toolName: string,
    args: string | Record<string, any>,
    isExecuting: boolean = true,
    runtime?: ToolRuntime,
  ): ToolDisplayInfo {
    let actualToolName = toolName;
    let extractedParams: Record<string, any> = {};

    if (typeof args === "string" && args.trim().length > 0) {
      try {
        const parsed = partialParse(args);
        if (parsed && typeof parsed === "object") {
          if (toolName === "tool_call") {
            if (parsed.tool_name) {
              actualToolName = parsed.tool_name;
            }
            if (parsed.arguments && typeof parsed.arguments === "object") {
              extractedParams = parsed.arguments;
            }
          } else {
            extractedParams = parsed;
          }
        }
      } catch (error) {
        this.logger.debug(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (typeof args === "object" && args !== null) {
      extractedParams = args;
    }

    return this.toolOrchestrator.generateDisplayMessage(
      { id: "", name: actualToolName, arguments: extractedParams },
      isExecuting,
      runtime,
    );
  }

  /**
   * 安全解析 JSON 字符串
   */
  safeJsonParse(jsonString: string): any {
    if (!jsonString || typeof jsonString !== "string") {
      return {};
    }
    try {
      return JSON.parse(jsonString) || {};
    } catch {
      return { _raw_arguments: jsonString };
    }
  }
}
