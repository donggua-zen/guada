# Workflow 子代理编排方案（对齐 deepseek-harness）

> 状态：已实现（v1）
> 竞品参照：`D:\AI\work\public\deepseek-harness` 的 `packages/workflow/*` + `packages/subagent/*` + `packages/client/ui-workflow-run`

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

## 四、事件双通道（对齐压缩事件先例）

| 通道 | 事件 | 消费方 |
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

- `backend-ts/test/workflow/workflow-engine.spec.ts`（22 用例）：同步校验（META_INVALID/SCRIPT_PARSE/abort 已中止）、正常运行（串行/args 注入/失败 null/aborted 映射/parallel/pipeline/phase+log）、上限与安全（白名单 AGENT_START/INVALID_ARGUMENT/RESULT_UNSERIALIZABLE/parallel 普通异常容错）、取消（abort 配对合成）、事件双发（seq 递增/落库失败不中断）
- `frontend/src/services/modules/streamProjector.test.ts`（+4 用例）：live 建卡与累积、回放与 live 收敛（seq 幂等）、end-先于-start 防御、多 run 并存与日志封顶
- 回归：`test/chat`、`test/plugins`、`test/common` 等全套后端 775/790 通过（3 个失败套件 embedding/browser/skill-hot-reload 为存量问题，与本改动无关）

## 八、已知边界（后续可扩展）

- agent() 无超时（受用户停止约束）；如需单 agent 超时可在 opts 加 timeoutMs
- 后台模式：现有信箱基建（enqueueMessage + system_reminder）可支撑"超时转后台"或显式后台参数（DSH 亦为 deferred 项）
- outputSchema 结构化输出、跨 run 持久化工作流模板（workflow 复用/分享）
