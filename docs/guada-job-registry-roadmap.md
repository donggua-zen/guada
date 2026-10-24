# GuaDa 后台作业体系后续开发计划

- 日期：2026-10-23
- 仓库：`D:\AI\ai_chat`（分支 `local-dev`）
- 上游文档：`docs/guada-background-notification-read-plan.md` 第 7 节
- 状态：路线已批准；**M1、M2、M4、M5 已执行（2026-10-23）**；M3（持久 PTY）暂缓。见第 8/9/10 节。

---

## 0. 结论与范围

按上游文档第 7 节，拆成 **M1-M5** 五个里程碑。先执行 M1，验收后再逐阶段确认 M2-M5，避免一次性重构所有执行器。

核心原则：

1. **先统一控制面，不重写执行面**：ProcessManager / SubAgentManager / WorkflowEngine / RemoteAgentManager 继续负责执行；Registry 只负责 jobId、状态、通知、读取、取消、归属。
2. **jobId 稳定，processId 降级为 handle**：保留现有 `process` 工具、REST、UI 兼容。
3. **通知单点化**：后台完成通知由 JobNotifier 统一投递，`reported` 去重；执行器不再各自 `enqueueMessage`。
4. **不把重启恢复塞进本计划**：Registry 仍是进程内内存表；重启后 job 丢失，但日志文件仍可读。持久化 journal 单列为后续可选。

---

## 1. 现状判断（已核实）

| 能力 | 现状 | 主要缺口 |
|---|---|---|
| 本地 shell | ProcessManager：spool + cleaned log、`process list/read/poll/kill`、`reported`、10min TTL、Windows native Job | processId = OS PID；无稳定 jobId；无通用 job 工具 |
| 子 Agent | 同进程 async、父会话 10 个上限、完成经 `enqueueMessage` | 无 jobId/list/output；`wait` 取走 completed 后通知失效 |
| Workflow | worker_thread + runId + 终态快照，前台工具调用 | 无 job 视角；turn 结束后无通知 |
| Scheduler | node-cron + JSON，派发聊天回合 | 无 job 观测；合并批次只回填第一条 callbacks，其余日志永久 running |
| 远程 workspace | SSH/docker/WSL agent，`r:conn:pid`，poll 拉取 | 无完成推送；turn.stopping 之后完成即静默；断线后远端进程失联 |
| 持久 Shell | TerminalService 有 node-pty，但只服务 UI；`createAgentTerminal` 无调用点 | 模型无工具；transcript 1MB 内存，无 offset/落盘；无命令完成检测 |
| 退出收尾 | Electron 强杀后端树；ProcessManager `onModuleDestroy` 只清 GC timer | 后端无 reaper；信号路径直接 `process.exit(1)`；legacy 子进程可能孤儿 |
| keep-awake | 只看 `ChatRunner.hasActiveWork()` | 不感知本地后台 shell、远程 job、PTY |
| UI | `process_changed` → REST 重拉；日志面板 2s 轮询 | 无 jobs 快照流；远程/PTY 不显示 |

可复用的基础已经具备：ProcessManager 的 spool/offset 读取、TerminalService 的 PTY/spawn/orphan 回收、ChatRunner 队列、EventBus/SSE、`RpcClient.onPush`（已存在但未使用）。

---

## 2. 目标架构

新增 `backend-ts/src/modules/jobs/`：

```ts
type JobId = `job-${string}`;
type JobKind = "shell" | "remote-shell" | "pty" | "subagent" | "workflow" | "scheduler";
type JobStatus = "running" | "stopping" | "completed" | "killed" | "failed" | "lost";

interface JobSnapshot {
  id: JobId; kind: JobKind; label: string; sessionId: string;
  status: JobStatus; detail?: string; handle?: string;
  startedAt: number; finishedAt?: number; exitCode?: number | null;
  logFilePath?: string; logSize?: number; reported: boolean; revision: number;
}

interface JobStartSpec {
  kind: JobKind; label: string; sessionId: string; handle?: string;
  notify?: boolean;              // 默认 true；前台工具结果已交付时设 false
  read(opts: { offset?: number; maxBytes?: number }): Promise<JobOutputRead>;
  cancel(reason?: string): void | Promise<void>;
  isAlive?(): boolean;
  done: Promise<JobOutcome>;     // 执行器结算时 resolve
}
```

`JobRegistryService` 语义：

| 操作 | 语义 |
|---|---|
| `start(spec)` | 每会话最多 10 个 running/stopping；生成 `job-<uuid>`；revision++；`done.then(settle)` |
| `settle(id, outcome)` | first-wins；写 finishedAt/exitCode/detail；revision++；发 `job.settled` |
| `read(id, sessionId, opts)` | 非破坏性；默认尾部 64KB；有 offset 读区间；**终态读取置 reported**，running 不置 |
| `wait(id, timeoutMs)` | 有界等待；超时返回 running；终态置 reported |
| `kill(id, reason)` | 终态返回 already-finished；running → cancel + `stopping` + reported（不投递完成通知） |
| `list(sessionId)` | running + 终态（TTL 10 分钟） |
| `disposeSession(sessionId)` | 取消该会话全部 job，最多等 2s，移除记录 |
| `hasActiveJobs()` | running/stopping，供 keep-awake |

模块依赖约定（避免循环）：

- `JobsModule` 只提供 Registry/types/JobsPlugin，**不 import ChatModule / RemoteWorkspaceModule / PluginsModule**。
- `JobNotifierService` 放在 ChatModule（ChatModule imports JobsModule），避免 `JobsModule → ChatModule → RemoteWorkspaceModule → JobsModule`。
- `JobsPlugin` 由 ShellModule 注册（ShellModule 已 import PluginsModule），避免 `JobsModule → PluginsModule → RemoteWorkspaceModule → JobsModule`。

---

## 3. 里程碑

### M1：通用 Job Registry + 本地 shell（6-8 人日）

**目标**：本地后台命令拥有稳定 jobId、统一通知、统一读取/取消工具；`process` 工具和 UI 完全兼容。

**改动**

1. 新增 `modules/jobs/`：`job.types.ts`、`job-registry.service.ts`、`jobs.plugin.ts`、`jobs.module.ts`。
2. `ProcessManagerService`：
   - 注入 `JobRegistryService`；`ProcessEntryBase` 增加 `jobId?`、`jobDoneResolve?`。
   - 显式 `background:true` 和前台超时转后台时，同步 `registry.start(...)`；`ExecuteResult` 增加 `jobId`。
   - `handleProcessEnd` resolve job；`cleanupProcess` 对未结算 job 做 killed/failed 兜底。
   - `buildPollResult` / `drainCompleted` / `readProcessLog` / `kill` 同步 `registry.markReported(jobId)`。
   - 保留无 jobId 时的旧 `enqueueSystemMessageFromEntry` 作为回退，有 jobId 时通知权归 Registry。
3. `JobNotifierService`（ChatModule）：
   - 监听 `job.settled`；跳过 `reported` / `notify:false`。
   - shell/remote/pty → `source.kind="process_monitor"`（UI 不变，source 增加 jobId）；subagent → `sub_agent`；workflow/scheduler 默认不通知。
   - 文本：jobId、状态、exit code、日志路径、`Use job_output <id>`。
   - `isValid = !reported && registry.has(id)`；`onConsumed = markReported + scheduleCleanup`。
4. `JobsPlugin`：
   - `job_output(job_id, offset?, max_bytes?, wait?, timeout_ms?)`：默认非阻塞、尾部 64KB、clamp 1KB-512KB；wait 默认 30s、上限 10min；末尾 `[status: ...]`。
   - `job_list`：当前会话 job。
   - `job_kill(job_id, reason?)`：立即返回，状态先 `stopping`。
   - prompt：后台工作返回 jobId；完成会推送，不要 busy-poll；最终回答前 `job_output` 收口。
5. `shell.plugin.ts`：background 文本/meta 增加 `Job ID`；prompt 引导优先用 `job_*`，`process` 继续用于 stdin/legacy。

**验收**

- `run_command(background:true)` 同时返回 `jobId` + `processId` + 日志路径。
- `job_list` 可见；`job_output` 尾部/offset 读取正确；`job_kill` 能终止整树。
- 完成通知只发一次；`job_output` 读终态后通知失效；读 running 不抑制通知。
- 现有 `process` 工具、REST、ProcessLogPanel、全部回归测试不破。

---

### M2：子 Agent / Workflow / Scheduler 接入（4-6 人日）

**目标**：本地后台工作统一到 jobId；完成通知只走一条链路。

**改动**

1. `SubAgentManager`：
   - 后台 spawn 注册 `kind="subagent"`，handle=subSessionId，sessionId=父会话。
   - `finalizeSubAgent` resolve job；`waitForComplete` / `closeSubAgent` 置 reported 并取消。
   - 删除后台完成路径的直接 `enqueueMessage`，由 notifier 走 `sub_agent` source。
   - 前台模式保持原契约；超时转后台时才注册 job。
2. `WorkflowEngineService`：
   - 每次 run 注册 `kind="workflow"`，`notify:false`（结果仍由工具返回）。
   - `read` 返回终态摘要；`cancel` 调现有 `cancel(runId)`。
3. Scheduler（可选，放在本阶段末尾）：
   - 派发时注册 `kind="scheduler"` 观测记录，不改调度语义；`cancel` 取消目标会话流。
   - 顺带修复 `executeQueueItem` 合并批次只取第一条 callbacks 的问题，避免其余任务日志永久 running。
4. `SessionService.delete` → `jobRegistry.disposeSession(sessionId)`，补上会话删除清理。

**验收**

- 后台子 Agent 返回 jobId；`job_list/job_output/job_kill` 可用；完成通知与 `subagent_manager wait` 不重复。
- 父会话删除 / 子 Agent close 后无残留 job。
- Workflow 在 job_list 可见，cancel 能停；不影响现有 workflow_event/快照。

---

### M3：持久 Shell / PTY（8-12 人日）

**目标**：给模型一个跨命令保留 cwd/env 的持久 shell，同时不改变 `run_command` 契约。

**方案选择**：新增独立工具 `persistent_shell`，不采用 `run_command(persistent:true)`。理由：一次性命令的超时/截断/远程/sandbox 语义太多，改契约回归面过大；独立工具风险隔离，且可对齐 DSH 的 persistent shell。

**改动**

1. 抽出 `CommandPolicyService`（从 `ShellPlugin.enforceCommandPolicy` 提取），`run_command` 与 `persistent_shell` 共用；plan mode / sandbox / 审批语义保持一致。
2. `TerminalService`：
   - 启用并扩展 `createAgentTerminal`：每 GuaDa 会话最多 1 个 agent PTY；shell 用 `GUADA_SHELL` 解析结果（Git Bash/PowerShell，cmd 可选）。
   - PTY 输出同时写 raw spool + cleaned log（复用 OutputTailer / StreamingSanitizer），transcript 仅作 UI 回放。
   - 新增 `read(sessionId, offset, maxBytes)`、`write(sessionId, input)`、`disposeAgentSession(sessionId)`、`listAgentSessions()`。
   - 命令完成检测：命令后追加随机 sentinel（bash `printf ... "$?"`，PowerShell `Write-Output ... $LASTEXITCODE`），解析最后一条 sentinel，剥离命令回显和 ANSI。
   - 同一会话命令串行；上一命令未完成时拒绝新命令并返回 jobId/offset。
   - 空闲 30 分钟回收；会话删除/子 Agent 关闭/后端重启时 dispose；Windows 增加 `taskkill /T /F` 兜底，Unix 尽力进程组 kill。
3. `PersistentShellPlugin`：
   - 工具 `persistent_shell` actions：`run`（command, timeout_ms?）、`read`（offset?）、`write`、`close`、`list`。
   - `run` 在 timeout 内完成 → 返回 output + `[status: completed]`；超时 → `[status: running]` 并注册 `kind="pty"` job，后续 `job_output/job_kill` 可用。
   - sandbox/只读/plan mode 下拒绝或降级，错误信息明确。
4. UI：复用 `ToolTerminalView` 的 terminal renderer，不新增面板。

**验收**

- `cd` / `export` / 变量在后续命令可见；输出干净、无 sentinel/ANSI 残留。
- 超时命令可通过 `job_output` 继续读、`job_kill` 终止。
- 会话删除/后端退出后 PTY 不残留；命令策略每次执行都生效。

---

### M4：远程 Job + 推送 + shutdown reaping + keep-awake（7-10 人日）

**目标**：远程后台进程不再是“静默完成”；退出不留孤儿；keep-awake 能感知后台工作。

**改动**

1. `guada-agent` 升到 0.7：
   - 后台进程 ID 改为稳定 `p-<hex>`（替代自增 `processSeq`），保留 `processId` 字段兼容旧后端。
   - `execute` 增加可选 `jobId`，存入 `processInfo`；后台完成时广播 `process_done`：`{processId, jobId, status, exitCode, logFile, uptimeMs}`。
   - 新增 RPC：`readProcess`（按 offset 非破坏性读取）、`listProcesses`、`killAllProcesses`（退出收尾）。
   - `handleKill` 不立即删除 entry，保留日志与终态供 read；由 `drainCompleted`/TTL 回收。
   - 传输层：WS 与 stdio 都接上 `process_done` 广播。
2. 后端远程接入：
   - `WorkspaceToolRouter` 远程后台启动时注册 `kind="remote-shell"` job；read 调 `readProcess`，cancel 调 `kill`。
   - `RemoteAgentManager` 建连时 `rpc.onPush("process_done", ...)`，按 `jobId` 优先映射，回退 `connection:pid`；转 `jobRegistry.settle`。
   - 旧 agent 兼容：版本低于 0.7 时启动 3-5s 轻量 poller，`poll(0)` 累积输出并结算；新 agent 走推送。
   - 连接断开：running job 置 `lost`，detail 写明“远端可能仍在运行”，notify 一次；不谎报 completed。
3. Shutdown reaping：
   - `ProcessManagerService implements OnApplicationShutdown`：终止所有 running entry，最多等 1.5s，释放 Job/进程句柄。
   - 模块级 `liveKillGuards` + `process.on("exit")`：legacy Windows `taskkill /T /F`，Unix 进程组 SIGKILL；native 由 Job 内核兜底。
   - `TerminalService` 增加 exit 兜底；`main.ts` 信号路径改为 `await app.close()` + 5s 超时，不再直接 `process.exit(1)`；Bridge shutdown 的 2s 上限放宽到 5s。
   - `RemoteAgentManager` 退出时对缓存连接调 `killAllProcesses`（1s 超时）；提供 `GUADA_KEEP_REMOTE_JOBS_ON_EXIT=1` 逃生开关。
   - 启动孤儿扫描暂不做；崩溃路径由 Job/进程组/exit guard 兜底，避免 PID 复用误杀。
4. keep-awake：
   - `JobRegistry.hasActiveJobs()` 纳入 `KeepAwakeService.isBusy()`；RuntimeModule imports JobsModule。
   - 只统计 running/stopping；持久 shell 空闲会话不算 busy。

**验收**

- 远程后台命令完成后无需 poll 即收到通知；`job_output` 能读终态。
- app.quit 后本地无 shell/PTY 子进程；远程已登记 job 尽力终止；崩溃场景不 lingering（可接受远端孤儿并记录）。
- 有后台 job 运行时 Electron `powerSaveBlocker` 保持开启，全部结束后释放。

---

### M5：UI jobs 快照流 + 可选 keepDescendants（4-6 人日）

**目标**：前端不再靠 `process_changed` 全量重拉和固定日志轮询；jobs 视图统一。

**改动**

1. 后端：
   - `JobRegistry.snapshot(sessionId)` 返回 `{ revision, jobs }`；`JobSnapshot` 只含元数据，不含输出。
   - 扩展 `ProcessChangedEvent.payload` 为 `{ revision, jobs }`（保留事件名，旧前端忽略 payload 仍可 `load()`）。
   - 新增 `JobsController`：`GET /sessions/:id/jobs`、`POST .../jobs/:jobId/kill`、`GET .../jobs/:jobId/output?offset=`；保留 ShellController 旧端点。
   - 在 start/settle/kill/cleanup 发快照；日志增长用 `logSize` 字段 + 前端低频兜底。
2. 前端：
   - 新增 `stores/jobs.ts`：per-session `{revision, jobs}`、`applySnapshot`、`ensureLoaded`、断线重连补拉。
   - `useRunningProcesses` 改为 store 选择器；不再每个 `process_changed` 发 REST。
   - `ProcessLogPanel`：`logSize` 变化触发增量拉取；保留 2s 慢轮询作为兜底；终态补拉一次。
   - `UiProcessInfo` 补 `jobId/kind/exitCode/logFilePath`。
3. 可选 `keepDescendants`（默认不做）：
   - `run_command` 增加 `keepDescendants?: boolean`，仅 Windows native 生效。
   - 直接子进程退出后不立即关 Job handle；轮询 `QueryInformationJobObject` ActiveProcesses，归零或 10min TTL 再关；`job_kill` 仍整树终止。
   - 该语义会改变“无隐藏子进程”的现有承诺，需单独确认后再做。

**验收**

- 多窗口/重连时 jobs 列表由 revision 收敛，无乱序回退。
- 进程面板不再 2s 全量轮询；日志按 offset 增量追加。
- 旧 REST/旧前端仍可用。

---

## 4. 排期与依赖

| 阶段 | 内容 | 依赖 | 估算 |
|---|---|---|---|
| M1 | Job Registry 核心 + 本地 shell | 无 | 6-8 人日 |
| M2 | 子 Agent / Workflow / Scheduler | M1 | 4-6 人日 |
| M3 | 持久 Shell / PTY | M1（策略/输出可复用） | 8-12 人日 |
| M4 | 远程 Job + 推送 + 收尾 + keep-awake | M1；建议 M3 后 | 7-10 人日 |
| M5 | UI jobs 快照 + 可选 keepDescendants | M1-M4 | 4-6 人日 |

总计约 **29-42 人日**（单人全职、熟悉代码库）。M3 与 M4 无代码依赖，可按优先级互换；若更急迫解决远程静默完成，可先做 M4。

---

## 5. 测试与验证

**单元/集成**

```bash
cd backend-ts
pnpm build
pnpm test src/modules/jobs --runInBand
pnpm test src/modules/shell --runInBand
pnpm test test/plugins/jobs.plugin.spec.ts test/plugins/shell.plugin.spec.ts --runInBand
pnpm test --runInBand
```

```bash
pnpm --dir frontend test
pnpm --dir frontend typecheck
cd guada-agent && go test ./...
```

**手工验收场景**

1. 本地：`sleep 5; echo done` 后台 → jobId、`job_list`、`job_output(wait:true)`、通知一次。
2. 读取：终态 read 后不再通知；running read 不抑制通知。
3. 子 Agent：后台 spawn、wait、close，通知不重复。
4. 持久 shell：`cd`/`export` 跨命令保持；超时命令可 read/kill。
5. 远程：SSH 后台命令完成自动通知；断线显示 lost；旧 agent 走轮询兜底。
6. 退出：有运行中 job 时退出，任务管理器/`ps` 无残留；远程已登记 job 被 kill。
7. keep-awake：后台 job 运行时阻止休眠，结束后释放。
8. UI：多窗口同步、断线重连、日志增量。

---

## 6. 关键决策与风险

**决策**

1. jobId 稳定，processId 仅作 handle；日志命名 M1 不改，避免破坏磁盘回退。
2. shell/remote/pty 完成通知继续用 `process_monitor` source，UI 不改；subagent 继续用 `sub_agent`。
3. `job_output` 沿用 GuaDa 已定的非破坏性 tail/offset 语义，不引入 DSH 式隐藏单消费游标，避免和 `turn.stopping` 抢输出。
4. 远程推送带 `clientJobId` 回显，解决“完成事件早于 job 注册”的竞态；旧 agent 用 poller 兜底。
5. 退出默认终止本地运行中 job，并尽力 kill 远程已登记 job；保留环境变量逃生开关。
6. 持久 shell 用独立工具，不改 `run_command` 契约。
7. UI 扩展现有 `process_changed` payload，不新增事件名，保证旧前端兼容。
8. 本计划不做 job 持久化/重启恢复；Registry 内存表，日志文件仍可读。

**主要风险**

| 风险 | 缓解 |
|---|---|
| 迁移期通知双发 | 单点 notifier + `reported` + `isValid`；M1 保留无 jobId 回退路径但默认不触发 |
| 远程完成事件竞态 | execute 带 clientJobId 回显；未匹配事件短缓冲 |
| 退出强杀用户任务 | 只杀 running；1.5s 有界；逃生开关；文档说明 |
| 持久 shell 绕过命令策略 | 每命令都过 CommandPolicyService；sandbox/plan mode 禁用 |
| PTY sentinel 冲突/输出污染 | 随机 token、取最后一条、ANSI 清洗、多行/here-doc 测试 |
| 模块循环依赖 | Notifier 放 ChatModule、JobsPlugin 由 ShellModule 注册 |
| app.close 预算不足 | reaper 先跑，5s 上限，exit guard 兜底 |
| UI 快照乱序 | revision + REST 基线 + 重连补拉 |
| 旧远程 agent 不兼容 | 版本门控 + poller 兜底 + 自动部署新 agent |

---

## 8. M1 执行记录（2026-10-23）

### 8.1 已落地

- 新增 `backend-ts/src/modules/jobs/`：
  - `job.types.ts`：JobId/JobKind/JobStatus、JobSnapshot/JobStartSpec、读取/事件类型、配额与 TTL 常量。
  - `job-registry.service.ts`：start/settle/read/wait/kill/list/disposeSession/hasActiveJobs；每会话 10 个 running/stopping；终态 10 分钟 TTL；first-wins；等待者结算时自动 reported；跨会话访问拒绝。
  - `job-notifier.service.ts`：订阅 `job.settled`，shell/remote/pty → `process_monitor`，subagent → `sub_agent`；通知只带状态与读取入口，不带完整输出；`isValid` 用 Registry 快照 + reported 去重。
  - `jobs.plugin.ts`：`job_output` / `job_list` / `job_kill` 三个模型工具 + 使用提示词。
  - `jobs.module.ts`：只提供 Registry 与 JobsPlugin，不 import Chat/Plugins/Remote，避免循环依赖。
- `ProcessManagerService`：
  - 可选注入 `JobRegistryService`（直接 new 的测试/嵌入场景不挂 Registry，保留旧通知路径）。
  - `ProcessEntryBase` 增加 `jobId/jobDoneResolve/jobSettled/pendingJobNotice/jobRegistrationFailed`。
  - 显式 background 与前台超时转后台时注册 job；`ExecuteResult.backgrounded`、`PollResult`、`ProcessListEntry` 增加 `jobId`。
  - `handleProcessEnd`：有 poll waiter 时交给 poll 结算；否则结算 job；有 jobId 时不再走旧 enqueue。
  - `buildPollResult` / `drainCompleted` / `readProcessLog` / `kill` / `cleanupProcess` 同步 reported 与 job 结算。
  - 处理“进程在 job 登记前结束”的竞态：`pendingJobNotice` 等登记后由 Registry 投递，避免双通知。
- `ChatModule`：imports JobsModule，providers 增加 JobNotifierService。
- `ShellModule`：imports JobsModule，注册 JobsPlugin（不把插件注册放进 JobsModule，避免与 PluginsModule/RemoteWorkspaceModule 成环）。
- `shell.plugin.ts`：
  - background 结果文本/meta 增加 `jobId` 与 `job_output` 提示。
  - process list/poll 输出增加 jobId。
  - prompt 引导优先使用 job_output/job_list/job_kill。

### 8.2 测试

- 新增 `src/modules/jobs/job-registry.service.spec.ts`（8 tests）。
- 新增 `src/modules/jobs/job-notifier.service.spec.ts`（3 tests）。
- 新增 `src/modules/jobs/jobs.plugin.spec.ts`（4 tests）。
- 新增 `src/modules/shell/process-manager-job.spec.ts`（2 tests：background jobId/读取/结算、job kill 抑制通知）。
- `pnpm build`：通过。
- 全量后端：**242 suites，3255 passed / 1 known scheduler 时序抖动 / 3 skipped**；失败用例 `test/scheduler/missed-window.spec.ts` 单独跑 5/5 通过（已知长跑抖动，非本次改动引入）。

### 8.3 已知限制

- Registry 仍为内存表，重启后 job 丢失；日志文件仍可读。
- 现有 `process` 工具/UI 未改，shell 后台通知 source 仍是 `process_monitor`。
- `job_output` 是非破坏性 tail/offset 读取，与 DSH 的隐藏单消费游标有意不同。
- M1 时子 Agent / Workflow / Scheduler / Remote / PTY 尚未接入；其中前三项已在 M2 完成，Remote/PTY 按 M3/M4 继续。

---

## 9. M2 执行记录（2026-10-23）

### 9.1 Registry 生命周期钩子

- `JobStartSpec` 增加：
  - `onReported?: () => void`：结果被 read/wait/consume 交付，或 kill 主动抑制通知；只调用一次。
  - `onDisposed?: () => void`：终态 TTL 清理 / `disposeSession` 移除；只调用一次。
- `JobRegistryService`：
  - `markReported` 统一触发 `onReported`；settle 的 waiter 分支、kill、终态 read/wait 都走它。
  - `removeRecord` 用对象存在性防重复，并触发 `onDisposed`。
  - 钩子内部 try/catch，异常不影响 Registry 结算。
- 新增 `job-output.util.ts`：内存文本按 UTF-8 字节切 tail/offset，两端对齐字符边界。

### 9.2 子 Agent

- `SubAgentResult` 增加 `jobId`；后台 spawn / 前台超时转后台返回 jobId。
- `SubAgentManager` 可选注入 `JobRegistryService`；`SubAgentModule` imports `JobsModule`。
- 注册时点：
  - 后台 spawn：先注册 job，再挂 `onSettled`，避免 wait 先取走结果时重复通知。
  - 前台 20 分钟超时：同样先注册再挂 `onSettled`。
  - 前台正常完成 / `spawnForWorkflow` 不注册。
- `done` 在 settle 完成后 resolve，映射：completed→completed；aborted/closed→killed；error/max_tokens/refusal→failed。
- `read` 复用 `readSubAgentResult`，返回最后一条 assistant 文本。
- `cancel` 复用 `closeSubAgent`：移除 running、清理 completed/completers、冻结会话，`finalizeSubAgent` 早退，不投递脏消息。
- 通知归属：
  - `finalizeSubAgent` 在 `jobId` 存在时跳过旧 `enqueueMessage`，由 `JobNotifierService` 走 `sub_agent` source。
  - `jobId` 不存在（Registry 未注入/配额满）时保留旧信箱通知 fallback。
- 去重/冻结：
  - `waitForComplete` 两条路径都 markReported；无 jobId 时补 one_shot 冻结。
  - `job_output` 终态读取 markReported。
  - `closeSubAgent` 开头 suppress job。
  - `settle` 先检查 `state.running`，close 与 settle 竞态不再留下脏 completed 条目。
  - `ParentSessionState.completed` 增加 `jobId/lifecycle`。
- `subagent_spawn` running 文案增加 Job ID 与 job_output/job_kill 提示。

### 9.3 Workflow

- `WorkflowRunResult` 增加 `jobId`；`workflow.plugin` 完成/取消/失败文案带 jobId。
- `WorkflowEngineService` 可选注入 Registry；`WorkflowModule` imports `JobsModule`。
- `runId` 创建后注册 `kind="workflow"`、`notify:false`、handle=runId、label=workflow 名称。
- `read` 返回 `run.getSnapshot()` 的 JSON 文本；`cancel` 复用 `run.cancel`；`onDisposed` 只删除该 run 的内存快照。
- 注册失败（配额）不影响 workflow 执行。

### 9.4 ChatRunner 合并回调

- `executeQueueItem` 不再只取第一条 callbacks：
  - `onEvent/onComplete/onError` fan-out 到批次内全部回调，每个回调独立 try/catch。
  - 非 `SESSION_BUSY/STREAM_START_FAILED` 失败先逐条 `onError`，再逐条 `onConsumed`。
- 这修复了多个 scheduler 任务合并成一轮时，除第一条外日志永久 running、job 永不结算的问题。

### 9.5 Scheduler

- `TaskExecutorService` 可选注入 Registry；`SchedulerModule` imports `JobsModule`。
- `runOnce` 在 `prepareSession` 后注册 `kind="scheduler"`、`notify:false`、handle=log.id；重试复用同一 job。
- callbacks 的 `onComplete/onError` 更新日志并结算 job；`runWithRetries` 最终失败也结算 failed。
- `read` 读取 `getLogsByTaskId` 中的执行日志。
- `job_kill`：先结算 killed，再 `cancelStream` + `peekQueuedMessage` 移除排队消息，并落失败日志。
- 注册失败不影响任务执行。

### 9.6 会话删除与 source

- `SessionService` 可选注入 Registry；`deleteSession` 在活跃流护栏之后、删除 DB/JSONL 之前，对父会话和 children 并发 `disposeSession`。
- `MessageSource` 的 `sub_agent` / `process_monitor` 增加可选 `jobId`；`toMessageSource` 保留该字段。
- Workflow run 快照通过 job 的 `onDisposed` 按 run 清理。

### 9.7 测试

- `job-registry.service.spec.ts`：新增 onReported/onDisposed 幂等用例（11 tests）。
- `job-output.util.spec.ts`：tail/offset/UTF-8 边界（5 tests）。
- `test/sub-agent/sub-agent.manager.spec.ts`：新增 5 个 Job Registry 集成用例（64 tests total）。
- `test/workflow/workflow-engine.spec.ts`：新增 2 个 job 用例（32 tests total）。
- `test/scheduler/task-executor.service.spec.ts`：3 个 job/取消/失败用例。
- `test/chat/chat-runner.service.spec.ts`：2 个合并回调用例（10 tests total）。
- `src/modules/chat/session.service.delete-job.spec.ts`：2 个删除清理用例。
- `pnpm build`：通过。
- M2 目标回归：**13 suites / 160 tests passed**。
- 全量后端：**245 suites，3277 passed / 1 known scheduler 时序抖动 / 3 skipped**；失败用例 `test/scheduler/missed-window.spec.ts` 单独跑 5/5 通过（已知长跑抖动，非本次改动引入）。

### 9.8 已知限制

- Registry 仍为内存表，重启后 job 丢失；子 Agent/Workflow 的结果仍可从 JSONL/快照读取。
- Scheduler 的 `job_kill` 对已开始回合是取消流，对排队消息是移除；都不能保证目标会话的模型请求在远端立刻停止。
- Workflow 取消有 5s 宽限，而 `disposeSession` 只等 2s，极端情况下 job 已移除但 worker 仍在收尾。
- M2 时 Remote / PTY 尚未接入；M4 已完成 Remote，PTY 按 M3 暂缓。

---

## 10. M4 + M5 执行记录（2026-10-23）

### 10.1 远程 agent 0.7 + 推送 + 远程 Job

- `guada-agent` 版本升到 **0.7.0**，`Makefile` 与 `dist/latest.json` 同步；已重建 Linux/Darwin（amd64/arm64）与本地 Windows 二进制。
- 后台进程 ID 改为稳定 `p-<16hex>`；`processInfo` 增加 `JobID/Status/ExitCode/Killed`。
- `execute` 接受 `jobId` 并回显；后台与前台超时转后台都会在退出时广播 `process_done`。
- 新增 RPC：`readProcess`（offset 非破坏性，offset<0 读尾部）、`listProcesses`、`killAllProcesses`。
- `handleKill` 保留 entry 并标记 killed；`drainCompleted` 返回 jobId/status。
- WS 推送统一走 `RPCHandler.WriteEvent` + `connectionTracker.broadcastEvent`，与响应共用 writeMu；stdio 由 `streamServer.Broadcast` 串行写。
- 后端：
  - `AgentWorkspaceProvider` 增加 `supportsRemoteJobs`、`readProcess`、`listProcesses`、`killAllProcesses`；后台结果回传 `jobId`。
  - `RemoteAgentManager` 缓存 agent 版本，连接建立时注册 `rpc.onPush("process_done")`，断线发 `remote.process.disconnected`。
  - `WorkspaceToolRouter` 注册 `remote-shell` job，支持 push 结算、10s 早到事件缓冲、turn.stopping drain 去重、断线置 lost、主动 kill 抑制通知。
  - `run_command` 远程后台结果带 jobId/job_output 提示；旧 agent 只登记 processId，不注册永不结算的 job。
- 版本策略：0.7 硬要求；不维护 0.6 poll 兼容层，升级失败时后台命令明确报错。

### 10.2 shutdown reaping

- `ProcessManagerService` 实现 `OnApplicationShutdown`：终止 running、最多等 1.5s、释放句柄；legacy 注册 `process.on("exit")` 同步 taskkill / 进程组 SIGKILL；native 由 Job `KILL_ON_JOB_CLOSE` 兜底。
- `TerminalService` 实现 `OnApplicationShutdown` + PTY exit guard（Windows `taskkill /T /F`，Unix SIGKILL）。
- `main.ts` 信号路径改为 `await app.close()` + 5s 强制退出；Bridge shutdown 上限 5s；关闭前先 `JobRegistryService.beginShutdown()` 静默通知。
- `RemoteAgentManager` 在 `onModuleDestroy`（连接仍打开时）调用 `killAllProcesses`，1s 超时；`GUADA_KEEP_REMOTE_JOBS_ON_EXIT=1` 跳过。
- Electron `performShutdown` 等待后端从 5s 调到 7s，给 reaper 留余量。

### 10.3 keep-awake

- `KeepAwakeService.isBusy()` 增加 `JobRegistryService.hasActiveJobs()`。
- `RuntimeModule` imports `JobsModule`。
- 覆盖 shell/remote/subagent/workflow/scheduler；终态 job 不阻止休眠。

### 10.4 jobs 快照流 + API

- `JobStartSpec` 增加 `getLogSize`；shell 用 `fs.stat(cleaned log)`，remote 用最后已知大小。
- `JobRegistryService`：
  - `snapshot(sessionId)` 返回全量 jobs（含 logSize）；
  - 有 active job 的会话每 1s 发 `jobs.changed` 全量快照；revision 单调递增；
  - `read(..., { markReported:false })` 供 UI 读取，不吞模型通知。
- 新增 `JobsController`：
  - `GET /sessions/:id/jobs`
  - `POST /sessions/:id/jobs/:jobId/kill`
  - `GET /sessions/:id/jobs/:jobId/output?offset=&maxBytes=`
- SSE 增加 `jobs_snapshot`；删除 `process_changed` / `ProcessChangedEvent` / 旧 `ShellController`，前后端同版本发布，不做双事件兼容。

### 10.5 前端迁移

- 新增 `stores/jobs.ts`：按会话保存 revision + jobs；旧 revision 丢弃；REST 基线用于首屏/重连。
- `useRunningProcesses` 改为 jobs store 选择器；只展示 `shell/remote-shell/pty` 的运行中 job；不再事件后 REST 重拉。
- `ProcessLogPanel`：
  - props 改 `jobId`；日志通过 `GET /jobs/:id/output` 按 `nextOffset` 增量读取；
  - shell 不再 2s 轮询，由快照 `logSize` 触发；remote-shell 保留 2s 低频兜底；
  - 终态 1.5s 补拉；状态支持 stopping/failed/lost。
- tab 缓存：`processlog` key 改为 jobId；旧 processId 标签启动时直接丢弃，不迁移。
- `SessionEventsService` 类型改为 `jobs_snapshot`；旧 `process_changed` 删除。

### 10.6 测试

- Go：`go test ./...` 通过；新增 `process_job_test.go`（jobId 回显、process_done、readProcess 非破坏性、listProcesses）。
- 后端：`pnpm build` 通过；全量 **248 suites / 3292 passed / 3 skipped**。
- 前端：`vue-tsc --noEmit` 通过；`vite build` 通过；Vitest **51 files / 608 tests passed**。
- 新增后端测试：
  - `workspace-router.spec.ts` remote job push/lost/drain；
  - `remote-workspace-shutdown.spec.ts` killAll 与逃生开关；
  - `process-manager-shutdown.spec.ts` reaper；
  - `jobs.controller.spec.ts` jobs list/kill/output；
  - registry snapshot/ticker + UI read 不 markReported；
  - keep-awake registry busy。
- 前端测试：`useRunningProcesses` 改为 jobs 快照/revision/重连基线；tab 用例改为 jobId。

### 10.7 已知限制

- 远程 agent 0.7 为硬要求；旧 agent 后台命令会明确报错（无 0.6 poll 兼容层）。
- 远程 job 的 `logSize` 只在 read/完成时更新；日志面板对 remote-shell 保留 2s 兜底。
- 不做 job 持久化/重启恢复；远程 agent 重启后旧远端进程无法按 ID 重挂。
- `keepDescendants`（M5.3 可选）未实现；当前仍保持“直接子进程退出即回收 Job 后代”。
- 安装版 Electron 包未重新打包；需要完整重建安装包才能在实际安装版验证。

---

## 11. 单文件化执行记录（2026-10-24）

### 11.1 背景与决策

每个后台进程此前落两个文件：spool（`guada-<sid>-<tailId>.raw.log`，子进程直写的原始字节）+ cleaned log（`guada-<sid>-<pid>.log`，OutputTailer 转写的 UTF-8）。spool 存在的唯一理由是旧管道实现把「完成检测」耦合在管道 EOF 上（Git Bash 后代进程拖 EOF 1–2 分钟）；M1 引入 Windows Job Object 后完成检测已只认直接子进程 exit（native 轮询句柄 / legacy exit 事件），EOF 耦合解除，管道方案的前提重新成立。已核实：spool 无任何外部读者（唯一读者是 tailer 自己），所有读取方（poll/read/drain/UI/job_output）都读 cleaned 文件，`readOffset` 定义在 cleaned 字节空间，单文件后语义不变。远程 guada-agent 本来就是单文件（`<id>.out`）。

### 11.2 改动

- `win32-job-process.ts`：
  - koffi 新增 `ReadFile`/`PeekNamedPipe` 绑定；删除 `CreateFileW` + `createFileInheritable`（spool 文件句柄）。
  - `createStdoutPipe`：匿名管道写端 inheritable（stdout/stderr 在 STARTUPINFOW 共用同一句柄），读端留父进程；spawn 后父进程立即关掉写端副本，EOF 只取决于子进程树。
  - `spawnSuspendedInJob` 返回 `outputRead`（管道读端）；`NativeSpawnOptions.stdoutHandle` 参数删除。
  - 同步读取助手 `peekOutputPipeSync`/`readOutputPipeSync`（PeekNamedPipe/ReadFile 均在 peek 之后非阻塞，可安全跑在 JS 线程，无需 worker）。
- `output-tailer.ts`：从「spool 文件 → cleaned 文件」转写器改为「管道字节块 → 单文件」写入器：`feed(Buffer)`/`flushIdle()`/`flushFinal()`；`rawOffset` 游标消失。OutputDecoder 全部流式语义（GBK 粘性判定、ANSI 擦除、\r 折叠、行缓冲）不变。
- `process-manager.service.ts`：
  - native：`startOutputDrain` 定时泵（500ms 一拍，与 idle ticker 同拍）：`peekOutputPipeSync` 探到字节才 `readOutputPipeSync`，单拍预算 8MB，读到空即收；EOF（写端全关）或泵异常即停泵。退出路径 `checkNativeExit` 先 drain 再 `flushFinal`。
  - legacy：`stdio: ["pipe","pipe","pipe"]`；stdout/stderr 的 `data` 事件实时喂同一个 OutputDecoder → 同一单文件（到达顺序即进程真实写序，与旧共享 spool fd 一致）。
  - 所有读路径的 `tailer.pull()` 改为 `syncOutput(entry)`（native drain 管道、legacy 空操作）；`buildRawLogFileName` 删除。
  - `releaseProcessHandles` 增加关闭输出管道读端（kill/兜底清理路径不留句柄泄漏）。
- EOF 语义：EOF 只决定「还能不能读到后续字节」，不影响完成判定；孤儿后代仍持有写端时泵继续收它的输出（与 spool 时代一致）。Job Object `KILL_ON_JOB_CLOSE` 保证 kill 后 EOF 必达。

### 11.3 测试

- `win32-job-process.spec.ts`：spool 文件断言改为管道读取断言；新增「缓冲读干后 EOF 必达」（Win32 语义：数据不读走时 PeekNamedPipe 一直报告缓冲量）。
- `process-manager-native.spec.ts`：新增单文件断言（执行前后目录快照差集恰好等于 pid 命名的日志，无 `.raw.log`）。
- `process-manager.service.spec.ts`：新增 Unix legacy 单文件用例（stdout+stderr 同落一份日志）；ANSI/GBK/\r 折叠/后代进程/整树终止全部在管道语义下通过。
- 回归：`pnpm build` 通过；shell 模块 7 suites / 48 passed；jobs + shutdown 6 suites / 31 passed。

### 11.4 已知限制

- native 泵是 500ms 一拍的轮询（与 idle ticker 同拍），非事件驱动；命令输出到达日志的延迟最多一拍。管道默认缓冲 4KB 起步，正常命令输出不会在两拍之间溢出。
- legacy 路径（Unix）的 data 事件是实时的，无此延迟。
- `guada-logs` 目录里历史遗留的 `.raw.log` 由既有的 10 天 mtime GC 自然回收。

---

## 12. 工具收敛执行记录（2026-10-24）

### 12.1 原则与目标

化繁为简：**概念不新增、工具不冲突、能少则少**。参照 zcode（同级目录）的模型面——一个任务概念 + TaskOutput/TaskStop/SendMessage 三工具，无 process 工具、无 job/subagent 双列表——把 GuaDa 的后台工具收敛为**一个 job 概念、四个动词**。

### 12.2 收敛后模型工具面

| 工具 | 语义 | 来源 |
|---|---|---|
| `job_read(job_id, offset?, max_bytes?, wait?, timeout_ms?)` | 读输出/等终态 | 原 `job_output` 改名 |
| `job_list()` | 列本会话作业 | 不变 |
| `job_stop(job_id, reason?)` | 取消 | 原 `job_kill` 改名 |
| `job_send(job_id, input, append_newline?)` | shell 写 stdin；子 Agent 继续对话（自动解冻） | 新增，吸收 `process write` 与 `subagent_manager send_message` |

**删除**：`process`（kill/poll/write/list/read 5 action）、`subagent_manager`（wait/list/close/send_message 4 action）、`subagent_spawn` 的 `lifecycle` 参数、模型面一切 `processId`（转后台文案只报 `Job ID`；meta 保留 processId/handle 仅作 UI tooltip）。

**发起侧规则一句话**：`run_command` / `subagent_spawn` 前台=阻塞返回结果；后台=返回 jobId 托管。子 Agent 生命周期唯一：结果交付后自动冻结（原 one_shot 行为），`job_send` 对已冻结子会话自动解冻继续——模型面没有 lifecycle 概念。

### 12.3 关键改动

- `JobStartSpec` 增加可选 `send(input, appendNewline?)` 回调；`JobRegistryService.send()` 校验归属后转发，未声明 send 的 kind 明确报错。
- 三处实现：shell job → `ProcessManager.writeToStdin`；remote-shell job → `provider.writeToStdin`；subagent job → `SubAgentManager.sendMessage`。
- `SubAgentManager`：全链路删除 lifecycle 参数（spawn/createSubSessionAndRun/executeSubAgentStream/settle/finalizeSubAgent/registerSubAgentJob/handleSubAgentJobReported/maybeAutoDispose/finalizeCompletedDelivery，ParentSessionState.completed 条目不再带 lifecycle）；`sendMessage` 对 closedAt 非空会话自动解冻（`sessionStore.update({closedAt: null, closeReason: null})`），名额随 countByParentId 自然恢复。
- 文案单轨：run_command 本地/远程转后台、spawn 后台/超时、turn.stopping 提示、通知正文（job-notifier）、registry 配额报错、registerPrompt 全部改为 job 四动词措辞；shell/subagent NLS 的 process/subagent_manager 键删除。
- 前端：`terminalOutput.ts` BACKGROUND_MARKER 改为优先捕获 `Job ID: job-...`（保留旧 processId 捕获供历史会话回放，字段分立 `jobId`/`processId`）；`ToolCustomView` tooltip 取值优先 meta.jobId；`subAgentTools.ts` 删除 SUB_AGENT_MANAGER_TOOL；`subAgentLink.ts` 删除 args.sessionId 兜底分支。

### 12.4 测试

- jobs.plugin.spec 重写：四工具注册、job_read 读/等、job_stop、job_send 三用例（透传 appendNewline、false 原样、不支持报错）。
- sub-agent.manager.spec（src+test）：lifecycle 用例改写为统一冻结语义；新增「冻结后 sendMessage 自动解冻继续、交互后再冻结、名额恢复」。
- shell.plugin.spec：process 工具 describe 块整体删除。
- 前端：subAgentLink.test 4 处改写；terminalOutput.test 转后台用例改 jobId 提取 + 新增旧文案兼容用例。
- 回归：后端 **248 suites / 3292 passed / 4 skipped，0 失败**；前端 **51 files / 607 passed**、vue-tsc、vite build 全过。

### 12.5 已知限制

- 【TODO·待定】子 Agent 的 `job_send` 在运行中报错（只支持空闲时开新回合）。补齐方式是 DSH/zcode 式步边界注入（steer）：消息进收件箱，在子 Agent 的两次工具调用之间注入上下文同轮转向。属低频场景，暂不排期，需要时再按 dsh-agent-teams-research.md §282 的差距记录实施。
- `waitForComplete`/`getSubAgents` 方法保留（测试与内部诊断仍在用），只是不再有模型工具调用它们。
- 历史会话回放：旧文案的 processId 仍能解析展示，但新会话不再产生 processId 文案。

---

## 13. job_read 游标化执行记录（2026-10-24）

### 13.1 动机与语义

`job_read` 的 offset/max_bytes 参数面是给模型加翻页负担（教模型"拿 nextOffset 当下次 offset"）。改为 **poll 式自动增量**：

- `job_read(job_id, wait?, timeout_ms?)` —— 参数面只剩 3 个；`offset`/`max_bytes` 从模型面删除（max_bytes 降为内部两档：字节日志 64KB、内存文本 512KB）。
- **字节日志类**（shell/remote-shell/pty）：Registry 的 `JobRecord` 新增 `modelReadOffset` 模型侧游标——首次读尾部，之后每次读 `[游标, 新末尾)` 并推进；模型零参数拿到"上次没读的部分"。游标只挂模型路径，REST/前端显式 offset 契约不变（`markReported` 分叉是同类先例）。
- **内存文本类**（subagent/workflow/scheduler）：无稳定字节空间（快照每次整体重生成），按 512KB 上限**一次给全**——subagent 结果典型几 KB，不存在截断烦恼。
- **截断转读文件**：截断提示改为 run_command 同款文案（`The complete log is saved at: <path>. Read it with the read tool for full content.`）——日志本来落盘、read 工具可读任意绝对路径、完成通知已带路径，模型拿路径读文件即可，不在 job 层做翻页协议。
- 状态行简化为 `[status: <status>[, exit code: N]]`（与前端 STATUS_MARKER 正则匹配）；`offset/nextOffset/size` 字段从模型文本删除（前端 REST 仍带）。

### 13.2 改动

- `job-registry.service.ts`：`JobRecord.modelReadOffset` + 公开 `readIncremental(id, sessionId, readOptions?)`（按 kind 分派，内部复用 `read()` 的 markReported/兜底逻辑）；`read()` 原样保留。
- `jobs.plugin.ts`：job_read schema 瘦身、execute 改调 readIncremental、renderOutput 状态行/截断指引改写、description 与 STATIC prompt 删除 offset 翻页教学。
- 执行器与前端零改动：read 回调签名不变；ProcessLogPanel 的 REST 显式 offset 拉取不受游标影响。

### 13.3 测试

- jobs.plugin.spec：job_read 断言改新状态行（无 nextOffset）；新增「第二次调用只返回增量」「截断指引读文件」。
- job-registry.service.spec：新增 readIncremental 两条——字节日志类游标推进 + REST offset 隔离；subagent 类全量透传。
- 回归：后端 **248 suites / 3296 passed / 4 skipped，0 失败**。

---

## 14. 注册失败去回退执行记录（2026-10-24）

### 14.1 决策

job 配额（每会话 10 个 running）的目的与实现自相矛盾：配额满时静默回退旧通知路径，工作照常存在——**限制等于没有**，且回退出去的进程不受 job_stop/job_list 管辖，模型被告知"用 job_stop 释放配额"却查不到它。前后端强绑定（工具收敛后模型只有 job 一套接口）后，"Registry 不可用"在生产路径已不存在，回退失去存在理由。改为**快速失败**。

### 14.2 改动

- **subagent**（sub-agent.manager.ts）：
  - `registerSubAgentJob` 删除 try/catch 回退，注册抛错直接向上传播（executeSubAgentStream 的后台分支与前台超时转后台分支均为 async，错误自然到达 spawn 调用方 → subagent_spawn 工具结果）；
  - 删除 spawn 前的 `countByParentId >= 10` 独立预检（双重计数：一个数未冻结会话、一个数 running job，口径不一）——配额统一由 Registry 在后台注册时执行；
  - 信箱路径收窄为仅"Registry 未注入"（测试/嵌入场景 `@Optional()` 直接 new）；
  - spawn 工具文案：running 分支必有 jobId，不再有"等系统通知"分支。
- **shell**（process-manager.service.ts）：
  - `registerJob` 删除 `jobRegistrationFailed`/`pendingJobNotice` 整条回退链，注册抛错向上传播；execute 的两个转后台点（显式 background、60s 超时）在 registry 未注入时 kill 进程并抛明确错误；
  - `handleProcessEnd` 的旧信箱投递收窄为仅"无 jobId"（Registry 未注入场景）。
- 配额语义澄清：**只限后台**（前台是阻塞调用，模型自然串行，堆积风险在后台）。

### 14.3 测试

- sub-agent.manager.spec：「配额满回退信箱」改写为「配额满直接报错、无会话无通知」；「满 10 个子代理拒绝创建」改写为预检已删（配额统一由 Registry）；其余 lifecycle 用例不变。
- shell 侧 4 个 spec 补 stub registry（native/service/ui/completion），completion spec 从断言旧信箱通知改写为断言 job.settled 精确一次 + drain/poll 后 reported 置位。
- 回归：**248 suites / 3294 passed / 4 skipped**（唯一失败 `test/scheduler/missed-window.spec.ts` 为已知长跑时序抖动，单独跑 5/5 通过）。
