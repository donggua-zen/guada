# 工具审批与断点续传设计 — 对齐 deepseek-harness

> **已被统一 Ask 体系取代（2026-08-29）**：审批/询问/迭代暂停合并为单一 ask 闭环（无超时、
> 审批为 ask 特例、自定义回复=拒绝+反馈模型），本文件仅作历史设计记录。
> 正本文档：`docs/交互层统一Ask方案.md`。

> 版本：1.9 | 日期：2026-08-29 | 状态：已实施（v1.6 原地阻塞审批；v1.7 沙盒提权审批；v1.8 迭代暂停原地阻塞 + 删除 resume 分支；v1.9 名单预分类退役，审批统一为工具 execute 内主动发起）

---

## 0.9 v1.9 变更：名单预分类退役，审批统一为工具 execute 内主动发起

> 设计动机：v1.6 的"执行前按名单分类 → 批次挂起 → 二次执行"是旧管线迁移产物，且名单
> （`requiresApproval`）默认为空、机制休眠。v1.7 提权已证明"工具 execute 内按需发起审批"
> 模式全链路可行且与审批共享全部基础设施。v1.9 把名单预分类管线整体删除，审批统一为
> **执行内主动发起**——`executeToolsAndBuildParts` 的"探测/挂起 + 决策后二次执行"结构随之消亡。

### 0.9.1 统一审批模型

```
工具 handler 在 execute 内按需发起（沙盒提权 / 通用工具审批同构）：
  await sandboxEscalation.requestApproval({ session, messageId, turnId, toolCallId, toolName, reason, abortSignal })
    → 审计 approval/asked（approvalId 凭证）→ EventBus "approval.requested"（payload.kind 区分 tool/escalation）
    → SSE approval_requested → 前端审批卡（一张卡一个工具）
    → awaitDecision 原地阻塞（等待表 sessionId:approvalId，10min fail-closed）
    → 前端 POST /chat/approve（approvalId 凭证）唤醒
    → 批准：requestApproval 正常返回（工具继续本次调用）；提权返回放宽 mode（one-shot）
    → 拒绝/超时/中止：抛 ApprovalDeniedError（EscalationDeniedError 继承之）→ isError tool-result 反馈模型
```

- **逐工具审批**：一次消息多个需审批工具 = 顺序逐个审批，每张卡一个工具（DSH pre-execute 式）
- 引擎不再有任何审批逻辑：删除 `classifyToolsByApproval` / `isToolRequiresApproval` /
  `normalizeApprovalDecisions` / `awaitApprovalDecision` / 主循环审批分支 / `metadata.approvalContext`；
  `executeToolsAndBuildParts` 退化为纯执行（一次调用，直接 executeBatch 全部合法工具）
- 名单配置删除：`ToolApprovalConfig` / `getToolApprovalConfig` / `buildToolApprovalConfig` /
  `settings.toolApproval` 消费链（配置本就无写入口、无前端 UI）
- `message/meta` 事件退役：唯一生产者（审批 completed 补丁）已随管线删除，replayer case、
  接口、前端类型、TurnItem legacy 分支（finishReason=approval_required 读 approvalContext）一并移除；
  历史 JSONL 中的 message/meta 事件重放时走默认分支忽略（兼容）

### 0.9.2 会话级全局卡（对齐 DSH wire 契约）

DSH 源码事实（`packages/host/apiproxy/src/api/events.schema.ts:46-47`）：

```
approval/requested 帧: { sessionId, approvalId, toolName, callId?, reason? }
approval/resolved 帧:  { sessionId, approvalId, outcome }
```

core `ApprovalRequest` = `{ agent, toolName, callId?, reason?, signal? }`——**无 turnId / messageId**；
审计事件 log-only（非 UI 事件）。呈现锚点 = sessionId + approvalId，会话级提示，`resolved` 收尾。

本项目对齐改造：
- 审批链路删除 `turnId` / `messageId` 锚点（`PluginContext`、`executeBatch` ctxMeta、审批服务参数、
  Event payload、SSE 事件类型全清；`PluginContext` 只剩 `session + toolCallId`）
- 前端状态从 `turn.state.approval/paused` 迁移为 `SessionState.approval/paused`（sessionStore 访问器
  仿 `isCompressing`）；streamProjector 写入/清除不再 `turns.find`
- 新建 `SessionCards.vue` 会话级全局卡（审批卡 + 暂停卡），插在 ChatPanel 输入区上方（排队抽屉之后）；
  `TurnItem` 回归纯回合渲染
- 附带修复：原 TurnItem 卡受 `activeBlocks.length > 0` / `isLast` 双门约束（LLM 未产出块前收到
  审批事件会被吞）；全局卡无条件展示，且多会话/子 Agent 场景按 sessionId 天然隔离

### 0.9.3 保留不动

- `approval/asked|decided` 审计事件（审批服务统一写）、`ApprovalWaitService`、`POST /chat/approve`、
  迭代暂停（pauseId / waitForSignal / continue 端点）、前端审批卡（approvalId 凭证回传）、`kind` 字段

---

## 0.8 v1.8 变更：迭代暂停原地阻塞 + 删除 resume 分支

> 设计动机：max_iterations / rate_limited 的"继续执行"原走「终止回合 + 前端重触发 resume」，
> resume 分支需单独维护且已基本闲置（审批已改原地阻塞）。v1.8 把两者改为与审批相同的
> **回合内原地阻塞**机制，然后**整体删除 resume 分支**。

### 0.8.1 核心机制（与审批同构）

```
max_iterations 分支（agent-engine）：
  达到最大轮次 → 落库 assistant 消息（工具未执行）→ yield iteration_paused
    → awaitIterationContinue（waitForSignal，无超时）→
      继续（signal）→ iterationCount=0（授权新一轮批次）→ 执行 pending 工具
      中止（abort）  → user_cancel 收尾（不执行工具）

rate_limited 分支：**不暂停、无继续按钮**（v1.8 后续调整：大多数产品无手动继续，
  发文字说明即可）——该轮不落库（半截消息不污染历史），直接以 rate_limited 收尾，
  turn_end 携带 errorDetail；前端按 finishReason=rate_limited 展示文字说明（无按钮），
  用户自行继续（发新消息）。
```

**关键：max_iterations 暂停等待无超时**（区别于审批 10min fail-closed）——刷新绝不自动拒绝/
自动终止；仅用户"继续"（signal）或"停止"（abort → user_cancel）能解除。

### 0.8.2 刷新安全（用户核心关切）

- **无超时**：暂停中的循环原地等待，刷新不触发任何自动终止/拒绝
- **按钮重现**：暂停循环不调 `stopStream`（stream 保持 alive）→ `eventBuffer`（上限 2000，
  回合级事件不被清理）在 SSE 重连时重放 `iteration_paused` → 前端重投影 `turn.state.paused`
- **stash 竞态修复（预存 bug）**：`ChatPanel` 加载会话后同时消费 `streamProjector` 的 stash
  （此前只消费 `useStreamResponse` 的，刷新竞态下事件丢失）——暂停/审批卡可靠重现
- **重连状态补发**：`SessionEventsService.subscribe` 对活跃流补发 `stream_status_changed(running)`
  （该事件不在 eventBuffer 中），恢复刷新后的会话级 isStreaming，避免新消息撞 SESSION_BUSY

### 0.8.3 删除 resume 分支（清理面）

- **引擎**：`isResumeMode`、resume 回合级分支（`turn_resume` yield + `resumeTurn`）、循环顶
  resume 数据准备（rate_limited-last pop / tool-last / user-last / seed+skipLLM 审批续跑）全部删除；
  非 overwrite 模式回退 overwrite
- **持久化**：`ISessionContext.resumeTurn`、`jsonl-session-context`、`jsonl-message.service`
  （turn/resume 写入器）删除；**replayer 读旧日志的 case 保留**（兼容旧数据）
- **事件**：`TurnResumeEvent`（后端 + 前端）+ `mapStreamMethod` + `EVENT_METHOD.STREAM_TURN_RESUME`
  + 前端 projector / useStreamResponse 的 turn_resume 分支删除
- **前端**：`continueResponse` + `@continue` 绑定 + `emit('continue')`（含审批 legacy 兜底）
  删除；"继续执行"改由暂停卡驱动（`continueIteration` API → `POST /chat/stream/:id/continue`）
- **死文件**：`resume-mode.test.ts`（jest 不跑、import 不存在类）、`RESUME_MODE_INTEGRATION_TEST.md` 删除

### 0.8.4 事件与端点

- **`IterationPausedEvent`**：`{ type:"iteration_paused", turnId?, messageId, pauseId, reason:"max_iterations_reached"|"rate_limited", message? }`（后端 + 前端同构；pauseId = 发起暂停时生成的 uuid 凭证）
- **`POST /chat/stream/:sessionId/continue`**（body: pauseId）→ `ApprovalWaitService.signal(sessionId, pauseId)`，无等待者抛 404（与审批统一：凭证匹配才有效，不依赖 messageId）
- **`ApprovalWaitService` 泛化为通用会话信号**：等待者条目判别
  `{ kind:"decision", resolve(decisions), timer } | { kind:"signal", resolve(ok), timer? }`；
  新增 `waitForSignal`（缺省无超时）/ `signal`；`cancel` 对 signal 返回 false（abort）

### 0.8.5 前端暂停卡

- `streamProjector`：`iteration_paused` → 置 `turn.state.paused`（isWorking=true）；
  `turn_end` / `tool_calls_response` / 消息级 chunk 到达时清除；`turn_end` 同时写
  `turn.metadata.finishReason/errorDetail`（回合级，rate_limited 无 assistant 消息时据此展示说明）
- `TurnItem`：暂停卡（`turn.state.paused?.reason === 'max_iterations_reached' && isLast`，
  不依赖 `!isStreaming`）——仅 max_iterations 显示"继续执行"；`handleContinue` →
  `continueIteration`
- `rate_limited`：**无继续按钮**，改为回合级文字提示（`finishReason === 'rate_limited'` 的
  el-alert，展示 errorDetail）
- 旧的两个 continue 按钮（`finishReason==='max_iterations_reached'/'rate_limited'`）删除

### 0.8.6 验证

后端 `tsc` 通过；新增 approval-wait signal 用例 + agent-engine 迭代暂停用例（signal 继续重置配额
执行 pending 工具最终 stop / abort user_cancel 不执行工具）+ controller continue 用例；
chat 相关 15 套件 166 例全绿；前端改动文件 `vue-tsc` 无新错误。

### 0.8.7 权衡与明确不做

- **暂停无超时**：循环可能无限挂起（用户一直不操作）——换取刷新安全与无自动拒绝；
  可随时"停止"（abort）解除。后续如需安全网可加超长超时以干净的 user_cancel 收尾（本次不做）
- **审批崩溃兜底随 resume 删除**：与"审批不支持重启恢复"结论一致（崩溃后挂起审批作废，
  repair 以 interrupted 关闭回合）；legacy `approval_required` 展示分支保留（读旧日志兼容）
- **rate_limited 以文字收尾**：半截消息不落库，回合以 rate_limited 结束 + 文字说明，用户自行继续
  （无暂停、无按钮，对齐大多数产品形态）

---

## 0.7 v1.7 变更：沙盒提权审批（对齐 DSH escalation.ts）

> 设计动机：v1.6 的审批触发源（`requiresApproval` 名单）默认为空，机制休眠。v1.7 给
> 本项目已有的沙盒（`sandbox` 二进制 + 运行模式 normal/sandbox/plan/free）接入 DSH 式
> **调用级提权审批**——模型在普通工具调用里带 `sandbox_permissions` + `justification` 参数，
> 严格放宽校验命中后触发审批，让审批有了真实、自动的触发源。

### 0.7.1 核心机制

```
当前有效模式（会话 runMode 派生）：
  plan → read-only | sandbox → workspace-write | normal/free → danger-full-access（无沙盒，提权参数不可用）

严格放宽阶梯（WIDER_MODES）：
  read-only → [workspace-write, danger-full-access]
  workspace-write → [danger-full-access]
  danger-full-access → []
  非严格放宽请求（平级/降级）→ 直接抛错，永不打扰人（对齐 DSH "非放宽永不问"）

批准 → 该模式应用这一次调用（one-shot，不持久化）：
  read-only → {enabled, readOnly:true} | workspace-write → {enabled, readOnly:false} | danger-full-access → 无沙盒执行
```

### 0.7.2 触发流程（模型侧）

```
1. 模型正常调用 run_command（不带提权参数）→ 沙盒拒绝（非零退出）
2. 拒绝结果附 hint 标记：
   [sandbox: escalation available — retry this exact command once with
    sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]
3. 模型带参重试：sandbox_permissions（最窄放宽模式）+ 一句话 justification
4. 严格放宽校验通过 → requestEscalation 触发审批
5. 审批卡（kind=escalation）展示工具名 + 理由（justification）
6. allowed → 本次调用以放宽模式执行；rejected/超时/中止 → 抛错（命令不执行，终局）
```

### 0.7.3 实现要点

- **新增 `SandboxEscalationService`**（SharedModule，全局）：`requestEscalation()` = 严格放宽校验 →
  `session.appendApprovalAsked`（审计，携带审批凭证 approvalId）→ EventBus relay 广播
  `approval_requested(kind=escalation, approvalId)` → `ApprovalWaitService.waitForDecision(sessionId,
  approvalId, 超时)` 与 abortSignal 竞速 → `appendApprovalDecided`（所有结果都写，审计配对）→
  批准返回放宽模式 / 拒绝·超时·中止抛 `EscalationDeniedError`（终局）
- **`ApprovalWaitService` 移到 SharedModule**（纯进程内原语，全局可注入；审批 key 泛化为
  `sessionId:凭证id`——审批（工具/提权）用发起时生成的 **approvalId（uuid）**，迭代暂停用
  **pauseId（uuid）**，uuid 命名空间天然不冲突；前端回传凭证匹配，messageId 不再作匹配凭证）
- **工具 ctx 穿透**：`PluginContext` 加 `turnId/messageId/toolCallId`（`executeBatch → executeTool →
  handler` 线程化，additive）——工具内提权审批需关联审批卡 + 审批 key
- **SSE relay**：服务 `EventBusService.emit("approval.escalation_requested")` → `SessionEventsService`
  `@OnEvent` → `emitStream`（复用 TodoPlugin 模式，避免模块循环依赖）
- **统一审批端点 `POST /chat/approve`**（sessionId + approvalId + decisions）：工具审批与沙盒提权
  共用，直接 `resolveDecision(sessionId, approvalId, decisions)`，**无等待者抛 404**；提权无持久化
  写回（瞬态，崩溃即作废，沙盒会再次拒绝模型可重试）

### 0.7.4 工具接入

| 工具 | 提权方向 | 批准后效果 |
|---|---|---|
| `run_command` | sandbox/plan 模式：当前有效模式 → `workspace-write`/`danger-full-access` | `sandbox` 参数按放宽模式应用（danger → 无沙盒执行） |
| `write` / `edit` | `workspace-write`（工作区包含）→ `danger-full-access` | 本次调用跳过 `validateWritePath` 工作区包含检查 |

### 0.7.5 前端

- `ApprovalRequestedEvent` / `TurnState.approval` 加 `kind?: "tool"|"escalation"` + `reason?` +
  `approvalId`（临时审批凭证，提交时回传）
- 审批卡：kind=escalation → 标题"请求沙盒提权"+ 展示理由（justification）
- `handleApproval` **统一走 `approve` API**（工具审批与提权均以 approvalId 凭证回传，无 kind 分支；
  legacy 旧数据无 approvalId → 提交视为失效）；`continueIteration` 按暂停凭证 pauseId 回传
- i18n：`escalationRequired` / `approvalReason`

### 0.7.6 验证

后端 `tsc` 通过；新增 `sandbox-escalation.service.spec.ts`（放宽矩阵/决策/超时/中止/审计配对）
+ `chat.controller.spec.ts` 新增 approve-escalation 用例；chat 相关全套用例绿；前端改动文件
`vue-tsc` 无新错误。

### 0.7.7 明确不做

- **网络隔离**：本项目与 DSH 一样只约束文件系统写，任何平台不拦网络
- **escalation 持久化恢复**：瞬态请求，崩溃即作废（沙盒会再次拒绝、模型可重试）
- **默认危险名单 / hook 三态决策**：独立演进项，本次范围外

---

## 0. v1.6 变更：审批从「终止+resume」改为「回合内原地阻塞」

> 设计动机：本项目传输层已是全局长会话（前端常驻 SSE + HTTP 触发 RPC + 后台 agent 循环），
> 不存在"挂连接"约束——真正的差异是 agent 循环生命周期。v1.6 让循环在审批时**原地 await 决策**，
> 与 DSH 的 step 内同步挂起完全对齐。

### 0.1 机制对比

| 维度 | v1.5（终止+resume） | v1.6（原地阻塞，对齐 DSH） |
|---|---|---|
| 审批时 | `businessReason="approval_required"`、`needToContinue=false`、`turn_end` 收尾 | 落库 pending 态消息 → `yield approval_requested` → **原地 await 决策**（turn 保持 open、无 turn_end） |
| 续跑方式 | 前端点"继续" → 重新触发 `/chat/stream`（resume） | 前端只调 `approve` → 按 approvalId 凭证 `ApprovalWaitService.resolveDecision` 唤醒在等待的循环 → 原地重分类执行（不调 LLM） |
| 超时 | 仅 resume 路径自动拒绝 | 原地 await 与剩余超时竞速（fail-closed），自动拒绝并补审计 decided |
| 中止 | — | await 与 abortSignal 竞速 → 撤回审批 → `user_cancel` 收尾（DSH signal→cancelled） |
| resume 分支 | 主路径 | **降级为崩溃/循环已死兜底**（决策已写回 JSONL，resume 仍可消费） |

### 0.2 实现要点

**新增 `ApprovalWaitService`**（`chat/approval-wait.service.ts`，进程内信号原语）：
- `waitForDecision(sessionId, 凭证id, timeoutMs): Promise<ApprovalDecision[] | null>`（null=超时）；
  凭证 id = 发起审批时生成的 **approvalId（uuid）**
- `resolveDecision(sessionId, 凭证id, decisions): boolean`（无等待者返回 false → 端点抛 404）
- `cancel(sessionId, 凭证id)`（abort 竞速清理）；key = `sessionId:approvalId`（uuid 凭证天然
  唯一——同一消息多轮审批互不干扰，延迟重放的旧决策匹配不到新等待者）

**引擎原地阻塞**（`agent-engine.service.ts` 审批分支）：
1. `appendMessages(parts)` 落库 pending 态 assistant 消息（崩溃后仍可恢复）
2. 生成审批凭证 `approvalId = crypto.randomUUID()` → `yield approval_requested`
   （messageId/approvalId/toolCallIds/toolNames/expiresAt）
3. `awaitApprovalDecision`：`Promise.race` = 决策到达 | 剩余超时 | abortSignal（key = approvalId）
4. 决策归一化：**全覆盖 pendingToolCallIds**（缺失/超时 → 拒绝，fail-closed）→ 杜绝二次 pending 死循环
5. 原地重调 `executeToolsAndBuildParts`（不调 LLM）→ approved 执行 / rejected 错误反馈 → 继续循环
6. **统一写回**（用户决策与超时共用同路径）：`appendApprovalDecided`（审计配对，每次 asked 必有
   decided）+ `updateMessageMetadata`（持久化 completed 补丁）；abort → `user_cancel` 走既有收尾

**投递**（`chat.controller.ts` 统一端点 `POST /chat/approve`）：**只做一件事**——
`approvalWait.resolveDecision(sessionId, approvalId, decisions)` 唤醒活循环（工具审批与沙盒提权
共用，前端回传 approvalId 凭证），**无等待者抛 404**（不再加载历史、不依赖 messageId、不落库；
写回已移入引擎第 6 步 / 提权服务）。

**前端**：
- `streamProjector` 处理 `approval_requested` → 置 `turn.state.approval`（含 approvalId 凭证；
  审批卡在流存活期间展示，不再依赖 `finishReason=approval_required` + `!isStreaming`）；
  `tool_calls_response`/`turn_end` 清除
- `TurnItem`：审批卡移出 `!isStreaming` 门；`handleApproval` 统一调 `approve`（按 approvalId 凭证，
  legacy/崩溃兜底数据无凭证 → 提交视为失效）

**修复的既有 bug**：`classifyToolsByApproval` 决策匹配原用 `d.toolCallId === tc.id`，但 tool-call 块
只有 `toolCallId` 字段（无 `id`）——决策永远无法匹配（v1.5 resume 审批路径同样受影响）。已改为
`tc.toolCallId`。

### 0.3 风险控制

- 等待有 10min 上限（fail-closed），最坏情况循环自行收尾，不会永久悬挂 stream
- 双写保留：决策先落 JSONL（崩溃后可 resume），再 notify 活循环——两条路径互不依赖
- `hasActiveStream` 在等待期间保持 true：会话被 `SESSION_BUSY` 挡住，新消息入队（队列 NORMAL_FINISH
  门注释已更新，approval 不再是暂停态）
- 明确不做：`never` 策略、hook 驱动的 ask 决策（可后续演进）；`approval_required` finishReason 保留
  （legacy/崩溃展示依赖）

### 0.4 验证

后端 `tsc` 通过；新增 `approval-wait.service.spec.ts`（7 例）+ `chat.controller.spec.ts`（5 例）
+ agent-engine 新增 4 例（approve/reject/超时/abort 原地阻塞）；chat 相关全套用例绿；
前端改动文件 `vue-tsc` 无新错误（其余 24 例为既有环境性错误，与本改动无关）。

---

## 1. 背景与现状发现

本项目原有审批"半成品"框架（后端分类 + 挂起 + 端点），但存在三处断裂：

| # | 断裂点 | 表现 |
|---|--------|------|
| A | **resume 消费 decisions 断链** | `approve-tools` 写 decisions 到 DB message 表（消息已在 JSONL）；resume 分支不重建 assistantMessage（`:687` NPE 隐患）→ decisions 无法被 `classifyToolsByApproval` 消费，审批死循环 |
| B | **前端零审批 UI** | 无 approve-tools 封装、无 `approval_required` 分支展示 |
| C | **崩溃修复缺口** | torn-tail 只合成 `turn/finish(interrupted)`，不合成未配对 tool-call 的错误结果（DSH 会补） |

另：审批状态无事件溯源（DSH 有 `approval/asked` + `approval/decided` 日志事件，跨重启可恢复）。

---

## 2. DSH 机制（对齐依据）

### 2.1 审批生命周期（DSH）

```
模型流结束 → assistant/message(含 tool-call) → tools runtime prepareExecution
  → tools/pre-execute waterfall（默认 allow）→ gate=ask → ApprovalService.request
    ├─ 前置校验 hasOpenTurn
    ├─ append approval/asked（事件落日志）
    └─ decide()：signal 中止→cancelled；policy 'never'→rejected（先于 dispatch）
        → waterfall('approval/request') 应答者链（缺应答者 → fail-closed 'unavailable'，与 signal 竞速）
  → append approval/decided（事件落日志）
  → 按 outcome：allowed→allow / rejected→deny("the user rejected…") / cancelled→deny
  → deny 物化为 isError tool/result → 模型下一循环看到拒绝理由
```

**关键特征**：审批在 step 内**同步 await 挂起**（turn 保持 open、agent 状态 running），
决策后**同一轮次原地继续**（不需要重启回合）；事件落日志跨重启可恢复；fail-closed 默认拒绝。

### 2.2 崩溃修复（DSH interruptedTurnClosers）

扫描未闭合 `turn/start` → 对未配对 `tool/call` 合成**显式错误 tool/result**
（`TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED`，指导模型"只重试只读/幂等操作"）
→ 合成 `step/end` + `turn/end {kind:'interrupted'}` —— 恢复后 transcript 平衡。

---

## 3. 本项目实施（对齐改造）

### 3.1 审批闭环（后端）

**事件溯源（对齐 DSH approval/*）**
- 新事件 `approval/asked`（messageId/**approvalId**/toolCallIds/expiresAt）、
  `approval/decided`（messageId/**approvalId**/decisions）——approvalId 为发起时生成的 uuid 凭证
- 写入：agent-engine pending 时 `appendApprovalAsked`（经 ISessionContext 透传）；决策落地统一由
  agent-engine / 提权服务写 `approval/decided`（用户决策与超时共用，经 ISessionContext 透传）
- replayer 无状态透传（审计/恢复源；挂起状态由 assistant 消息 metadata.approvalContext 承载）

**决策回写 JSONL（修复存储断链）**
- 新事件 `message/meta`（messageId + patch，last-wins metadata 补丁——append-only 不改写已写事件）
- `IMessageStore.updateMessageMetadata(sessionId, messageId, patch)` → replayer 合并到消息 metadata
- 写回统一由 agent-engine 决策落地后经 `sessionContext.updateMessageMetadata` + `appendApprovalDecided`
  完成；统一端点 `POST /chat/approve` 只负责按 approvalId 凭证 `resolveDecision` 唤醒等待者
  （无等待者抛 404），不再落库

**resume 原地继续（对齐 DSH step 内挂起语义）**
- resume 且最后消息为 assistant：`assembler.seed` 后**重建 assistantMessage**（`toMessage` + 继承
  `lastMessage.metadata.approvalContext`），`skipLLM` 不调模型——直接进入工具分类/执行：
  - `completed`（前端已决策）→ `classifyToolsByApproval` 按 decisions → approve 组执行 /
    reject 组生成 isError 反馈模型 → `needToContinue` 继续循环
  - `pending`（未决策）→ 重新 `approval_required` 终止
- 同时修复原 resume+assistant-last 路径 `assistantMessage=null` 的 NPE 隐患

**fail-closed（对齐 DSH 应答者竞速/policy）**
- `approvalContext.expiresAt`（默认 10 分钟）：pending 挂起超时 → 自动拒绝（isError "审批超时，已自动拒绝"）
- `enabled:false` → 全部放行（gate 默许语义）
- `isToolRequiresApproval` 补 `prefix__*` 前缀通配（注释承诺未实现，现已补齐）

### 3.2 前端审批 UI（对齐 DSH 应答者）

- `MessageApi.approve(sessionId, approvalId, decisions)`（`POST /chat/approve`，统一工具审批与提权）
- `TurnItem` 审批卡显示待审批工具名（toolCallIds → metadata.toolCalls 映射）+ "全部允许 / 全部拒绝"
  按钮 → `approve`（按 approval_requested 事件携带的 approvalId 凭证回传，不依赖 messageId）
- i18n：`chat.turn.toolApprovalRequired / approveAll / rejectAll`

### 3.3 崩溃修复补 tool 错误结果（对齐 interruptedTurnClosers）

- `repairActiveSegmentIfNeeded`：合成 `turn/finish(interrupted)` 前，为该回合内**未配对 tool-call**
  （assistant 消息含 tool-call 块但无对应 tool-result）追加错误 `tool/result` 事件
  （"Error: tool call interrupted before dispatch. Retry only read-only/idempotent operations."）
- 恢复后模型看到平衡 transcript，决定是否只读/幂等重试

---

## 4. 文件变更

| 层 | 文件 | 变更 |
|---|---|---|
| 存储 | `types.ts` | 新事件 `message/meta` / `approval/asked` / `approval/decided` + data 接口 |
| 存储 | `replayer.ts` | `message/meta` patch 合并；approval 事件无状态透传 |
| 存储 | `message-store.interface.ts` / `jsonl-message.service.ts` | `appendApprovalAsked/Decided` + `updateMessageMetadata`；torn-tail 补 tool 错误结果 |
| 会话 | `session-context.ts` / `jsonl-session-context.ts` | `appendApprovalAsked/Decided` + `updateMessageMetadata` 透传 |
| 引擎 | `agent-engine.service.ts` | 审批发 approvalId 凭证；pending 写 asked；决策落地统一写 decided + metadata 补丁；暂停发 pauseId 凭证；超时自动拒绝；enabled 放行；通配 |
| API | `chat.controller.ts` | 统一 `POST /chat/approve` 按 approvalId 凭证 `resolveDecision` 唤醒等待者（无等待者抛 404）；continue 按 pauseId 凭证 |
| 前端 | `message.api.ts` / `TurnItem.vue` / locales | `approve`（approvalId 凭证）+ `continueIteration`（pauseId 凭证）+ 审批卡/继续按钮 + 文案 |
| 测试 | `replayer.spec.ts` / `torn-tail-repair.spec.ts` | message/meta 合并、approval 事件透传、torn-tail 补 tool 错误结果 |

## 5. 验证

后端 `tsc` 通过；相关模块 **96 例测试全绿**；前端改动文件 `vue-tsc` 无新错误。

## 6. 明示不做（标注远期）

- **KV 缓存续传（requestHeader/replayState）**：需 adapter 层支持（pi-ai 类原生缓存引用），远期
- **max-tokens/轮次上限续跑**：沿用"继续按钮 resume"形态（与 DSH turn-stopping 钩子语义等价）
- **inbox durable 排队**：本项目无多消息排队模型（前端单条发送）
