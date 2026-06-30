import { z } from "zod";
import { Logger, Injectable } from "@nestjs/common";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { SchedulerService } from "../scheduler.service";
import { PluginApi } from "../../plugins/api/plugin-api";

@Injectable()
export class SchedulerPlugin extends PluginBase {
  private readonly logger = new Logger(SchedulerPlugin.name);
  manifest = {
    id: "scheduler",
    name: "定时任务工具",
    description: "创建和管理定时任务",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private schedulerService: SchedulerService) {
    super();
  }

  async onLoad(api: PluginApi) {
    const schedKit = api.registerToolKit({
      id: "scheduler",
      name: "定时任务",
      loadMode: "lazy",
      activator:
        "定时任务管理工具，用于创建、查看、删除定时任务，当你需要在指定时间自动执行某项任务时，可以使用此工具",
    });

    schedKit.registerTool({
      name: "scheduler_create_task",
      description:
        "创建一个定时任务，让 AI 可以在指定时间自动执行提示词。定时器本身不会自动获得执行结果，仅仅是发送提示词，本质是一个「闹钟」。",
      inputSchema: z.object({
        name: z
          .string()
          .describe("任务名称，建议简短明确，如「每日早报」「开会提醒」"),
        prompt: z.string().describe("到达指定时间后发送的提示词内容"),
        schedule_type: z
          .enum(["cron", "once"])
          .describe("调度类型：cron=按cron表达式重复执行，once=一次性执行"),
        cron_expression: z
          .string()
          .optional()
          .describe(
            "cron 表达式，schedule_type 为 cron 时必填。示例：'0 9 * * *' 表示每天9点",
          ),
        execute_at: z
          .string()
          .optional()
          .describe(
            "执行时间，schedule_type 为 once 时必填。ISO 8601 格式，如 '2026-01-01T00:00:00Z'",
          ),
        max_executions: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("最大执行次数，不传则不限次数"),
        max_retries: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("失败重试次数，默认 0"),
        retry_interval: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("重试间隔（秒），默认 60"),
      }),
      execute: async (args, ctx) => {
        const userId = ctx?.session.userId;
        if (!userId) throw new Error("无法获取用户ID，无法创建定时任务");
        const sessionId = ctx?.session.sessionId;
        if (!sessionId) throw new Error("无法获取会话ID，无法创建定时任务");

        const scheduleType = args.schedule_type;
        if (!scheduleType || !["cron", "once"].includes(scheduleType)) {
          throw new Error("schedule_type 必须是 cron 或 once");
        }
        if (scheduleType === "cron" && !args.cron_expression) {
          throw new Error("cron 类型任务需要提供 cron_expression");
        }
        if (scheduleType === "once" && !args.execute_at) {
          throw new Error("once 类型任务需要提供 execute_at");
        }

        // AI 只能使用 existing_session 模式（注入当前会话）
        const dto = {
          name: args.name,
          prompt: args.prompt,
          scheduleType,
          cronExpression: args.cron_expression || "",
          executeAt: args.execute_at || null,
          targetMode: "existing_session" as const,
          targetSessionId: sessionId,
          maxExecutions: args.max_executions ?? null,
          maxRetries: args.max_retries ?? 0,
          retryInterval: args.retry_interval ?? 60,
          enabled: true,
        };

        const task = await this.schedulerService.createTask(userId, dto as any);
        return JSON.stringify({
          success: true,
          message: `定时任务 "${task.name}" 创建成功`,
          task: {
            id: task.id,
            name: task.name,
            nextRunAt: task.nextRunAt,
          },
        });
      },
      display: { action: "创建定时任务", argsKey: "name", icon: "time" },
    });

    schedKit.registerTool({
      name: "scheduler_list_tasks",
      description: "获取当前用户的所有定时任务列表",
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        const userId = ctx?.session.userId;
        if (!userId) throw new Error("无法获取用户ID");
        const tasks = await this.schedulerService.getTasks(userId);
        return JSON.stringify({
          total: tasks.length,
          items: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            prompt: t.prompt,
            scheduleType: t.scheduleType,
            cronExpression: t.cronExpression,
            executeAt: t.executeAt,
            enabled: t.enabled,
            executionCount: t.executionCount,
            maxExecutions: t.maxExecutions,
            lastRunAt: t.lastRunAt,
            nextRunAt: t.nextRunAt,
            createdAt: t.createdAt,
          })),
        });
      },
      display: { action: "列出定时任务", icon: "time" },
    });

    schedKit.registerTool({
      name: "scheduler_delete_task",
      description: "删除指定的定时任务",
      inputSchema: z.object({
        task_id: z.string().describe("要删除的定时任务 ID"),
      }),
      execute: async (args, ctx) => {
        const userId = ctx?.session.userId;
        if (!userId) throw new Error("无法获取用户ID");
        if (!args.task_id) throw new Error("需要提供 task_id");
        await this.schedulerService.deleteTask(args.task_id, userId);
        return JSON.stringify({ success: true, message: "任务已删除" });
      },
      display: { action: "删除定时任务", icon: "time" },
    });

    schedKit.registerTool({
      name: "scheduler_toggle_task",
      description: "启用或禁用指定的定时任务",
      inputSchema: z.object({
        task_id: z.string().describe("要启用或禁用的定时任务 ID"),
      }),
      execute: async (args, ctx) => {
        const userId = ctx?.session.userId;
        if (!userId) throw new Error("无法获取用户ID");
        if (!args.task_id) throw new Error("需要提供 task_id");
        const task = await this.schedulerService.toggleTask(
          args.task_id,
          userId,
        );
        return JSON.stringify({
          success: true,
          message: `任务已${task.enabled ? "启用" : "禁用"}`,
          task: {
            id: task.id,
            name: task.name,
            enabled: task.enabled,
          },
        });
      },
      display: { action: "切换定时任务状态", icon: "time" },
    });

    schedKit.registerPrompt({
      frequency: "REGULAR",
      description: "定时任务工具使用说明",
      content: [
        "# 定时任务工具使用说明",
        "",
        "你可以使用这些工具帮助用户创建和管理定时任务。任务会在指定时间自动将提示词以用户消息的形式发送到当前对话中。定时器本身不会自动获得执行结果，仅仅是发送提示词，你可以理解为其本质是一个「闹钟」。",
        "",
        "## 使用场景示例",
        "",
        "- 用户说'每天早上9点给我发一份新闻汇总' → 使用 scheduler_create_task 创建 cron 任务",
        "- 用户说'一小时后提醒我开会' → 使用 scheduler_create_task 创建 once 任务",
        "- 用户说'查看我所有的定时任务' → 使用 scheduler_list_tasks",
        "- 用户说'删除那个早报任务' → 使用 scheduler_delete_task",
        "",
        "## cron 表达式常用示例",
        "",
        "| 需求 | 表达式 |",
        "|------|--------|",
        "| 每分钟 | `* * * * *` |",
        "| 每小时 | `0 * * * *` |",
        "| 每天9点 | `0 9 * * *` |",
        "| 每周一9点 | `0 9 * * 1` |",
        "| 每月1日0点 | `0 0 1 * *` |",
        "",
        "## 重要提醒",
        "",
        "1. 创建的任务会自动注入到当前会话中执行，不需要指定会话ID",
        "2. 任务创建后会立即生效，到达设定时间自动触发",
        "3. 建议为用户设置合理的任务名称，方便后续管理",
      ].join("\n"),
    });
  }

  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isExecuting: boolean,
  ) {
    const prefix = isExecuting ? "正在" : "已";
    switch (toolName) {
      case "scheduler_create_task":
        return { action: `${prefix}创建定时任务`, args: args.name, toolName };
      case "scheduler_list_tasks":
        return { action: `${prefix}获取定时任务列表`, toolName };
      case "scheduler_delete_task":
        return {
          action: `${prefix}删除定时任务`,
          args: args.task_id,
          toolName,
        };
      case "scheduler_toggle_task":
        return {
          action: `${prefix}切换任务状态`,
          args: args.task_id,
          toolName,
        };
      default:
        return { action: `${prefix}执行定时任务操作`, toolName };
    }
  }
}
