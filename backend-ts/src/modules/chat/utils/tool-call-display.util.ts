import { Injectable, Logger } from "@nestjs/common";
import { ToolDisplayInfo } from "../../tools/interfaces/tool-provider.interface";
import { generateDisplayMessage } from "../../plugins/utils/display-formatter";
import { partialParse } from "partial-json-parser";

@Injectable()
export class ToolCallDisplayUtil {
  private readonly logger = new Logger(ToolCallDisplayUtil.name);

  format(
    toolName: string,
    args: string | Record<string, any>,
    isExecuting: boolean = true,
  ): ToolDisplayInfo {

    let actualToolName = toolName;
    let extractedParams: Record<string, any> = {};

    if (typeof args === "string" && args.trim().length > 0) {
      try {
        const parsed = partialParse(args);
        if (parsed && typeof parsed === "object") {
          if (toolName === "tool_use") {
            if (parsed.tool_name) actualToolName = parsed.tool_name;
            if (parsed.arguments && typeof parsed.arguments === "object") extractedParams = parsed.arguments;
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

    return generateDisplayMessage(
      { id: "", name: actualToolName, arguments: extractedParams },
      isExecuting,
    );
  }

  safeJsonParse(jsonString: string): any {
    if (!jsonString || typeof jsonString !== "string") return {};
    try { return JSON.parse(jsonString) || {}; }
    catch { return { _raw_arguments: jsonString }; }
  }
}
