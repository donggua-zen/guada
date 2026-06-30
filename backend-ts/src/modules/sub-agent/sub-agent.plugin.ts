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
      loadMode: "lazy",
      activator: "需要创建子代理执行独立任务时，可以调用此工具包",
      handler: (ctx) => ({
        loadMode:
          ctx.session.sessionType === "team" ? ("eager" as const) : ("lazy" as const),
      }),
    });

    subKit.registerTool({
      name: "subagent_spawn",
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
          `创建子 Agent: ${args.name}, 父会话: ${ctx?.session.sessionId}`,
        );
        const result = await this.subAgentManager.spawn(
          {
            parentSessionId: ctx?.session.sessionId,
            userId: ctx?.session.userId,
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

    subKit.registerTool({
      name: "subagent_wait",
      description: "等待子代理执行完成并返回结果摘要",
      inputSchema: z.object({}),
      execute: async (_args, ctx, abortSignal) => {
        this.logger.log(`等待子代理完成: 父会话 ${ctx?.session.sessionId}`);
        const completed = await this.subAgentManager.waitForComplete(
          ctx?.session.sessionId,
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

    subKit.registerTool({
      name: "subagent_close",
      description: "关闭指定子代理并删除其会话数据",
      inputSchema: z.object({
        sessionId: z.string().describe("要关闭的子代理会话 ID"),
      }),
      execute: async (args, ctx) => {
        try {
          await this.subAgentManager.closeSubAgent(
            args.sessionId,
            ctx?.session.sessionId,
            ctx?.session.userId,
            ctx?.session.workspacePath,
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

    subKit.registerTool({
      name: "subagent_list",
      description: "获取当前父会话下所有子代理列表",
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        const agents = await this.subAgentManager.getSubAgents(ctx?.session.sessionId);
        return {
          success: true,
          sub_agents: agents,
          total: agents.length,
        };
      },
      display: { action: "列出子代理", icon: "generic" },
    });

    subKit.registerTool({
      name: "subagent_send_message",
      description: "向已存在的子代理发送消息继续交互",
      inputSchema: z.object({
        sessionId: z.string().describe("子代理的会话 ID"),
        message: z.string().describe("要发送给子代理的消息内容"),
      }),
      execute: async (args, ctx, abortSignal) => {
        try {
          const result = await this.subAgentManager.sendMessage(
            {
              parentSessionId: ctx?.session.sessionId,
              userId: ctx?.session.userId,
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

    subKit.registerPrompt({
      frequency: "REGULAR",
      description: "子代理工具使用说明",
      content: `# 子代理工具使用说明：
- 对于某项任务如果只关心结果不关系中间过程，可以使用子代理协助完成
- 默认使用前台子代理（run_mode="foreground"）
- 当任务复杂、耗时较长，使用后台子代理（run_mode="background"）
- 拆分任务时必须边界清晰，确保各子代理不会互相修改同一文件或者任务重叠

**角色驱动模式**：
- 当你的系统提示词中包含【团队成员】时，你可以使用 create 的 characterId 参数创建角色驱动的子代理
- 角色驱动的子代理会继承该角色的完整设定（系统提示词、工具权限等），以该角色身份执行任务
- 格式：spawn(name="角色名", characterId="角色ID", task="具体任务")
- 根据任务性质选择合适的团队成员角色

**注意**：
- spawn 前台模式会阻塞到任务完成，后台子代理在后台执行，结果会通过系统消息通知
- 如非必要禁止使用wait轮询等待子代理结果
- 若对子代理任务需要进一步追问或者调整，使用 \`send_message\` 继续交互
- 对于任务结束且不需要后续交互的子代理，及时 \`close\` 关闭并清理其会话数据`,
    });
  }
}
