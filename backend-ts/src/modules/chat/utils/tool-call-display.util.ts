import { Injectable, Logger } from "@nestjs/common";
import { ToolOrchestrator } from "../../tools/tool-orchestrator.service";
import { ToolDisplayInfo } from "../../tools/interfaces/tool-provider.interface";
import { partialParse } from "partial-json-parser";

/**
 * 工具调用展示文案工具类
 *
 * 负责管理流式工具调用的展示文案生成。
 * 文案会直接注入到 toolCalls 的 metadata 中，随 MessageContent 一起持久化。
 */
@Injectable()
export class ToolCallDisplayUtil {
  private readonly logger = new Logger(ToolCallDisplayUtil.name);

  // 存储每个工具调用的状态（仅用于流式阶段）
  private states = new Map<
    number,
    {
      displayInfo: ToolDisplayInfo; // 结构化的展示信息
    }
  >();

  constructor(private toolOrchestrator: ToolOrchestrator) {}

  /**
   * 初始化工具调用状态（收到第一个 chunk 时）
   */
  initialize(index: number, toolId: string, toolName: string): void {
    const displayInfo = this.toolOrchestrator.generateDisplayMessage(
      { id: toolId, name: toolName, arguments: {} },
      true,
    );

    this.states.set(index, {
      displayInfo: displayInfo,
    });

    this.logger.log(`[ToolCall #${index}] Initialized: ${displayInfo.action}`);
  }

  /**
   * 从流式 chunk 更新文案
   * @param accumulatedArgs 外部已累积的完整参数字符串
   * @returns 是否需要更新文案
   */
  updateFromChunk(
    index: number,
    toolName: string,
    accumulatedArgs: string,
  ): boolean {
    const state = this.states.get(index);
    if (!state) return false;

    const updated = this.tryUpdateDisplayMessage(
      index,
      toolName,
      accumulatedArgs,
      state,
    );

    if (updated) {
      this.logger.log(
        `[ToolCall #${index}] Updated: ${state.displayInfo.action}`,
      );
    }

    return updated;
  }

  /**
   * 获取当前展示信息（流式阶段使用）
   */
  getDisplayMessage(index: number): ToolDisplayInfo | undefined {
    return this.states.get(index)?.displayInfo;
  }

  /**
   * 获取所有工具调用的完成状态文案（工具执行完成后使用）
   * 同时更新内部状态为完成状态的文案
   */
  finalizeAll(toolCalls: any[]): ToolDisplayInfo[] {
    return toolCalls.map((tc, index) => {
      const state = this.states.get(index);

      // 从 arguments 重新生成完成状态的文案（isStreaming = false）
      const parsedArgs = this.safeJsonParse(tc.arguments);
      const completedInfo = this.toolOrchestrator.generateDisplayMessage(
        { id: tc.id, name: tc.name, arguments: parsedArgs },
        false, // isStreaming = false，生成"已..."状态
      );

      // 更新内部状态为完成状态的文案
      if (state) {
        state.displayInfo = completedInfo;
      }

      // 同时更新 toolCall 的 metadata（如果存在）
      if (tc.metadata) {
        tc.metadata.displayMessage = completedInfo;
      }

      // 返回完整的 ToolDisplayInfo 对象
      return completedInfo;
    });
  }

  /**
   * 将文案注入到 toolCalls 的 metadata 中（持久化前调用）
   */
  injectDisplayMessages(toolCalls: any[]): void {
    toolCalls.forEach((tc, index) => {
      const state = this.states.get(index);
      if (state && state.displayInfo) {
        // 确保 metadata 存在
        if (!tc.metadata) {
          tc.metadata = {};
        }
        // 保存结构化的展示信息到 metadata
        tc.metadata.displayMessage = state.displayInfo;

        this.logger.debug(
          `[ToolCall #${index}] Saved displayInfo to metadata: ${JSON.stringify(state.displayInfo)}`,
        );
      }
    });
  }

  /**
   * 清理所有状态
   */
  clear(): void {
    this.states.clear();
  }

  // ==================== 私有方法 ====================

  private tryUpdateDisplayMessage(
    index: number,
    toolName: string,
    accumulatedArgs: string,
    state: any,
  ): boolean {
    if (!accumulatedArgs || accumulatedArgs.trim().length === 0) {
      return false;
    }

    try {
      // 使用 partial-json-parser 解析不完整的 JSON
      const parsed = partialParse(accumulatedArgs);

      if (!parsed || typeof parsed !== "object") {
        return false;
      }

      let actualToolName = toolName;
      let extractedParams: Record<string, any> = {};

      if (toolName === "tool_call") {
        // tool_call 特殊处理：从解析结果中提取 tool_name 和 arguments
        if (parsed.tool_name) {
          actualToolName = parsed.tool_name;
        }

        if (parsed.arguments && typeof parsed.arguments === "object") {
          extractedParams = parsed.arguments;
        }
      } else {
        // 普通工具：直接使用解析后的参数
        extractedParams = parsed;
      }

      // 只要有有效参数就更新展示文案
      if (
        Object.keys(extractedParams).length > 0 ||
        actualToolName !== toolName
      ) {
        const request = {
          id: "",
          name: actualToolName,
          arguments: extractedParams,
        };
        state.displayInfo = this.toolOrchestrator.generateDisplayMessage(
          request,
          true,
        );
        return true;
      }
    } catch (error) {
      // 解析失败时静默忽略，等待更多数据
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.debug(`JSON 解析失败（等待更多数据）: ${errorMessage}`);
    }

    return false;
  }

  private safeJsonParse(jsonString: string): any {
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
