# GuaDa 后台通知与读取能力 —— 上下文存档 / 实施计划

- 日期：2026-10-23
- 仓库：`D:\AI\ai_chat`（分支 `local-dev`）
- 当前阶段：**通知 + 读取能力**
- 状态：**Phase A/B/C 已执行（2026-10-23）**；全量测试 3237 passed / 1 known scheduler flake；见第 10 节执行记录。
- 本文用途：上下文压缩后恢复进度，避免重新分析、避免重复已完成改造。

---

## 0. 压缩后如何继续

1. 先读第 1 节「已完成改造」，确认不要重做。
2. 再读第 2 节「DSH 对比结论」，这是后续决策依据。
3. 当前要执行的是第 3 节「当前阶段计划」；按 Phase A/B/C 做。
4. 第 4 节是已定决策；第 5 节是测试与验证命令；第 6 节是风险；第 7 节是后续路线。
5. 不要重新做 DSH 全量勘察；关键结论已收敛在第 2 节。

---

## 1. 已完成改造（不要重做）

### 1.1 句柄泄漏 / EMFILE 修复

- `backend-ts/src/modules/shell/process-manager.service.ts`
  - `releaseProcessHandles()`：进程结束/清理时销毁 legacy `childProcess.stdin`；native 关闭 stdin/job/process handles。
  - `handleProcessEnd` 与 `cleanupProcess` 都会释放。
  - `readAndTruncate` 的 `fd.close()` 放进 `finally`。
- `backend-ts/src/common/utils/transient-fs-retry.util.ts`
  - `EMFILE`/`ENFILE` 退避重试（4 次，100/200/400ms）。
  - 接入 `jsonl-backend.ts` 的 `appendEvent/appendEvents/createSession/writeManifest/writeSnapshot`。
- `backend-ts/src/modules/chat/agent-engine.service.ts`
  - ReAct 循环包进 `try/catch/finally`；落盘失败也执行 `finalizeTurn`、`persist`、`turn_end`；收口后重新抛出原始异常。
- `backend-ts/src/modules/chat/jsonl-session-context.ts`
  - `finalizeTurn` 的 `getContextStats()` 失败降级为空锚点，不阻塞 `turn/finish`。

### 1.2 Windows 原生 Job Object 路径

- 新增 `backend-ts/src/modules/shell/win32-job-process.ts`
  - Koffi bindings：`CreateJobObjectW`、`SetInformationJobObject`、`CreateProcessW`、`AssignProcessToJobObject`、`ResumeThread`、`TerminateJobObject`、`WaitForSingleObject`、`GetExitCodeProcess`、`TerminateProcess`、`CreatePipe`、`CreateFileW`、`WriteFile`。
  - `spawnSuspendedInJob()`：创建 kill-on-close Job → 创建 stdin pipe + 可继承 spool HANDLE → 构造 UTF-16 env block/命令行 → `CREATE_SUSPENDED` 创建 → Assign Job → Resume。
  - `writeToProcessStdinSync()`、`waitForProcessExit()`、`terminateJob()`、`terminateProcess()`、`closeNativeHandle()`。
  - `quoteArg` / `buildCommandLine` / `buildEnvironmentBlock` 纯函数。
- `process-manager.service.ts` 双路径：
  - `ProcessEntry` 判别联合：`kind: "native" | "node"`；native 存 `pid/processHandle/jobHandle/stdinWriteHandle/exitPollTimer`。
  - `createProcess` 优先 native；失败回退 legacy。
  - native 250ms 轮询退出；`kill` → `TerminateJobObject`；直接子进程退出后关闭 Job，`KILL_ON_JOB_CLOSE` 回收后代。
  - `writeToStdin` 保持同步；native 用 `WriteFile`。
- Shell 覆盖：
  - **Git Bash**：`bash -c -l <command>`。
  - **PowerShell**：`powershell -NoLogo -NoProfile -NonInteractive -Command <POWERSHELL_UTF8_PREAMBLE + command>`。
    - UTF-8 preamble：
      ```powershell
      [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
      $OutputEncoding = [System.Text.UTF8Encoding]::new($false);
      ```
    - 仅默认/UTF-8 编码时加；显式 GBK 等不加。
  - **cmd**：仍走 legacy（Node spawn + taskkill + MSYS sweep）。
- 开关：
  - `GUADA_WIN32_JOB_SPAWN` **默认开启**；`=0/false/off` 回退 legacy。
  - `canUseNativeSpawn()` 允许 `gitbash` / `powershell`；`cmd` 返回 false；sandbox enabled 返回 false。
- 打包：
  - `backend-ts/package.json` 增加 `koffi`。
  - `backend-ts/pnpm-workspace.yaml` 增加 `koffi: true`。
  - 根 `package.json` `asarUnpack` 增加 `koffi/**`、`@koromix/koffi-*/**`。
  - `node_modules_production` 已重建，Koffi 在 Electron 41.10.7 下可加载。
- 新增测试：
  - `backend-ts/src/modules/shell/win32-job-process.spec.ts`（7 tests）。
  - `backend-ts/src/modules/shell/process-manager-native.spec.ts`（6 tests：Git Bash 3、PowerShell 2、cmd gate 1）。

### 1.3 已完成验证（最近一次）

- `win32-job-process.spec.ts` + `process-manager-native.spec.ts`：**10/10 通过**（后加 PowerShell/cmd，native spec 单独 6/6）。
- `process-manager.service.spec.ts` 默认开启 native：**8 passed / 3 skipped**，包括之前失败的 pipeline 整树回收用例。
- `shell.plugin.spec.ts` + `agent-engine.spec.ts`：**46/46 通过**。
- `pnpm build`：通过。
- 全量测试曾跑过：3194 passed / 2 failed；失败是已知 pipeline 用例（默认开启 native 后已通过）和 `test/scheduler/missed-window.spec.ts` 时序抖动（单独跑通过）。
- 安装版 `C:\Program Files\GuaDa` 未重新打包；需要重新构建/重启才能生效。

### 1.4 重要行为变化

- 直接子进程退出后关闭 Job，会杀掉仍在 Job 里的 `&`/pipeline 后代——这是有意行为（无隐藏子进程）。
- 需要长期后台存活，应让直接进程常驻；后续可加 `keepDescendants` 选项。
- PowerShell 原生路径已开；cmd 仍 legacy。

---

## 2. DSH 对比结论（后续决策依据）

### 2.1 DSH 的分层

| 层 | 作用 |
|---|---|
| 一次性 shell（`bash-local` / `pwsh-local`） | 每条命令一个新进程；前台 `run()`，后台 `start()` |
| 持久 shell（`tool-bash-persistent` / `tool-pwsh-persistent`） | 每个 agent 一个 PTY；只有 `command`；无 `run_in_background` |
| Terminal 工具 | open/send/read/signal/close/list；`terminal_send(run_in_background)` → `pty-send` job |
| `ctx.jobs` | 通用后台任务注册表：bash/pwsh/pty-send/subagent 共用 |
| `subprocess-local` | OS 进程与输出管道 |

**一个宿主只挂一套 shell**：Windows = PowerShell，POSIX = bash。没有 cmd 执行器。

### 2.2 DSH 后台进程

- `run_in_background: true` → `ctx.jobs.start({kind,label,owner,run,cancel,done,readOutput})` → 返回 `{kind:'background', jobId}`（**不是 PID**）。
- 注册表在 `jobs-local` 内存：`Map<JobId, TrackedTask>`；状态 `running|stopping|completed|killed|failed`；无队列；每 owner 最多 10 个并发；first-wins settlement；owner 销毁时 cancel + await。
- 后台进程无 executor timeout；`job_output(wait)` 只有观察超时。
- 后台进程由 `subprocess-local` 持有，executor 重载不杀；composition teardown 整树终止；host exit 同步强杀。
- 持久 shell **不接 jobs**：`sleep 10 &` / `Start-Job` 不返回 jobId、不通知、输出只在 PTY scrollback。

### 2.3 DSH 读取

- 模型侧：`job_output(job_id, wait?, timeout_ms?)`
  - 默认非阻塞；
  - `wait: true` 最多 30s（默认）/10min（上限），超时返回 `[status: running]`，不杀 job；
  - stream job 返回自上次读取的增量（单消费游标）；
  - final-output job 结算后幂等返回；
  - 每条响应末尾 `[status: ...]`；
  - 空增量 `(no new output)`。
- 配套：`job_list()`、`job_kill(job_id, reason?)`。
- 系统提示：完成会推送，不要 busy-poll。

### 2.4 DSH 通知

```text
producer done
  → LocalJobRegistry.settle()
  → onJobDone listeners
  → tool-jobs createUserMessage({
       text: "background job <id> (<kind>: <label>) finished [status: ...]. Read its output with job_output.",
       source: { kind:'plugin', plugin:'tool-jobs', form:'notice', summary }
     })
  → owner.inject(message) 或 owner.followup(message)
  → Agent inbox (next-step / next-turn)
  → 下一次 pre-step claim 成 user/message
```

- **user-role notice，不是 system message**；`source.form='notice'` 只给 UI/策略。
- busy → `inject` 到 next-step，不唤醒，延长当前 turn；
- idle → `followup` 唤醒新 turn；
- wake 预算默认 3 次，用完退化为 inject，用户真实输入才重置；
- `reported` 抑制：kill/read/wait/teardown 都标记 reported；
- 无 debounce/合并；合并只发生在 next-step claim 边界；
- 取消中的 turn：inject 不唤醒（不重开用户刚停止的 turn）；
- 已知竞态：settlement 在 turn loop 最后检查与 driver 提交 idle 之间，误判 busy，通知等下一次用户输入。
- Stop **不杀后台 job**；`job_kill` 才取消；owner dispose/composition teardown 才 kill。
- UI：`onJobsChanged` → `{type:'jobs', sessionId, jobs}` 快照流；只读，不读输出。

### 2.5 DSH 输出通道

- 主通道是 **pipe**；
- `OutputCollector` 内存尾部（pwsh-local 默认 64KB），超过才创建 **spill file**（默认上限 64MB）；
- spill 文件私有 0700 目录、0600、`wx` 随机名；超上限即删；
- 小输出不落盘；持久 PTY 用内存 scrollback（4MB / 10k 行）。

### 2.6 GuaDa 现状

- 工具：`run_command(command, encoding?, background?, workspace?)`；`process(kill|poll|write, processId, params?)`。
- 前台默认，60s 自动转后台；显式 `background: true` 立即返回 processId。
- `ProcessManagerService` 进程表；native/legacy 双路径；spool 文件 + cleaned log；`readOffset` + `OutputTailer`。
- `process poll`：agent 侧最小 30s；完成即 `cleanupProcess` 删除 entry；输出 10KB/10K 字符/80 行 head-tail 截断。
- 完成通知两条路径：
  1. `process_monitor` → `ChatRunner.enqueueMessage` → idle 立即新 turn；busy 排队；
  2. `turn.stopping` 正常收尾时 `drainCompleted` 直接注入 hidden `<system-reminder>` 到当前 turn；entry 删除后队列通知 `isValid` 失败被丢弃。
- `user_cancel/error/timeout/rate_limited` 后 `processQueue` 不 drain，通知可能一直挂着。
- 没有 `list`/`read`/`wait`/`close` action；显式 background 不返回 logPath。
- UI：`process_changed` SSE → REST 重拉列表；`ProcessLogPanel` 每 2s 轮询日志。

### 2.7 关键差异

| 维度 | DSH | GuaDa |
|---|---|---|
| 后台启动 | jobId | processId |
| 状态归属 | 通用 jobs registry，owner-bound | shell 专用进程表 |
| 输出读取 | `job_output` 非阻塞/可 wait；final 幂等 | `process poll` 最小 30s；完成即删 entry |
| 完成通知 | 短 notice（不含输出），模型再 `job_output` | `<system_reminder>` 直接带输出 |
| busy | inject 到 next-step | 队列 + turn.stopping 注入 |
| idle | followup 唤醒，wake 预算 3 | 队列立即新 turn，无预算 |
| 去重 | `reported` + 单消费游标 | `isValid` + entry 删除；双路径 |
| Stop | 不杀 job | kill 显式；子 agent 流结束杀本地 |
| 重启 | job registry 丢失 | 进程表/队列丢失 |
| UI | jobs 快照推送，只读 | process_changed + REST 重拉 + 日志轮询 |
| 持久 shell | 有 PTY | 独立 terminal 服务，run_command 不接 |

### 2.8 术语

- **spool**：主输出捕获文件。子进程 stdout/stderr 直接写；父进程按偏移读并转写。GuaDa 每条命令都有。
- **spill**：溢出文件。内存主缓冲放不下时才落盘；DSH `OutputCollector` 的兜底，不是主通道。
- 记忆：spool = 收集箱；spill = 溢写盘。

---

## 3. 当前阶段计划：通知 + 读取能力

> 只做通知链路和模型侧读取；不抽通用 Job Registry，不改持久 Shell，不动远程推送。

### Phase A：通知链路引入 `reported`，收敛双路径

#### `process-manager.service.ts`

- `ProcessEntryBase` 增加：
  - `reported?: boolean` —— 最终输出已被 poll/read/drain 消费，抑制重复通知；
  - `noticeQueued?: boolean` —— 完成通知已入队（诊断）；
  - `completedCleanupTimer?: NodeJS.Timeout` —— 已完成 entry TTL（10 分钟，unref）。
- 新增 `COMPLETED_ENTRY_TTL_MS = 10 * 60 * 1000`。
  - `handleProcessEnd` 设置 TTL；
  - `cleanupProcess` 清除。
- `buildPollResult`：
  - 当 `entry.status !== "running"` 时，在 `cleanupProcess` 前设置 `entry.reported = true`。
- `drainCompleted`：
  - `buildPollResult` 前设置 `entry.reported = true`（turn.stopping 已交付输出，队列通知应失效）。
- `readProcessLog()`：
  - 读到终态时设置 `entry.reported = true`；
  - 读 running 进程不抑制完成通知。
- `kill()`：设置 `reported = true`（kill 不投递通知）。
- `handleProcessEnd`：
  - 有 poll waiter → 只 notify，不 enqueue；
  - `entry.reported` → 不 enqueue，只保留 TTL 清理；
  - 否则 `noticeQueued = true`，enqueue 通知。
- `enqueueSystemMessageFromEntry`：
  - 入口再检查 `entry.reported`；
  - `isValid: () => !entry.reported && this.processes.has(entry.id)`；
  - **await** `chatRunnerService.enqueueMessage(...)` 并 catch（修掉当前未 await 导致 rejection 逃逸）。

#### `chat-runner.service.ts`

- 新增 per-session 队列重试状态：
  - `queueRetryTimers: Map<string, NodeJS.Timeout>`；
  - `queueRetryAttempts: Map<string, number>`；
  - `scheduleQueueRetry(sessionId, reason)`、`clearQueueRetry(sessionId)`。
- `runAgentEngine.finally`：
  - 正常收尾（`stop/undefined/plan_rejected`）→ 立即 `processQueue`（现有行为）；
  - `error/timeout/rate_limited` → `scheduleQueueRetry`（最多 3 次，1s/3s/9s 退避）；
  - `user_cancel` → **不自动重开 turn**（对齐 DSH）；通知留在队列，下一次用户主动回合正常结束时消费；日志记录 pending 数量。
- `processQueue` 遇到 `SESSION_BUSY`/`STREAM_START_FAILED`：
  - 批次放回队头后，再 `scheduleQueueRetry`。
- `startStream` 成功开启新 turn 时 `clearQueueRetry(sessionId)`，重置预算。
- `turn.stopping` 保留（busy 时当前 turn 内直接交付输出）；通过 `drainCompleted` 设置 `reported`，队列重复通知自动失效。

#### 通知文本

- 保持 `<system_reminder>` + `source.kind = "process_monitor"`，不改前端渲染。
- 保留 `Log file: <path>`；可追加 `Use process read <id> to read the log later.`（可选）。

### Phase B：模型侧读取能力

#### `process-manager.service.ts`

- `ProcessListEntry` 增加：
  - `exitCode: number | null`；
  - `logFilePath: string`。
  - `listBySession` / `listRunningBySession` / `get` 同步填充。
- 新增 `readProcessLog(processId, sessionId, { maxBytes?, offset? })`：
  - 返回 `processId/command/status/exitCode/size/offset/nextOffset/truncated/content/logFilePath`；
  - `maxBytes` 默认 64KB，clamp 1KB..512KB；
  - 无 `offset` → 读 cleaned log 尾部；有 `offset` → 从该绝对字节偏移读 `maxBytes`；
  - `fs.open` + `read` + `finally close`；两端 trim UTF-8 边界；
  - **不推进 `entry.readOffset`、不删除 entry**；
  - entry 已清理 → 回退 `resolveLogFileOnDisk`，status `"ended"`；
  - 读到终态设置 `reported = true`；读 running 不设置。
- `execute()` background 分支返回 `logFilePath`（显式 background 和 timeout background 都返回）。

#### `shell.plugin.ts` 的 `process` 工具

- schema：
  - `action: "kill" | "poll" | "write" | "list" | "read"`；
  - `processId` 改 optional；`kill/poll/write/read` 校验必填，`list` 忽略。
- 新增 `list`：
  - `processManager.listBySession(sessionId)`；
  - 每行 `id [status, exit code N, background] command (log: path)`；
  - 无进程 `(no processes)`；
  - 远程进程暂不列出（本地-only），描述里注明。
- 新增 `read`：
  - `readProcessLog`；
  - content + 截断提示 + `[status: ..., offset: ..., nextOffset: ..., size: ...]` + log path；
  - 对 `r:` 远程 ID 抛明确错误：用 `poll` 或 `read` 工具读远端日志路径。
- `poll`：
  - `params.timeout === 0` 允许零等待（非阻塞快照）；
  - 正数最小 1s（去掉 30s 下限）；
  - 未传 timeout 保持 30s 默认；
  - 更新描述/prompt：poll 等待并消费输出；read 非破坏性；list 查看会话进程。
- `write` 修正 “Written N agents” → “Written N bytes”。
- `run_command` background 文本/meta 增加 `Log file: <path>`。

### Phase C：测试

- `process-manager`：
  - `readProcessLog` 两次尾部读取一致、entry 不删除；
  - `readProcessLog({offset})` 返回增量与 `nextOffset`；
  - `listBySession` 包含 exitCode/logFilePath；
  - 完成前 `read` 不抑制通知；完成后 `read` 设置 reported，队列通知失效；
  - `poll` 终态设置 reported；
  - background `execute` 返回 logFilePath；
  - TTL 清理（fake timers）。
- `chat-runner`：
  - idle 通知立即开 turn；
  - busy 正常收尾 drain；
  - `user_cancel` 不自动重开，下一次正常 turn 消费；
  - `error/timeout` 有界重试（fake timers，最多 3 次）；
  - `isValid` 在 read/poll 后 false。
- `shell.plugin`：
  - `process list` / `process read` 文本；
  - `poll timeout=0` 立即返回；
  - background 结果包含日志路径。
- 更新现有 `process` 工具 schema/枚举相关断言。

---

## 4. 已定决策 / 需要坚持的语义

1. `reported` 抑制策略：
   - read **running** 不抑制完成通知；
   - read **终态** 抑制；
   - poll 终态、drainCompleted、kill 抑制。
2. `user_cancel` 不自动重开 turn（对齐 DSH）；通知保留，等下一次用户主动回合。
3. `error/timeout/rate_limited` 有界自动重试（3 次，1/3/9s）。
4. `read` 默认读尾部；要增量就传上一次的 `nextOffset`。
5. `list`/`read` 本地-only；远程 `read` 明确报错，远程继续用 `poll` 或 `read` 工具读远端日志。
6. 已完成 entry TTL 10 分钟；UI 列表只查 running，不受影响。
7. 不改前端渲染；`process_monitor` 的 UI 样式保持。

---

## 5. 测试 / 验证命令

```bash
cd D:/AI/ai_chat/backend-ts
pnpm build
pnpm test src/modules/shell/process-manager.service.spec.ts --runInBand
pnpm test src/modules/shell/win32-job-process.spec.ts src/modules/shell/process-manager-native.spec.ts --runInBand
pnpm test test/plugins/shell.plugin.spec.ts test/agent-engine/agent-engine.spec.ts --runInBand
```

全量：

```bash
cd D:/AI/ai_chat/backend-ts
pnpm test --runInBand
```

已知：`test/scheduler/missed-window.spec.ts` 在全量长跑下偶发时序失败，单独跑通过；不是本次改动引入。

---

## 6. 风险

1. `reported` 抑制过头 → 模型收不到完成通知。必须坚持“read running 不抑制”。
2. `user_cancel` 不自动重开 → 通知可能等到下一次用户输入；需要日志/文档说明。
3. 已完成 entry TTL 改变“poll 后立即消失”的行为；UI 只查 running，不受影响。
4. `read` 默认读尾部而非增量，工具描述必须讲清楚。
5. 队列重试不能无限循环；3 次上限，用户回合开始时重置。
6. 远程 list/read 未做，避免 scope 膨胀。

---

## 7. 后续路线（本阶段之后）

> 详细开发计划已拆到 `docs/guada-job-registry-roadmap.md`（M1-M5，含排期、文件改动、验收与风险）。

1. **通用 Job Registry**：shell/subagent/scheduler/remote 统一 jobId + `job_output/job_list/job_kill`；owner-bound 生命周期；DSH 式 notice + read。
2. **持久 Shell / PTY**：复用现有 terminal 服务，给 `run_command` 增加持久会话模式；或引入 `bash`/`pwsh` persistent 工具。
3. **远程推送 + 收尾**：remote workspace 完成推送；shutdown reaping；keep-awake 感知后台进程。
4. **可选**：`keepDescendants` 选项；UI jobs 快照流替代 REST 重拉/日志轮询。

---

## 8. 关键文件索引

### 已完成

- `backend-ts/src/modules/shell/win32-job-process.ts`
- `backend-ts/src/modules/shell/process-manager.service.ts`
- `backend-ts/src/modules/shell/process-manager-native.spec.ts`
- `backend-ts/src/modules/shell/win32-job-process.spec.ts`
- `backend-ts/src/common/utils/transient-fs-retry.util.ts`
- `backend-ts/src/common/persistence/jsonl-backend.ts`
- `backend-ts/src/modules/chat/agent-engine.service.ts`
- `backend-ts/src/modules/chat/jsonl-session-context.ts`
- `backend-ts/package.json`（koffi）
- `backend-ts/pnpm-workspace.yaml`（allowBuilds koffi）
- 根 `package.json`（asarUnpack koffi）

### 本阶段要改

- `backend-ts/src/modules/shell/process-manager.service.ts`
  - `ProcessEntry` / `reported` / TTL
  - `readProcessLog`
  - `ProcessListEntry`
  - `handleProcessEnd` / `enqueueSystemMessageFromEntry`
  - `buildPollResult` / `drainCompleted`
  - `execute` background `logFilePath`
- `backend-ts/src/modules/shell/shell.plugin.ts`
  - `process` schema/actions（list/read/zero-wait poll）
  - background 文本/meta logPath
  - prompt 文案
- `backend-ts/src/modules/chat/chat-runner.service.ts`
  - queue retry / clear retry
  - `runAgentEngine.finally` 分支
- 测试：
  - `backend-ts/src/modules/shell/process-manager.service.spec.ts`
  - `backend-ts/src/modules/shell/process-manager-native.spec.ts`
  - `backend-ts/test/plugins/shell.plugin.spec.ts`
  - 新增/扩展 chat-runner 通知用例（若已有测试文件则加）

### DSH 参考（只读，不修改）

- `D:/AI/work/public/deepseek-harness/packages/jobs/tool-jobs/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/jobs/jobs-local/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/shell/tool-bash/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/shell/tool-pwsh/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/shell/tool-bash-persistent/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/shell/tool-pwsh-persistent/src/index.ts`
- `D:/AI/work/public/deepseek-harness/packages/terminal/terminal-bash/src/session.ts`
- `D:/AI/work/public/deepseek-harness/packages/subprocess/subprocess-local/src/spawn.ts`
- `D:/AI/work/public/deepseek-harness/packages/api/session-controller/src/control.ts`

---

## 9. 当前状态 / 下一步

- 当前分支：`local-dev`。
- 已完成改造未提交（工作区有 modified/untracked）。
- 当前阶段计划已出；用户要求先存档（本文），存档后暂停。
- 压缩后下一步：
  1. 读本文；
  2. 确认第 3 节计划；
  3. 等用户明确说「开始执行」后按 Phase A → B → C 实施；
  4. 每阶段跑第 5 节对应测试。
- 如果用户改变方向，优先看第 7 节路线，不要推倒第 1 节已完成改造。

---

## 10. 执行记录（2026-10-23）

### Phase A：通知链路

- `ProcessEntryBase` 增加 `reported` / `noticeQueued` / `completedCleanupTimer`；`COMPLETED_ENTRY_TTL_MS = 10 分钟`。
- `handleProcessEnd`：
  - 设置 TTL；
  - 有 poll waiter → 只 notify；
  - `reported` → 不 enqueue；
  - 否则 `noticeQueued=true` 并 enqueue。
- `enqueueSystemMessageFromEntry`：入口检查 `reported`；`isValid = !reported && processes.has(id)`；**await** enqueue；文本增加 `Use process read <id>`。
- `buildPollResult`：终态设置 `reported` 后 cleanup。
- `drainCompleted`：buildPollResult 前设置 `reported`；已 `reported` 的 entry 直接跳过，避免 turn.stopping 重复注入。
- `kill`：设置 `reported`。
- `cleanupProcess`：清除 TTL timer。
- TTL 清理与通知 `isValid` 使用**对象身份**校验，防止 PID 复用后误删新 entry / 旧通知误命中新 entry。
- `ChatRunnerService`：
  - `queueRetryTimers` / `queueRetryAttempts`；
  - 正常收尾立即 `processQueue`；
  - `error/timeout/rate_limited` 有界重试（1s/3s/9s，最多 3 次）；
  - `user_cancel` 不自动重开，通知保留到下一次用户输入；
  - `SESSION_BUSY` 重新入队 + 重试；
  - 新 turn 开始/队列清空时重置重试预算；
  - `finalReason` 统一跟踪成功/abort/异常。

### Phase B：读取能力

- `ProcessListEntry` 增加 `exitCode` / `logFilePath`；`listBySession` / `listRunningBySession` / `get` 填充。
- 新增 `readProcessLog(processId, sessionId, { maxBytes?, offset? })`：
  - 非破坏性、不推进 readOffset、不删除 entry；
  - 默认读尾部；有 offset 读区间；两端 trim UTF-8；
  - entry 已清理时回退磁盘，status `"ended"`；
  - 终态读取设置 `reported`；running 不设置。
- `execute()` background 两个分支都返回 `logFilePath`。
- `process` 工具：
  - `action` 增加 `list` / `read`；`processId` optional；
  - `list` 输出 id/status/exitCode/background/log path；
  - `read` 支持 offset/maxBytes，渲染 nextOffset；远程 read 明确报 local-only；
  - `poll`：`timeout=0` 非阻塞；正数最小 1s；不传默认 30s；
  - background 文案/meta 增加 log path；
  - write 文案 “agents” → “bytes”；
  - prompt 增加 list/read/zero-wait 说明。

### Phase C：测试

- `process-manager-native.spec.ts`：新增非破坏性 read / list 字段 / background logPath / TTL timer 用例。
- `test/chat/chat-runner.service.spec.ts`：新增 error 重试、user_cancel 不重开、重试上限、timer 创建/清理用例。
- `test/plugins/shell.plugin.spec.ts`：新增 process list/read/remote error/zero-wait poll 用例。
- 验证：
  - `pnpm build` 通过。
  - native spec：7/7；chat-runner：8/8；shell plugin：29/29。
  - `process-manager.service.spec.ts`：8 passed / 3 skipped。
  - 全量：3237 passed / 1 failed；唯一失败是 `test/scheduler/missed-window.spec.ts` 的时序断言（单独跑通过，属于已知长跑抖动）。

### 备注

- `reported` 语义：poll 终态 / drain / kill / read 终态设置；read running 不设置。
- 已完成 entry TTL 10 分钟；cleanup 清除 timer。
- 远程 list/read 未做，避免 scope 膨胀。
