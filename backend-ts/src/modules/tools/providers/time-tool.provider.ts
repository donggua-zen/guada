import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolCallResponse,
  ToolProviderMetadata,
} from "../interfaces/tool-provider.interface";

@Injectable()
export class TimeToolProvider implements IToolProvider {
  private readonly logger = new Logger(TimeToolProvider.name);
  public readonly namespace = "time";

  constructor() { }

  async getTools(enabled?: boolean | string[], context?: Record<string, any>): Promise<any[]> {
    return [];
  }

  async execute(request: ToolCallRequest, context?: Record<string, any>): Promise<string> {
    throw new Error("时间工具仅用于提示词注入，不支持直接调用");
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    try {
      const now = new Date();
      const currentTime = now.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour12: false,
      });

      const promptParts: string[] = [];

      promptParts.push("【当前时间信息】");
      promptParts.push(`当前时间是：${currentTime}`);
      promptParts.push("");
      promptParts.push(
        "请注意：在与用户对话时，如果需要提及时间相关信息，请使用上述提供的准确时间。",
      );
      promptParts.push(
        '例如：当用户询问"现在几点了？"或"今天是什么日期？"时，请基于以上时间信息作答。',
      );

      return promptParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取时间提示词失败：${error.message}`);
      return "";
    }
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "自动注入当前时间信息，帮助 AI 准确回答时间相关问题";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "时间工具",
      description: "自动注入当前时间信息",
      isMcp: false,
      loadMode: "eager",
    };
  }
}
