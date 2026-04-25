import { Injectable, Logger } from "@nestjs/common";
import { MessageRecord } from "../llm-core/types/llm.types";

/**
 * 清理策略类型
 */
export type CleaningStrategy = "aggressive" | "moderate" | "conservative";

/**
 * 工具结果清理器服务
 * 
 * 负责在会话压缩前识别并精简工具调用结果,减少 Token 占用。
 * 采用分级策略:
 * - Level 0 (激进): 完全移除可再生工具的结果,仅保留引用标识
 * - Level 1 (中等): 智能精简冗长工具结果,提取关键信息
 * - Level 2 (保守): 保留原样,仅做最小化处理
 */
@Injectable()
export class ToolResultCleaner {
  private readonly logger = new Logger(ToolResultCleaner.name);

  /**
   * 识别并精简工具调用结果
   * @param messages 待处理的消息列表
   * @param strategy 清理策略配置
   * @param protectedMessageIds 需要保护不被清理的消息 ID 列表（通常是每个逻辑轮次的最后一条消息）
   * @returns 清理后的消息列表
   */
  cleanToolResults(
    messages: MessageRecord[],
    strategy: CleaningStrategy = "moderate",
    protectedMessageIds?: Set<string>,
  ): MessageRecord[] {
    this.logger.debug(
      `Cleaning tool results with strategy: ${strategy}, total messages: ${messages.length}`,
    );

    return messages.map((msg) => {
      // 如果消息在保护列表中，则跳过清理
      if (protectedMessageIds && msg.id && protectedMessageIds.has(msg.id)) {
        return msg;
      }

      // 只处理 tool 角色的消息
      if (msg.role !== "tool") {
        return msg;
      }

      const toolName = msg.name || "";
      const content = typeof msg.content === "string" ? msg.content : "";

      let cleanedMsg: MessageRecord;

      switch (strategy) {
        case "aggressive":
          // 激进策略: 对可再生工具和冗长工具都进行清理
          if (this.isRegenerableTool(toolName)) {
            cleanedMsg = this.createMinimalToolReference(msg);
          } else if (this.isVerboseTool(content)) {
            cleanedMsg = this.summarizeToolResult(msg, 100);
          } else {
            cleanedMsg = msg;
          }
          break;

        case "moderate":
          // 中等策略: 仅清理可再生工具,精简超长内容
          if (this.isRegenerableTool(toolName)) {
            cleanedMsg = this.createMinimalToolReference(msg);
          } else if (content.length > 2000) {
            cleanedMsg = this.summarizeToolResult(msg, 500);
          } else {
            cleanedMsg = msg;
          }
          break;

        case "conservative":
          // 保守策略: 仅对极长内容进行截断
          if (content.length > 5000) {
            cleanedMsg = this.summarizeToolResult(msg, 1000);
          } else {
            cleanedMsg = msg;
          }
          break;

        default:
          cleanedMsg = msg;
      }

      return cleanedMsg;
    });
  }

  /**
   * 判断是否为可再生工具(结果可以重新获取)
   */
  private isRegenerableTool(toolName: string): boolean {
    // 知识库检索、联网搜索等可重新执行的工具
    const regenerablePatterns = [
      "knowledge_base",
      "kb_search",
      "web_search",
      "search",
      "fetch_url",
      "retrieve",
    ];

    return regenerablePatterns.some((pattern) =>
      toolName.toLowerCase().includes(pattern),
    );
  }

  /**
   * 判断内容是否过于冗长
   */
  private isVerboseTool(content: string): boolean {
    return content.length > 1000;
  }

  /**
   * 创建最小化的工具引用(Level 0 清理)
   * 适用于可再生的工具结果,直接丢弃原始数据
   */
  private createMinimalToolReference(
    originalMsg: MessageRecord,
  ): MessageRecord {
    const toolName = originalMsg.name || "unknown_tool";

    return {
      ...originalMsg,
      content: `[工具调用已精简: ${toolName}]`,
      metadata: {
        ...originalMsg.metadata,
        originalContentLength:
          typeof originalMsg.content === "string"
            ? originalMsg.content.length
            : 0,
        cleanedAt: new Date().toISOString(),
        cleaningLevel: "minimal",
        toolName: toolName,
      },
    };
  }

  /**
   * 智能精简工具结果(Level 1 清理)
   * 提取关键信息生成简短摘要
   */
  private summarizeToolResult(
    msg: MessageRecord,
    maxLength: number,
  ): MessageRecord {
    const content = typeof msg.content === "string" ? msg.content : "";

    if (content.length <= maxLength) {
      return msg;
    }

    // 优化启发式：尝试提取 JSON 中的关键字段或保留开头和结尾的关键部分
    let truncated: string;
    try {
      // 简单尝试解析 JSON，如果成功则只保留前几个键值对
      const jsonContent = JSON.parse(content);
      if (typeof jsonContent === "object" && jsonContent !== null) {
        const keys = Object.keys(jsonContent);
        const summaryObj: any = {};
        keys.slice(0, 3).forEach(key => summaryObj[key] = jsonContent[key]);
        truncated = JSON.stringify(summaryObj);
        if (truncated.length > maxLength) {
          truncated = truncated.substring(0, maxLength);
        }
      } else {
        truncated = content.substring(0, maxLength);
      }
    } catch {
      // 非 JSON 内容直接截断
      truncated = content.substring(0, maxLength);
    }

    const omittedLength = content.length - truncated.length;

    return {
      ...msg,
      content: `${truncated}...[省略 ${omittedLength} 字符]`,
      metadata: {
        ...msg.metadata,
        summarized: true,
        originalLength: content.length,
        truncatedLength: truncated.length,
        cleanedAt: new Date().toISOString(),
        cleaningLevel: "summarized",
      },
    };
  }
}
