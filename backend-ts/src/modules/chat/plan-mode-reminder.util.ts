/**
 * 计划模式引导提示（每轮临时注入，不落库）。
 *
 * 为什么走临时注入而不是落库或改写 system：
 * - 改写 system 会破坏 KV 前缀（`getSystemText() + getTools()` 必须逐字节稳定）；
 * - 落库会在历史里堆提醒，且退出后无法自然消失；
 * - 临时注入追加在消息尾部（novel 区），前缀零损失，退出后自动不再注入。
 *
 * 代价是"历史里查不到"——所以每个迭代都要重新追加，否则模型在第二次工具往返后就看不见约束了。
 */
import type { Message } from "../../common/types/conversation.types";
import type { ISessionContext } from "./session-context";

/** 完整工作流（每个 run 的首迭代注入一次） */
const PLAN_MODE_FULL_REMINDER = `Plan mode is active. The user does not want you to execute yet — you MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading the code and asking questions.
1. Focus on understanding the request and the code it touches. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.
2. Read-only commands are available (${process.platform === "win32" ? "only verified read-only commands are allowed; anything else is denied" : "they run in a read-only sandbox"}). Use them to investigate the repository state.

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
3. If anything is genuinely ambiguous, end your turn with your question.

### Phase 4: Call ExitPlanMode
At the very end of your turn, once you are happy with your final plan, call ExitPlanMode to present it for approval. Do not stop for any other reason.

**Important:** Do NOT ask for plan approval in plain text. ExitPlanMode is what requests approval.`;

/** 稀疏提醒（同一 run 的后续迭代，控制 token 成本） */
const PLAN_MODE_SPARSE_REMINDER =
  "Plan mode still active (see the full instructions earlier in the conversation). " +
  "Read-only. Follow the 4-phase workflow. End your turn with ExitPlanMode when the plan is ready.";

/** 退出提醒（一次性：计划模式由 true 变 false 后的下一个迭代） */
const PLAN_MODE_EXIT_REMINDER = `## Exited Plan Mode

You have exited plan mode. You can now make edits, run commands, and take actions.`;

/**
 * 组装本迭代要临时追加的消息（顺序：退出提醒在前，计划态引导在后）。
 *
 * 变体选择：每个 run 的首迭代（iterationCount === 1）注入完整工作流，同 run 后续迭代用稀疏版。
 * 这个选择是确定性的、无额外状态、重启自愈——新 run 必然重新拿到完整版。
 */
export function buildPlanModeTurnEntries(
  sessionContext: ISessionContext,
  iterationCount: number,
): Message[] {
  const entries: Message[] = [];

  if (sessionContext.consumePlanModeExitReminder()) {
    entries.push(planModeReminderMessage(PLAN_MODE_EXIT_REMINDER));
  }

  if (sessionContext.getPlanEnabled()) {
    entries.push(
      planModeReminderMessage(
        iterationCount === 1
          ? PLAN_MODE_FULL_REMINDER
          : PLAN_MODE_SPARSE_REMINDER,
      ),
    );
  }

  return entries;
}

/**
 * 提醒消息形态：role='user'（模型侧按用户消息权重处理）+ kind='model'。
 *
 * kind='model' 是刻意的——`pickBaselineUserMessage` 只跳过 kind==='model'，
 * 这样临时注入不会被当作"上一条真实用户消息"，不污染模式切换检测基准。
 * 该消息只存在于请求数组，永不落库。
 */
function planModeReminderMessage(text: string): Message {
  return {
    id: `plan-reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "plan-mode" },
    metadata: { hidden: true, transient: true },
    content: [{ type: "text", text }],
  };
}
