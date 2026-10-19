/**
 * 计划模式每轮提醒（provider 实现）。
 *
 * 设计（对齐 deepseek-harness 的 provider 分层，但保留本项目自己的投递点）：
 * - 首轮完整提醒**按计划周期（epoch）落库一次**：模型在后续所有工具往返里都能从历史看到，
 *   审计也能查到；压缩遮蔽后由本轮 provider 自动补一份。
 * - 同 run 的后续迭代只追加稀疏提醒（临时、不落库），控制 token 成本。
 * - 退出检测不再依赖一次性内存 flag：扫历史里最近的 `planModeReminder` 标记，
 *   看到 `full` 且当前已退出，就落一条持久化退出说明；看到 `exit` 则不重复。
 *
 * 落库必须用 `appendMessages` + `kind='model'`（由引擎统一执行），不能走 `addUserMessage`：
 * 后者硬编码 `kind='user'` 并写 `metadata.planEnabled`，会污染模式切换基准。
 */
import type { Message } from "../../../common/types/conversation.types";
import { wrapSystemReminder } from "../../../common/utils/system-reminder.util";
import type { ISessionContext } from "../../chat/session-context";
import type { ResolvedPluginInfo } from "../types/plugin.types";
import type { TurnReminderInjection } from "../turn-reminders/turn-reminder.types";

/** 只读约束在本平台的表述（Windows 走命令白名单，其余平台走只读沙盒） */
const READ_ONLY_NOTE =
  process.platform === "win32"
    ? "only verified read-only commands are allowed; anything else is denied"
    : "they run in a read-only sandbox";

/** 提问工具名（plugins/builtins/ask-user.plugin.ts） */
const ASK_USER_TOOL_NAME = "ask_user";

/** 计划模式插件 id（用于确认插件确实启用，禁用插件也会执行 onLoad） */
const PLAN_MODE_PLUGIN_ID = "plan-mode";

export type PlanModeReminderKind = "full" | "exit";

export interface PlanModeMarker {
  kind: PlanModeReminderKind;
  epoch: string | null;
}

/**
 * 首迭代完整工作流。
 *
 * 两处"工具面二选一"（判据一律取"本会话实际解析出的工具"）：
 * - Phase 1 的探索方式：按"本会话有没有子代理工具"；
 * - Phase 3/4 的提问方式：按"本会话有没有 ask_user 工具"。
 */
function buildFullReminder(
  hasSubAgentTool: boolean,
  hasAskTool: boolean,
): string {
  const phase1Goal = hasAskTool
    ? "Goal: Gain a comprehensive understanding of the user's request by reading the code and asking questions. When a decision is genuinely the user's to make and you cannot resolve it from the code or sensible defaults, ask with the ask_user tool instead of guessing."
    : "Goal: Gain a comprehensive understanding of the user's request by reading the code and asking questions.";

  const phase1 = hasSubAgentTool
    ? `### Phase 1: Initial Understanding
${phase1Goal}
1. Broad search first: launch up to 3 read-only research sub-agents in parallel (a single message with multiple tool calls), one search focus each (the code path, existing patterns worth reusing, tests). Use a single sub-agent when the task is isolated to known files. Once you delegate a search, do not also run it yourself — wait for the result.
2. Read-only commands are available (${READ_ONLY_NOTE}). Use them to inspect repository state, or to investigate directly when delegating is not worthwhile.
3. Focus on understanding the request and the code it touches. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.`
    : `### Phase 1: Initial Understanding
${phase1Goal}
1. Focus on understanding the request and the code it touches. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.
2. Read-only commands are available (${READ_ONLY_NOTE}). Use them to investigate the repository state.`;

  const phase3Step3 = hasAskTool
    ? "3. Use the ask_user tool to clarify any remaining questions with the user before finalizing your plan."
    : "3. If anything is genuinely ambiguous, end your turn with your question.";

  const phase4Tail = hasAskTool
    ? " This is critical — your turn must only end with either the ask_user tool (to clarify requirements) or ExitPlanMode (to request plan approval)."
    : "";

  const important = hasAskTool
    ? "**Important:** Use ask_user ONLY to clarify requirements or choose between approaches. " +
      "Ask for plan approval ONLY via ExitPlanMode — never via plain text, and never via ask_user. " +
      'Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", or similar MUST use ExitPlanMode.'
    : "**Important:** Do NOT ask for plan approval in plain text. ExitPlanMode is what requests approval.";

  return `Plan mode is active. The user does not want you to execute yet — you MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan Workflow

${phase1}

### Phase 2: Design
Goal: Design an implementation approach.
- Use the context gathered in Phase 1, including relevant files and code paths.
- Account for the user's requirements and constraints.
- Produce a concrete implementation plan detailed enough to execute.
- Consider the perspectives that matter for this task type:
  - New feature: simplicity vs performance vs maintainability
  - Bug fix: root cause vs workaround vs prevention
  - Refactoring: minimal change vs clean architecture

### Phase 3: Review
1. Re-read the critical files to deepen your understanding.
2. Make sure the plan matches the user's original request.
${phase3Step3}

### Phase 4: Call ExitPlanMode
At the very end of your turn, once you are happy with your final plan, call ExitPlanMode to present it for approval. Do not stop for any other reason.${phase4Tail}

${important}`;
}

/** 稀疏提醒（同 run 的后续迭代，控制 token 成本）——提问方式同样按工具面二选一 */
function buildSparseReminder(hasAskTool: boolean): string {
  const ending = hasAskTool
    ? "End your turn with either the ask_user tool (for clarifications) or ExitPlanMode (for plan approval)."
    : "End your turn with ExitPlanMode when the plan is ready.";
  return (
    "Plan mode still active (see the full instructions earlier in the conversation). " +
    `Read-only. Follow the 4-phase workflow. ${ending}`
  );
}

/** 退出说明（持久化）：明确覆盖历史里的 "Plan mode is active" */
export const PLAN_MODE_EXIT_REMINDER = `## Exited Plan Mode

You have exited plan mode. The earlier plan-mode instructions (including "Plan mode is active" and its statement that it supersedes other instructions) no longer apply. You can now make edits, run commands, and take actions.`;

/** 最近一条计划模式标记（full / exit）；没有则 null */
export function findLatestPlanModeMarker(
  history: readonly Message[],
): PlanModeMarker | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const metadata = (history[i].metadata || {}) as Record<string, any>;
    const kind = metadata.planModeReminder;
    if (kind === "full" || kind === "exit") {
      return {
        kind,
        epoch:
          typeof metadata.planModeEpoch === "string"
            ? metadata.planModeEpoch
            : null,
      };
    }
  }
  return null;
}

/**
 * 本会话实际解析出的工具是否存在（等价于 ToolExecutor.findTool 的 eager 口径）。
 * 本地实现而非 import ToolExecutor：避免 PluginsModule 反向依赖 ToolsModule。
 */
function hasTool(
  resolved: readonly ResolvedPluginInfo[],
  toolName: string,
): boolean {
  return resolved.some(
    (rp) => rp.enabled && rp.enabledTools.some((tool) => tool.name === toolName),
  );
}

/** 计划模式插件是否启用（禁用插件也会 onLoad 并注册 provider，必须自门控） */
function isPlanModePluginEnabled(
  resolved: readonly ResolvedPluginInfo[],
): boolean {
  return resolved.some(
    (rp) => rp.plugin?.id === PLAN_MODE_PLUGIN_ID && rp.enabled,
  );
}

/** 持久化提醒消息：落库后进入历史，供后续请求与审计使用 */
function persistedReminderMessage(
  sessionContext: ISessionContext,
  text: string,
  kind: PlanModeReminderKind,
  epoch: string | null,
): Message {
  return {
    id: sessionContext.generateMessageId(),
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: PLAN_MODE_PLUGIN_ID },
    metadata: {
      plugin: PLAN_MODE_PLUGIN_ID,
      hidden: true,
      planModeReminder: kind,
      ...(epoch ? { planModeEpoch: epoch } : {}),
    },
    content: [{ type: "text", text: wrapSystemReminder(text) }],
  };
}

/** 临时提醒消息：只存在于请求数组，永不落库 */
function transientReminderMessage(text: string): Message {
  return {
    id: `plan-reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: PLAN_MODE_PLUGIN_ID },
    metadata: {
      plugin: PLAN_MODE_PLUGIN_ID,
      hidden: true,
      transient: true,
    },
    content: [{ type: "text", text: wrapSystemReminder(text) }],
  };
}

/**
 * 构建本迭代的计划模式提醒。
 *
 * 返回：
 * - `persist`：完整提醒 / 退出说明（引擎 appendMessages 后重读历史）；
 * - `transient`：稀疏提醒（只追加到本次请求）。
 */
export function buildPlanModeTurnInjection(
  sessionContext: ISessionContext,
  iterationCount: number,
  history: readonly Message[],
): TurnReminderInjection {
  // 计划模式对子代理不可见：工具包已被 toolkit handler 摘掉，提示词面同样收口
  if (sessionContext.sessionType === "sub_agent") return {};

  const resolved = sessionContext.getResolvedPlugins();
  if (!isPlanModePluginEnabled(resolved)) return {};

  const latest = findLatestPlanModeMarker(history);
  const epoch = sessionContext.getPlanModeEpoch();

  // 已退出：只有模型最后一次被告知的是 full 时才需要补退出说明
  if (!sessionContext.getPlanEnabled()) {
    if (latest?.kind === "full") {
      return {
        persist: [
          persistedReminderMessage(
            sessionContext,
            PLAN_MODE_EXIT_REMINDER,
            "exit",
            latest.epoch ?? epoch,
          ),
        ],
      };
    }
    return {};
  }

  // 提示词与工具面一致：ExitPlanMode 不在册时不再引导模型去调它
  if (!hasTool(resolved, "ExitPlanMode")) return {};

  const hasAskTool = hasTool(resolved, ASK_USER_TOOL_NAME);

  // 当前周期已有可见完整提醒：后续迭代只给稀疏版
  if (latest?.kind === "full" && latest.epoch === epoch) {
    if (iterationCount > 1) {
      return {
        transient: [transientReminderMessage(buildSparseReminder(hasAskTool))],
      };
    }
    return {};
  }

  // 无完整提醒 / epoch 不匹配 / 被压缩遮蔽：重新落一份完整版
  return {
    persist: [
      persistedReminderMessage(
        sessionContext,
        buildFullReminder(hasTool(resolved, "subagent_spawn"), hasAskTool),
        "full",
        epoch,
      ),
    ],
  };
}
