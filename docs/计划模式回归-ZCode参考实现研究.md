# 计划模式回归 —— ZCode 参考实现研究

> 日期：2026-10-04 | 状态：研究结论（未实施）
> 目的：为 [`安全模式三档方案.md`](安全模式三档方案.md) §6 待办 1「计划模式回归」提供第三方参考实现
> **后续**：基于本文结论已产出方案 [`计划模式实施方案.md`](计划模式实施方案.md) 并**完成实施**（2026-10-04）
> 参考对象：[zai-org/ZCode](https://github.com/zai-org/ZCode)（Apache-2.0，main 分支，快照版本 **3.14.3**，2026-09-29）
> 本地快照：`D:\g\zcode`（tarball 经 codeload 下载；`github.com` 的 git 协议在本机被重置，`codeload.github.com` 可用）

---

## 0. 结论摘要

ZCode 的计划模式有一个非常干净的架构决策，直接回答了本项目待办里那个悬而未决的问题——**计划状态该挂在哪里**：

> **计划不是模式（mode）的一个取值，而是一个与权限模式正交的独立布尔 `planEnabled`。**

```ts
// apps/zcode-cli/packages/contracts/src/interfaces/session.port.ts:32
export type CollaborationMode = "plan" | "build" | "edit" | "yolo" | "auto";

// packages/shared/src/execution-state.ts:3-9
export const executionPermissionModeSchema = z.enum(["build", "edit", "yolo", "auto"]);
export const executionStateSchema = z.object({
  mode: executionPermissionModeSchema,
  planEnabled: z.boolean(),
});
```

`"plan"` 只在**旧格式读取边界**与**用户可见命令面**存活；内部真实状态是 `{ mode, planEnabled }` 二元组。这与本项目 `安全模式三档方案.md` §4 的判断完全一致（"DSH 的 plan mode 是正交的软引导协作状态"），并且给出了比 DSH 更明确的可抄结构。

围绕这个核心，ZCode 用四层机制把它落地：

| 层 | 机制 | 一句话 |
|---|---|---|
| 状态 | `ExecutionState { mode, planEnabled }` | 正交布尔，进入计划不改权限档位 |
| 引导 | **每轮重算的** `runtime_mode` system reminder（4 阶段工作流） | 软引导，不进 system prompt、不破 KV 前缀 |
| 强制 | 权限层 `checkPlanMode` 三分支（只读放行 / MCP 放行 / 其余硬拒） | 强制力由权限层承担，与引导解耦 |
| 出口 | `ExitPlanMode` 工具 → 复用 userInput/elicitation 审批通道 | 审批就是一次 ask，拒收文本反馈转为真实 user 消息 |

对本项目最有价值的三点（按可复用度排序）：

1. **审批环节几乎零成本**——ZCode 的计划审批就是"一次带自由文本的 ask"，与本项目已实施的统一 Ask 体系（`AskService` / `POST /chat/respond` / `ask/asked|answered` 审计）同构，可直接映射。
2. **提示注入方式与本项目现有惯例兼容**——ZCode 把计划指引做成**每轮重算的临时 message attachment**而非 system prompt 改写，本项目已有 `<system_reminder>` + `origin='system'` 的注入惯例，机制现成。
3. **最大缺口是工具能力元数据**——ZCode 的权限门依赖每个工具的 `readOnly / destructive / sideEffectScope / allowedInPlanMode` 声明，而本项目 `ToolDefinition` 只有 `{ name, description, parameters }`。这是唯一需要"先补地基再盖楼"的部分。

---

## 1. 参考快照信息

| 项 | 值 |
|---|---|
| 仓库 | `zai-org/ZCode` — "Z.ai's coding agent harness. Powerful, intelligent, extensible." |
| 许可 | Apache-2.0 |
| 版本 | 3.14.3（根 `package.json`） |
| 分支/时间 | `main`，pushed_at 2026-09-29 |
| 本地路径 | `D:\g\zcode`（84 MB，已排除 node_modules） |
| 上游位置 | `apps/zcode-cli/packages/{core,contracts,bootstrap,cli,tui}` + `packages/{ui,shared,services}` |

**重要事实**：ZCode 开源仓库就是本项目当前运行所在的这套 harness 本体。`apps/zcode-cli/packages/core/src/context/dynamic-sections.ts` 里逐字包含本会话 system prompt 的"Communicating with the user"等段落。因此研究结论可以直接用**运行时观察**交叉验证——例如本会话手上的 `EnterPlanMode` / `ExitPlanMode` 工具描述，就是 `plan-mode-prompts.ts` 的原文输出。这层"源码 ↔ 实测"的对应关系是本次研究相对一般开源参考的额外可信度来源。

**公开快照的取舍**：仓库**不含任何计划模式测试**（全仓仅 4 个与本功能无关的 `*.test.ts`，`apps/zcode-cli/packages/core/package.json` 无 test 脚本）。因此本报告的"不变量"来自源码注释与实现本身，而非测试断言。

---

## 2. 状态模型与生命周期

### 2.1 状态容器

```ts
// apps/zcode-cli/packages/core/src/runtime/execution-state.ts:43-82（节选）
export async function applyRuntimeExecutionState(
  runtime, input: { mode?: string; planEnabled?: boolean },
  cause: { source: "command" | "tool"; toolCallId?: string; traceContext?: TraceContext },
): Promise<ExecutionState> {
  if (runtime.permissionFullAccessPending)
    throw new Error("Permission update is busy; retry mode change");
  const previous = readRuntimeExecutionState(runtime);
  const next = resolveExecutionState(input, previous);
  if (next.mode === previous.mode && next.planEnabled === previous.planEnabled) return next;

  // 互斥守卫：Goal 活跃时不得进入计划模式
  if (next.planEnabled && !previous.planEnabled) {
    const goal = await runtime.readSessionTargetForContext?.(...);
    if (goal?.status === "active")
      throw new Error("Plan and Goal cannot be active at the same time.");
  }

  await persistExecutionState(runtime, next);   // 先落盘
  runtime.config.mode = next.mode;              // 再改内存
  runtime.config.planEnabled = next.planEnabled;
  if (previous.planEnabled !== next.planEnabled)
    runtime.needsPlanModeExitReminder = !next.planEnabled;
  await runtime.appendEvent(runtime.createEvent(SessionEventType.SessionModeChanged, {
    ...next, previousMode: previous.mode, previousPlanEnabled: previous.planEnabled,
    source: cause.source, ...(cause.toolCallId ? { toolCallId: cause.toolCallId } : {}),
  }, trace), trace);
  return next;
}
```

四个值得抄的设计点：

1. **先持久化、后改内存**（`persistExecutionState` → `runtime.config.*`）。崩溃语义清晰：磁盘是事实源，内存是投影。
2. **幂等**：状态未变则提前返回，不产生事件（重复调用 EnterPlanMode 无副作用）。
3. **互斥守卫内聚在状态转换里**，不散落在各入口。ZCode 的互斥对象是 Goal（自主执行目标）；本项目当前无 Goal 概念，此条暂无对应物。
4. **`previousMode` / `previousPlanEnabled` 随事件一起写**——审计与前端动画都需要知道从哪来。

### 2.2 旧格式归一化（兼容层的写法）

```ts
// packages/shared/src/execution-state.ts:11-23
/** 在接纳边界固定旧请求语义，不能在队列消费时按当前配置重新解释。 */
export function resolveExecutionState(
  input: { mode?: string; planEnabled?: boolean },
  current: ExecutionState = { mode: "build", planEnabled: false },
): ExecutionState {
  const mode = executionPermissionModeSchema.safeParse(input.mode);
  return {
    mode: mode.success ? mode.data : current.mode,
    planEnabled:
      input.planEnabled ??
      (input.mode === "plan" ? true : mode.success ? false : current.planEnabled),
  };
}
```

`{mode:"plan"}` 被翻译为 `{mode: 不变, planEnabled: true}`；`{mode:"build"}` 在计划态下被翻译为 `planEnabled: false`。**归一化发生在接纳边界（admission）**，而不是消费时——注释明确写了原因："不能在队列消费时按当前配置重新解释"。本项目若要兼容历史数据/旧前端，这是正确的位置。

### 2.3 持久化：三条通道

| 通道 | 内容 | 位置 |
|---|---|---|
| Session entry | `ExecutionState` 快照（last-wins） | `SESSION_ENTRY_EXECUTION_STATE = "runtime/execution_state"`；`buildExecutionStateEntry()` 生成 id `${sessionId}:runtime-execution-state` |
| 事件日志 | `SessionModeChanged`（可 fold 出状态、天然审计） | `contracts/src/events/session.events.ts:641-649` |
| 逐消息/逐意图 | 每条 assistant/timeline 消息与每个排队 intent 各存一份当时的 `mode + planEnabled` | `message-persistence.ts:312-313`、`steering.ts:1131` |

第三条是最容易忽略也最关键的：**每个回合按"接纳那一刻"的计划状态解释**，而不是按"现在"的状态。队列里排着的消息不会因为用户后来切了模式而改变语义。

`SessionModeChangedPayload` 完整形态：

```ts
export interface SessionModeChangedPayload {
  permissionGrant?: { interactionId: string; queueItemIds: string[] };
  planEnabled?: boolean;
  previousPlanEnabled?: boolean;
  mode: CollaborationMode;
  previousMode: CollaborationMode;
  source: "tool" | "command" | "system";
  toolCallId?: ToolCallId;
}
```

冷启动恢复（`runtime/methods/resume.ts:193-216`）：先由事件日志 fold 出 `mode`，再由 session entry 覆盖（"会话自己的新记录优先于项目偏好；旧记录仅兼容读取，不批量回填"）。项目级偏好另存（`getProjectPermissionMode(projectID)`，SQLite local-settings）。

---

## 3. 两个工具契约

### 3.1 名称与 schema

```ts
// apps/zcode-cli/packages/contracts/src/tools/plan-mode.ts:10-13
export const ENTER_PLAN_MODE_TOOL_NAME = "EnterPlanMode";
export const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";
export const PLAN_MODE_MAX_PLAN_CHARS = 20_000;
```

| | EnterPlanMode | ExitPlanMode |
|---|---|---|
| 输入 | `z.object({}).strict()`（零参数） | `{ plan: string (1..20000, 非空白), allowedPrompts?: {tool:"Bash", prompt:string}[] }` |
| 输出 | `{ message, mode, previousMode, planEnabled?, previousPlanEnabled? }` | `{ plan, approved: true, mode, previousMode, planEnabled?, previousPlanEnabled?, allowedPrompts? }` |
| 权限 | **无条件 allow，不弹窗** | `needsApproval` + `requiresUserInteraction` → **ask** |
| 元数据 | `readOnly:false, destructive:false, sideEffectScope:"session", riskLevel:"low", timeoutMs:30000` | 同左，另加 `requiresUserInteraction:true` |
| 计划态外调用 | 幂等（已在计划态则无操作） | 硬拒：`"You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation."` |

注意 `ExitPlanModeOutput.mode` 的枚举**不含 `"plan"`**（`z.enum(["build","edit","yolo","auto"])`）——类型层面就保证出口之后不再处于计划态。这是个值得抄的类型技巧。

### 3.2 进入计划态后注入给模型的指令

工具结果本身携带一段强引导（`handlers/plan-mode.ts:257-270`）：

```
Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.
```

### 3.3 审批通过后回给模型的文本

```
User has approved your plan. You can now start coding. Start with updating your todo list if applicable.

## Approved Plan:
<plan>
```

（计划为空时退化为 `"User has approved exiting plan mode. You can now proceed."`）

---

## 4. 权限门（强制力所在）

### 4.1 决策顺序

`permission/service.ts:97-231` 的判定顺序，计划相关部分：

```
1. 计划转换策略 resolvePlanModeTransitionPermission   ← 压过一切
2. capability.requiresUserInteraction → ask
3. capability.alwaysAsk → checkAlwaysAsk
4. mode === "yolo" && !planEnabled → allow
5. mode === "auto" → deny
6. config.disallowedTools → deny
7/8. 项目规则 deny / ask
9. planEnabled → checkPlanMode          ← 计划门
10. 项目 allow / WebFetch 预批 / workflow 草稿预批 / config.allowedTools / edit/build
```

两个刻意的顺序选择值得注意：

- **`requiresUserInteraction` 早于计划门**。所以 `AskUserQuestion` 和 `ExitPlanMode` 在计划态下依然可用（前者是澄清需求的正道，后者是出口）。若把计划门提前，模型会被彻底锁死无法提问。
- **项目 `ask` 规则早于计划门**。意味着用户显式配置的"这个工具需要问我"可以穿透计划态（问过之后仍能执行）。计划门只硬拒**落到底部**的调用。

### 4.2 转换策略

```ts
// core/src/permission/plan-mode-policy.ts:20-43
export function resolvePlanModeTransitionPermission(context): PlanModeTransitionPermission | undefined {
  if (context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
    return { behavior: "allow",
      reason: "EnterPlanMode switches to plan mode without a permission prompt",
      ruleId: "tool.plan.enter" };
  }
  if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME &&
      !(context.planEnabled ?? context.mode === "plan")) {
    return { behavior: "deny",
      reason: "ExitPlanMode can only be used while plan mode is active",
      ruleId: "mode.plan.exitOnly" };
  }
  return undefined;
}
```

注意 `?? context.mode === "plan"` 这个 fallback 在多处重复出现——它是旧格式（plan 作为 mode 取值）的兼容读法。本项目若从一开始就用正交布尔，可省掉这层。

### 4.3 计划门三分支

```ts
// core/src/permission/service.ts:402-444
private checkPlanMode(context, capability): PermissionDecisionResult {
  if (capability.readOnly && !capability.destructive)
    return this.allow(context, capability, "mode.plan.readOnly",
      "Plan mode allows read-only tool execution");

  if (this.isMcpToolCapability(capability) && !capability.destructive)
    return this.allow(context, capability, "mode.plan.mcp",
      "Plan mode allows non-destructive MCP tool execution");

  if (capability.allowedInPlanMode && capability.sideEffectScope === "session" &&
      !capability.destructive && !capability.needsApproval)
    return this.allow(context, capability, "mode.plan.explicitSessionCapability",
      "Plan mode allows this explicit non-destructive session control action");

  return this.deny(context, capability, "mode.plan.nonReadOnly",
    "Plan mode only allows read-only, non-destructive tools");
}
```

**"只读"不是工具名白名单，而是能力声明 + 动态判定**：

- 静态只读集合（`service.ts:557-571`）：`Read, Glob, Grep, WebSearch, WebFetch, TodoRead, TodoWrite, AskUserQuestion, Agent, Task, Skill`
- **`Bash` 可动态变成只读**：`bash.ts:77-95` 在 `isRuntimeReadOnlyBashCommand(command)` 为真时返回 `{ readOnly:true, destructive:false, needsApproval:false }`。这是计划态允许 `git log`、`ls` 之类命令的机制——非常关键，否则模型在计划阶段连现状都查不了。
- 唯一使用 `allowedInPlanMode` 逃生舱的工具是 `RespondToCoordinator`（协调者应答）。

**写入类工具**（`Write/Edit/ApplyPatch/Bash`）在计划态下走最后一条 `deny`——是**硬拒**而非弹窗。模型看到的是错误结果，可以据此调整，而不是卡在等人。

### 4.4 子代理：工具面强制剔除

```ts
// core/src/subagent/tool-policy.ts:4-22
const SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS = [ENTER_PLAN_MODE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME] as const;

// 子 agent 没有独立的 plan approval 恢复面，暴露 plan tools 会让
// ExitPlanMode 等待用户确认并卡住父 turn，因此所有子 agent 工具面统一剔除。
return filterDisallowedToolNames(toolNames, buildSubagentChildDisallowRules(disallowedTools));
```

但**状态仍继承**：`subagent.ts:170-174` 用 `this.getPlanEnabled() ? "plan" : this.config.mode` 决定子代理权限模式，构造子 runtime 时 `mode: this.config.mode, planEnabled: true`。净效果——计划态父会话派生的子代理**同样只读**，但无法自己退出。这是"防权限逃逸"的正确做法，且剔除了卡死父 turn 的悬挂风险。headless 的 workflow actor 另额外剔除 `AskUserQuestion`（无人可问）。

---

## 5. 提示词与提醒机制（软引导的核心）

这是 ZCode 设计里最精细的一层，也是"软引导"三个字的落地处。

### 5.1 关键决策：不改 system prompt

计划指引**不进 system prompt**，而是作为**每轮重算的 message attachment** 注入。原因写在 `runtime-reminders.ts` 与 `system-reminder/source.ts` 的分类里：`runtime_mode` 与 `plan_mode_exit` 属于 `per_current_turn` / `runtime_local`——**不持久化、每轮重新推导**；只有 `plan_file_reference` 是持久化来源。

这个选择同时解决三件事：不破坏 KV 前缀缓存、退出计划态后引导自动消失（无需清理）、提醒可以按节奏重复。

### 5.2 完整提醒文本

`PLAN_MODE_FULL_REMINDER`（`runtime-reminders.ts:66-69`）第一行 + `buildPlanWorkflow()`：

```
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Explore subagent type.
1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.
2. **Launch up to 3 Explore agents IN PARALLEL** ... Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)

### Phase 2: Design
Goal: Design an implementation approach.
- Use the context gathered in Phase 1, including relevant files and code paths.
- Produce a concrete implementation plan that is detailed enough to execute.
- Consider useful perspectives for the task type: New feature: simplicity vs performance vs maintainability / Bug fix: root cause vs workaround vs prevention / Refactoring: minimal change vs clean architecture

### Phase 3: Review
1. Read the critical files to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use AskUserQuestion to clarify any remaining questions with the user

### Phase 4: Call ExitPlanMode
At the very end of your turn ... your turn should only end with either using the AskUserQuestion tool OR calling ExitPlanMode.
**Important:** Use AskUserQuestion ONLY to clarify requirements or choose between approaches. Use ExitPlanMode to request plan approval. Do NOT ask about plan approval in any other way ...
```

稀疏版（后续轮次）：

```
Plan mode still active (see full instructions earlier in conversation). Read-only. Follow 4-phase workflow. End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval). Never ask about plan approval via text or AskUserQuestion.
```

退出提醒（一次性）：

```
## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.
```

### 5.3 节奏控制

```ts
// core/src/runtime/helpers/runtime-reminders.ts:18-21
TURNS_BETWEEN_ATTACHMENTS: 5,
FULL_REMINDER_EVERY_N_ATTACHMENTS: 5,
```

规则（`buildRuntimeModeReminderBody`，`:182-208`）：距上次 `runtime_mode` 提醒不足 5 个人类回合则**完全不注入**；第 N 次注入时，`N % 5 === 1` 用完整版，否则用稀疏版。即"每 5 轮提醒一次，每 5 次提醒里 1 次是完整工作流"。

这是成本与约束力的平衡：完整工作流文本很长（约 1.5k tokens），每轮注入既贵又会淹没对话；但完全不重复，长会话里模型会漂移。**"5 轮 + 5:1 稀疏比"是个可以直接抄的经验值。**

### 5.4 三处分工声明

计划态下的"提问 vs 审批"分工在三个地方重复声明，防止模型用错工具：

- `AskUserQuestion` 描述里：`Plan mode note: To switch into plan mode, use EnterPlanMode (not this tool). ... Do NOT use this tool to ask "Is my plan ready?"... the user cannot see the plan until you call ExitPlanMode for approval.`
- `ExitPlanMode` 描述里：`Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does.`
- 提醒文本里：`Never ask about plan approval via text or AskUserQuestion.`

---

## 6. 审批交互与拒绝闭环

### 6.1 通道：复用统一 userInput/elicitation

ZCode 没有为计划审批造新的协议消息，而是把 `ExitPlanMode` 的 `requiresUserInteraction` 投影成 `userInput` 交互，并用 schema 打标区分：

```ts
// bootstrap/src/zcode-protocol-v4/product-projection.ts:3117-3137（注释节选）
// ExitPlanMode 复用 userInput/elicitation 通道承载计划审批反馈；
// 普通 permission payload 无法表达 approve/custom feedback 的业务语义。
payload: { kind: "userInput", prompt: payload.reason, freeText: true, toolCallId,
  toolName: payload.toolName, input: payload.input,
  schema: { interaction: "plan_approval", toolName: payload.toolName },
  questions: [createExitPlanModeApprovalQuestion(payload.reason)], ... }
```

审批问题只有**一个选项**：

```ts
// services/src/zcode-agent/zcodeTaskServiceAdapter.ts:5079-5093
function createExitPlanModeApprovalQuestions(): [PendingElicitationQuestion] {
  return [{
    header: "Plan",
    options: [{ description: "Exit plan mode and start implementation.",
                label: "Approve", value: "approve" }],
    question: "Review this implementation plan.",
  }];
}
```

即用户的三个真实选择：**Approve**（点选项）、**自由文本**（= 拒绝 + 反馈）、**Dismiss/Escape**（= 拒绝，无反馈）。没有独立的"批准并编辑"或"拒绝并继续规划"按钮——反馈文本承担了后者的角色。这是很克制的设计：按钮越少，协议分支越少。

### 6.2 拒绝的两种语义（最值得抄的部分）

拒绝后走哪条路，取决于**有没有自由文本反馈**：

```ts
// core/src/tool/executor/turn-control.ts:44-98（节选）
const feedback = readPlanExitDeniedFeedback(result);
if (feedback) {
  return { ...result,
    followUpUserInput: { input: feedback, reasonSource: "plan_approval_feedback" },
    // feedback 会通过 steer 成为真实 user message；tool_result 只能表达计划被拒绝，
    // 不能承诺反馈一定跟随，否则 steer 被拒绝时 provider 会看到不存在的后续 user message。
    modelContent: EXIT_PLAN_DENIED_BY_USER_MESSAGE,   // "The plan was not approved by the user."
  };
}
// 拒绝退出计划代表用户要继续讨论，不能把它当普通工具错误继续喂给模型自我重写计划。
return { ...result,
  turnControl: { reason: "plan_exit_denied", stopTurnAfterResult: true } };
```

| 情况 | 处理 | 计划态 | 模型看到 |
|---|---|---|---|
| 有文本反馈 | 反馈作为**真实 user 消息** steer 进当前回合（`delivery:"guide"`，`source:"plan_approval_feedback"`） | 保持 | 工具结果只说"计划未获批准"，随后收到真实用户消息 |
| 无反馈 | **终止回合**（`stopTurnAfterResult`），不喂给模型 | 保持 | `"Permission denied for ExitPlanMode"` |

两条注释里的推理质量很高：

- 反馈走 steer 而不是塞进 tool_result，是为了让它在 transcript 里成为**真正的用户消息**（模型对 user 消息的权重与对工具错误的权重不同）。
- tool_result 措辞刻意**不承诺**反馈会跟随（steer 可能被拒），避免 provider 看到不存在的后续消息。
- 无反馈的拒绝**不当普通工具错误**处理——否则模型会以为"工具报错了，我改改计划再试"，而用户的本意是"停下来跟我讨论"。

`readPlanExitDeniedFeedback`（`:84-98`）只认 `reasonSource === "plan_approval_feedback"` 且消息非默认、非空白的反馈；hook/项目规则的拒绝被刻意排除，不会被误升级为用户反馈。

---

## 7. 计划文件持久化

```ts
// core/src/runtime/helpers/plan-file-continuity.ts:18-28
function resolveApprovedPlanFilePath(input: { sessionId; workspaceRoot }): string {
  return join(input.workspaceRoot, ".zcode", "plans", `plan-${sanitizePlanFileSessionId(input.sessionId)}.md`);
}
```

- **审批通过时原子写入**（`writeApprovedPlanFile`，`atomic:true, createParents:true`），且**在状态翻转之前**写（`handlers/plan-mode.ts:210-242`）。写失败则整个退出被中止；计划为空抛 `"ExitPlanMode plan cannot be empty"`。
- **路径是推导的，不是存储的**——没有 `planFilePath` 状态字段，`<workspaceRoot>/.zcode/plans/plan-<sessionId>.md` 由 sessionId 决定。少一个状态就少一处不一致。
  （口径澄清：ZCode 的落盘文件是**每会话一份**，只服务"压缩后重注入"；它的**计划历史/列表**来自转录（终态 ExitPlanMode 行的目录，见 §8）与文件无关。本项目 v2 在此基础上把文件也改成**每计划一份**（toolCallId 命名）以便文件树里能看到历史，属于超出 ZCode 的选择——见《计划模式实施方案》§13。）
- **压缩后重新注入**（`compact-active.ts:484-501`）：每次 compaction 完成后读回该文件，构造 `plan_file_reference` system reminder 条目，并**持久化为真实消息**（`compact-persistence.ts:367-377`），因此重启后依然存在：

```
A plan file exists from plan mode at: <path>

Plan contents:

<planContent>

If this plan is relevant to the current work and not already complete, continue working on it.
```

这是"计划跨压缩存活"的完整答案：不靠特殊 resume 钩子，靠"压缩后重注入 + 该条目本身持久化"。

---

## 8. UI 呈现

| 面 | 位置 | 要点 |
|---|---|---|
| 入口 1 | composer 模式下拉里的**独立勾选项**（`V4ComposerModeControls.tsx:40-67,143-158`） | plan 被**从单选组里过滤出来**做成 checkbox——UI 层直接体现"正交" |
| 入口 2 | `/plan [task]` 斜杠命令（`slashCommands.ts:53-73`） | 带附件/上下文时**拒绝**并 toast（`chat.plan.attachmentsBlocked`），避免退化成普通 prompt |
| 入口 3 | agent 驱动的转换（`planTransition: {toolCallId, planEnabled}`） | 客户端一次性消费，让草稿跟着工具切换同步 |
| 键盘 | **无** | `Ctrl+Shift+M` 循环模式时显式排除 plan |
| 状态指示 | composer 旁的 chip（`data-testid="v4-composer-plan-marker"`） | 灯泡图标 + "Plan" + X 关闭 |
| 审批卡 | 计划正文**不在弹窗里**，在会话卡片/侧栏 | 弹窗只显示 "Implementation plan" 标题 |
| 计划卡片 | `SwitchModeToolCallBlock` | 计划 markdown 预览 + 文件名 + 复制 + "View full plan" |
| 计划详情 | 只读侧栏 `PlanDetailSidePane` | 订阅父会话投影实时更新；**无编辑器**（`planFilePath` 只作展示标签） |
| 计划目录 | `conversationProjectionStore.sessionPlans` | 终态 `ExitPlanMode` 行的目录，按 revision/epoch 合并 |

两个细节值得注意：

- `EnterPlanMode` 在回合渲染里被**完全隐藏**（`conversationTurnRenderUnits.ts:107-117`），`ExitPlanMode` 则明确**不被收进回合尾部**（`:273-277`）——避免"计划卡片被折叠进 work 流"。
- `ExitPlanMode` 被刻意排除在"聊天加载中阻塞交互"之外（`chatLoadingVisibility.ts:7-21`），即审批弹窗不阻塞会话加载指示。
- **计划正文随流式参数实时渲染**：`plan` 被加入半截 JSON 预览键（`packages/shared/src/streaming-tool-input-preview.ts` 注释原话："计划卡片与侧边详情才能从**首个流式 chunk** 开始更新，而不是等 `input_end` 才突然出现"）。后端把该字段加进预览键，前端在工具卡片里增量渲染——这是"长计划不必等写完"的完整答案。

---

## 9. 已知缺口与不一致（抄的时候避开）

研究开源实现的价值一半在"哪些地方是坑"。ZCode 3.14.3 里有这几处：

1. **`EnterPlanMode` 描述与实现不符**。工具描述写着 `This tool REQUIRES user approval - they must consent to entering plan mode`，但策略层无条件 allow 且 `needsApproval:false`——**实际不弹窗**。本项目若照抄描述文案，务必同步改掉这句。
2. **`allowedPrompts` 是死参数**。schema 定义、校验、回显都在，但全仓没有任何地方消费它去创建权限规则（`ExitPlanMode` 输出里有，无人读）。概念很好（"实现这个计划需要哪类 Bash 权限，一次批掉"），但没做完。
3. **`getPrePlanMode()` 恒返回 `undefined`**。`prePlanMode` 一路从 `permission/service.ts` 透传到 `permission-flow.ts`，但运行时实现从不填充——遗留字段。
4. **`auto` 模式未实现**：命中即 `deny mode.auto.unimplemented`。
5. **项目 `ask` 规则与 `alwaysAsk` 工具可穿透计划态**（问过之后能执行）。这是刻意的顺序选择，但意味着"计划态绝对只读"的说法有例外。
6. **公开快照无测试**。所有不变量只有注释背书。
7. **`mcp` 判定过宽**：`isMcpToolCapability` 只判断 `permissionName === "mcp"`，任何非破坏性 MCP 工具在计划态下都放行——而 MCP 工具的破坏性无法自动推断。

---

## 10. 对照本项目（guada_ai）

### 10.1 逐项映射

| 能力 | ZCode | guada_ai 现状 | 结论 |
|---|---|---|---|
| 状态载体 | `ExecutionState { mode, planEnabled }` | 无 | **需新增**；建议完全照抄正交布尔 |
| 状态持久化 | session entry + 事件日志 + 逐消息快照 | JSONL 事件模型（`turn/*`、`ask/*`、`message/meta`、`compaction/*`） | 加一个事件类型即可，模型现成 |
| 工具能力元数据 | `readOnly / destructive / sideEffectScope / allowedInPlanMode / needsApproval` | `ToolDefinition` 仅 `{name, description, parameters}` | **最大缺口**，需先补 |
| 权限门 | `checkPlanMode` 三分支 | 无计划门；有 `sandboxMode` 三档 + `setToolScope` / `setPathJail` 瞬态开关 | 需新增；注意与 sandboxMode 正交 |
| 提示注入 | 每轮重算的 `runtime_mode` reminder（不持久化） | `<system_reminder>` + `origin='system'` 消息（**持久化**） | 机制已有，但**语义不同**，见 10.2 |
| 审批通道 | userInput/elicitation + `schema:{interaction:"plan_approval"}` | `AskService`（`kind: approval\|ask\|continue`）+ `POST /chat/respond` | **可直接复用**，成本最低 |
| 审批选项 | 单选项 Approve + 自由文本 | `requestApproval` = 预置「是否同意?」(同意/拒绝) + 自定义回复 | 几乎 1:1 |
| 拒绝反馈 | `reasonSource:"plan_approval_feedback"` → steer 成真实 user 消息 | `AskDeniedError { outcome, feedback }` → `isError` tool-result content = feedback | **语义已有，落点不同**，见 10.3 |
| 计划落盘 | `.zcode/plans/plan-<sid>.md`，推导路径，审批时原子写 | 无 | 需新增 |
| 压缩后重注入 | `plan_file_reference` 持久化 reminder 条目 | compaction 已有 checkpoint 机制 | 需接入 |
| 子代理 | 强制剔除 plan 工具，但继承 `planEnabled` | `setToolScope` / 子代理继承 sandboxMode | 机制已有，需接入 |
| 互斥对象 | plan × Goal 互斥 | **无 Goal 概念** | 不适用，跳过 |
| 前端指示 | composer 勾选项 + chip + 计划卡 + 只读侧栏 | `SessionCards.vue` 会话级卡 + `streamProjector` + turns 模型 | 机制已有 |

### 10.2 提示注入的语义差异（需要注意）

ZCode 的计划提醒**每轮重算、不落库**；本项目的 `<system_reminder>` 模式是**在转换点落库一条 `origin='system'` 消息**（见 `jsonl-session-context.ts:515` 的 sandbox 模式切换叙事）。

两者不可直接互换：

- 照抄"每轮重算"需要在本项目引入一个**不持久化的 per-turn 注入点**——而本项目当前所有注入都走历史消息（KV 前缀 = `getSystemText()` + `getTools()`，见 `compaction/types.ts:11`）。
- 照抄"转换点落库一条"则得到一次性引导，**长会话会漂移**（模型几轮后就忘了自己在计划态）。

**建议的折中**：保留本项目的落库注入作为"进入计划态"的一次性完整引导（等价 ZCode 的 full reminder），再在引擎循环里加一个**轻量的每轮检查**——距上次注入满 N 轮且仍在计划态时，追加一条稀疏提醒。这样既不动 KV 前缀，又拿到节奏控制。稀疏提醒是否落库可再定（落库更简单，且天然进入压缩输入）。

### 10.3 拒绝反馈的落点差异

ZCode 把用户反馈 steer 成**真实 user 消息**，并刻意让 tool_result 只说"计划未获批准"。
本项目 `AskDeniedError.feedback` 是塞进 **`isError` tool-result content**（见 `docs/交互层统一Ask方案.md` §三"拒绝/取消反馈模型"）。

ZCode 的注释给出了这样做的理由（"反馈会成为真实 user message"，模型对 user 消息权重更高；且 tool_result 不能承诺反馈一定跟随）。本项目当前把反馈放在 tool-result 里，模型会把"用户的不同意见"和"工具报错"混为一类。

**建议**：计划审批的反馈走 steer 式真实 user 消息，而不是 tool-result。这需要引擎在计划审批这一条路径上特判——但注意 ZCode 的同款特判也只在 `ExitPlanMode` 这一处（`turn-control.ts` 明确只认 `reasonSource === "plan_approval_feedback"`，不误伤 hook/规则拒绝）。

### 10.4 建议的落地顺序

**阶段一：补地基（无用户可见行为）**
1. 给 `ToolDefinition` / 插件注册 API 增加能力声明：`readOnly`、`destructive`、`sideEffectScope`、`allowedInPlanMode`。**存量工具逐个标注**，`run_command` 需要动态只读判定（对应 ZCode 的 `isRuntimeReadOnlyBashCommand`）。
2. 定 `ExecutionState { mode, planEnabled }` 与本项目的 `sandboxMode` 的关系：**两者正交**（`sandboxMode` 管文件效应强制力，`planEnabled` 管协作状态），符合 `安全模式三档方案.md` §4 的既定判断。

**阶段二：状态与事件**
3. JSONL 加事件类型（如 `session/mode_changed`，携带 `mode / planEnabled / previous* / source / toolCallId`），replayer 无状态透传，session 级投影 fold 出当前值。
4. 归一化放接纳边界（`resolveExecutionState` 同款）。

**阶段三：工具与权限门**
5. 新增 `EnterPlanMode` / `ExitPlanMode` 两个工具；`ExitPlanMode.plan` 限 20000 字符、非空白；输出 `mode` 枚举不含计划态。
6. 在 `ToolExecutorService` 加计划门（三分支），位置参照 ZCode：**`requiresUserInteraction` 早于计划门**（否则 `ask` 工具被锁死）。
7. 子代理工具面剔除两个 plan 工具，但继承 `planEnabled`（防权限逃逸 + 防卡死父回合）。

**阶段四：引导与出口**
8. 进入计划态注入完整 4 阶段引导（复用现有 `<system_reminder>` + `origin='system'` 惯例）；退出注入一次性退出提醒。
9. 每轮节奏检查（见 10.2）。
10. 计划审批复用 `AskService.requestApproval`（或新增 `kind:'approval'` 的计划变体），自由文本 = 拒绝 + 反馈。
11. 计划落盘 `<workspace>/.guada/plans/plan-<sessionId>.md`（路径推导，审批通过时原子写、写在状态翻转前）；compaction 后重注入。

**阶段五：前端**
12. composer 模式控件里把计划做成**独立勾选项**（不要混进模式单选组——这是"正交"在 UI 上的体现）；计划态 chip；计划卡片 + 只读详情侧栏。

### 10.5 建议直接照抄 / 建议改造

**直接照抄**：

- `ExecutionState { mode, planEnabled }` 正交二元组（含"`"plan"` 只在读取边界存在"）
- 先持久化后改内存 + 幂等 + 互斥守卫内聚在状态转换函数里
- 提示节奏 5 轮 / 5:1 稀疏比
- 拒绝的两种语义（有反馈 → 真实 user 消息 + 状态保持；无反馈 → 终止回合且不当工具错误）
- 计划文件路径推导（不存路径字段）+ 审批时原子写 + 写在翻转前
- 子代理剔除 plan 工具但继承状态
- 权限判定顺序里 `requiresUserInteraction` 早于计划门

**建议改造**：

- 提醒注入方式 → 落库完整引导 + 轻量每轮稀疏提醒（见 10.2）
- 拒绝反馈落点 → 真实 user 消息而非 tool-result（见 10.3）
- `EnterPlanMode` 描述文案 → 删掉"REQUIRES user approval"（实现不弹窗）
- `allowedPrompts` → 要么不做，要么做完整（本项目可考虑作为"计划批准即预授权一批 Bash 类别"的载体，但需先有 prompt-based 权限体系）
- MCP 工具放行 → 不要照抄 `permissionName === "mcp"` 的宽判定，应要求 MCP 工具显式声明只读

---

## 11. 风险与注意点

1. **与 `sandboxMode` 的边界要一次划清**。两者都叫"模式"，但一个管文件效应强制力、一个管协作状态。混在一起会重演本项目已经删除的那版"计划=强制只读"的错误（见 `安全模式三档方案.md` §4）。
2. **`read-only` 沙盒档与计划态会叠加**。用户在 `read-only` + 计划态下，写入被两套机制各拒一次——注意错误信息不要互相打架，建议计划门先判（它是状态而非强制力）。
3. **提示长度是真金白银**。ZCode 的完整工作流约 1.5k tokens；若本项目计划引导也写这么长，务必落实节奏控制，否则长会话 token 成本显著上升。
4. **`TodoWrite` 在计划态是放行的**（在静态只读集合里）。本项目若有待办类工具，需明确它在计划态下的定位——ZCode 允许模型在计划阶段维护待办，这有助于计划成型。
5. **审批弹窗不阻塞加载指示**这个细节（`chatLoadingVisibility.ts`）在本项目对应 `SessionCards.vue` 的展示条件，容易漏。

---

## 附录 A：关键文件索引（ZCode）

核心（`apps/zcode-cli/packages/`）：

| 关注点 | 文件 |
|---|---|
| 状态类型 / 转换 | `contracts/src/interfaces/session.port.ts`、`core/src/runtime/execution-state.ts`、`shared/execution-state.ts`（`packages/shared/src/execution-state.ts`） |
| 工具契约 | `contracts/src/tools/plan-mode.ts`、`core/src/tool/handlers/plan-mode.ts` |
| 提示词 | `core/src/tool/handlers/plan-mode-prompts.ts`、`core/src/runtime/helpers/runtime-reminders.ts` |
| 权限 | `core/src/permission/plan-mode-policy.ts`、`core/src/permission/service.ts`（`checkPlanMode`） |
| 拒绝闭环 | `core/src/tool/executor/turn-control.ts`、`core/src/tool/executor/errors.ts`、`core/src/runtime/methods/turn-tools.ts` |
| 计划文件 | `core/src/runtime/helpers/plan-file-continuity.ts`、`core/src/runtime/methods/compact-active.ts` |
| 子代理 | `core/src/subagent/tool-policy.ts`、`core/src/runtime/methods/subagent.ts` |
| 协议 | `bootstrap/src/zcode-protocol-v4/product-projection.ts`、`bootstrap/src/zcode-protocol/interaction-broker.ts` |
| 事件 | `contracts/src/events/session.events.ts`（`SessionModeChangedPayload`）、`contracts/src/events/event-reducer.ts` |

前端（`packages/`）：

| 关注点 | 文件 |
|---|---|
| 入口 | `ui/src/v4/composer/V4ComposerModeControls.tsx`、`ui/src/v4/slashCommands.ts`、`ui/src/v4/composer/useDraftConfigControl.ts` |
| 审批弹窗 | `ui/src/ElicitationDialog.tsx`、`ui/src/v4/V4InteractionDialogs.tsx` |
| 计划卡片/详情 | `ui/src/ToolCallBlocks/renderers/switch-mode.tsx`、`ui/src/app-shell/PlanDetailSidePane.tsx` |
| 投影 | `ui/src/v4/conversationProjectionStore.ts`、`ui/src/v4/conversationStatusPanelModel.ts` |
| 工具身份 | `ui/src/lib/toolIdentity.ts`、`ui/src/lib/planToolCall.ts` |

## 附录 B：本项目对照锚点

| 关注点 | 文件 |
|---|---|
| 统一 Ask | `backend-ts/src/common/services/ask.service.ts`、`backend-ts/src/common/types/ask.types.ts`、`docs/交互层统一Ask方案.md` |
| 安全三档 / 提权 | `backend-ts/src/common/services/sandbox-policy.ts`、`docs/安全模式三档方案.md` |
| 工具定义 / 执行 | `backend-ts/src/modules/tools/interfaces/tool-provider.interface.ts`、`backend-ts/src/modules/plugins/api/plugin-api.ts` |
| 会话上下文 / 瞬态开关 | `backend-ts/src/modules/chat/session-context.ts`、`backend-ts/src/modules/chat/jsonl-session-context.ts`（`setToolScope` / `setPathJail`） |
| JSONL 事件 / 回放 | `backend-ts/src/common/persistence/types.ts`、`backend-ts/src/common/persistence/replayer.ts` |
| system 注入惯例 | `backend-ts/src/modules/chat/jsonl-session-context.ts:515`（`<system_reminder>` + `origin='system'`） |
| 引擎循环 | `backend-ts/src/modules/chat/agent-engine.service.ts` |
| 前端卡 / 投影 | `frontend/src/components/chat/SessionCards.vue`、`frontend/src/services/modules/streamProjector.ts`、`frontend/src/components/chat/TurnItem.vue` |
