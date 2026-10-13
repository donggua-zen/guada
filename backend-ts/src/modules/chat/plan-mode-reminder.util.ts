/**
 * 计划模式引导提示（每轮临时注入，不落库）。
 *
 * 为什么走临时注入而不是落库或改写 system：
 * - 改写 system 会破坏 KV 前缀（`getSystemText() + getTools()` 必须逐字节稳定）；
 * - 落库会在历史里堆提醒，且退出后无法自然消失；
 * - 临时注入追加在消息尾部（novel 区），前缀零损失，退出后自动不再注入。
 *
 * 代价是"历史里查不到"——所以每个迭代都要重新追加，否则模型在第二次工具往返后就看不见约束了。
 *
 * 提示词与工具面必须一致：工具面按会话类型/插件开关摘掉的东西，提示词里也不能再引导模型去调
 * （两道前置条件见 buildPlanModeTurnEntries；工具包对子代理的隐藏见 plan-mode.plugin.ts 的 handler）。
 */
import type { Message } from "../../common/types/conversation.types";
import type { ISessionContext } from "./session-context";
import { ToolExecutor } from "../tools/tool-executor.service";

/** 只读约束在本平台的表述（Windows 走命令白名单，其余平台走只读沙盒） */
const READ_ONLY_NOTE =
  process.platform === "win32"
    ? "only verified read-only commands are allowed; anything else is denied"
    : "they run in a read-only sandbox";

/**
 * 首迭代注入的完整工作流。
 *
 * Phase 1 的探索方式按"本会话有没有子代理工具"二选一。`subagent_spawn` 可能因为插件被全局关闭、
 * 智能体 toolkit deny、或当前就是子代理会话而根本不在册——那时绝不能引导模型去派子代理：
 * 引导指向一个不存在的工具，模型只会空转。判据取"本会话实际解析出的工具"，
 * 而不是全局插件开关（后者覆盖不了后两种"没打开"）。
 */
function buildFullReminder(hasSubAgentTool: boolean): string {
  const phase1 = hasSubAgentTool
    ? `### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading the code and asking questions.
1. Broad search first: launch up to 3 read-only research sub-agents in parallel (a single message with multiple tool calls), one search focus each (the code path, existing patterns worth reusing, tests). Use a single sub-agent when the task is isolated to known files. Once you delegate a search, do not also run it yourself — wait for the result.
2. Read-only commands are available (${READ_ONLY_NOTE}). Use them to inspect repository state, or to investigate directly when delegating is not worthwhile.
3. Focus on understanding the request and the code it touches. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.`
    : `### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading the code and asking questions.
1. Focus on understanding the request and the code it touches. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.
2. Read-only commands are available (${READ_ONLY_NOTE}). Use them to investigate the repository state.`;

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
3. If anything is genuinely ambiguous, end your turn with your question.

### Phase 4: Call ExitPlanMode
At the very end of your turn, once you are happy with your final plan, call ExitPlanMode to present it for approval. Do not stop for any other reason.

**Important:** Do NOT ask for plan approval in plain text. ExitPlanMode is what requests approval.`;
}

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

  // 前置条件一：计划模式对子代理不可见。工具面已经按会话类型把整个计划工具包摘掉了
  // （plan-mode.plugin.ts 的 toolkit handler），提示词面必须同样收口——否则子代理会被指挥
  // 去调用一个它根本看不见的工具。放在退出提醒之后：退出提醒是纯状态通知，与会话类型无关。
  if (sessionContext.sessionType === "sub_agent") return entries;

  const resolved = sessionContext.getResolvedPlugins();

  // 前置条件二：ExitPlanMode 真的在册。计划工具包可被 plugins_config 关闭、也可被智能体
  // toolkit deny 摘掉——那时提示词里再要求"用 ExitPlanMode 提交计划"就是指向空气。
  if (!ToolExecutor.findTool(resolved, "ExitPlanMode")) return entries;

  if (sessionContext.getPlanEnabled()) {
    entries.push(
      planModeReminderMessage(
        iterationCount === 1
          ? buildFullReminder(
              !!ToolExecutor.findTool(resolved, "subagent_spawn"),
            )
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
