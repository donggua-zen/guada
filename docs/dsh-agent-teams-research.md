# dsh-agent-teams 实现原理研究

> 研究对象：<https://github.com/NanmiCoder/dsh-agent-teams>（v0.1.25，MIT，约 2.3k stars）
> 研究时间：2026-10-20
> 结论先行：它不是一个 workflow 引擎，而是一套「**共享任务板 + 持久邮箱 + 事件驱动调度器 + 机器可判定的质量门禁**」，以 DSH 插件形态挂在宿主里，把当前会话变成队长。

---

## 0. TL;DR

1. **形态**：一个 npm 包，同时扮演 host 插件（Node：注册 14 个工具、1 段系统提示、3 条业务 HTTP 路由 + 1 条静态资源路由）和 client 插件（React 活动面板）。没有独立服务、没有数据库。
2. **身份模型**：队长 = 当前 DSH 会话本身；成员 = `subagents.startContinuable()` 创建的**可续聊子代理**，带 persona、独立模型路由、工具白名单/黑名单。
3. **真相源**：工作区下 `<ws>/.agent-teams/<teamId>/team.json` + `inbox/*.jsonl`。所有工具只是这个状态机的受控写入口；UI 也直接读磁盘。
4. **可靠性三件套**：进程内 per-team 串行锁 + 原子写；`attempt` + `attemptId` 执行代际租约（迟到写入必失败）；邮箱投递租约（60s）+ delivered/read 回执 + 代际过滤。
5. **差异化**：质量门禁把「几个 Agent 互相说 OK」变成机器判定——任务合同、`verdict/findings`、验收/命令证据、**文件 sha256 指纹绑定**、自动 repair + 下一轮 review、范围审计。

---

## 1. 项目形态与体量

| 维度 | 事实 |
| --- | --- |
| 发布 | npm `@nanmicoder/dsh-agent-teams`，`dsh plugin --profile <name> add ...` |
| 宿主 | DeepSeek Harness（DSH）`0.2.1-rc.2` 及其兼容区间；`compatibility.json` 维护矩阵 |
| 挂载 | `cordis.patch.yml` 向宿主组合树 insert 一行插件；工具进入全局 `tools` 注册表，所有会话可用 |
| host 端 | `src/*.ts` 22 个文件，约 570 KB（`tools.ts` 单文件 151 KB、`quality-gates.ts` 93 KB） |
| client 端 | `src/client/*` 18 个文件，约 248 KB（React + CSS Modules） |
| 测试 | 仓库里没有 `src/**/*.spec.ts`；验证主要是 `scripts/*.test.mjs` 与 `.dsh/skills` 下的宿主级冒烟 |
| 依赖 | 全部 peerDependencies（工具、会话、子代理、客户端 UI 包由宿主 profile 提供） |

**关键判断**：它把复杂度集中在两处——`tools.ts`（业务状态机与 14 个工具）和 `quality-gates.ts`（合同/审计）。其余模块职责很干净（state / scheduler / mailbox / members / profiles / snapshot）。

---

## 2. 总体架构

```
用户自然语言（"用 AgentTeams 做 X"）
        │
        ▼
队长会话 captain（就是当前 DSH session，不是新进程）
        │  14 个 agent_teams_* 工具 = 业务状态机的唯一写入口
        ▼
┌──────────────────────────────────────────────────────────────┐
│ TeamState 磁盘真相源                                          │
│ <workspace>/.agent-teams/<teamId>/team.json                   │
│                              /inbox/captain.jsonl + <member>.jsonl │
└──────────────────────────────────────────────────────────────┘
   ▲            │
   │            ├─ Scheduler：agent/status 的 idle 边沿 + 任务图变更
   │            │             → 选 ready task → 原子 claim → 派工/唤醒
   │            ├─ Mailbox：持久消息 + 投递租约 + 回执 + 执行代际过滤
   │            └─ Quality gates：合同校验 / verdict / 证据 / 范围审计
   │
   ├─ members：continuable subagents（persona + toolFilter + 独立 provider/model）
   └─ Web routes → 活动面板（1s 轮询磁盘快照）/ 计划审批 / 停止团队
```

两条数据通道：

- **控制面**：模型调工具 → 校验 → 修改 `team.json` → 调度器/邮箱把下一步推给成员。
- **观测面**：工具执行写会话事件（对话流卡片）+ HTTP 快照（面板），二者都从磁盘派生，不依赖内存镜像。

---

## 3. 数据模型

### 3.1 团队目录

```
<workspace>/.agent-teams/<teamId>/
├── team.json            # 团队记录：成员、任务、序号、阶段、策略快照
└── inbox/
    ├── captain.jsonl    # 成员 → 队长
    └── <member>.jsonl   # 队长/其他成员 → 该成员
```

`teamId` 由团队名经 `sanitizeKey()` 归一（保留 Unicode 字母/数字，其余折叠为 `-`，超长追加 sha256 摘要），避免中文/emoji 名撞目录。

### 3.2 TeamState（核心字段）

```ts
interface TeamState {
  name: string; id: string; description?: string
  profile?: TeamProfileSnapshot          // 命名模板快照（含 reviewPolicy）
  captainSessionId: string
  members: TeamMember[]
  tasks: TeamTask[]; taskSeq: number
  phase?: 'staged' | 'running'           // 两阶段：缺省按 running 兼容旧数据
  planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  approvedAt?: number
  halted?: boolean; haltedAt?: number    // 人工停止（成员保留、未完成取消）
  escalated?: boolean                    // 审查循环触顶，交给队长/用户
  reviewPolicy?: ReviewPolicy
}
```

### 3.3 TeamMember

成员既是「团队记录」也是「子会话句柄」：

- `id`：durable continuable subagent 的 session id（spawn 成功后才填）
- `provider/model/reasoningEffort`：创建时解析并冻结的路由；`fallback`/`activeProvider` 记录降级
- `toolPolicy` / `toolFilter`：部署方声明的策略 id + 解析后的不可变过滤器（冷恢复时由子会话描述符重放）
- `status`：`idle | working | removed`；`stopping` 表示正在收敛交接；`spawnError` 记录首次启动失败原因

### 3.4 TeamTask 与状态机

```
pending → claimed → in_progress → completed | failed | cancelled
```

- 终态只读；`claimed` 不能直接跳 `completed`。
- 依赖只认上游 `completed`（`failed/cancelled` 永不解锁下游）。
- 每次执行有单调 `attempt` + 唯一 `attemptId`（UUID）。转派/重试会 `invalidateTaskAttempt()`：清空 capability、写 `handoffId`、`reassigning=true`，旧成员后续写入因 `attempt_id` 过期被拒。
- 质量任务额外字段：`kind/round/verdict/findings/objective/inScope/outOfScope/acceptance/verify/changedPaths/acceptanceResults/commandsRun/reviewedTaskId/reviewedAttempt/reviewedArtifacts/revisions...`。

---

## 4. 端到端主流程

```
① 自然语言触发
   └─ captain 调 agent_teams_create(approval=required) → 建 staged 团队（不 spawn、不领取）
② 规划
   └─ create({plan:{members,tasks}}) 原子写入阵容 + DAG；或 add_member / create_task 逐条
③ 人工审批（Web）
   └─ POST /plugins/dsh-agent-teams/plan {action:approve}
        → approveStagedTeam()：校验阵容/DAG + 冻结路由，phase 置 running，然后 kickTeam
        （同时 captain.steer() 注入一条控制消息，让模型知道已批准；
          成员此时仍未 spawn，等第一次派工才惰性创建）
④ 调度
   └─ scheduler：ready task → beginTaskAttempt → assignmentPrompt
        → dispatchMember：member.id 为空则先 spawnMember，再投递
⑤ 成员执行
   └─ claim_task → in_progress → 工具工作 → update_task(attempt_id, ...)
        → completed/failed（质量任务要过门禁）
        → send_message(to=captain) 汇报（队长被 steer 唤醒）
⑥ 收尾
   └─ 所有必需任务终态、成员 idle → 汇报 → delete（归档到 archive/<teamId>/）
```

对应的工具面（14 个，`tool-names.ts` 冻结业务名）：

| 角色 | 工具 |
| --- | --- |
| 队长专属 | create / approve / edit_plan / add_member / remove_member / create_task / reassign_task / amend_task / resume / delete |
| 共享 | claim_task / update_task / send_message / status |
| 成员可用 | claim_task / update_task / send_message / status（其余被 `tools.restrict` 隐藏） |

`approve` 既可以是工具（模型显式调用），也可以是 Web 路由（人点 Approve & Run）；协议明确要求「规划回合不得自我批准」。

---

## 5. 核心机制深挖

### 5.1 事件驱动调度器（`scheduler.ts`，554 行）

**为什么不是轮询**：Claude Code 的 teammates 靠"回合结束后继续 poll 共享任务列表"；DSH 的可续聊子代理有明确的 `running/idle` 边沿，所以调度器**在每个 idle 边沿和每次任务图变更时尝试一次原子领取**，不需要挂着一个轮询回合。

就绪判定：

```ts
const ready = tasks.filter(t => t.status === 'pending'
  && t.reassigning !== true
  && unsatisfiedDependencies(tasks, t.dependencies).length === 0)
// 优先派给"指定给自己"的任务，其次派给未指派任务
```

领取是锁内原子操作：

1. 锁内重读 `team.json`（防止并发变更）；
2. `beginTaskAttempt(task, member)` 生成新 `attemptId`，成员置 `working`；
3. 质量/审查类任务在领取时对 `inScope` 做一次工作区快照（`verdictStartSnapshot`）；
4. 写盘后**出锁**再投递（避免网络/模型调用持锁）；
5. 投递失败只回滚"自己这张票"：若 `attemptId` 已被并发转派改掉则放弃回滚。

几个容易忽略的边界：

- **一个成员同时只能有一个开放任务**（`ownedOpenTask`），空闲但仍有未完成任务时会被 **parked**，只有队长显式 reassign/接管才会换 capability。
- **冷恢复只做一次**：本进程没观察过的 durable 开放任务才允许自动恢复；恢复投递失败回到原 attempt，而不是变成可无限重派的 `pending`。
- **队长接管**：队长自己执行的任务如果回合结束仍未完成，会在 idle 边沿被重新入池（队长没有"下一轮自动续领"的调度通道）。
- `serializeMember` 用 per-member promise 链，保证同一成员的 kick 不并发。

### 5.2 邮箱与唤醒（`mailbox.ts` + `state.ts`）

设计目标：**消息必须可持久、可去重、可证明送达，并且不能唤醒过期执行代际**。

- 存储：每个收件人一个 JSONL；追加是"读全文 + 原子重写"（简单可靠，但长邮箱是 O(n²) 写放大）。
- 消息状态：`deliveryClaimedAt`（投递租约 60s）→ `deliveredAt`（宿主 inbox 接受）→ `readAt`（真正进入模型步骤）→ 或 `discardedAt`。
- `isCurrentMail()` 过滤两类过期消息：
  - 发送方代际过期（`sourceAttemptId` 已不是该成员当前 attempt）；
  - 接收方代际过期（`attemptId` 对应的任务已被转派/终结）。
- **step 准入**（`agent/pre-step` hook）：投递时文本里带一个 receipt（teamId/recipient/ids）。宿主把这些消息拼进下一步时，插件解析 receipt，只放行"当前代际且未读"的消息，然后在模型真正 `enter` 后统一 ack；过期消息被丢弃且**不阻塞**工具结果的回传。
- 去重：宿主原生的 `subagent-settled` 唤醒如果已有对应的团队报告，会被抑制，避免队长被同一次完成唤醒两遍。
- 两种投递模式：
  - `queue`：作为成员下一轮排队（派工）；
  - `steer`：插入正在运行的成员的下一个模型步（引导/追加要求）。
- 队长唤醒：成员 `send_message(to=captain)` 若队长在线，直接 `captain.steer(...)`；否则只写邮箱，队长下次 `status`/被唤醒时消费。

### 5.3 角色面：同一进程里的两种 Agent（`capabilities.ts`）

- 每个 Agent 首次 ready 时判定身份：队长 / 成员（成员还包括"已退休"与"fork 后的非 lead"）。
- 成员：`agent.ctx.tools.restrict({deny: 队长专属工具})` —— **schema 级隐藏 + 执行级拒绝**，不是提示词约束。
- 系统提示按身份切换（同一个 `systemPrompt.section`，order 117）：
  - 队长：10 条协议（建队、DAG、审批、调度、attempt、质量、halt/escaped、收尾）；
  - 成员：一段简短协议（先 claim、带 attempt_id、完成后汇报一次、不要建队）。
- persona（`memberPersona`）：团队目标 + 角色 + 执行指引 + "状态文件只读，别绕过工具直接改" + 10 条工作规则。欢迎语明确"等调度或队长指令，不要自己开工"。
- 工具策略（`tool-policies.ts`）：部署方声明 `toolPolicies: { researcher: { allow:[read,glob,grep] } }`；成员只能按 id 选择，模型不能运行时提交 allow/deny 列表。不变量：队长专属工具永不可放开；四个协调工具必须可用；`deny` 与队长 deny 取并集。
- 成员路由：创建时解析 provider/model/reasoning，写入 team.json；冷恢复从持久描述符重放。主模型不可用时可切 fallback，并记录 `activeProvider/activeModel`。

### 5.4 质量门禁：把"共识"变成机器判定（`quality-gates.ts` + `workspace-audit.ts`）

官方定义（docs/quality-gates.md）：

```
所有必需门禁通过
+ 所有 acceptance 通过
+ 没有 blocker/high finding
+ 最新实现版本已被独立 Reviewer 审查
+ 声明的验证命令通过
+ 修改范围合法
```

实现要点：

1. **任务合同**：`kind ∈ {requirements, implementation, verification, review, repair, integration, work}`；实现/修复必须带 `objective + acceptance + inScope + verify`，否则创建即拒绝。
2. **完成校验**：`update_task` 不是"写个 completed 就行"——
   - review/requirements 必须 `verdict=pass`；`needs_revision/reject` 只能 `failed` 且至少一条 finding；
   - 验收项/命令必须逐条 passed；
   - `changedPaths` 必须落在 `inScope`，越界不能完成；
   - 审查结论绑定 reviewed attempt + **文件 sha256 指纹**（`reviewedArtifacts/reviewedScope`）。
3. **证据与漂移**：审查开始时对 scope 做快照；交付/状态查询时重新读取当前字节并比对。文件在审查后被改、被删或 scope 里新增文件，结论标记 stale，面板不能显示"通过"徽章。
4. **自动修复循环**：review 失败 → 自动创建 `repair`（不依赖 failed 任务，避免永久不可领取）+ 下一轮 `review`，重连下游门禁；超过 `reviewPolicy` 轮次 → `escalated=true`，停止自动循环交给人。
5. **合同修订**：`amend_task`（队长专属）可改非终态质量任务的合同，写 revisions ledger；审查通过后冻结。用于"verify 命令本身写错导致死锁"的情况，而不是让 worker 作弊。
6. **统一审计面**：`status`、活动面板、任何 Web 消费者都走同一个 `auditTeamWorkspace()`，避免一个界面报通过、另一个界面看到的是新字节。

### 5.5 持久化、并发与恢复

- 所有读-改-写都包在 `withTeamLock(key)` 的 promise 链里（key 含 stateRoot + teamId，避免跨工作区同名串行）。
- 写文件用 `write tmp → rename` 原子替换；JSONL 邮箱也是整文件原子重写。
- 重启恢复依赖磁盘：团队、成员 child session id、任务 attempt、邮箱未读都持久化；`retired-members.json` 是"永不复活"的 deny-list。
- **fork 语义**（`lineage.ts`）：DSH 的 fork 会生成新 session，团队归属必须沿 `header.parentSession` 链解析；否则用户在 fork 里继续对话就"丢了团队"。成员仍按精确 session id 匹配，不会误认祖先。
- 删除不是删除：`delete` 把目录移到 `archive/`，保留成员、任务图、邮箱，供历史复盘。

### 5.6 Web/UI 面

- 三条业务路由：`GET /state`（团队快照，支持 `?archived=1`）、`POST /halt`、`POST /plan`（approve/continue/discard/add_task/update_task/...）；另有一条 `/assets` 静态白名单路由。
- 快照 = **磁盘真相 + live subagent activity**，不是事件重放；前端 1s 轮询，`cache: no-store`。
- 会话事件（`agent-teams/*`）写入队长会话，供对话流卡片与审计重放。
- 静态图片路由做显式 allowlist，防路径穿越。

### 5.7 兼容性工程

- `harness-compat.ts`（23 KB）集中处理宿主版本差异（continuable API、状态事件、session header 形态等）。
- 服务键双探测（`webServer`/`httpServer`、`workspaceRegistry`/`workspace`），`internal/service` 事件补注册——插件可在旧/新宿主上都工作。
- **fail-loud 时机**：`subagents` provider 是兄弟插件的 effect，`inject` 只保证 service 存在，所以能力校验放在**第一次 spawn**，不放在 `apply`。
- Web 路由懒注册：无 Web 的 headless profile 自动退化为纯工具模式。

---

## 6. 设计代价与局限

1. **单体复杂度**：`tools.ts` 151 KB、`quality-gates.ts` 93 KB，状态机分支极多；新人理解成本高，修改回归风险大。
2. **提示词常驻成本**：队长协议约 10 条长段落 + 工具描述，每个会话都占用上下文；靠"快照一次、永不重写"保证前缀稳定（对缓存友好）。
3. **文件即真相源**：跨进程并发没有文件锁（只有进程内 promise 锁）；桌面/CLI 双开同一工作区会互相覆盖。作者自己也把"独立 worktree 隔离"列为后续 PR。
4. **轮询 UI**：1s 轮询快照，规模大时会产生持续 IO；这是"外部插件只能拿 HTTP"的妥协。
5. **强宿主耦合**：continuable subagent、`agent/status`、`tools.restrict`、`systemPrompt.section` 缺一不可；换宿主等于重写。
6. **邮箱写放大**：每次追加/标记都是整文件重写，长会话下邮箱增长会拖慢。
7. **测试形态**：核心逻辑没有 `src` 内单测，主要靠 `.mjs` 集成脚本与真实宿主验证；对贡献者不够友好。

---

## 7. 对 GuaDa 的映射（如果要复刻）

### 7.1 能力对照

| 能力 | dsh-agent-teams | GuaDa 现状 | 差距 |
| --- | --- | --- | --- |
| 队长 | 当前会话 | 任意会话 | ✅ 无需改 |
| 成员 | `startContinuable` + persona + toolFilter + 独立路由 | `SubAgentManager.spawn(agentId, lifecycle)` | 缺 **persona 注入**、**per-member 工具过滤**、**可续聊 + 空闲唤醒** |
| 唤醒 | `followup queue/steer`，运行中可插入 | `sendMessage` 仅允许 idle，运行中直接报错 | 需增加 inbox + 步边界准入 / steer |
| 状态边沿 | `agent/status` idle/running | 有 settle 事件与 `isSubAgentRunning` | 需补 **idle/running 事件总线** |
| 工具面 | 14 个工具 + `tools.restrict` | 插件 toolkit + 智能体级 toolkit 过滤（`applyRoleLayer`） | 缺**会话级临时过滤器**；可用"临时 agent 配置"绕 |
| 状态持久化 | 工作区 JSON + JSONL | JSONL 事件溯源 + DB 元数据 + `.guada/` 目录 | ✅ 基础更好，可放 `.guada/teams/` |
| 并发 | 进程内 per-team 锁 | 单进程 Nest + 现有写锁范式 | ✅ 可直接复用思路 |
| 观测 | HTTP 轮询 + 会话事件 | SSE + OverviewPanel | ✅ 可做得更好（推送而非轮询） |
| 审批 | staged + Web 路由 | `ask_user` 阻塞式交互 + 前端面板 | ✅ 有基础，需加"计划编辑器" |
| 质量门禁 | 合同 + verdict + 证据 + sha256 | git 模块 + 沙箱策略 + 无任务级合同 | 全新领域，建议后置 |
| 脚本编排 | 明确"不用 workflow 引擎" | 已有 `workflow_run`（worker + vm + 子代理） | 两者是**互补**，不要混为一谈 |

### 7.2 边界建议

- **workflow 适合**：一次性的 fan-out/fan-in、固定脚本、无需人工中途审批（当前 `workflow_run` 正是这个定位）。
- **agent-teams 适合**：长生命周期、任务有依赖、成员之间要通信、需要人工审批/停止/恢复、需要审计的团队协作。
- 不要用 workflow 模拟团队（没有持久任务板/邮箱/审批），也不要把团队塞进 workflow 脚本（会失去可恢复性）。

### 7.3 分阶段落地建议

**P0：最小可用团队（团队状态 + 调度 + 邮箱）**

1. 新模块 `backend-ts/src/modules/team/`：`team.store.ts`（`<workspace>/.guada/teams/<teamId>/team.json` + `inbox/*.jsonl`）、`team.scheduler.ts`、`team.mailbox.ts`。
2. 复用 `SubAgentManager.spawn(..., lifecycle="persist")`；在 `settle`/`spawn` 处补发 `team/member-idle|running` 事件。
3. 给 `SubAgentManager` 增加 `deliver(sessionId, text, mode: queue|steer)`：idle 走现有 `sendMessage`，running 走"下一步注入"（可先落 inbox，在 `executeSubAgentStream` 的步边界消费）。
4. 工具面先做 6 个：`team_create / team_add_member / team_create_task / team_claim_task / team_update_task / team_send_message / team_status`。
5. 调度触发点：任务图变更 + 成员 idle 事件；所有写操作走 `withTeamLock`。

**P1：角色面与人工审批**

1. `team_create(approval=required)` + 前端计划编辑器（复用 `ask_user` 的交互范式，但独立面板）。
2. 成员 persona 注入 + 临时工具过滤：给 `spawn` 增加 `toolkits?: {allow?,deny?}`（覆盖 `applyRoleLayer` 结果），或生成临时 agent 配置。
3. SSE 推送 `team_snapshot`，不做 1s 轮询；沿用 MainLayout 单 SSE 连接、消费方订阅的既有约定。
4. 增加 `team_delete`（归档到 `.guada/teams/archive/`）与 `team_resume`。

**P2：质量门禁**

1. 任务合同字段（kind/objective/acceptance/verify/inScope）与完成校验。
2. `changedPaths` 用 git 模块取工作区 diff；审查结论绑定 `sha256`（复用 `attachment`/`file` 工具或新增 `artifact.util.ts`）。
3. 自动 repair + review 循环 + 轮次上限升级；`team_amend_task` 修订账本。

### 7.4 不建议照搬

- **不要**把 `team.json` 当唯一真相源：GuaDa 已有事件溯源 JSONL，团队事件也应进会话/全局事件流，文件只做投影。
- **不要**做 1s 轮询：SSE 是我们的优势。
- **不要**把 14 个工具塞进一个 151 KB 文件：按 store/scheduler/tools 分层。
- **不要**直接给成员全局 `tools.restrict` 的等价物而不留审计：我们的工具面是 toolkit 级，先做"能力包级"过滤即可。

---

## 8. 关键源码索引

| 文件 | 作用 | 值得先读 |
| --- | --- | --- |
| `src/index.ts` | 插件入口：Config、工具注册、prompt、Web 路由 | `usageSectionText()`、`apply()` |
| `src/types.ts` | TeamState / Member / Task / Message 全量模型 | — |
| `src/state.ts` | 锁、状态机、原子写、邮箱读写、归档 | `withTeamLock`、`beginTaskAttempt`、`isCurrentMail` 相关 |
| `src/scheduler.ts` | 事件驱动调度 | `kickMember`、`syncMemberStatus`、parked 逻辑 |
| `src/mailbox.ts` | 投递回执与 step 准入 | `installMailboxAdmission` |
| `src/members.ts` | spawn / deliver / persona / 失败分类 | `spawnMember`、`memberPersona`、`steerCaptainReport` |
| `src/tools.ts` | 14 个工具与业务状态机 | `agent_teams_create`、`update_task`、`reassign_task` |
| `src/quality-gates.ts` | 合同、verdict、自动修复循环 | `validateCreateTask`、`canDeclareDelivery` |
| `src/workspace-audit.ts` | 交付审计（sha256 + scope） | `auditTeamWorkspace` |
| `src/snapshot.ts` | 面板快照（磁盘 + live） | `collectTeamsActivity` |
| `src/capabilities.ts` | 身份判定、prompt 切换、工具限制 | `attach()` |
| `src/profiles.ts` | 命名团队模板 | `taskPlanning`、`reviewPolicy` |
| `src/lineage.ts` | fork 链上的团队归属 | `leadIdentityOfAsync` |
| `docs/quality-gates.md` | 质量门禁唯一执行规格 | 第 4、5 节 |
| `docs/developing-dsh-plugins.md` | DSH 插件开发全景（host/client/兼容坑） | 第 2、5 节 |

---

## 9. 一句话总结

**它用「文件状态机 + 代际租约 + 邮箱回执」解决了多 Agent 的可靠协作，用「任务合同 + 证据指纹」解决了多 Agent 的质量判定；真正值钱的不是 14 个工具，而是这些不变量。** 对 GuaDa 而言，P0 可先复刻调度器与邮箱，P1 再做角色面与审批，P2 才值得投入质量门禁。
