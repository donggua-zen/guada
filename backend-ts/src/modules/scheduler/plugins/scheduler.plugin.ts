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
      name: "Scheduled Tasks",
      loadMode: "lazy",
      activator:
        "Scheduled task management tool for creating, viewing, and deleting scheduled tasks. Use this tool when you need to automatically execute a task at a specified time.",
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
      display: { actionType: "scheduler_create", argsKey: "name", icon: "time" },
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
      display: { actionType: "scheduler_list", icon: "time" },
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
      display: { actionType: "scheduler_delete", icon: "time" },
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
      display: { actionType: "scheduler_toggle", icon: "time" },
    });

    schedKit.registerPrompt({
      frequency: "REGULAR",
      description: "定时任务工具使用说明",
      content: [
        "# Scheduled Task Tool Instructions",
        "",
        "You can use these tools to help users create and manage scheduled tasks. Tasks will automatically send the prompt as a user message to the current conversation at the specified time. The scheduler itself does not automatically retrieve execution results — it only sends the prompt. You can think of it as an \"alarm clock\".",
        "",
        "## Example Scenarios",
        "",
        "- User says 'Send me a news summary every morning at 9 AM' → use scheduler_create_task to create a cron task",
        "- User says 'Remind me about the meeting in one hour' → use scheduler_create_task to create a once task",
        "- User says 'Show me all my scheduled tasks' → use scheduler_list_tasks",
        "- User says 'Delete that morning news task' → use scheduler_delete_task",
        "",
        "## Common Cron Expressions",
        "",
        "| Requirement | Expression |",
        "|------|--------|",
        "| Every minute | `* * * * *` |",
        "| Every hour | `0 * * * *` |",
        "| Daily at 9 AM | `0 9 * * *` |",
        "| Every Monday at 9 AM | `0 9 * * 1` |",
        "| 1st of each month at midnight | `0 0 1 * *` |",
        "",
        "## Important Reminders",
        "",
        "1. Tasks are automatically injected into the current session for execution — no session ID is required",
        "2. Tasks take effect immediately after creation and will trigger automatically at the set time",
        "3. It is recommended to set a reasonable task name for the user to facilitate future management",
      ].join("\n"),
    });
  }
}
