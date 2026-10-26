import type {
  CommandContext,
  CommandItem,
  ICommandProvider,
  ParserResult,
} from "../commands/interfaces/command-provider.interface";

/** 工作流命令在当前会话的可用性 */
export type WorkflowAvailability =
  | "available"
  | "unknown"
  | "no_agents"
  | "toolkit_disabled"
  | "sub_agent";

export interface WorkflowCommandDeps {
  /** 工作流插件全局启用态：关闭时命令不出现在面板，也不注入说明 */
  isEnabled: () => boolean;
  /** 按会话解析可用性；unknown 表示查不到（fail-open，按可用处理） */
  resolveAvailability: (sessionId?: string) => Promise<WorkflowAvailability>;
}

export const WORKFLOW_COMMAND_NAME = "workflow";
export const WORKFLOW_COMMAND_LABEL = "工作流";
export const WORKFLOW_COMMAND_DESCRIPTION =
  "多智能体工作流编排：并行/分阶段调度子代理执行大任务（需先在智能体设置中启用子代理）";

const AVAILABLE_APPENDIX = [
  'The user explicitly invoked the /workflow slash command. This satisfies the "user explicitly asks for a workflow" condition — proceed with workflow orchestration instead of substituting a plain answer or a single sub-agent call.',
  "",
  'If the workflow toolkit has not been loaded in this conversation yet, call tool_learn("workflow") first; then invoke workflow_run via tool_use.',
  "",
  "Write the orchestration script yourself: split the user's request into independent units, fan them out with parallel()/pipeline(), collect the results, and return a concise, well-organized summary. If the toolkit turns out to be unavailable, explain which setting must be enabled instead of attempting workflow_run.",
].join("\n");

const NO_AGENTS_APPENDIX = [
  "The user invoked the /workflow slash command, but no sub-agent is enabled for the current agent, so the workflow toolkit cannot run.",
  "Do not call workflow_run. Explain that the user must enable at least one sub-agent in the current agent's settings (Agent settings → Sub-agents), then resend the request.",
].join("\n");

const TOOLKIT_DISABLED_APPENDIX = [
  "The user invoked the /workflow slash command, but the workflow toolkit is disabled for the current agent.",
  "Do not call workflow_run. Explain that the user must enable the workflow toolkit in the current agent's settings (Agent settings → Toolkits), and make sure at least one sub-agent is enabled under Sub-agents.",
].join("\n");

const SUB_AGENT_APPENDIX = [
  "The user invoked the /workflow slash command from a sub-agent session, but workflows cannot be nested inside sub-agent sessions.",
  "Do not call workflow_run. Explain that the workflow must be started from the parent conversation.",
].join("\n");

const APPENDIX_BY_AVAILABILITY: Record<WorkflowAvailability, string> = {
  available: AVAILABLE_APPENDIX,
  unknown: AVAILABLE_APPENDIX,
  no_agents: NO_AGENTS_APPENDIX,
  toolkit_disabled: TOOLKIT_DISABLED_APPENDIX,
  sub_agent: SUB_AGENT_APPENDIX,
};

/**
 * 注册 `/workflow` 斜杠命令（与技能命令同一套 ICommandProvider 机制）。
 *
 * 命令只做显式意图标记：选中后正文保留 `[/workflow:workflow ...]` 标签，
 * parse 产出 origin=system 的注入块，告诉模型用户已显式要求工作流。
 * 不新增执行通道，也不绕过 workflow 工具包/子代理白名单门控。
 */
export function createWorkflowCommandProvider(
  deps: WorkflowCommandDeps,
): ICommandProvider {
  return {
    id: "workflow",
    trigger: "slash",
    fetchItems(): CommandItem[] {
      if (!deps.isEnabled()) return [];
      return [
        {
          name: WORKFLOW_COMMAND_NAME,
          label: WORKFLOW_COMMAND_LABEL,
          description: WORKFLOW_COMMAND_DESCRIPTION,
        },
      ];
    },
    async parse(
      _attrs: Record<string, string>,
      ctx?: CommandContext,
    ): Promise<ParserResult | undefined> {
      if (!deps.isEnabled()) return undefined;

      let availability: WorkflowAvailability = "unknown";
      try {
        availability = await deps.resolveAvailability(ctx?.sessionId);
      } catch {
        // 查询失败按未知处理（fail-open）：不阻断显式请求，模型会在工具不可用时给出提示
      }

      return {
        replacement: "`workflow`",
        appendix: APPENDIX_BY_AVAILABILITY[availability] ?? AVAILABLE_APPENDIX,
      };
    },
  };
}

const WORKFLOW_TAG = `[/workflow:${WORKFLOW_COMMAND_NAME} label="${WORKFLOW_COMMAND_LABEL}"]`;
const WORKFLOW_INPUT_RE = /^\s*\/workflow(?:\s+([\s\S]*))?\s*$/i;

/**
 * 把整段 `/workflow [任务]` 输入规范化为标签形态，交给 TagParserPipeline 统一注入
 * 显式请求说明。只有整段输入以命令开头才命中；正文中的斜杠、`/workflowx` 以及
 * 已有标签一律原样返回（与本地命令 `/compact` 的整段匹配规则一致）。
 */
export function normalizeWorkflowCommandInput(text: string): string {
  const match = WORKFLOW_INPUT_RE.exec(text);
  if (!match) return text;
  const task = (match[1] || "").trim();
  return task ? `${WORKFLOW_TAG} ${task}` : WORKFLOW_TAG;
}
