import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { SubAgentManager } from "./sub-agent.manager";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext, RolePluginConfig } from "../plugins/types/plugin.types";
import { isToolkitAllowedByRoleConfig } from "../plugins/utils/role-toolkit-filter";
import { AgentFileStore } from "../agents/agent-file.store";
import { CommandContext } from "../commands/interfaces/command-provider.interface";
import langZh from "./sub-agent.lang.zh.json";
import langEn from "./sub-agent.lang.en.json";

/**
 * 子代理跳转信息：前端据此在工具行 / 结果通知上提供"打开子代理面板"入口。
 * meta 是 UI 专用通道（不进 LLM 上下文），故可对模型隐藏 Session ID 的同时仍让用户点进会话
 * ——one_shot 完成分支刻意不把 ID 写进 content，避免 AI 去操作已冻结的会话。
 */
function subAgentLinkMeta(subSessionId: string, name?: string) {
  return {
    link: {
      type: "sub_agent",
      subSessionId,
      ...(name ? { name } : {}),
    },
  };
}

@Injectable()
export class SubAgentPlugin extends PluginBase {
  private readonly logger = new Logger(SubAgentPlugin.name);
  manifest = {
    id: "sub_agent",
    name: "%subAgent.name%",
    description: "%subAgent.description%",
    version: "1.0.0",
    category: "system" as const,
    icon: "images/plugins/sub_agent.svg",
  };

  constructor(
    private subAgentManager: SubAgentManager,
    private agentStore: AgentFileStore,
  ) {
    super();
  }

  /**
   * 校验 agentId 是否被当前会话的 agents 配置允许
   *
   * 固定白名单模式：仅允许显式 true 的智能体（generic 始终允许）
   */
  private isAgentAllowed(agentId: string, ctx?: PluginContext): boolean {
    if (!agentId || agentId === "generic") return true;

    const charAgentCfg = ctx?.session?.getSettings?.("agents");

    if (charAgentCfg === false) return false;

    if (typeof charAgentCfg === "object" && charAgentCfg !== null) {
      // 固定白名单：仅允许显式 true 的智能体
      return charAgentCfg[agentId] === true;
    }

    return true;
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);
    const subKit = api.registerToolKit({
      id: "subagent",
      name: "%subAgent.toolkitName%",
      description: "%subAgent.toolkitDescription%",
      loadMode: "eager",
      // 子代理有自己的管理页：总开关由子代理 tab 写入 settings.plugins.sub_agent，
      // 逐项偏好在 settings.agents
      governance: "self",
      activator:
        "Call this toolkit when you need to create a sub-agent to execute an independent task",
      handler: async (ctx) => {
        // sub_agent 会话禁止递归加载子代理工具
        if (ctx.session.sessionType === "sub_agent") {
          return { loadMode: "none" as const };
        }
        // 自有管理页的总开关（配置键为 sub_agent，工具包 id 为 subagent）
        const entry = (ctx.pluginsConfig as RolePluginConfig | undefined)
          ?.sub_agent;
        if (!isToolkitAllowedByRoleConfig(entry, "subagent")) {
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
      description: `Create a sub-agent to execute an independent task, or to research/explore the codebase in parallel.
Use it when answering means sweeping multiple files, directories, or naming conventions and you only need the conclusion, not the file dumps; also for independent sub-tasks that can run concurrently.
The sub-agent has its own independent conversation context and tool capabilities. Once you delegate a search, do not also run it yourself — wait for the result.
In plan mode, sub-agents run read-only; use them for research, not for edits or state-changing commands.
Foreground (default) blocks until done and returns the result. Background mode returns a Job ID immediately; track it with job_read / job_stop, continue the conversation with job_send, and you will be notified when it finishes.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            'Name of the sub-agent (concise and clear, e.g. "Financial Report Analysis", "Code Generation")',
          ),
        task: z
          .string()
          .describe("Specific task description for the sub-agent to complete"),
        agentId: z
          .string()
          .optional()
          .describe(
            'Agent ID; omit or pass "generic" to use the generic sub-agent',
          ),
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
            `Agent "${args.agentId}" is not allowed. Please enable it in the agent settings and try again.`,
          );
        }

        this.logger.log(
          `创建子 Agent: ${args.name}, 父会话: ${ctx?.session.sessionId}, 模式: ${args.mode || "foreground"}`,
        );
        const result = await this.subAgentManager.spawn(
          {
            parentContext: ctx.session,
            name: args.name,
            task: args.task,
            agentId: args.agentId,
            // 透传本次调用 id：manager 在子会话创建瞬间据此发布流事件，
            // 让前端在工具结果落库前就能把这次调用关联到子会话
            toolCallId: ctx?.toolCallId,
          },
          args.mode || "foreground",
          abortSignal,
        );
        const linkMeta = subAgentLinkMeta(result.subSessionId, args.name);
        if (result.status === "running") {
          const reason = result.error ? ` (${result.error})` : "";
          const jobHint = ` Use job_read ${result.jobId} to read the result, job_send to continue its conversation, or job_stop to cancel.`;
          return {
            content: `[Sub-agent running. Job ID: ${result.jobId}${reason}.${jobHint}]`,
            meta: { ...linkMeta, jobId: result.jobId },
          };
        }
        const parts: string[] = [];
        if (result.content) parts.push(result.content);
        // 结果交付后会话已自动冻结（仅供回放），不返回 Session ID：
        // 继续交互走 job_send（自动解冻）。隐藏只针对模型：
        // meta.link 是 UI 通道，用户仍可点开该会话回放
        const tag =
          result.status === "error"
            ? `[Sub-agent ended with error${result.error ? `. Reason: ${result.error}` : ""}. Sub-agent auto-closed.]`
            : "[Sub-agent completed and auto-closed.]";
        parts.push(tag);
        return { content: parts.join("\n"), meta: linkMeta };
      },
      display: {
        actionType: "sub_agent_create",
        text: { executing: "%subagent_spawn.executing%", completed: "%subagent_spawn.completed%" },
        aggregate: { executing: "%subagent_spawn.aggregate.executing%", completed: "%subagent_spawn.aggregate.completed%" },
        argsKey: "name",
        icon: "generic",
      },
      // 计划阶段派子代理做调研是正道（本工具包对 sub_agent 返回 loadMode:none，不会递归）。
      // 注意：子代理**不继承** planEnabled——spawn() 只继承 thinkingEffort / sandboxMode /
      // attachments，所以子代理并不受计划门的只读约束。这是**已知且已接受的风险**（
      // 见 docs/计划模式实施方案.md §8）。计划模式对子代理的不可见性由另两处保证：
      // plan-mode 工具包对 sub_agent 返回 loadMode:none，以及 plan-mode-reminder.util 的会话类型前置条件。
      allowedInPlanMode: true,
    });

    // ── Prompt: 子代理使用指南 + 可用智能体列表 ──
    subKit.registerPrompt({
      frequency: "REGULAR",
      description: "Sub-agent usage guide and available agents list",
      content: async (context: PluginContext) => {
        if (context?.session.sessionType === "sub_agent") return "";

        // ── 构建可用智能体列表 ──
        const genericAgent = {
          id: "generic",
          name: "Generic Sub-Agent",
          description:
            "A general-purpose agent capable of handling any task. Tasks that don't match a dedicated sub-agent can be delegated to this generic agent.",
        };

        // includeHidden：插件声明的执行角色（hidden:true）不出现在列表，
        // 但派活时必须让模型看到它们的 id 与描述。
        const items = (
          await this.agentStore.listAgents({ includeHidden: true })
        ).slice(0, 200);

        // 排除当前会话自身的智能体
        const currentAgentId = context?.session?.agentId;
        const dbCandidates = currentAgentId
          ? items.filter((c: any) => c.id !== currentAgentId)
          : items;

        const charAgentCfg = context?.session.getSettings?.("agents");

        let agents: any[];

        if (charAgentCfg && typeof charAgentCfg === "object") {
          const allCandidates = [genericAgent, ...dbCandidates];
          // 固定白名单：只保留显式 true 的智能体
          agents = allCandidates.filter(
            (c: any) => charAgentCfg[c.id] === true,
          );
        } else {
          // 无配置：不注入任何智能体
          agents = [];
        }

        // ── 组装提示词 ──
        const sections: string[] = [
          "# Sub-Agents",
          "",
          "## Usage Guide",
          "",
          "### 1. When to Use",
          "   - Broad codebase exploration/research across multiple files, directories, or naming conventions — especially when you only need the conclusion, not the file dumps.",
          "   - Multiple independent research questions that can run in parallel; send them in a single message with multiple subagent_spawn calls.",
          "   - The task involves heavy reasoning, e.g., in-depth debugging, complex code review, technical research.",
          "   - You care only about the final deliverable and do not need to intervene in the sub-task's execution in real time.",
          "   - The sub-task is independent and can run in parallel with other tasks without blocking.",
          "",
          "### 2. When NOT to Use",
          "   - A single known-file lookup or a task completable with one tool call → do it directly; broad or multi-area exploration → delegate.",
          "   - The task requires soliciting user input or obtaining real-time feedback during execution → sub-agents cannot directly interact with users; such interactions must remain in the main flow.",
          "",
          "### 2b. Plan Mode",
          "   - In plan mode, sub-agents are read-only; do not ask them to write or run state-changing commands. Use them for research and report findings.",
          "   - Once you delegate a search, do not repeat the same search yourself — wait for the sub-agent's conclusion.",
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
          "   - Resource release: A sub-agent's session is automatically closed (frozen, kept for replay) once its result is delivered to you — no close call is ever needed. To continue interacting with a background sub-agent, use job_send on its Job ID; it resumes automatically.",
          "   - Transparency management: Users cannot see the internal interaction logs between you and the sub-agents. You must not assume that users are aware of execution details. Ultimately, you must summarize and distill the results of sub-tasks and present them to the user in a clear, structured form.",
        ];

        if (agents.length > 0) {
          const agentXml = agents
            .map((a: any) => {
              return `   - name: ${a.name}\nid: ${a.id}\ndescription: ${a.description || ""}`;
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

    // ── @ 唤起智能体 ──
    //
    // 原独立插件 `agent` 的全部产出，合并到本插件（两者本就是同一能力的两半：
    // @ 选中的智能体最终就是 subagent_spawn 的 agentId）。
    //
    // 提供者 id 必须保持 "agent"：前端把选中项序列化为 `[@agent:<id> ...]`，
    // TagParserPipeline 按标签 type 反查解析器，改 id 会让历史消息全部失效。
    api.registerCommandProvider({
      id: "agent",
      trigger: "mention",
      fetchItems: async (ctx?: CommandContext) => {
        const items = (await this.agentStore.listAgents()).slice(0, 200);

        // 排除当前会话自身的智能体
        const candidates = ctx?.agentId
          ? items.filter((c: any) => c.id !== ctx.agentId)
          : items;

        // 无智能体上下文时，返回全部智能体（向后兼容）
        if (!ctx?.agentId) {
          return candidates.map((c: any) => ({
            name: c.id,
            description: c.name || c.id,
            label: c.name || c.id,
          }));
        }

        // 从智能体 settings 读取 agents 配置进行过滤
        const agent = await this.agentStore.findById(ctx.agentId);
        const agentCfg = (agent?.settings as any)?.agents;

        let filtered: any[];

        if (agentCfg === false) {
          filtered = [];
        } else if (typeof agentCfg === "object" && agentCfg !== null) {
          // 固定白名单：只保留显式 true 的智能体
          filtered = candidates.filter((c: any) => agentCfg[c.id] === true);
        } else {
          // 无 agents 配置：返回全部智能体
          filtered = candidates;
        }

        return filtered.map((c: any) => ({
          name: c.id,
          description: c.name || c.id,
          label: c.name || c.id,
        }));
      },
      parse: async (attrs) => {
        const agentId = attrs.name || "";
        if (!agentId) return undefined;

        const agent = await this.agentStore.findById(agentId);
        if (!agent) return undefined;

        const displayName = agent.name || agentId;
        return {
          replacement: `\`@subagent: ${displayName} (id:${agentId})\``,
          appendix: agent.description
            ? `<available_agents>name:${displayName}\nid:${agentId}\n${agent.description ? `description:${agent.description}` : ""}</available_agents>`
            : undefined,
        };
      },
    });
  }
}
