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

    // 解包 tool_use：提取实际工具名
    if (typeof args === "string" && args.trim().length > 0) {
      try {
        const parsed = partialParse(args);
        if (parsed && typeof parsed === "object") {
          if (toolName === "tool_use" && parsed.tool_name) {
            actualToolName = parsed.tool_name;
          }
        }
      } catch (error) {
        this.logger.debug(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return generateDisplayMessage(
      { id: "", name: actualToolName, arguments: {} },
      isExecuting,
    );
  }

  safeJsonParse(jsonString: string): any {
    if (!jsonString || typeof jsonString !== "string") return {};
    try { return JSON.parse(jsonString) || {}; }
    catch { return { _raw_arguments: jsonString }; }
  }
}
