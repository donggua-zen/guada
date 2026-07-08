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
    const subKit = api.registerToolKit({
      id: "subagent",
      name: "子代理",
      loadMode: "eager",
      activator: "需要创建子代理执行独立任务时，可以调用此工具包",
      handler: async (ctx) => {
        // sub_agent 会话禁止递归加载子代理工具
        if (ctx.session.sessionType === "sub_agent") {
          return { loadMode: "none" as const };
        }
        return { loadMode: "eager" as const };
      },
    });

    // ── spawn：创建 + 执行子代理 ──
    subKit.registerTool({
      name: "subagent_spawn",
      description: `创建一个子代理独立执行指定任务。
子代理拥有独立的对话上下文和工具能力，创建后立即返回子会话 ID。`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('子代理的名称（简洁明了，如"财报分析"、"代码生成"）'),
        task: z.string().describe("子代理需要完成的具体任务描述（越详细越好）"),
        agentId: z
          .string()
          .optional()
          .describe("角色 ID/agent ID（可选，不传则创建通用子代理）"),
        mode: z
          .enum(["foreground", "background"])
          .optional()
          .describe(
            "执行模式：foreground=等待完成（默认），background=后台运行立即返回",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        this.logger.log(
          `创建子 Agent: ${args.name}, 父会话: ${ctx?.session.sessionId}`,
        );
        const result = await this.subAgentManager.spawn(
          {
            parentSessionId: ctx?.session.sessionId,
            userId: ctx?.session.userId,
            name: args.name,
            task: args.task,
            characterId: args.agentId,
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
              ? "子代理已创建并开始执行，请使用 subagent_manager wait 获取结果"
              : "子代理执行完成",
        };
      },
      display: { action: "创建子代理", argsKey: "name", icon: "generic" },
    });

    // ── manager：管理子代理（wait / list / close / send_message）──
    subKit.registerTool({
      name: "subagent_manager",
      description: `管理子代理：等待完成 / 关闭 / 列表 / 发送消息`,
      inputSchema: z.object({
        action: z.enum(["wait", "list", "close", "send_message"]),
        sessionId: z
          .string()
          .optional()
          .describe("close 或 send_message 时需要"),
        message: z.string().optional().describe("send_message 时需要"),
      }),
      execute: async (args, ctx, abortSignal) => {
        const { action, sessionId, message } = args as {
          action: string;
          sessionId?: string;
          message?: string;
        };
        switch (action) {
          case "wait": {
            this.logger.log(`等待子代理完成: 父会话 ${ctx?.session.sessionId}`);
            const completed = await this.subAgentManager.waitForComplete(
              ctx?.session.sessionId,
              120000,
              abortSignal,
            );
            if (completed.length === 0) {
              return { success: true, message: "没有进行中的子代理任务" };
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
          }

          case "list": {
            const agents = await this.subAgentManager.getSubAgents(
              ctx?.session.sessionId,
            );
            return { success: true, sub_agents: agents, total: agents.length };
          }

          case "close": {
            if (!sessionId)
              return { success: false, message: "缺少 sessionId" };
            try {
              await this.subAgentManager.closeSubAgent(
                sessionId,
                ctx?.session.sessionId,
                ctx?.session.userId,
                ctx?.session.workspacePath,
              );
              return { success: true, message: "子代理已关闭并删除" };
            } catch (e: any) {
              return { success: false, message: e.message || "关闭子代理失败" };
            }
          }

          case "send_message": {
            if (!sessionId || !message)
              return { success: false, message: "缺少 sessionId 或 message" };
            try {
              const result = await this.subAgentManager.sendMessage(
                {
                  parentSessionId: ctx?.session.sessionId,
                  userId: ctx?.session.userId,
                  sessionId,
                  message,
                },
                "foreground",
                abortSignal,
              );
              return {
                success: true,
                sessionId: result.subSessionId,
                status: result.status,
                content:
                  result.status === "completed" ? result.content : undefined,
                message:
                  result.status === "running"
                    ? "消息已发送，子代理开始执行"
                    : "子代理执行完成",
              };
            } catch (e: any) {
              return { success: false, message: e.message || "发送消息失败" };
            }
          }

          default:
            return { success: false, message: `未知操作: ${action}` };
        }
      },
      display: { action: "管理子代理", argsKey: "action", icon: "generic" },
    });

    // ── Prompt ──
    subKit.registerPrompt({
      frequency: "REGULAR",
      description: "子代理工具使用说明",
      content: `# 子代理工具使用说明

## 何时使用
- 推理繁重的子任务（调试、代码审查、研究）
- 将中间数据淹没上下文的任务
- 并行独立工作流
- 任务匹配优先级：手动@ > 预定义subagent > skills

## 何时不使用
- 机械多步骤工作→ 使用execute_code
- 单一工具调用→ 直接调用该工具即可
- 需要用户交互的任务→ 子代理不能使用clear

## agentId 使用说明
- 可选参数，不传则使用通用子代理
- 你可以通过预定义列表（若存在）或者用户@手动指定来获取预定义的子代理Id
- ** 若用户明确指定子代理Id（即便不在预定义列表），必须优先使用 **

## 注意事项
- 拆分原则：任务边界必须清晰，严禁不同子代理修改同一文件或任务重叠。
- 任务结束且无需后续交互时，及时 close 释放会话资源。

`,
    });
  }
}
