import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { PluginContext } from "../plugins/types/plugin.types";
import { CharacterRepository } from "../../common/database/character.repository";
import { WorkflowEngineService, WORKFLOW_RESULT_MAX_CHARS } from "./workflow-engine.service";
import type { WorkflowMeta } from "./workflow.types";
import langZh from "./workflow.lang.zh.json";
import langEn from "./workflow.lang.en.json";

@Injectable()
export class WorkflowPlugin extends PluginBase {
  private readonly logger = new Logger(WorkflowPlugin.name);
  manifest = {
    id: "workflow",
    name: "%workflow.name%",
    description: "%workflow.description%",
    version: "1.0.0",
    // core 级：默认启用但允许用户全局关闭（功能较重且为新功能；
    // 工具注入仍有 agents 白名单门控 + sub_agent 会话禁递归）
    category: "core" as const,
  };

  constructor(
    private workflowEngine: WorkflowEngineService,
    private characterRepo: CharacterRepository,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);

    const kit = api.registerToolKit({
      id: "workflow",
      name: "%workflow.toolkitName%",
      description: "%workflow.toolkitDescription%",
      loadMode: "eager", // 注册默认值；实际 loadMode 由 handler 按会话动态决议
      // 目录行是本工具包唯一常驻的模型面文本，承担使用门槛：
      // 低频重型编排按需学习（tool_learn），API 规格收敛在工具描述里一次性下发
      activator:
        "Use ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: learn this toolkit to write a JavaScript script that fans work out across many sub-agents with phases and structured results. For one or two delegations, prefer plain subagent calls.",
      handler: async (ctx) => {
        // 子代理会话禁止递归编排（与 sub_agent 工具同一防线）
        if (ctx.session.sessionType === "sub_agent") {
          return { loadMode: "none" as const };
        }
        // agents 白名单非空才提供，且为懒加载：目录行常驻，tool_learn 时才进上下文
        const agentsCfg = ctx.session?.getSettings?.("agents");
        const hasEnabledAgent =
          typeof agentsCfg === "object" &&
          agentsCfg !== null &&
          Object.entries(agentsCfg).some(
            ([k, v]) => !k.startsWith("__") && v === true,
          );
        return {
          loadMode: hasEnabledAgent ? ("lazy" as const) : ("none" as const),
        };
      },
    });

    // ── workflow_run：一次调用执行整段编排脚本（前台阻塞）──
    // 工具描述即脚本 API 的唯一规格（钩子语义/错误纪律/约束都在这里），
    // 使用指南与参数描述不重复承担 API 教学
    kit.registerTool({
      name: "workflow_run",
      description: `Run a JavaScript workflow script that orchestrates sub-agents at scale. Use this for work that fans out across many independent pieces — an audit over many files, a migration, multi-angle research, adversarial verification of findings — where you write the orchestration as a script instead of delegating turn by turn.

Workflow identity rides the \`name\`, \`description\` and optional \`phases\` parameters as plain JSON (never code). The \`script\` parameter is the plain JavaScript body ONLY (NOT TypeScript), running with top-level await; end with \`return <value>\` — the value must be JSON-serializable and is this tool's result.

Script-body hooks:
- \`agent(prompt, opts?): Promise<string | null>\` — run one sub-agent to completion (independent session with its own tools); resolves to the child's final output text, or null when the child fails (filter with \`.filter(Boolean)\`). opts: \`agentId\` (persona id from the Available Agents list), \`label\` (display), \`phase\` (progress group). Anything else is rejected loudly.
- \`pipeline(items, ...stages): Promise<any[]>\` — run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work). Each stage receives \`(prev, item, index)\`. An ordinary stage throw drops that ITEM to null and skips its remaining stages.
- \`parallel(thunks): Promise<any[]>\` — run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together). A throwing thunk resolves to null.
- \`phase(title)\` — start a progress phase; \`log(message)\` — narrate progress; \`args\` — the tool call's \`args\` input, verbatim.

Misused hooks (bad arguments, unknown options, tripped caps) throw errors that ALWAYS kill the script — they never dissolve into a per-item null.

Constraints: concurrency and total-agent caps apply; no filesystem, network, timers, or Node.js APIs are provided — the agents do the work, the script only coordinates them. The run executes in the foreground: this call returns when the whole script finishes.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('Workflow name (concise, e.g. "Codebase Quality Review")'),
        description: z
          .string()
          .optional()
          .describe("One-line description of what this workflow does"),
        phases: z
          .array(
            z.object({
              title: z.string().describe("Phase title"),
              detail: z.string().optional().describe("What happens in this phase"),
            }),
          )
          .optional()
          .describe(
            "Optional phase declarations for progress display (pure narration, they do not impose execution structure)",
          ),
        script: z
          .string()
          .describe(
            'The plain-JS workflow script body (top-level await allowed; end with `return <json-value>`). The tool description documents the exact hook semantics.',
          ),
        args: z
          .record(z.string(), z.any())
          .optional()
          .describe("Optional JSON input injected into the script as the global variable `args`"),
      }),
      execute: async (args, ctx, abortSignal) => {
        if (!ctx?.session) {
          throw new Error("Workflow requires a session context.");
        }
        const meta: WorkflowMeta = {
          name: args.name,
          ...(args.description ? { description: args.description } : {}),
          ...(args.phases ? { phases: args.phases } : {}),
        };
        this.logger.log(
          `启动 workflow: ${meta.name}, 父会话: ${ctx.session.sessionId}`,
        );
        const result = await this.workflowEngine.startRun(
          ctx.session,
          { script: args.script, meta, args: args.args },
          abortSignal,
        );

        if (result.status === "completed") {
          let valueText: string;
          try {
            valueText =
              result.value === undefined
                ? "undefined"
                : JSON.stringify(result.value, null, 2);
          } catch {
            valueText = String(result.value);
          }
          const truncated =
            valueText.length > WORKFLOW_RESULT_MAX_CHARS
              ? `${valueText.slice(0, WORKFLOW_RESULT_MAX_CHARS)}\n...(truncated, ${valueText.length} chars total)`
              : valueText;
          const seconds = ((result.durationMs ?? 0) / 1000).toFixed(1);
          return `Workflow "${meta.name}" completed (${result.agentCount} agents, ${seconds}s). Return value:\n${truncated}`;
        }
        if (result.status === "cancelled") {
          return `Workflow "${meta.name}" was cancelled${result.errorMessage ? `: ${result.errorMessage}` : ""}.`;
        }
        // 运行期失败：抛错 → 工具结果标记 error，模型可修正脚本重试
        throw new Error(
          `Workflow "${meta.name}" failed [${result.errorCode}]: ${result.errorMessage}`,
        );
      },
      display: {
        actionType: "workflow_run",
        text: { executing: "%workflow_run.executing%", completed: "%workflow_run.completed%" },
        aggregate: {
          executing: "%workflow_run.aggregate.executing%",
          completed: "%workflow_run.aggregate.completed%",
        },
        argsKey: "name",
        icon: "generic",
      },
    });

    // ── Prompt: workflow 使用指南 + 可用角色列表 ──
    kit.registerPrompt({
      frequency: "REGULAR",
      description: "Workflow orchestration usage guide and available agents list",
      content: async (context: PluginContext) => {
        if (context?.session.sessionType === "sub_agent") return "";

        const genericAgent = {
          id: "generic",
          name: "Generic Sub-Agent",
          description:
            "A general-purpose agent capable of handling any task. Tasks that don't match a dedicated sub-agent can be delegated to this generic agent.",
        };
        const { items } = await this.characterRepo.findAll(0, 200);
        const currentCharacterId = context?.session?.characterId;
        const dbCandidates = currentCharacterId
          ? items.filter((c: any) => c.id !== currentCharacterId)
          : items;
        const charAgentCfg = context?.session.getSettings?.("agents");
        let agents: any[];
        if (charAgentCfg && typeof charAgentCfg === "object") {
          agents = [genericAgent, ...dbCandidates].filter(
            (c: any) => charAgentCfg[c.id] === true,
          );
        } else {
          agents = [];
        }

        const sections: string[] = [
          "# Workflow Orchestration",
          "",
          "Use the workflow_run tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration; for one or two delegations, prefer plain subagent_spawn calls. The tool description documents the exact script format and hooks.",
          "",
          "Rules:",
          "   - Write self-contained prompts: sub-agents cannot see this conversation or each other; pass all needed context in the prompt text.",
          "   - Never assign the same file to multiple sub-agents for modification.",
          "   - The tool call blocks until the whole workflow finishes (the user watches live progress and can stop it); make the return value a well-organized summary — it is the tool result you will read.",
        ];

        if (agents.length > 0) {
          const agentXml = agents
            .map((a: any) => `   - name: ${a.name}\nid: ${a.id}\ndescription: ${a.description || ""}`)
            .join("\n");
          sections.push(
            "",
            "## Available Agents (usable as agent() opts.agentId)",
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
