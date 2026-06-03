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

  private readonly toolsConfig = [
    {
      name: "get_current_time",
      description:
        "获取当前详细时间信息，包括日期、星期、时间、时区等。当用户询问当前时间、日期、星期几或时区信息时使用此工具。",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "时区名称，例如 'Asia/Shanghai'、'UTC'。默认为系统本地时区。",
          },
          format: {
            type: "string",
            description:
              "时间格式，可选值为 'iso'（ISO 8601 格式）、'locale'（本地化格式）、'full'（完整详细信息）。默认为 'full'。",
            enum: ["iso", "locale", "full"],
          },
        },
        required: [],
      },
    },
  ];

  constructor() {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    // 如果是数组，只返回数组中指定的工具
    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter((tool) => enabled.includes(tool.name));
    }

    // true 或未指定：返回所有工具
    return this.toolsConfig;
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    if (request.name === "get_current_time") {
      return this.handleGetCurrentTime(request.arguments);
    }

    throw new Error(`未知工具：${request.name}`);
  }

  /**
   * 处理获取当前时间请求
   */
  private async handleGetCurrentTime(
    args: Record<string, any> = {},
  ): Promise<string> {
    try {
      const timezone = args.timezone as string | undefined;
      const format = (args.format as string | undefined) || "full";

      const now = new Date();

      // 构建时区选项
      const localeOptions: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      };

      // 获取时区偏移
      let timezoneOffset = "";
      try {
        const timeZoneName =
          timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formatter = new Intl.DateTimeFormat("zh-CN", {
          timeZone: timeZoneName,
          timeZoneName: "longOffset",
        });
        const parts = formatter.formatToParts(now);
        const offsetPart = parts.find((p) => p.type === "timeZoneName");
        timezoneOffset = offsetPart ? offsetPart.value : "";
      } catch {
        timezoneOffset = "无法获取时区偏移";
      }

      if (format === "iso") {
        return now.toISOString();
      }

      if (format === "locale") {
        return now.toLocaleString("zh-CN", localeOptions);
      }

      // full 格式：返回详细信息
      const weekdays = [
        "星期日",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
      ];
      const weekday = weekdays[now.getDay()];

      const dateStr = now.toLocaleDateString("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });

      const timeStr = now.toLocaleTimeString("zh-CN", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      const timeZoneName =
        timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const resultParts: string[] = [];
      resultParts.push("【当前详细时间信息】");
      resultParts.push(`日期：${dateStr}`);
      resultParts.push(`星期：${weekday}`);
      resultParts.push(`时间：${timeStr}`);
      resultParts.push(`时区：${timeZoneName}`);
      resultParts.push(`时区偏移：${timezoneOffset}`);
      resultParts.push(`时间戳：${now.getTime()}`);
      resultParts.push(`ISO 格式：${now.toISOString()}`);

      return resultParts.join("\n");
    } catch (error: any) {
      this.logger.error(`获取详细时间信息失败：${error.message}`);
      throw new Error(`获取时间信息失败：${error.message}`);
    }
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

      promptParts.push("# 当前时间信息");
      promptParts.push(`${currentTime}`);
      promptParts.push("");
      promptParts.push(
        "请注意：在与用户对话时，如果需要提及时间相关信息，请使用上述提供的准确时间。",
      );
      promptParts.push(
        '例如：当用户询问"现在几点了？"或"今天是什么日期？"时，请基于以上时间信息作答。',
      );
      promptParts.push("");
      promptParts.push(
        "此外，你还可以调用 `time__get_current_time` 工具获取更详细的时间信息（包括星期、时区、时间戳等）。",
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
      description: "自动注入当前时间信息，支持获取详细时间",
      isMcp: false,
      loadMode: "eager",
      type: "core",
    };
  }
}
