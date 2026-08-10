import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { SubAgentManager } from "./sub-agent.manager";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext } from "../plugins/types/plugin.types";
import { CharacterRepository } from "../../common/database/character.repository";
import langZh from "./sub-agent.lang.zh.json";

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
   * 固定白名单模式：仅允许显式 true 的角色（generic 始终允许）
   */
  private isAgentAllowed(agentId: string, ctx?: PluginContext): boolean {
    if (!agentId || agentId === "generic") return true;

    const charAgentCfg = ctx?.session?.getSettings?.("agents");

    if (charAgentCfg === false) return false;

    if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
      // 固定白名单：仅允许显式 true 的角色
      return charAgentCfg[agentId] === true;
    }

    return true;
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    const subKit = api.registerToolKit({
      id: "subagent",
      name: "Sub-Agent",
      loadMode: "eager",
      activator:
        "Call this toolkit when you need to create a sub-agent to execute an independent task",
      handler: async (ctx) => {
        // sub_agent 会话禁止递归加载子代理工具
        if (ctx.session.sessionType === "sub_agent") {
          return { loadMode: "none" as const };
        }
        // 无已启用子代理时不注入工具（避免无意义占用）
        const agentsCfg = ctx.session?.getSettings?.("agents");
        const hasEnabledAgent =
          typeof agentsCfg === "object" &&
          agentsCfg !== null &&
          Object.entries(agentsCfg).some(
            ([k, v]) => !k.startsWith("__") && v === true,
          );
        return {
          loadMode: hasEnabledAgent ? ("eager" as const) : ("none" as const),
        };
      },
    });

    // ── spawn：创建 + 执行子代理 ──
    subKit.registerTool({
      name: "subagent_spawn",
      description: `Create a sub-agent to execute an independent task.
The sub-agent has its own independent conversation context and tool capabilities. Returns the sub-session ID immediately after creation.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            'Name of the sub-agent (concise and clear, e.g. "Financial Report Analysis", "Code Generation")',
          ),
        task: z
          .string()
          .describe("Specific task description for the sub-agent to complete"),
        agentId: z.string().describe("Character ID"),
        mode: z
          .enum(["foreground", "background"])
          .optional()
          .describe(
            "Execution mode: foreground=wait for completion (default), background=run in background and return immediately",
          ),
      }),
      execute: async (args, ctx, abortSignal) => {
        // 校验 agentId 是否被允许
        if (args.agentId && !this.isAgentAllowed(args.agentId, ctx)) {
          throw new Error(
            `Agent "${args.agentId}" is not allowed. Please enable it in the character settings and try again.`,
          );
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
        if (result.status === "running") {
          const reason = result.error ? ` (${result.error})` : "";
          return `[Sub-agent running. Session ID: ${result.subSessionId}${reason}. Use subagent_manager wait to get the result.]`;
        }
        const parts: string[] = [];
        if (result.content) parts.push(result.content);
        const tag =
          result.status === "error"
            ? `[Sub-agent ended with error. Session ID: ${result.subSessionId}${result.error ? `. Reason: ${result.error}` : ""}]`
            : `[Sub-agent completed. Session ID: ${result.subSessionId}]`;
        parts.push(tag);
        return parts.join("\n");
      },
      display: {
        actionType: "sub_agent_create",
        text: { executing: "%subagent_spawn.executing%", completed: "%subagent_spawn.completed%" },
        aggregate: { executing: "%subagent_spawn.aggregate.executing%", completed: "%subagent_spawn.aggregate.completed%" },
        argsKey: "name",
        icon: "generic",
      },
    });

    // ── manager：管理子代理（wait / list / close / send_message）──
    subKit.registerTool({
      name: "subagent_manager",
      description: `Manage sub-agents: wait for completion / close / list / send message`,
      inputSchema: z.object({
        action: z.enum(["wait", "list", "close", "send_message"]),
        sessionId: z
          .string()
          .optional()
          .describe("Required for close or send_message"),
        message: z.string().optional().describe("Required for send_message"),
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
              return "[No active sub-agent tasks.]";
            }
            const parts: string[] = [];
            for (const c of completed) {
              const r = c.result;
              const lines: string[] = [];
              if (r.content) lines.push(r.content);
              const tag =
                r.status === "error"
                  ? `[Sub-agent "${c.name}" ended with error. Session ID: ${c.subSessionId}${r.error ? `. Reason: ${r.error}` : ""}]`
                  : `[Sub-agent "${c.name}" completed. Session ID: ${c.subSessionId}]`;
              lines.push(tag);
              parts.push(lines.join("\n"));
            }
            return parts.join("\n\n");
          }

          case "list": {
            const agents = await this.subAgentManager.getSubAgents(
              ctx?.session.sessionId,
            );
            if (agents.length === 0) return "[No sub-agents running.]";
            const lines = agents.map(
              (a: any) => `- ${a.name} (${a.subSessionId}) [${a.status}]`,
            );
            return `Active sub-agents:\n${lines.join("\n")}`;
          }

          case "close": {
            if (!sessionId) throw new Error("Missing sessionId parameter.");
            try {
              await this.subAgentManager.closeSubAgent(
                sessionId,
                ctx?.session.sessionId,
                ctx?.session.userId,
                ctx?.session.workspacePath,
              );
              return "Sub-agent closed and deleted successfully.";
            } catch (e: any) {
              throw new Error(e.message || "Failed to close sub-agent.");
            }
          }

          case "send_message": {
            if (!sessionId || !message)
              throw new Error("Missing sessionId or message parameter.");
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
              if (result.status === "running") {
                return `[Message sent. Sub-agent is running. Session ID: ${result.subSessionId}]`;
              }
              const parts: string[] = [];
              if (result.content) parts.push(result.content);
              const tag =
                result.status === "error"
                  ? `[Sub-agent ended with error. Session ID: ${result.subSessionId}${result.error ? `. Reason: ${result.error}` : ""}]`
                  : `[Sub-agent completed. Session ID: ${result.subSessionId}]`;
              parts.push(tag);
              return parts.join("\n");
            } catch (e: any) {
              throw new Error(e.message || "Failed to send message.");
            }
          }

          default:
            throw new Error(`Unknown action: ${action}`);
        }
      },
      display: {
        actionType: "sub_agent_manage",
        text: { executing: "%subagent_manager.executing%", completed: "%subagent_manager.completed%" },
        aggregate: { executing: "%subagent_manager.aggregate.executing%", completed: "%subagent_manager.aggregate.completed%" },
        argsKey: "action",
        icon: "generic",
      },
    });

    // ── Prompt: 子代理使用指南 + 可用角色列表 ──
    subKit.registerPrompt({
      frequency: "REGULAR",
      description: "Sub-agent usage guide and available agents list",
      content: async (context: PluginContext) => {
        if (context?.session.sessionType === "sub_agent") return "";

        // ── 构建可用角色列表 ──
        const genericAgent = {
          id: "generic",
          title: "Generic Sub-Agent",
          description:
            "A general-purpose agent capable of handling any task. Tasks that don't match a dedicated sub-agent can be delegated to this generic agent.",
        };

        const { items } = await this.characterRepo.findAll(0, 200);

        // 排除当前会话自身的角色
        const currentCharacterId = context?.session?.characterId;
        const dbCandidates = currentCharacterId
          ? items.filter((c: any) => c.id !== currentCharacterId)
          : items;

        const charAgentCfg = context?.session.getSettings?.("agents");

        let agents: any[];

        if (charAgentCfg && typeof charAgentCfg === "object") {
          const allCandidates = [genericAgent, ...dbCandidates];
          // 固定白名单：只保留显式 true 的角色
          agents = allCandidates.filter(
            (c: any) => charAgentCfg[c.id] === true,
          );
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
