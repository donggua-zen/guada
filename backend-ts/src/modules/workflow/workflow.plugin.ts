import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { PluginBase } from "../plugins/base-plugin";
import { PluginApi } from "../plugins/api/plugin-api";
import { SessionService } from "../chat/session.service";
import { isToolkitAllowedByRoleConfig } from "../plugins/utils/role-toolkit-filter";
import { WorkflowEngineService, WORKFLOW_RESULT_MAX_CHARS } from "./workflow-engine.service";
import type { WorkflowMeta } from "./workflow.types";
import {
  createWorkflowCommandProvider,
  type WorkflowAvailability,
} from "./workflow.command";
import { WORKFLOW_SKILL, WORKFLOW_SKILL_DESCRIPTION } from "./workflow.skill";
import { SkillRegistry } from "../skills/core/skill-registry.service";
import langZh from "./workflow.lang.zh.json";
import langEn from "./workflow.lang.en.json";

/**
 * Workflow —— 多子代理编排。
 *
 * 加载模型（v4.1，对齐 browser-script 的「薄工具 + 技能」范式）：
 * - 工具包 eager：workflow_run 作为单入口常驻 function list，描述只保留
 *   必要约定（能力一行 + 必须先 skill_learn("workflow") + 脚本基本形态）；
 * - 完整脚本 API（hooks/失败语义/限制/示例）注册为插件技能，skill_learn
 *   时才进入上下文，默认零注入；
 * - 不再注册 toolkit prompt：静态指南已进技能；可用智能体清单由 sub-agent
 *   插件（同为 eager）的 "## Available Agents" 段提供，条件与 workflow 一致
 *   （均要求 settings.agents 有启用项），无需重复注入。
 */
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
    private sessionService: SessionService,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    api.registerNls("zh", langZh);
    api.registerNls("en", langEn);

    // ── 斜杠命令 /workflow：用户显式发起工作流的入口 ──
    // 只做意图标记与可用性引导，不新增执行通道：标签由 TagParserPipeline 冻结为
    // origin=system 注入块，模型仍走 skill_learn("workflow") → workflow_run。
    api.registerCommandProvider(
      createWorkflowCommandProvider({
        isEnabled: () => this._enabled,
        resolveAvailability: (sessionId) =>
          this.resolveWorkflowAvailability(sessionId),
      }),
    );

    const kit = api.registerToolKit({
      id: "workflow",
      name: "%workflow.toolkitName%",
      description: "%workflow.toolkitDescription%",
      // eager：单入口工具直接进 function list（薄描述成本）；长文档在技能里。
      // 运行时仍由 handler 按会话收口：子代理会话 / 无启用子代理 → none。
      loadMode: "eager",
      handler: async (ctx) => {
        // 子代理会话禁止递归编排（与 sub_agent 工具同一防线）
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

    // ── 能力包技能：完整脚本 API 指南（skill_learn("workflow") 按需加载）──
    // 注册为 workflow 能力包的技能：随该包门控显隐——智能体禁用 workflow 包、
    // 子代理会话（handler → none）、无启用子代理时，技能与工具同步消失。
    // description 会出现在系统提示词 # Skills 清单里，承担"调用前必读"的引导。
    kit.registerSkill({
      name: "workflow",
      description: WORKFLOW_SKILL_DESCRIPTION,
      content: WORKFLOW_SKILL,
      version: "1.0.0",
      tags: ["workflow", "orchestration", "sub-agent"],
    });

    // ── workflow_run：一次调用执行整段编排脚本（前台阻塞）──
    // 薄描述：只做能力声明 + 必读引导 + 脚本基本形态；完整 hooks/限制/示例
    // 在 workflow 技能里（skill_learn 按需加载）
    kit.registerTool({
      name: "workflow_run",
      description: `Run a JavaScript workflow script that orchestrates sub-agents at scale (fan-out audits, migrations, multi-angle research, adversarial verification). Use ONLY when the user explicitly asks for a workflow (including the /workflow command) or for large multi-agent orchestration; for one or two delegations, prefer plain subagent_spawn calls.

PREREQUISITE: call skill_learn("workflow") before using this tool. It is the only source of truth for the script hooks (agent/pipeline/parallel/phase/log), failure semantics, limits and agent selection; do not write scripts from memory.

The script is a plain-JavaScript body (NOT TypeScript) with top-level await and must end with return <JSON-serializable value>, which becomes this tool's result. The call executes in the foreground: it returns when the whole script finishes.`,
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
          {
            script: args.script,
            meta,
            args: args.args,
            // 关联键：把 run 绑回本次 workflow_run 工具调用（前端在调用处原地渲染进度）
            toolCallId: ctx.toolCallId,
          },
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
          const jobLine = result.jobId ? `\nJob ID: ${result.jobId}` : "";
          return `Workflow "${meta.name}" completed (${result.agentCount} agents, ${seconds}s). Return value:\n${truncated}${jobLine}`;
        }
        if (result.status === "cancelled") {
          const jobLine = result.jobId ? ` Job ID: ${result.jobId}` : "";
          return `Workflow "${meta.name}" was cancelled${result.errorMessage ? `: ${result.errorMessage}` : ""}.${jobLine}`;
        }
        // 运行期失败：抛错 → 工具结果标记 error，模型可修正脚本重试
        throw new Error(
          `Workflow "${meta.name}" failed [${result.errorCode}]: ${result.errorMessage}${result.jobId ? ` (job: ${result.jobId})` : ""}`,
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
  }

  /**
   * 卸载时清除插件技能。
   *
   * 刻意不放 onStop：禁用→启用只走 onStart，不会重新执行 onLoad，
   * 放 onStop 会导致技能永久消失（与 browser-script 同一纪律）。
   */
  async onUnload(): Promise<void> {
    SkillRegistry.getInstance()?.unregisterByProvider("plugin:workflow");
  }

  /**
   * 解析工作流在当前会话是否可用。
   *
   * 工作流工具有两层门控：workflow 插件/toolkit 的启用态，以及会话/智能体的
   * settings.agents 白名单。这里只决定 /workflow 的注入文案，不改变门控本身；
   * 查不到会话时返回 unknown（fail-open），避免元数据暂缺时吞掉显式请求。
   */
  private async resolveWorkflowAvailability(
    sessionId?: string,
  ): Promise<WorkflowAvailability> {
    if (!sessionId) return "unknown";
    try {
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) return "unknown";
      if (session.sessionType === "sub_agent") return "sub_agent";

      const pluginsCfg =
        session.settings?.plugins ?? session.agent?.settings?.plugins;
      if (!isToolkitAllowedByRoleConfig(pluginsCfg?.workflow, "workflow")) {
        return "toolkit_disabled";
      }

      const agentsCfg =
        session.settings?.agents ?? session.agent?.settings?.agents;
      const hasEnabledAgent =
        typeof agentsCfg === "object" &&
        agentsCfg !== null &&
        Object.entries(agentsCfg).some(
          ([key, enabled]) => !key.startsWith("__") && enabled === true,
        );
      return hasEnabledAgent ? "available" : "no_agents";
    } catch (error) {
      this.logger.warn(
        `解析工作流可用性失败，按 unknown 处理: ${(error as Error)?.message || error}`,
      );
      return "unknown";
    }
  }
}
