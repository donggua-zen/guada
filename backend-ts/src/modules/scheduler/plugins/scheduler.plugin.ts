import { z } from "zod";
import { Logger, Injectable } from "@nestjs/common";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginContext } from "../../plugins/types/plugin.types";
import { SchedulerService } from "../scheduler.service";
import { PluginApi } from "../../plugins/api/plugin-api";
import type { UpdateTaskDto } from "../dto/update-task.dto";
import langZh from "./scheduler.lang.zh.json";
import langEn from "./scheduler.lang.en.json";

@Injectable()
export class SchedulerPlugin extends PluginBase {
  private readonly logger = new Logger(SchedulerPlugin.name);
  manifest = {
    id: "scheduler",
    name: "%scheduler.name%",
    description: "%scheduler.description%",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private schedulerService: SchedulerService) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    const schedKit = api.registerToolKit({
      id: "scheduler",
      name: "%scheduler.toolkitName%",
      description: "%scheduler.toolkitDescription%",
      loadMode: "lazy",
      activator:
        "Scheduled task management tool for creating, viewing, updating, and deleting scheduled tasks. Use this tool when you need to automatically execute a task at a specified time.",
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
        expires_at: z
          .string()
          .optional()
          .describe("到期时间 ISO 字符串，到期后自动暂停不再执行；不传则永不到期"),
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
          expiresAt: args.expires_at || null,
          maxRetries: args.max_retries ?? 0,
          retryInterval: args.retry_interval ?? 60,
          enabled: true,
        };

        const task = await this.schedulerService.createTask(dto as any);
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
      display: {
        actionType: "scheduler_create",
        text: { executing: "%scheduler_create_task.executing%", completed: "%scheduler_create_task.completed%" },
        aggregate: { executing: "%scheduler_create_task.aggregate.executing%", completed: "%scheduler_create_task.aggregate.completed%" },
        argsKey: "name",
        icon: "time",
      },
    });

    schedKit.registerTool({
      name: "scheduler_update_task",
      description:
        "修改一个已存在的定时任务。只传需要变更的字段，未传字段保持不变。修改调度时 schedule_type 与对应的 cron_expression/execute_at 需要一起传。",
      inputSchema: z.object({
        task_id: z.string().describe("要修改的定时任务 ID；不确定时先用 scheduler_list_tasks 查询"),
        name: z.string().optional().describe("新的任务名称"),
        prompt: z.string().optional().describe("新的提示词"),
        schedule_type: z
          .enum(["cron", "once"])
          .optional()
          .describe("新的调度类型：cron=重复执行，once=一次性执行"),
        cron_expression: z
          .string()
          .optional()
          .describe("新的 cron 表达式（schedule_type=cron 时必填），如 '0 9 * * *'"),
        execute_at: z
          .string()
          .optional()
          .describe("新的一次性执行时间（schedule_type=once 时必填），ISO 8601 格式"),
        expires_at: z
          .string()
          .nullable()
          .optional()
          .describe("新的到期时间 ISO 字符串；传 null 表示取消到期"),
        max_retries: z.number().int().min(0).optional().describe("失败重试次数"),
        retry_interval: z.number().int().min(1).optional().describe("重试间隔（秒）"),
      }),
      execute: async (args) => {
        if (!args.task_id) throw new Error("需要提供 task_id");

        const dto: UpdateTaskDto = {};
        if (args.name !== undefined) dto.name = args.name;
        if (args.prompt !== undefined) dto.prompt = args.prompt;
        if (args.schedule_type !== undefined) dto.scheduleType = args.schedule_type;
        if (args.cron_expression !== undefined) dto.cronExpression = args.cron_expression;
        if (args.execute_at !== undefined) dto.executeAt = args.execute_at;
        if (args.expires_at !== undefined) dto.expiresAt = args.expires_at;
        if (args.max_retries !== undefined) dto.maxRetries = args.max_retries;
        if (args.retry_interval !== undefined) dto.retryInterval = args.retry_interval;

        if (args.schedule_type === "cron") {
          if (!args.cron_expression) throw new Error("cron 类型任务需要提供 cron_expression");
          // 切到 cron 时清掉旧的一次性时间，避免残留
          dto.executeAt = null;
        } else if (args.schedule_type === "once") {
          if (!args.execute_at) throw new Error("once 类型任务需要提供 execute_at");
          dto.cronExpression = "";
        } else if (args.cron_expression !== undefined && args.execute_at !== undefined) {
          throw new Error("cron_expression 与 execute_at 只能提供一个");
        }

        if (Object.keys(dto).length === 0) {
          throw new Error("至少需要提供一个要修改的字段");
        }

        const task = await this.schedulerService.updateTask(args.task_id, dto);
        return JSON.stringify({
          success: true,
          message: `定时任务 "${task.name}" 已更新`,
          task: {
            id: task.id,
            name: task.name,
            scheduleType: task.scheduleType,
            cronExpression: task.cronExpression,
            executeAt: task.executeAt,
            enabled: task.enabled,
            nextRunAt: task.nextRunAt,
          },
        });
      },
      display: {
        actionType: "scheduler_update",
        text: { executing: "%scheduler_update_task.executing%", completed: "%scheduler_update_task.completed%" },
        aggregate: { executing: "%scheduler_update_task.aggregate.executing%", completed: "%scheduler_update_task.aggregate.completed%" },
        argsKey: "task_id",
        icon: "time",
      },
    });

    schedKit.registerTool({
      name: "scheduler_list_tasks",
      description: "获取所有定时任务列表",
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        const tasks = await this.schedulerService.getTasks();
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
            expiresAt: t.expiresAt,
            lastRunAt: t.lastRunAt,
            nextRunAt: t.nextRunAt,
            createdAt: t.createdAt,
          })),
        });
      },
      display: {
        actionType: "scheduler_list",
        text: { executing: "%scheduler_list_tasks.executing%", completed: "%scheduler_list_tasks.completed%" },
        aggregate: { executing: "%scheduler_list_tasks.aggregate.executing%", completed: "%scheduler_list_tasks.aggregate.completed%" },
        icon: "time",
      },
      readOnly: true,
    });

    schedKit.registerTool({
      name: "scheduler_delete_task",
      description: "删除指定的定时任务",
      inputSchema: z.object({
        task_id: z.string().describe("要删除的定时任务 ID"),
      }),
      execute: async (args, ctx) => {
        if (!args.task_id) throw new Error("需要提供 task_id");
        await this.schedulerService.deleteTask(args.task_id);
        return JSON.stringify({ success: true, message: "任务已删除" });
      },
      display: {
        actionType: "scheduler_delete",
        text: { executing: "%scheduler_delete_task.executing%", completed: "%scheduler_delete_task.completed%" },
        aggregate: { executing: "%scheduler_delete_task.aggregate.executing%", completed: "%scheduler_delete_task.aggregate.completed%" },
        icon: "time",
      },
    });

    schedKit.registerTool({
      name: "scheduler_toggle_task",
      description: "启用或禁用指定的定时任务",
      inputSchema: z.object({
        task_id: z.string().describe("要启用或禁用的定时任务 ID"),
      }),
      execute: async (args, ctx) => {
        if (!args.task_id) throw new Error("需要提供 task_id");
        const task = await this.schedulerService.toggleTask(args.task_id);
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
      display: {
        actionType: "scheduler_toggle",
        text: { executing: "%scheduler_toggle_task.executing%", completed: "%scheduler_toggle_task.completed%" },
        aggregate: { executing: "%scheduler_toggle_task.aggregate.executing%", completed: "%scheduler_toggle_task.aggregate.completed%" },
        icon: "time",
      },
    });

    schedKit.registerPrompt({
      frequency: "REGULAR",
      description: "定时任务工具使用说明",
      content: [
        "# Scheduled Task Tool Instructions",
        "",
        "These tools manage scheduled tasks for the CURRENT conversation. A task is an \"alarm clock\": at the scheduled time it sends its prompt as a user message into the conversation where it was created. The scheduler does not fetch or summarize execution results.",
        "",
        "## Rules",
        "",
        "1. Tasks created here always belong to the current conversation — do not ask for a session id.",
        "2. cron expressions use 5 fields: minute hour day-of-month month day-of-week, interpreted in the server's local timezone. Do not convert to UTC.",
        "3. For one-shot tasks set schedule_type=\"once\" and provide execute_at as a future ISO 8601 timestamp.",
        "4. Name tasks with the schedule when helpful, e.g. \"每天 9 点早报\".",
        "5. Use scheduler_update_task to change an existing task. Pass only the fields that change; call scheduler_list_tasks first if the id is unknown.",
        "6. Do not create a task whose prompt asks the future run to create or modify another scheduled task.",
        "7. After create/update/delete, reply with a brief confirmation; do not restate the whole task in a code block.",
        "",
        "## Common Cron Expressions",
        "",
        "| Requirement | Expression |",
        "|------|--------|",
        "| Every hour at minute 0 | `0 * * * *` |",
        "| Every 2 hours | `0 */2 * * *` |",
        "| Daily at 9 AM | `0 9 * * *` |",
        "| Every weekday at 9 AM | `0 9 * * 1-5` |",
        "| Every Monday at 9 AM | `0 9 * * 1` |",
        "| 1st of each month at midnight | `0 0 1 * *` |",
      ].join("\n"),
    });
  }
}
