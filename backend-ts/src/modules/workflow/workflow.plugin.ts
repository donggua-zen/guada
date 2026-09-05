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
    category: "system" as const,
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
      loadMode: "eager",
      activator:
        "Call this toolkit when you need to orchestrate a multi-step plan with several sub-agents running in parallel or in staged phases",
      handler: async (ctx) => {
        // 子代理会话禁止递归编排（与 sub_agent 工具同一防线）
        if (ctx.session.sessionType === "sub_agent") {
          return { loadMode: "none" as const };
        }
        // 与 sub_agent 相同的启用条件：agents 白名单非空才注入（避免无意义占用）
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

    // ── workflow_run：一次调用执行整段编排脚本（前台阻塞）──
    kit.registerTool({
      name: "workflow_run",
      description: `Run a multi-agent workflow orchestration script. You write a plain JavaScript script body (top-level await allowed, must end with a return of a JSON value); the engine executes it in an isolated sandbox. Inside the script, agent(prompt, opts) spawns a real sub-agent (independent session, full agent loop with tools) and resolves with its final output text (null on failure). parallel()/pipeline() compose concurrency; phase()/log() narrate progress. The tool call blocks until the whole script finishes; the script's return value is returned to you as the tool result. Use this instead of repeated subagent_spawn calls when the plan involves parallelism, staged phases, or data flowing between agents.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('Workflow name (concise, e.g. "Codebase Quality Review")'),
        description: z
          .string()
          .optional()
          .describe("What this workflow does and when to use it"),
        phases: z
          .array(
            z.object({
              title: z.string().describe("Phase title"),
              detail: z.string().optional().describe("What happens in this phase"),
            }),
          )
          .optional()
          .describe(
            "Declared phases for progress display (pure narration, they do not impose execution structure)",
          ),
        script: z
          .string()
          .describe(
            'Plain JavaScript function body. Top-level await allowed. Must end with "return <JSON value>". No TypeScript, no imports, no require. Available hooks: agent(prompt, opts?), parallel(thunks), pipeline(items, ...stages), phase(title), log(msg), plus the args variable below.',
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
          title: "Generic Sub-Agent",
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
          "## When to Use workflow_run",
          "   - The plan involves MULTIPLE sub-agents with parallelism (parallel fan-out / fan-in) or staged phases.",
          "   - Intermediate results must flow between agents (output of one becomes input of the next).",
          "   - You can express the whole plan as code up front, without needing user feedback mid-way.",
          "   For a single independent task, use subagent_spawn instead. If the task can be done with one direct tool call, do not spawn anything.",
          "",
          "## Script API (plain JavaScript function body, top-level await allowed, must `return <JSON value>`)",
          "   - `agent(prompt, opts?)` → spawns a real sub-agent (independent session with tools) and resolves with its final output text. Returns `null` if the agent failed or was stopped. opts: `{ agentId?, label?, phase? }`.",
          "   - `parallel(thunks)` → runs an array of zero-arg functions concurrently, resolves when all settle; failed entries are `null`.",
          "   - `pipeline(items, ...stages)` → each item flows through the stage chain independently (stage signature: `(prev, item, index)`), no barrier between stages.",
          "   - `phase(title)` / `log(message)` → progress narration only (shown to the user, no execution semantics).",
          "   - `args` → the JSON you passed in the `args` parameter.",
          "",
          "## Rules",
          "   - The script is pure orchestration: no require/import/fs/network. Sub-agents do the real work with their tools.",
          "   - Agent failures resolve to `null` — handle them (e.g. `results.filter(Boolean)`). Script syntax errors or invalid hook arguments fail the whole run loudly with an error code; fix the script and retry.",
          "   - Write explicit, self-contained prompts for each agent: they cannot see this conversation. Pass needed context inside the prompt text.",
          "   - Sub-agents run with the session's sandbox mode and cannot ask the user questions. Do not assign the same file to multiple agents for modification.",
          "   - The tool call blocks until the whole workflow finishes (user can watch live progress and can stop it). The script's return value is the tool result, so make it a well-organized summary.",
          "   - Do not `await agent(...)` inside huge sequential loops when parallel(pipeline) would do — parallelism is the point.",
        ];

        if (agents.length > 0) {
          const agentXml = agents
            .map((a: any) => `   - name: ${a.title}\nid: ${a.id}\ndescription: ${a.description || ""}`)
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
