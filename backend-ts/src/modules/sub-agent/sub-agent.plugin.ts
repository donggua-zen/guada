import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { SubAgentManager } from "./sub-agent.manager";
import { PluginApi } from "../plugins/api/plugin-api";

@Injectable()
export class SubAgentPlugin extends PluginBase {
  private readonly logger = new Logger(SubAgentPlugin.name);
  manifest = {
    id: "sub_agent",
    name: "子代理",
    description: "创建和管理子代理执行独立任务",
    version: "1.0.0",
    category: "core" as const,
  };

  constructor(private subAgentManager: SubAgentManager) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerToolSet({
      name: "subagent",
      loadMode: "lazy",
      activator: "当需要创建子代理执行独立任务时通过 tool_load 加载",
      handler: (ctx) => ({
        loadMode:
          ctx.sessionType === "team" ? ("eager" as const) : ("lazy" as const),
      }),
    });

    api.registerTool({
      name: "subagent_spawn",
      toolSet: "subagent",
      description: `创建一个子代理独立执行指定任务。
子代理拥有独立的对话上下文和工具能力，创建后立即返回子会话 ID。`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('子代理的名称（简洁明了，如"财报分析"、"代码生成"）'),
        task: z.string().describe("子代理需要完成的具体任务描述（越详细越好）"),
        characterId: z
          .string()
          .optional()
          .describe("角色 ID（可选，不传则使用默认模型）"),
        mode: z
          .enum(["foreground", "background"])
          .optional()
          .describe(
            "执行模式：foreground=等待完成（默认），background=后台运行立即返回",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        this.logger.log(
          `创建子 Agent: ${args.name}, 父会话: ${ctx?.sessionId}`,
        );
        const result = await this.subAgentManager.spawn(
          {
            parentSessionId: ctx?.sessionId,
            userId: ctx?.userId,
            name: args.name,
            task: args.task,
            characterId: args.characterId,
          },
          args.mode || "foreground",
          abortSignal,
        );
        return {
          success: true,
          sessionId: result.subSessionId,
          status: result.status,
          content: result.status === "completed" ? result.content : undefined,
          message:
            result.status === "running"
              ? "子代理已创建并开始执行，请使用 wait 获取结果"
              : "子代理执行完成",
        };
      },
      display: { action: "创建子代理", argsKey: "name", icon: "generic" },
    });

    api.registerTool({
      name: "subagent_wait",
      toolSet: "subagent",
      description: "等待子代理执行完成并返回结果摘要",
      inputSchema: z.object({}),
      execute: async (_args, ctx, abortSignal) => {
        this.logger.log(`等待子代理完成: 父会话 ${ctx?.sessionId}`);
        const completed = await this.subAgentManager.waitForComplete(
          ctx?.sessionId,
          120000,
          abortSignal,
        );
        if (completed.length === 0) {
          return {
            success: true,
            message: "没有进行中的子代理任务",
          };
        }
        return {
          success: true,
          completedSubAgents: completed.map((c: any) => ({
            sessionId: c.subSessionId,
            name: c.name,
            status: c.result?.status,
            content: c.result?.content,
            reasoningContent: c.result?.reasoningContent,
            finishReason: c.result?.finishReason,
          })),
          message: `以下子代理已完成: ${completed.map((c: any) => c.name).join(", ")}`,
        };
      },
      display: { action: "等待子代理", icon: "generic" },
    });

    api.registerTool({
      name: "subagent_close",
      toolSet: "subagent",
      description: "关闭指定子代理并删除其会话数据",
      inputSchema: z.object({
        sessionId: z.string().describe("要关闭的子代理会话 ID"),
      }),
      execute: async (args, ctx) => {
        try {
          await this.subAgentManager.closeSubAgent(
            args.sessionId,
            ctx?.sessionId,
            ctx?.userId,
            ctx?.workspacePath,
          );
          return {
            success: true,
            message: "子代理已关闭并删除",
          };
        } catch (e: any) {
          return {
            success: false,
            message: e.message || "关闭子代理失败",
          };
        }
      },
      display: { action: "关闭子代理", argsKey: "sessionId", icon: "generic" },
    });

    api.registerTool({
      name: "subagent_list",
      toolSet: "subagent",
      description: "获取当前父会话下所有子代理列表",
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        const agents = await this.subAgentManager.getSubAgents(ctx?.sessionId);
        return {
          success: true,
          sub_agents: agents,
          total: agents.length,
        };
      },
      display: { action: "列出子代理", icon: "generic" },
    });

    api.registerTool({
      name: "subagent_send_message",
      toolSet: "subagent",
      description: "向已存在的子代理发送消息继续交互",
      inputSchema: z.object({
        sessionId: z.string().describe("子代理的会话 ID"),
        message: z.string().describe("要发送给子代理的消息内容"),
      }),
      execute: async (args, ctx, abortSignal) => {
        try {
          const result = await this.subAgentManager.sendMessage(
            {
              parentSessionId: ctx?.sessionId,
              userId: ctx?.userId,
              sessionId: args.sessionId,
              message: args.message,
            },
            "foreground",
            abortSignal,
          );
          return {
            success: true,
            sessionId: result.subSessionId,
            status: result.status,
            content: result.status === "completed" ? result.content : undefined,
            message:
              result.status === "running"
                ? "消息已发送，子代理开始执行，请使用 wait 获取结果"
                : "子代理执行完成",
          };
        } catch (e: any) {
          return {
            success: false,
            message: e.message || "发送消息失败",
          };
        }
      },
      display: {
        action: "向子代理发消息",
        argsKey: "sessionId",
        icon: "generic",
      },
    });

    api.registerPrompt({
      toolSet: "subagent",
      frequency: "REGULAR",
      description: "子代理工具使用说明",
      content: `# 子代理工具

你可以使用以下工具来管理子代理：

## subagent_spawn
创建子代理独立执行任务。子代理拥有独立的对话上下文和工具能力。

**何时使用**：
- 需要并行处理多个独立任务
- 有一个耗时任务需要异步执行
- 需要隔离不同任务的上下文

## subagent_wait
等待当前会话创建的子代理执行完成并返回结果。

## subagent_close
关闭指定子代理。

## subagent_list
获取当前所有子代理列表。

## subagent_send_message
向已存在的子代理发送新消息继续交互。`,
    });
  }
}
