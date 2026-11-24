# GuaDa 后台通知与读取能力 —— 上下文存档 / 实施计划

- 日期：2026-10-23
- 仓库：`D:\AI\ai_chat`（分支 `local-dev`）
- 当前阶段：**通知 + 读取能力**
- 状态：**Phase A/B/C 已执行（2026-10-23）**；全量测试 3237 passed / 1 known scheduler flake；见第 9 节执行记录。
- 本文用途：上下文压缩后恢复进度，避免重新分析、避免重复已完成改造。

---

## 0. 压缩后如何继续

1. 先读第 1 节「已完成改造」，确认不要重做。
2. 当前要执行的是第 2 节「当前阶段计划」；按 Phase A/B/C 做。
3. 第 3 节是已定决策；第 4 节是测试与验证命令；第 5 节是风险；第 6 节是后续路线。
4. 前期调研结论已并入本文，无需重新做全量勘察。

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

## 2. 当前阶段计划：通知 + 读取能力

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
  - `user_cancel` → **不自动重开 turn**；通知留在队列，下一次用户主动回合正常结束时消费；日志记录 pending 数量。
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

## 3. 已定决策 / 需要坚持的语义

1. `reported` 抑制策略：
   - read **running** 不抑制完成通知；
   - read **终态** 抑制；
   - poll 终态、drainCompleted、kill 抑制。
2. `user_cancel` 不自动重开 turn；通知保留，等下一次用户主动回合。
3. `error/timeout/rate_limited` 有界自动重试（3 次，1/3/9s）。
4. `read` 默认读尾部；要增量就传上一次的 `nextOffset`。
5. `list`/`read` 本地-only；远程 `read` 明确报错，远程继续用 `poll` 或 `read` 工具读远端日志。
6. 已完成 entry TTL 10 分钟；UI 列表只查 running，不受影响。
7. 不改前端渲染；`process_monitor` 的 UI 样式保持。

---

## 4. 测试 / 验证命令

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

## 5. 风险

1. `reported` 抑制过头 → 模型收不到完成通知。必须坚持“read running 不抑制”。
2. `user_cancel` 不自动重开 → 通知可能等到下一次用户输入；需要日志/文档说明。
3. 已完成 entry TTL 改变“poll 后立即消失”的行为；UI 只查 running，不受影响。
4. `read` 默认读尾部而非增量，工具描述必须讲清楚。
5. 队列重试不能无限循环；3 次上限，用户回合开始时重置。
6. 远程 list/read 未做，避免 scope 膨胀。

---

## 6. 后续路线（本阶段之后）

> 详细开发计划已拆到 `docs/guada-job-registry-roadmap.md`（M1-M5，含排期、文件改动、验收与风险）。

1. **通用 Job Registry**：shell/subagent/scheduler/remote 统一 jobId + `job_output/job_list/job_kill`；owner-bound 生命周期；notice + read 形态。
2. **持久 Shell / PTY**：复用现有 terminal 服务，给 `run_command` 增加持久会话模式；或引入 `bash`/`pwsh` persistent 工具。
3. **远程推送 + 收尾**：remote workspace 完成推送；shutdown reaping；keep-awake 感知后台进程。
4. **可选**：`keepDescendants` 选项；UI jobs 快照流替代 REST 重拉/日志轮询。

---

## 7. 关键文件索引

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

---

## 8. 当前状态 / 下一步

- 当前分支：`local-dev`。
- 已完成改造未提交（工作区有 modified/untracked）。
- 当前阶段计划已出；用户要求先存档（本文），存档后暂停。
- 压缩后下一步：
  1. 读本文；
  2. 确认第 2 节计划；
  3. 等用户明确说「开始执行」后按 Phase A → B → C 实施；
  4. 每阶段跑第 4 节对应测试。
- 如果用户改变方向，优先看第 6 节路线，不要推倒第 1 节已完成改造。

---

## 9. 执行记录（2026-10-23）

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
