import { Injectable } from "@nestjs/common";
import { PluginBase } from "../base-plugin";
import { PluginContext } from "../types/plugin.types";
import { PluginApi } from "../api/plugin-api";
import { z } from "zod";

@Injectable()
export class TimePlugin extends PluginBase {
  manifest = {
    id: "time",
    name: "时间工具",
    description: "获取当前详细时间信息，包括日期、星期、时间、时区等",
    version: "1.0.0",
    category: "core" as const,
  };

  async onLoad(api: PluginApi) {
    const timeKit = api.registerToolKit({
      id: "time",
      name: "Time Tools",
      activator: "Get current detailed time information, including date, day of week, time, timezone, etc.",
    });
    timeKit.registerTool({
      name: "get_current_time",
      description:
        "获取当前详细时间信息，包括日期、星期、时间、时区等。当用户询问当前时间、日期、星期几或时区信息时使用此工具。",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            "时区名称，例如 'Asia/Shanghai'、'UTC'、'America/New_York'。默认为系统本地时区",
          ),
        format: z
          .enum(["iso", "locale", "full"])
          .optional()
          .describe(
            "时间格式：iso=ISO 8601 格式、locale=本地化格式、full=完整详细信息。默认 full",
          ),
      }),
      execute: async (args) => {
        try {
          return this.getTimeString(args);
        } catch (error: any) {
          throw new Error(`获取时间信息失败：${error.message}`);
        }
      },
      display: { action: "获取当前时间", icon: "time" },
    });

    api.registerPrompt({
      frequency: "STATIC",
      description: "当前时间信息（自动注入）",
      content: () => this.getCurrentTimeString(),
    });
  }

  private getTimeString(args: { timezone?: string; format?: string }): string {
    const timezone = args.timezone;
    const format = args.format || "full";
    const now = new Date();
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

    let timezoneOffset = "";
    try {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        timeZoneName: "longOffset",
      }).formatToParts(now);
      const off = parts.find((p) => p.type === "timeZoneName");
      timezoneOffset = off ? off.value : "";
    } catch {
      timezoneOffset = "无法获取时区偏移";
    }

    if (format === "iso") return now.toISOString();
    if (format === "locale") return now.toLocaleString("zh-CN", localeOptions);

    const weekdays = [
      "星期日",
      "星期一",
      "星期二",
      "星期三",
      "星期四",
      "星期五",
      "星期六",
    ];
    return [
      "【当前详细时间信息】",
      `日期：${now.toLocaleDateString("zh-CN", { timeZone: timezone })}`,
      `星期：${weekdays[now.getDay()]}`,
      `时间：${now.toLocaleTimeString("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`,
      `时区：${timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      `时区偏移：${timezoneOffset}`,
      `时间戳：${now.getTime()}`,
      `ISO 格式：${now.toISOString()}`,
    ].join("\n");
  }

  private getCurrentTimeString(): string {
    const now = new Date();
    const currentTime = now.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
    });
    return [
      "# Current Time",
      currentTime,
      "",
      "When interacting with the user, use the accurate time provided above if you need to mention time-related information.",
      "You can also call the `get_current_time` tool for detailed information.",
    ].join("\n");
  }
}
