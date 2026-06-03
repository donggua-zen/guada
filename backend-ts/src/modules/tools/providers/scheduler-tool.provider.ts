import { Injectable, Logger } from "@nestjs/common";
import {
  IToolProvider,
  ToolCallRequest,
  ToolProviderMetadata,
  ToolDisplayInfo,
} from "../interfaces/tool-provider.interface";
import { InternalToolDefinition } from "../../llm-core/types/llm.types";
import { SchedulerService } from "../../scheduler/scheduler.service";

/**
 * 定时任务工具提供者
 *
 * 让 AI 能够创建和管理定时任务。
 * AI 只能使用 "existing_session" 模式（注入当前会话），对用户隐藏此选项。
 */
@Injectable()
export class SchedulerToolProvider implements IToolProvider {
  private readonly logger = new Logger(SchedulerToolProvider.name);
  public readonly namespace = "scheduler";

  private readonly toolsConfig: InternalToolDefinition[] = [
    {
      name: "create_task",
      description:
        "创建一个定时任务，让 AI 可以在指定时间自动执行提示词。任务会注入到当前会话中执行。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "任务名称，如：每日早报、定时提醒",
          },
          prompt: {
            type: "string",
            description: "任务执行时发送给 AI 的提示词内容",
          },
          schedule_type: {
            type: "string",
            enum: ["cron", "once"],
            description:
              "调度类型：cron 表示周期性执行，once 表示一次性定点执行",
          },
          cron_expression: {
            type: "string",
            description:
              "cron 表达式（schedule_type 为 cron 时必填）。格式：分 时 日 月 周。示例：'0 9 * * *' 表示每天9点",
          },
          execute_at: {
            type: "string",
            description:
              "定点执行时间 ISO 字符串（schedule_type 为 once 时必填）。示例：'2026-05-25T14:30:00.000Z'",
          },
          max_executions: {
            type: "integer",
            description: "最大执行次数（可选，默认 null 表示无限次）",
          },
          max_retries: {
            type: "integer",
            description: "失败重试次数（可选，默认 0 表示不重试）",
          },
          retry_interval: {
            type: "integer",
            description: "重试间隔秒数（可选，默认 60 秒）",
          },
        },
        required: ["name", "prompt", "schedule_type"],
      },
    },
    {
      name: "list_tasks",
      description: "获取当前用户的所有定时任务列表",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "delete_task",
      description: "删除指定的定时任务",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "要删除的任务ID",
          },
        },
        required: ["task_id"],
      },
    },
    {
      name: "toggle_task",
      description: "启用或禁用指定的定时任务",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "任务ID",
          },
        },
        required: ["task_id"],
      },
    },
  ];

  constructor(private schedulerService: SchedulerService) {}

  async getTools(
    enabled?: boolean | string[],
    context?: Record<string, any>,
  ): Promise<any[]> {
    if (enabled === false) return [];

    if (Array.isArray(enabled)) {
      return this.toolsConfig.filter((tool) => enabled.includes(tool.name));
    }

    return this.toolsConfig;
  }

  async execute(
    request: ToolCallRequest,
    context?: Record<string, any>,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const handlers: Record<
      string,
      (
        args: any,
        ctx?: Record<string, any>,
        signal?: AbortSignal,
      ) => Promise<string>
    > = {
      create_task: this.handleCreateTask.bind(this),
      list_tasks: this.handleListTasks.bind(this),
      delete_task: this.handleDeleteTask.bind(this),
      toggle_task: this.handleToggleTask.bind(this),
    };

    const handler = handlers[request.name];

    if (!handler) {
      throw new Error(`未知工具：${request.name}`);
    }

    return await handler(request.arguments, context, abortSignal);
  }

  /**
   * 创建定时任务
   *
   * AI 只能使用 existing_session 模式（注入当前会话），对用户隐藏此选项
   */
  private async handleCreateTask(
    args: any,
    context?: Record<string, any>,
  ): Promise<string> {
    const userId = context?.userId;
    if (!userId) {
      throw new Error("无法获取用户ID，无法创建定时任务");
    }

    const sessionId = context?.sessionId;
    if (!sessionId) {
      throw new Error("无法获取会话ID，无法创建定时任务");
    }

    // 参数校验
    if (!args.name || !args.prompt) {
      throw new Error("任务名称和提示词不能为空");
    }

    const scheduleType = args.schedule_type;
    if (scheduleType !== "cron" && scheduleType !== "once") {
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
      scheduleType: scheduleType,
      cronExpression: args.cron_expression || "",
      executeAt: args.execute_at || null,
      targetMode: "existing_session" as const,
      targetSessionId: sessionId,
      maxExecutions: args.max_executions ?? null,
      maxRetries: args.max_retries ?? 0,
      retryInterval: args.retry_interval ?? 60,
      enabled: true,
    };

    const task = await this.schedulerService.createTask(userId, dto);

    return JSON.stringify(
      {
        success: true,
        message: `定时任务 "${task.name}" 创建成功`,
        task: {
          id: task.id,
          name: task.name,
          scheduleType: task.scheduleType,
          cronExpression: task.cronExpression,
          executeAt: task.executeAt,
          enabled: task.enabled,
          nextRunAt: task.nextRunAt,
        },
      },
      null,
      2,
    );
  }

  /**
   * 获取任务列表
   */
  private async handleListTasks(
    args: any,
    context?: Record<string, any>,
  ): Promise<string> {
    const userId = context?.userId;
    if (!userId) {
      throw new Error("无法获取用户ID");
    }

    const tasks = await this.schedulerService.getTasks(userId);

    return JSON.stringify(
      {
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
      },
      null,
      2,
    );
  }

  /**
   * 删除任务
   */
  private async handleDeleteTask(
    args: any,
    context?: Record<string, any>,
  ): Promise<string> {
    const userId = context?.userId;
    if (!userId) {
      throw new Error("无法获取用户ID");
    }

    if (!args.task_id) {
      throw new Error("需要提供 task_id");
    }

    await this.schedulerService.deleteTask(args.task_id, userId);

    return JSON.stringify(
      {
        success: true,
        message: "任务已删除",
      },
      null,
      2,
    );
  }

  /**
   * 切换任务启用状态
   */
  private async handleToggleTask(
    args: any,
    context?: Record<string, any>,
  ): Promise<string> {
    const userId = context?.userId;
    if (!userId) {
      throw new Error("无法获取用户ID");
    }

    if (!args.task_id) {
      throw new Error("需要提供 task_id");
    }

    const task = await this.schedulerService.toggleTask(args.task_id, userId);

    return JSON.stringify(
      {
        success: true,
        message: `任务已${task.enabled ? "启用" : "禁用"}`,
        task: {
          id: task.id,
          name: task.name,
          enabled: task.enabled,
        },
      },
      null,
      2,
    );
  }

  async getPrompt(context?: Record<string, any>): Promise<string> {
    const promptParts: string[] = [];

    promptParts.push("# 定时任务工具使用说明");
    promptParts.push("");
    promptParts.push(
      "你可以使用这些工具帮助用户创建和管理定时任务。任务会在指定时间自动将提示词以用户消息的形式发送到当前对话中。定时器本身不会自动获得执行结果，仅仅是发送提示词，你可以理解为其本质是一个“闹钟”。",
    );
    promptParts.push("");
    promptParts.push("## 使用场景示例");
    promptParts.push("");
    promptParts.push(
      "- 用户说'每天早上9点给我发一份新闻汇总' → 使用 create_task 创建 cron 任务",
    );
    promptParts.push(
      "- 用户说'一小时后提醒我开会' → 使用 create_task 创建 once 任务",
    );
    promptParts.push("- 用户说'查看我所有的定时任务' → 使用 list_tasks");
    promptParts.push("- 用户说'删除那个早报任务' → 使用 delete_task");
    promptParts.push("");
    promptParts.push("## cron 表达式常用示例");
    promptParts.push("");
    promptParts.push("| 需求 | 表达式 |");
    promptParts.push("|------|--------|");
    promptParts.push("| 每分钟 | `* * * * *` |");
    promptParts.push("| 每小时 | `0 * * * *` |");
    promptParts.push("| 每天9点 | `0 9 * * *` |");
    promptParts.push("| 每周一9点 | `0 9 * * 1` |");
    promptParts.push("| 每月1日0点 | `0 0 1 * *` |");
    promptParts.push("");
    promptParts.push("## 重要提醒");
    promptParts.push("");
    promptParts.push(
      "1. 创建的任务会自动注入到当前会话中执行，不需要指定会话ID",
    );
    promptParts.push("2. 任务创建后会立即生效，到达设定时间自动触发");
    promptParts.push("3. 建议为用户设置合理的任务名称，方便后续管理");

    return promptParts.join("\n");
  }

  async getBriefDescription(context?: Record<string, any>): Promise<string> {
    return "定时任务管理工具，用于创建、查看、删除定时任务，当你需要在指定时间自动执行某项任务时，可以使用此工具。";
  }

  getMetadata(context?: Record<string, any>): ToolProviderMetadata {
    return {
      namespace: this.namespace,
      displayName: "定时任务工具",
      description: "创建和管理定时任务，让 AI 在指定时间自动执行",
      isMcp: false,
      loadMode: "lazy",
      type: "core",
    };
  }

  /**
   * 生成展示文案
   */
  formatDisplayMessage(
    toolName: string,
    args: Record<string, any>,
    isStreaming: boolean,
  ): ToolDisplayInfo {
    const prefix = isStreaming ? "正在" : "已";

    switch (toolName) {
      case "create_task":
        return {
          action: `${prefix}创建定时任务`,
          args: args.name,
          toolName: `${this.namespace}__${toolName}`,
        };
      case "list_tasks":
        return {
          action: `${prefix}获取定时任务列表`,
          toolName: `${this.namespace}__${toolName}`,
        };
      case "delete_task":
        return {
          action: `${prefix}删除定时任务`,
          args: args.task_id,
          toolName: `${this.namespace}__${toolName}`,
        };
      case "toggle_task":
        return {
          action: `${prefix}切换任务状态`,
          args: args.task_id,
          toolName: `${this.namespace}__${toolName}`,
        };
      default:
        return {
          action: `${prefix}执行定时任务操作`,
          toolName: `${this.namespace}__${toolName}`,
        };
    }
  }
}
