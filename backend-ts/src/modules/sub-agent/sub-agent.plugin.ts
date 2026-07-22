import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { SubAgentManager } from "./sub-agent.manager";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext } from "../plugins/types/plugin.types";
import { CharacterRepository } from "../../common/database/character.repository";

@Injectable()
export class SubAgentPlugin extends PluginBase {
  private readonly logger = new Logger(SubAgentPlugin.name);
  manifest = {
    id: "sub_agent",
    name: "子代理",
    description: "创建和管理子代理执行独立任务",
    version: "1.0.0",
    category: "system" as const,
  };

  constructor(
    private subAgentManager: SubAgentManager,
    private characterRepo: CharacterRepository,
  ) {
    super();
  }

  /**
   * 校验 agentId 是否被当前会话的 agents 配置允许
   *
   * 与 prompt 中的列表过滤逻辑保持一致：
   * - generic / 空 → 始终允许（内置默认子代理）
   * - agents: false → 拒绝所有非 generic 角色
   * - __default === false（白名单）→ 仅允许显式 true 的角色
   * - 其他（黑名单）→ 排除显式 false 的角色
   * - 无配置 → 允许所有
   */
  private isAgentAllowed(agentId: string, ctx?: PluginContext): boolean {
    if (!agentId || agentId === "generic") return true;

    const charAgentCfg = ctx?.session?.getSettings?.("agents");

    if (charAgentCfg === false) return false;

    if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
      if (charAgentCfg.__default === false) {
        return charAgentCfg[agentId] === true;
      } else {
        return charAgentCfg[agentId] !== false;
      }
    }

    return true;
  }

  async onLoad(api: PluginApi) {
    const subKit = api.registerToolKit({
      id: "subagent",
      name: "Sub-Agent",
      loadMode: "eager",
      activator: "Call this toolkit when you need to create a sub-agent to execute an independent task",
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
          .describe("角色 ID（可选，不传则创建通用子代理）"),
        mode: z
          .enum(["foreground", "background"])
          .optional()
          .describe(
            "执行模式：foreground=等待完成（默认），background=后台运行立即返回",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        // 校验 agentId 是否被允许
        if (args.agentId && !this.isAgentAllowed(args.agentId, ctx)) {
          return {
            success: false,
            message: `角色 "${args.agentId}" 未被允许使用，请在角色设置中启用该角色后重试`,
          };
        }

        this.logger.log(
          `创建子 Agent: ${args.name}, 父会话: ${ctx?.session.sessionId}`,
        );
        const result = await this.subAgentManager.spawn(
          {
            parentContext: ctx.session,
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

    // ── Prompt: 子代理使用指南 + 可用角色列表 ──
    subKit.registerPrompt({
      frequency: "REGULAR",
      description: "子代理使用指南及可用角色列表",
      content: async (context: PluginContext) => {
        if (context?.session.sessionType === "sub_agent") return "";

        // ── 构建可用角色列表 ──
        const genericAgent = {
          id: "generic",
          title: "通用子代理",
          description: "适用于通用任务的子代理，无需特定角色设定",
        };

        const { items } = await this.characterRepo.findAll(0, 200);

        // 排除当前会话自身的角色
        const currentCharacterId = context?.session?.characterId;
        const dbCandidates = currentCharacterId
          ? items.filter((c: any) => c.id !== currentCharacterId)
          : items;

        const charAgentCfg = context?.session.getSettings?.("agents");

        let agents: any[];

        if (charAgentCfg === false) {
          agents = [];
        } else if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
          const allCandidates = [genericAgent, ...dbCandidates];
          if (charAgentCfg.__default === false) {
            // 白名单：只保留显式 true 的角色
            agents = allCandidates.filter((c: any) => charAgentCfg[c.id] === true);
          } else {
            // 黑名单：排除显式 false 的角色
            agents = allCandidates.filter((c: any) => charAgentCfg[c.id] !== false);
          }
        } else {
          // 无配置：不注入任何角色
          agents = [];
        }

        // ── 组装提示词 ──
        const sections: string[] = [
          "# Sub-Agents",
          "",
          "## Usage Guide",
          "",
          "The preset list provides you with dedicated agents that are visible by default and have built-in system instructions.",
          "",
          "### 1. When to Use",
          "   - The task involves heavy reasoning, e.g., in-depth debugging, complex code review, technical research.",
          "   - You care only about the final deliverable and do not need to intervene in the sub-task's execution in real time.",
          "   - The sub-task is independent and can run in parallel with other tasks without blocking.",
          "",
          "### 2. When NOT to Use",
          "   - The task can be completed with a single tool call → directly call that tool; no need to spawn a sub-agent.",
          "   - The task requires soliciting user input or obtaining real-time feedback during execution → sub-agents cannot directly interact with users; such interactions must remain in the main flow.",
          "",
          "### 3. Priority for Selecting a Sub-Agent",
          "   When you decide that a sub-task is needed, determine which agent to use strictly in the following priority:",
          "   1) User explicitly specifies (highest priority): If the user @mentions or clearly provides an agentId, you must unconditionally use that agent.",
          "   2) Predefined specialized agent (second priority): If the user does not specify, scan the descriptions of agents in the preset list and match one that best fits the current requirements.",
          '   3) Generic fallback (default): If no preset agent matches, or the current task is not suitable for a specialized agent, use agentId "generic".',
          "",
          "### 4. Detailed Rules for agentId",
          '   - This parameter is optional; leaving it empty or passing "generic" invokes the generic sub-agent.',
          "   - You can obtain preset agent IDs from the available agents list below.",
          "",
          "### 5. Critical Operational Guidelines (Cautions)",
          "   - Boundary isolation: When splitting tasks, the boundaries must be absolutely clear. It is strictly forbidden to assign the same file to multiple sub-agents for modification, or to have overlapping responsibilities among different sub-agents.",
          "   - Resource release: Once a sub-task finishes and no further interaction with that sub-agent is required, you must immediately call close to release session resources in a timely manner.",
          "   - Transparency management: Users cannot see the internal interaction logs between you and the sub-agents. You must not assume that users are aware of execution details. Ultimately, you must summarize and distill the results of sub-tasks and present them to the user in a clear, structured form.",
        ];

        if (agents.length > 0) {
          const agentXml = agents
            .map((a: any) => {
              return `   - name: ${a.title}\nid: ${a.id}\ndescription: ${a.description || ""}`;
            })
            .join("\n");

          sections.push(
            "",
            "## Available Agents",
            "",
            "These preset Agents have built-in system instructions and dedicated working methods. Scan their descriptions to see if they match the user's requirements. If so, use subagent_spawn with the corresponding agentId to create a sub-agent. When using a preset Agent, you only need to specify requirements and deliverables; no additional workflow instructions are required.",
            "",
            "<agents>",
            agentXml,
            "</agents>",
          );
        }

        return sections.join("\n");
      },
    });
  }
}
