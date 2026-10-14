# Workflow 子代理编排方案（对齐 deepseek-harness）

> 状态：执行机制 v1 已实现；**进度展示已演进到方案 C（见第零节，2026-10-14）**
> 竞品参照：`D:\AI\work\public\deepseek-harness` 的 `packages/workflow/*` + `packages/subagent/*` + `packages/client/ui-workflow-run`
>
> 阅读提示：第一节「机制概述」、第二节「架构与数据流」、第五节「安全与继承」、第六节「与 DSH 的差异」
> 描述的是**执行机制**，仍然有效；第三节「文件清单」与第四节「事件双通道」是 **v1 落地时的历史记录**，
> 其中进度持久化与前端渲染位置已被后续两次迁移取代（见第零节）。

## 零、进度展示的现状（方案 C，取代 v1 与方案 B 的展示部分）

| 维度 | 现状 | 取代了什么 |
|---|---|---|
| 进度持久化 | **不落 JSONL**（方案 B，commit `43afee84`）：引擎维护内存折叠快照 + `workflow_event` SSE；终态一次性原子归档 `sessions/<sid>/workflows/<runId>.json` | v1 的 `workflow/event` 领域事件落库 + 双通道回放重建（与父循环共享 seq 分配，曾出现重复 seq 损坏会话的硬故障） |
| 后端接口 | `GET sessions/:id/workflow/runs`（内存快照 ∪ 磁盘归档，同 runId 内存优先） | — |
| 前端数据层 | `frontend/src/stores/workflowRuns.ts`：按会话缓存，**单一** REST 基线 + **单一常驻** SSE 订阅（不依赖面板挂载，避免"条件渲染导致订阅断链"）；基线按 `lastSeq` 防回退合并；`run-end` 后去抖补拉快照取 `result` | 概览面板与审阅标签各自 fetch + 各自订阅的两份重复逻辑 |
| 渲染位置 | **对话流内 `workflow_run` 工具调用处原地渲染**（方案 C，2026-10-14）：`components/chat/message-item/WorkflowRunInlineCard.vue` 作为独立渲染行（`STANDALONE_TOOL_NAMES`）；头行＝状态点/名称/进度/耗时 + 成员树（可跳子代理）+ 日志折叠 + 失败错误行 | 概览面板「工作流」区块（已删除）；v1 的 `WorkflowRunCard.vue` 事件卡（已随方案 B 删除） |
| 关联键 | `runId ↔ toolCallId`：插件把 `ctx.toolCallId` 传进 `startRun`，随 `run-start` 事件下发并进快照（对齐 `subagent_link` 范式）。旧归档无此字段 → 卡片绑不到 run，只按工具结果出终态头 + 返回值（不出进度树） | v1 靠事件落库在回合内现场合成消息束，不需要关联键 |
| 详情/历史 | 工作流审阅标签 `WorkflowHistoryPanel.vue`（成员树/日志/返回值/错误）；入口＝内联卡片「详情」+ 侧边栏起始页 | 概览区块的「查看全部」（已删除） |

渲染数据流（单链路）：

```
workflow_run 工具调用（JSONL 原生落库，工具执行前即已可读）
   ↕ toolCallId 绑定
workflowRuns store ── REST 快照（基线，含 logs/error/result）──► WorkflowRunInlineCard
                   └─ workflow_event SSE（增量，run 内 seq 幂等）──►   （对话流调用处）
                                                                    WorkflowHistoryPanel（审阅标签）
```

**终态收口**：`settle()` 是所有终态路径（worker `result`/`error` 消息、worker `error`/`exit` 兜底、
宽限期强杀、worker 构造失败）的唯一汇聚点。它除了归档快照，还负责①补发缺失的 `run-end`
（正常两个分支自己发过 → `runEndEmitted` 幂等跳过，seq 不重复占号）②把 `status/errorCode/errorMessage/durationMs`
同步进快照且先于归档。缺这一步时，崩溃/强杀分支只落到磁盘而没有事件：前端实时视图永久停在「运行中」，
刷新后归档里同样写着 `running`。


## 一、机制概述

Workflow = **模型现场生成的 JS 编排脚本**，在 worker thread + vm 沙箱中执行，通过钩子编排子代理：

```js
// 模型调用 workflow_run 工具时提供的 script 参数（顶层 await + return <JSON>）
const results = await parallel(repos.map(r => () =>
  agent(`分析 ${r} 的代码质量`)
));
const summary = await agent(`汇总：\n${results.filter(Boolean).join('\n---\n')}`);
return { summary, perRepo: results };
```

- `agent(prompt, opts?)` → RPC 回宿主 → `SubAgentManager.spawnForWorkflow` 创建独立会话子代理（同一个 AgentEngine 完整循环）→ 最终输出文本 resolve 回脚本；失败 resolve `null`（脚本 `.filter(Boolean)` 容错）
- `parallel(thunks)` / `pipeline(items, ...stages)` 编排并发；`phase(title)` / `log(msg)` 进度叙述；`args` 为工具调用传入的 JSON
- **fatal 错误纪律**（对齐 DSH）：脚本语法错（SCRIPT_PARSE）、meta 非法（META_INVALID）、钩子参数错（INVALID_ARGUMENT）、超总量（AGENT_CAP）、白名单拒绝（AGENT_START）等致命错误杀死整个 run 并以错误码报告；普通子代理失败仅该项为 null
- 前台阻塞执行：工具调用等待整个 run 结束，`return` 值（截断 30000 字符）即工具结果；期间父模型零 LLM 参与
- 无暂停/恢复/检查点（对齐 DSH deferred 项）；取消 = abort → 通知 worker + 中止全部在途子代理 → 5s 宽限 → `worker.terminate()` 强杀

## 二、架构与数据流

```
父 Agent 调 workflow_run {script, name, phases?, args?}
  │
  ▼
WorkflowEngineService.startRun (宿主)
  ├─ validateMeta（纯 JSON，绝不求值）→ META_INVALID 立即失败
  ├─ assertBodyParses（与 worker 相同 wrapper 预解析）→ SCRIPT_PARSE 立即失败
  ├─ 发 run-start 事件
  └─ new Worker(bootstrap, {eval:true}) ── go 启动门 ──► vm.createContext 执行脚本
                                                            │ agent()
  ◄──────────── RPC: agent-call {callId, prompt, opts} ─────┘
  │
  ├─ 并发槽 FIFO（默认 min(8, max(2, cores-1))，settings.workflow.maxConcurrentAgents 可覆盖）
  ├─ 总量兜底 100（AGENT_CAP）
  ├─ SubAgentManager.spawnForWorkflow → 独立子会话（sessionType=sub_agent, persist）
  │     → chatRunner.startStream（同一 AgentEngine 完整循环）
  │     ← SubAgentResult（readSubAgentResult 日志重放）
  ├─ 事件双发：publishStream(workflow_event) + messageStore.appendWorkflowEvent(workflow/event)
  └─ post agent-settled {output, stopReason} ──► agent() resolve
  │
  ▼
脚本 return <JSON> ── structured clone 校验 ──► 工具结果回父模型
```

**序列化边界**：worker_threads postMessage 的 structured clone 天然拒绝函数/循环引用/BigInt——
钩子入参显式校验（INVALID_ARGUMENT），return 值由 clone 把关（DataCloneError → RESULT_UNSERIALIZABLE），
等价 DSH realm 物化（materializeFromRealm）。

## 三、文件清单

### 新增（后端 `backend-ts/src/modules/workflow/`）

| 文件 | 职责 |
|---|---|
| `workflow.types.ts` | WorkflowMeta / WorkflowEventData / WorkflowError(fatal+code) / WorkflowRunResult |
| `worker/worker-protocol.ts` | Host↔Worker 消息联合（ready/go/cancel/agent-call/agent-settled/agent-failed/result/error） |
| `worker/worker-bootstrap.ts` | worker 入口源码字符串（`new Worker(code,{eval:true})` 免构建管线改动）：vm context + 5 钩子 + 取消/错误纪律 |
| `workflow-engine.service.ts` | 引擎：校验/worker 生命周期/RPC 路由/并发槽/事件双发/取消收敛/恰好一次配对 |
| `workflow.plugin.ts` | toolkit `workflow`（懒加载：目录行承担使用门槛；sub_agent 会话/无启用 agents → none）+ 工具 `workflow_run`（工具描述即脚本 API 唯一规格）+ `registerPrompt` 使用规则与 agents 清单（lazy prompt，tool_learn 时随工具定义一并下发） |
| `workflow.module.ts` | NestJS 模块（imports SubAgentModule） |
| `workflow.lang.zh/en.json` | NLS |

### 修改

| 文件 | 改动 |
|---|---|
| `sub-agent/sub-agent.manager.ts` | 新增 `spawnForWorkflow`：不走 states/completer/信箱（引擎是唯一等待者）、跳过 10 上限、lifecycle 固定 persist、settings.workflow 来源标记、导出 SubAgentResult |
| `common/persistence/types.ts` | EventType 增加 `workflow/event` |
| `common/persistence/message-store.interface.ts` | `appendWorkflowEvent` |
| `common/persistence/jsonl-message.service.ts` | 实现（载荷原样落库，返回 revision） |
| `common/events/unified-event.types.ts` | `STREAM_WORKFLOW_EVENT` |
| `chat/types/event-chunk.types.ts` | 流事件 `WorkflowEvent` 并入联合 |
| `chat/session-events.service.ts` | mapStreamMethod 增加 workflow_event 分支 |
| `app.module.ts` | 挂载 WorkflowModule |

### 新增（前端）

| 文件 | 职责 |
|---|---|
| `types/stream/workflow.types.ts` | WorkflowEventData / WorkflowRunState（与后端逐字段同构） |
| `components/chat/WorkflowRunCard.vue` | run → phase → member 三层折叠卡片（状态点/聚合尾巴/输出摘要/日志） |

### 修改（前端）

| 文件 | 改动 |
|---|---|
| `services/modules/streamProjector.ts` | `applyWorkflowEvent` reducer：live（workflow_event）与回放（workflow/event）**唯一入口**；按 runId 定位/创建 event 消息束；run 内 seq 幂等去重保证双源收敛 |
| `types/stream/event-chunk.types.ts` / `domain-event.types.ts` | 类型镜像扩展 |
| `components/chat/EventCard.vue` | eventType==='workflow' 分支渲染 WorkflowRunCard |
| `components/chat/ChatPage.vue` | provide `workflow:openSubAgentSession`（member 点击跳子代理 Tab，缺失时补建） |
| `locales/zh-CN|en-US/chat.ts` | `chat.workflow.*` 文案 |

## 四、事件双通道（v1 历史记录 —— 已被方案 B 取代，见第零节）

> 下列双通道（领域事件 `workflow/event` 落 JSONL）已在 commit `43afee84` 整体移除：
> 进度事件与父循环共享 per-session seq 分配（`getNextSeq` 读改写非原子），并发追加会写出重复 seq
> 触发 JSONL 连续性校验拒绝加载；现仅保留流通道 `workflow_event` + REST 快照基线的收敛。
> 本节的 reducer 幂等规则（`runId + run 内 seq`）仍是现行口径，只是不再有"回放"那一路。

| 通道 | 事件 | 消费方（v1） |
|---|---|---|
| 实时 | 流事件 `workflow_event`（SessionStreamManager → SSE，method `stream/workflow_event`） | StreamEventHub → streamProjector |
| 持久 | 领域事件 `workflow/event`（JSONL，载荷原样；后端 replayer 未知类型忽略，**绝不进 LLM 上下文**） | `GET /events` 事件页 → foldEvents |

两路喂 `applyWorkflowEvent` 同一 reducer，以 `runId + run 内 seq` 幂等去重——实时观看、刷新重建、翻历史页收敛到同一棵卡片状态树（用户决策：v1 完整回放重建）。

## 五、安全与继承

- 子代理 `sessionType="sub_agent"` → workflow/subagent 工具包 activator 返回 none，**天然禁递归**
- 沙盒模式/思考强度/attachments 从父会话继承（防权限逃逸）；角色模式沿用 agents 白名单（`settings.agents` 显式 true），非法 agentId → fatal AGENT_START 响亮失败
- 脚本沙箱：无 require/fs/网络；worker 资源限额 512MB；死循环由用户停止（abort → 5s 宽限 terminate）收敛，不阻塞后端主进程
- 子代理审批走现有统一 Ask 链路（v1 不像 DSH 钉死 never）

## 六、与 DSH 的有意差异（v1）

| 项 | DSH | 本项目 v1 |
|---|---|---|
| 结构化输出 outputSchema | 支持 | 不做，agent() 返回文本 |
| 多 provider（ACP/Codex/外部 CLI） | 支持 | 仅进程内 spawn（= 现有 SubAgentManager） |
| 暂停/恢复/检查点/后台模式 | 无 | 无（前台阻塞，已确认取舍） |
| 卡片内容边界 | 只显示身份+状态 | member 行可展开 200 字输出摘要 |
| realm 物化 | 手写深拷贝 | postMessage structured clone 等价 |
| 执行环境 | worker thread + vm | 相同（bootstrap 内联 eval，免构建管线改动） |
| 并发默认值 | min(16, cores-2) | min(8, max(2, cores-1))，settings 可调 |
| 模型面注入 | 工具常驻工具表 + 极简策略段（~720 tokens/轮常驻） | **懒加载工具包**：目录行 ~70 tokens/轮常驻，API 规格（工具描述即唯一规格）+ 使用指南在 tool_learn 时一次性下发（~720 tokens 一次），经 tool_use 包装调用 |

## 七、测试

- `backend-ts/test/workflow/`（`workflow-engine.spec.ts` / `workflow-file-store.spec.ts` / `workflow.controller.spec.ts`，36 用例）：同步校验、正常运行、上限与安全、取消配对、快照归档、REST 端点合并、工具调用关联键、终态收口（漏发的 run-end 由 settle 补发且只一条）
- `frontend/src/services/modules/workflowRuns.test.ts`：reducer 幂等与累积（含 `run-start` 关联键 `toolCallId` 落进状态、旧归档无关联键）
- `frontend/src/stores/workflowRuns.test.ts`（方案 C 新增）：基线幂等加载、SSE 增量与未加载会话、基线按 `lastSeq` 防回退合并、`run-end` 去抖补拉 result、`clearSession`
- `frontend/src/utils/toolDisplay.test.ts`：独立成块判定（`ExitPlanMode` / `subagent_spawn` / `workflow_run`）
- 回归：`test/chat`、`test/plugins`、`test/common` 等后端套件；前端 `pnpm --dir frontend test`（vitest）+ `typecheck` + `lint`

## 八、已知边界（后续可扩展）

- agent() 无超时（受用户停止约束）；如需单 agent 超时可在 opts 加 timeoutMs
- 后台模式：现有信箱基建（enqueueMessage + system_reminder）可支撑"超时转后台"或显式后台参数（DSH 亦为 deferred 项）
- outputSchema 结构化输出、跨 run 持久化工作流模板（workflow 复用/分享）
