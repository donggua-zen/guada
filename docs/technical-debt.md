# 技术债清单

记录已识别、但尚未立项或明确暂缓的问题。每条包含现状、风险、改造方向与关联文件。

约定：

- **待办**：已确认需要处理，等待排期立项。
- **暂缓项**：已确认存在，但当前明确不处理（保留记录以免遗忘）。

---

## 待办

### 1. 外部插件无沙箱隔离

**现状**

外部插件经 `require()` 直接加载进后端主进程，与后端共享同一 Node 运行时和权限：

- 入口解析与加载：[`external-plugin-loader.ts`](../backend-ts/src/modules/plugins/external/external-plugin-loader.ts) —— `requireWithFallback()` 临时 patch `Module._resolveFilename` 把 `backend-ts/node_modules` 作为回退搜索路径，require 完成后恢复；dev 源优先加载 `.ts`，user 源仅加载 `.js`。
- 实例化时**不经过 NestJS DI**（`new PluginClass()`），插件能力只能通过 `onLoad(api)` 的 `PluginApi` 获得，但代码本身不受任何限制。
- 安装/更新/卸载：[`plugin-source.ts`](../backend-ts/src/modules/plugins/external/plugin-source.ts) —— 支持 `github:` / `gitee:` / `git:` / `local:` 分发源，git 源走 `git clone`。

**风险**

插件代码拥有与后端进程完全等同的权限，可直接：

- 读写任意文件（含 `.env`、密钥、用户数据）
- 发起任意网络请求（数据外泄）
- 调用 `child_process` 执行任意命令
- 篡改进程内全局状态（包括 `PluginRegistry` 与其它插件的注册数据）

**现有防护（不足以构成隔离）**

- manifest.json 必填字段校验（id/name/version/description）
- 内建插件 id 优先，外部同名插件跳过
- 路径穿越防护（icon / assets / UI component 端点）
- 管理接口（安装/卸载/更新/RPC/数据写入）走 `AuthGuard` 鉴权，查询类为 `@Public`

这些是**输入校验与访问控制**，不是运行时隔离——插件一旦加载即完全可信。

**改造方向（择一或组合）**

1. **进程隔离**：插件在独立子进程中运行，通过 IPC 转发 `PluginApi` 调用与工具执行。隔离最彻底，但需处理序列化、生命周期与工具流式返回。
2. **worker_threads + 权限清单**：在 worker 中加载插件，manifest 声明所需能力（fs / net / child_process），宿主按清单构造受限的 `PluginApi` 与模块代理。隔离强度中等，实现成本较低。
3. **静态扫描 + 安装期准入**：安装时扫描插件源码中的高危 API（`child_process`、`fs`、`net`、`eval`、`Function`），命中则拒绝或要求管理员确认。只能拦低努力攻击者，不能替代运行时隔离。

配套还需要：插件的**权限声明 UI**（安装时向管理员展示申请的能力）与**运行时审计日志**。

**关联文件**

- `backend-ts/src/modules/plugins/external/external-plugin-loader.ts`
- `backend-ts/src/modules/plugins/external/plugin-source.ts`
- `backend-ts/src/modules/plugins/plugins.controller.ts`（安装/卸载/更新/RPC 端点）
- `backend-ts/src/modules/plugins/api/plugin-api.ts`（需按能力清单裁剪的接口面）

---

### 2. 执行层测试覆盖缺口（2026-10-15 部分补齐）

**现状**

backend-ts 现有 185 个 spec / 2770 个用例，但分布极不均衡：chat / plugins / knowledge-base / llm-core 占了绝大多数；**执行层**（子代理编排、终端 PTY、后端↔Electron 桥接）长期为零覆盖。

2026-10-15 已补齐 7 个模块，新增 10 个 spec、约 230 个用例：

| 新增测试 | 覆盖内容 |
|---|---|
| `test/sub-agent/` | SubAgentManager 全状态机（准入上限 / 结算 / 冻结 / 信箱投递 / 等待者 / 关闭 / 配额）+ `mapFinishReason` |
| `test/terminal/` | TerminalService（PTY 注册表、orphan 回收、UI 上限、归属校验）、pty-helper（asar 路径改写 + darwin spawn-helper 守卫）、TerminalGateway（WS 鉴权闸门，真实 socket 集成） |
| `test/bridge/` | BridgeClient（鉴权握手、请求/响应配对、消息分帧、超时与 abort、重连、孤儿自救、销毁后不再重连） |
| `test/commands/` | CommandProviderRegistry（id/name 校验、异常吞并、解析器分发）+ SnipCommandProvider |
| `test/settings/`、`test/users/`、`test/health/` | 设置校验钩子（模型引用 / 知识库根 / 附件子目录）、账户密码规则与返回体脱敏、健康检查字段形状 |

为可测性对生产代码做了 4 处**零行为变更**改动：导出 `mapFinishReason`（sub-agent）、`toUnpackedPath`（pty-helper）、`stripDaHandshake`（terminal.gateway），以及把 `TerminalService.loadNodePty` 由 `private` 提为 `protected`（供测试替换 PTY 工厂，避免单测触发原生模块）。另修复一处真实缺陷：`BridgeClient.scheduleReconnect` 缺 `shuttingDown` 保护（详见下节「已修复」）。

补齐后的行覆盖率（`jest --coverage`）：`command-provider-registry.service.ts` / `settings.service.ts` / `health.controller.ts` 100%，`bridge-client.ts` 97.0%，`user.service.ts` 97.1%，`pty-helper.ts` 96.7%，`terminal.gateway.ts` 94.6%，`sub-agent.manager.ts` 91.6%，`terminal.service.ts` 91.0%。

同模块内**仍为 0 覆盖**的部分：4 个薄控制器（`commands.controller.ts` 39 行、`settings.controller.ts` 100 行、`users.controller.ts` 69 行、`terminal.controller.ts` 25 行）与 `sub-agent.plugin.ts`（411 行，子代理的工具面插件）。控制器多为参数透传，优先级低；`sub-agent.plugin.ts` 值得补。

**仍缺口（建议后续立项）**

- **`electron/` 全层**：仅 `accessibility-snapshot` 有 `node:test` 脚本；`electron/bridge-server.ts`（token 鉴权、消息编解码）与 `electron/browser-automation-service.ts`（handler 分派）无测试。这两者是「后端 ↔ Electron」协议的另一半，桥接改协议时没有回归网。
- **前端组件层**：frontend 有 35 个 vitest 文件，但只覆盖 store / composables / utils / services；`ChatInput`、`ChatPanel`、`GitChangesPanel`、`GlobalSidebar` 等超大组件无组件测试（未安装 `@vue/test-utils` + `jsdom`，`vite.config.ts` 的 test environment 为 `node`）。
- **后端薄覆盖模块**：`agents`（1 个用例）、`git`（2 个）、`scheduler`（2 个）。

**风险**

执行层改动此前只能靠手工冒烟。2026-10-15 修复的 workflow 子代理配额泄漏（commit `c11e8155`：workflow 子代理永不写 `closedAt`，持续占用每父会话 10 个名额，最终卡死普通 `subagent_spawn`）就是该区域长期无测试才潜伏至今的典型例子。

**写测试时发现的问题**

已修复（2026-10-15）：

1. **`BridgeClient` 销毁后仍会重连**：`onModuleDestroy()` 会 `destroy()` socket，而该动作触发的 `close` 事件又会走一遍 `scheduleReconnect()`，形成永久重连循环——组件退不掉、进程不会退出（`pnpm test` 需要 `--forceExit` 才能结束），也令 `app.close()` 期间仍在反复创建新 socket，与 `onModuleDestroy` 注释里写明的本意相反。已在 `scheduleReconnect` 开头补 `if (this.shuttingDown) return;`，并加测试钉住「销毁后服务端不再收到新连接」。见 `backend-ts/src/modules/bridge/bridge-client.ts`。

未修（本轮只记录）：

2. **`waitForComplete()` 无 state 时不短路**：父会话从未创建过子代理时，`await waitForComplete()` 不会立即返回空数组，而是一路等到超时（默认 120 秒）。只有 `state` 存在且 `running` 为空才走「立即返回」分支。见 `backend-ts/src/modules/sub-agent/sub-agent.manager.ts` 的 `waitForComplete`；测试已按真实行为钉住（`test/sub-agent/sub-agent.manager.spec.ts`）。
3. **`TerminalGateway.findOrphan()` 是死代码**：已定义但无任何调用方，`handleConnection` 用内联的 `terminalService.get()` + `disconnectedAt` 判断代替。见 `backend-ts/src/modules/terminal/terminal.gateway.ts:175`。
4. **jest 全量运行有一处「worker 未优雅退出」告警**：在 `--forceExit` 之外即存在，非本轮新增，疑似某处未 `unref()` 的定时器，尚未定位。

**另：同名 spec 双份，建议合并**

`backend-ts/src/modules/sub-agent/sub-agent.manager.spec.ts`（真实 SQLite store，覆盖 workflow 冻结与配额释放）与 `backend-ts/test/sub-agent/sub-agent.manager.spec.ts`（fake 驱动，覆盖全状态机）测的是同一个类，存在少量重叠。建议后续合并为单文件，避免两处断言各自漂移。

**关联文件**

- `backend-ts/test/sub-agent/`、`test/terminal/`、`test/bridge/`、`test/commands/`、`test/settings/`、`test/users/`、`test/health/`
- `electron/bridge-server.ts`、`electron/browser-automation-service.ts`
- `frontend/src/components/`（ChatInput / ChatPanel / GitChangesPanel / GlobalSidebar）

---

## 暂缓项

已确认存在、当前明确不处理的问题。

| 问题 | 现状 | 关联文件 |
|---|---|---|
| `dangerLevel` 字段无消费方 | 全链路只声明与存储，执行器、AgentEngine、前端均不读取，不做拦截或 UI 分级 | `types/plugin.types.ts`、`toolkit/toolkit.ts`、`api/plugin-api.ts`、`builtins/file.plugin.ts` 等赋值处 |
| `params` 字段无消费方 | 角色插件条目的预留扩展位，解析器只读 `toolkits_filter/deny/allow`，前端读写也不含它 | `types/plugin.types.ts`（`RolePluginEntryConfig`）、`plugin.manager.ts`（`applyRoleLayer`） |
| 跨插件工具重名无仲裁 | 同名工具都会进入发送给 LLM 的 tools 数组（供应商会因此报 400），执行时按注册顺序命中第一个，后注册者不可达。**MCP 侧已处理**：添加服务器时检测重名并报错，注册期对运行期引入的冲突确定性保留创建更早的那个、跳过另一个并记 error；其余插件仍无仲裁 | `tool-executor.service.ts`（`findTool` / `toFlatToolDefs`）、`registry/plugin-registry.ts`、`mcp-servers/mcp-tool-name.ts` |

### 暂缓项 · 插件系统重构期间发现（2026-09-15）

本轮改插件门控与 MCP 时顺带发现、未修的项。都经过代码核实。

| 问题 | 现状 | 关联文件 |
|---|---|---|
| `registerPlugin` 的 catch 兜底与其它保护不一致 | 只认 `category === "core"`，不认 `system`/`essential`。配置读取异常时 system 非 essential 插件（mcp/skill/sub_agent）会被置为 disabled | `modules/plugins/plugin.manager.ts`（`registerPlugin` 的 catch） |
| 外部插件可自declare `category` / `essential` | `validateManifest` 只校验 id/name/version/description，不剥离这两个字段；外部插件借此获得"不可启停 + 免于批量禁用"。`governance` 已堵，`category`/`essential` 未堵 | `modules/plugins/external/external-plugin-loader.ts` |
| Skills 的逐技能过滤只在 prompt 生效 | `settings.skills` 的过滤作用在 skill 插件的提示词上，`skill_learn` 工具本身不校验 → 被角色关掉的技能仍可被 learn 到 | `modules/skills/plugins/skill.plugin.ts` |
| `category: "system"` 兼任三种职责 | 不可启停、不进通用启停列表、`/plugins/query` 的过滤判据。工具包治理已拆为工具包级 `governance`，插件级的这三项仍混在 `category` 上 | `modules/plugins/plugin.manager.ts`、`plugins.controller.ts` |

> 同轮记录的另三项 MCP 问题（`streamableHttp` 死分支、`callTool` 不透传 `isError`、`healthCheck` 无调用方）
> 已随 MCP 连接池改造一并修复：连接与生命周期现由 `common/mcp/mcp-connection-manager.service.ts` 负责，
> `healthCheck` 接入了设置页的「测试连接」（`POST /mcp-servers/:id/test-connection`）。
> 另：原先记在此处的「MCP 每次调用新建连接」也已解决，故不再列入本清单。

### 暂缓项 · 防休眠与错过窗口（2026-10-15）

本轮实现「保持电脑运行」（`keepAwakeMode`：关闭 / 仅执行任务时 / 始终）与定时任务错过窗口留痕时，明确不处理的边界。

| 问题 | 现状 | 关联文件 |
|---|---|---|
| 防不了合盖/手动睡眠 | `powerSaveBlocker("prevent-app-suspension")` 只阻止系统因空闲休眠，合盖、手动睡眠、企业电源策略仍会中断任务（设置页文案已如实说明） | `electron/main.ts`（`reconcileKeepAwakeBlocker`） |
| 「执行中」判据不含游离后台进程 | 忙碌状态只看 ChatRunner 队列（所有对话/定时任务/子 Agent/工作流都经它）。工具起的后台 shell 进程若在回合结束后仍在跑，不计入 busy，机器可能休眠把它挂起 | `modules/runtime/keep-awake.service.ts`、`modules/shell/process-manager.service.ts`（`ProcessManagerService` 未导出，接入需先补 exports） |
| ChatRunner 卡死会一直不休眠 | `isProcessing` 长期为 true 时 busy 恒真 → 阻塞器不释放。现有兜底是 LLM 空闲/请求超时，但没有「连续忙 N 小时后强制放行」的自保 | `modules/chat/chat-runner.service.ts`（`hasActiveWork`）、`modules/runtime/keep-awake.service.ts` |
| Web 端改设置不通知桌面主进程 | 通过浏览器（非桌面窗口）改 `keepAwakeMode` 时没有 IPC 通道，主进程要等下次启动读文件才生效；桌面窗口内改动是即时的（IPC + 设置页读回对账） | `electron/main.ts`（`readKeepAwakeModeFromSettings`）、`components/setting/GeneralSettings.vue` |
| 错过窗口的跳过策略不可配置 | 迟到超过 5 分钟一律只留痕不补跑，没有「按任务选择补跑」的开关；一次性任务错过即停用，不可恢复 | `modules/scheduler/task-scheduler.service.ts`（`MISSED_WINDOW_GRACE_MS`） |
