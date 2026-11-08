# dsh-purge 机制拆解与 GuaDa 平替评估

> 调研对象
> - 参考插件：`HunYiSage/dsh-purge` v1.1.92（本地克隆：`tmp/ref/dsh-purge`）
> - 宿主实现：`DeepSeek Harness`（本地：`D:\AI\work\public\deepseek-harness`）
> - 本项目：GuaDa（`D:\AI\ai_chat`，NestJS + Vue3 + Electron）
>
> 本文只讨论**机制与平台能力**，不评价该插件的合规性；其"绕过宿主安全策略"的部分在 GuaDa 不建议也不应复刻（见 §9）。
> 证据以 `文件:行号` 标注，均为调研时实际代码。

---

## 0. 结论摘要

1. **dsh-purge 不是一个"普通插件"，而是「插件 + 宿主补丁器 + 资产包」三合一。**
   - 插件层：吃 Cordis 的官方扩展点（提示词段、装配瀑布、工具、命令、UI slot、生命周期事件）。
   - 补丁层：用字符串/正则**直接改写宿主 `node_modules/@deepseek-ai/*` 的源码文件**（`.dshpurge.bak` 备份、marker 幂等、按版本适配、可回滚）。
   - 资产层：技能库、规则集、agent 预设、SQLite 事实库、授权门、更新检查。
2. **"破甲"效果由两层共同完成**：装配期改写（`system-prompt/assemble` 去身份/换人格）+ 磁盘补丁（改默认策略、工具过滤、审批门、预设文案）。后者的代码量最大（`lib/core.js` 8809 行），它存在的原因是：DSH 的默认身份文案、沙箱策略、审批门、工具过滤都不给插件改写权限。
3. **GuaDa 的前提不同**：系统提示词本来就由用户/智能体配置（没有硬编码身份句），提示词、工具白名单、沙箱档位都是显式配置，因此"身份替换/策略覆盖"不需要改宿主源码。
4. **GuaDa 现有插件机制已覆盖"基础层"**：工具/工具包、追加式提示词、技能注册、设置页 slot、主题、NLS、RPC、数据 KV、目录式安装（git/gitee/local）；缺的是"深度集成层"（见下）。
5. **要支撑"插件市场 + 类 dsh-purge 插件"，缺口集中在 6 处**：
   - ① 提示词段协议（命名/排序/作用域/覆盖/装配后 transform）
   - ② 插件可注册的 Hook（把已有 `HOOKS` 契约开放出去）
   - ③ 聊天区 UI 挂点（会话标题旁、右侧 dock、composer、消息节点）
   - ④ 动作型斜杠命令（现在只能做文本展开）
   - ⑤ 工具调用拦截/审批决策扩展点
   - ⑥ 市场侧：清单协议、配置 schema、权限声明、版本/渠道/校验
6. 建议按 **P0（市场可用）→ P1（类 dsh-purge 能力）→ P2（平台化）** 补齐，而不是照搬"改 node_modules"的补丁模式。

---

## 1. dsh-purge 是什么

一句话：针对**本机已安装的官方 DeepSeek Harness**，把宿主默认的"身份/免责声明/权限策略/工具限制"改写掉，并提供一个右侧 dock（Clean/Drill 两页）来管理补丁、提示词、规则集和红队演练台。

它的运行形态有三份产物：

| 产物 | 作用 | 证据 |
|---|---|---|
| npm 包（bundle） | 携带 `cordis.patch.yml`，被 profile 的 `dsh.profile.bundles` 引用 | `package.json:67-88` |
| Cordis 插件主体 | `lib/index.js`（2913 行）+ `lib/core.js`（8809 行补丁器） | `package.json:10` |
| 客户端产物 | `client.js`（9378 行），注入官方 Web UI 的 slot | `package.json:12,71-81` |

它**明确不用**第三方插件市场，安装方式是 `dsh plugin add <codeload tarball>` 或 `pnpm add`，再由 `postinstall` 把自己写进 profile 的 bundles 与 `cordis.patch.yml`（`scripts/ensure-profile-bundle.mjs`）。

---

## 2. 三层机制

### 2.1 安装层：bundle / profile / patch

DSH 的插件装配是"配置树叠加"模型：

```text
profile 模板（web/desktop）
  → 每个 bundle 自带的 cordis.patch.yml（层）
  → profile 用户层 cordis.patch.yml
  → $DSH_HOME/cordis.patch.yml
  → --patch 参数
  = 最终 entry list（yaml 行）
```

- bundle 的判定：`package.json` 里有 `dsh.bundle.patch`（`packages/boot/app-boot/src/profile.ts:49-53`）。
- patch 只有三种语义（`vendor/include/src/index.ts:58-128`）：
  - `{insert: [...]}`：无 id 追加到根；带 id 插入该 group 的 `config`；
  - `{id, ...overrides}`：按 id 覆盖字段（`name` 可用于断言）；
  - `{id, disabled: true}`：唯一的"移除"手段（**没有 remove**）。
- `dsh-purge` 的 `cordis.patch.yml` 就是：关掉几个旧红队包行、改 `system-prompt` 配置、给自身行补 `inject: [systemPrompt, tools]`、`insert` 三个 redteam 子节点（`cordis.patch.yml:6-71`）。
- 关键限制：**bundle 层只在启动时读一次**，`patchReload: 'live'` 只 watch `cordis.patch.yml`，所以装完必须重启（这也是社区"市场一键安装不生效"的根因之一）。

> 对 GuaDa 的启示：GuaDa 不需要"配置树 patch"，因为它没有 DSH 那种"bundle 组合"结构；但"插件声明自己被宿主加载"的清单语义（manifest + 目录扫描）已经具备，而且更适合市场分发。

### 2.2 运行时插件层：Cordis 扩展点

`lib/index.js` 把插件的运行时能力铺在 7 类扩展点上：

| # | 扩展点 | 插件用法 | 代码位置 |
|---|---|---|---|
| 1 | `export const inject = ["systemPrompt","tools"]` | 声明依赖，等两个服务就绪再 `apply` | `lib/index.js:62` |
| 2 | `ctx.systemPrompt.section({name, order, text})` | 注入自己的提示词段，`order = -100000` 排到最前 | `lib/index.js:440-470`、`lib/identity.js:3` |
| 3 | `ctx.on("system-prompt/assemble", handler, next)` | **每轮装配后整体改写**：去身份句、替换默认段、补尾锚点、保证 `complete:true` 后仍注入 | `lib/index.js:913`、`lib/identity.js:rewritePromptAssembly` |
| 4 | `ctx.on("session/created")` / `agent/pre-step` / `agent-preset/selected` | 会话创建、每步前、切换预设时重挂/重算 | `lib/index.js:791,1002,1011` |
| 5 | `ctx.tools.register({...})` | 注册 `purge_status / purge_apply / purge_revert` 三个模型工具 | `lib/index.js:1874-1960` |
| 6 | `ctx.commands.register` / 客户端命令源 | `/purge` `/rules` `/rewind` | `lib/index.js` + `client.js` |
| 7 | 客户端 `ctx.slots.inject` + `ctx.locale.register` + `ctx.uiConversation.events.register` | 会话标题旁按钮、右侧 dock、命令输入卡片 | `client.js:9330-9360` |

此外还有几个"平台级"接管：

- `installSubagentControl` / `installSubagentRoleCapture`：接管子代理的审批与角色段（`lib/subagent-control.js`、`lib/redteam/role-section.js`）。
- `hooks-deny.js`：绕过宿主 hooks 的 deny 决策。
- `continue-retry.js`：`autoRetry` / `autoContinue`——失败重试与"回合将结束时续跑"（对应 DSH 的 `agent/request-error` 与 `agent/turn-stopping`）。
- `ctx.effect()`：dispose 时卸载 section / 监听器，兼容热重载。

**这一层是"协作式"的**：所有能力都在宿主公开的 seam 上，插件不碰源码。

### 2.3 补丁层：Apply / Revert

这是 dsh-purge 的核心差异点，也是它必须存在的原因。

流程（`lib/core.js`）：

1. **定位宿主**：`DSH_HOME` / `DSH_BASE` → 启动器旁 `.dsh` → npm 全局前缀 → 嵌套 `@deepseek-ai` → `~/.dsh`；桌面端还要处理 asar（`findDshHome`、`resolveOfficialAiBase`、`extract-asar.js`）。
2. **建立文件映射表**：`targetFiles(aiBase)` 把逻辑名映射到真实包文件，例如
   `agent-instructions` → `dsh-agent-instructions/lib/index.js`，
   `base` → `dsh-base/cordis.patch.yml`，
   `tool-subagent` → `dsh-tool-subagent/lib/index.js`（`lib/core.js:6788+`）。
3. **逐补丁替换**：`PATCHES` 是 70+ 条声明式记录，每条含 `id/name/layer/desc/file/replacements/markers/optional/strictFiles`（`lib/core.js:2609+`）。
   - `replacements` 是 `pattern → replace` 的字符串或正则替换；
   - `markers` 用于状态展示与"是否已应用"；
   - `skipIfMarked` / `optional` / `strictFiles` 处理版本差异与重复应用；
   - 每条补丁失败只影响自己，整体报告分 `applied / already / skipped / failed`。
4. **备份与原子写**：首次应用前把目标复制成 `<file>.dshpurge.bak`；写文件走 `atomicWriteSync`（临时文件 + rename）。
5. **附带修补**：shim（启动脚本）改写、CMD 闪窗静默、asar 解包、重启宿主。
6. **回滚**：`revertAll` 用 `.bak` 覆盖回去并删除备份；无备份时按 marker 剥离自己写入的行（`lib/index.js:1356`）。

补丁覆盖的内容（按 `PATCH_DISPLAY_GROUPS` 分组）：

- 提示词/身份：免责声明、`AGENTS.md` 前言、身份句、persona 前缀、minimal 预设的"无网络"限制；
- 权限/审批：`toolFilter`、`ask` 门、沙箱策略、子代理委派上下文、hooks deny；
- 运行时行为：Bash 超时、`windowsHide`、市场重启命令、`job` 提升；
- UI：客户端 bundle 的注入点（`isWatchedClientBundle`）。

**为什么必须改源码**：DSH 官方明确不提供"删除/改写别人提示词段""在线改预设文本""绕审批/沙箱"的扩展点；插件只能新增自己的段，不能动宿主全局段（见 §3）。
所以 dsh-purge 选择"改安装产物"，并用备份/marker/版本适配把风险控制在可回滚范围。

> 对 GuaDa 的启示：**不要照搬这一层**。GuaDa 是自有 monorepo，源码与构建可控，插件不应有"改 dist"的权力；需要覆盖默认行为时，应提供**官方 overlay / 配置层**（见 §8）。

### 2.4 资产与运营层

| 资产 | 机制 | 证据 |
|---|---|---|
| 23 条红队技能 | 随包 `skills/redteam/*.md`，运行时落到 `$DSH_HOME/skills` | `skills/redteam/`、`lib/skills.js` |
| 规则集 | `$DSH_HOME/rules/` 下的 `AGENTS.md`/`CLAUDE.md`，按 cwd 勾选注入 | `lib/rules.js` |
| 用户注入文件 | `$DSH_HOME/prompt-inject.md`（用户文件，回滚时保留） | `lib/core.js:2456-2510` |
| Agent 预设 | `presets/redteam/{preset.yml,agent.cordis.yml}`，安装时落到预设目录 | `lib/preset-default.js`、`presets/redteam/` |
| 事实库 | `$DSH_HOME/redteam` 下的 SQLite（`dsh-purge/redteam/store` 子插件） | `cordis.patch.yml:60-67`、`lib/redteam/store.js` |
| 授权门 | 首次进 Drill 需读声明 + 倒计时 + 三项勾选 | `client.js`、`lib/drill-grant.js` |
| 更新 | GitHub Releases 版本比较，stable/beta 双通道 | `lib/update.js`、`lib/official-update.js` |

---

## 3. DSH 宿主到底给了插件什么（官方 vs 只能改源码）

| 能力 | DSH 官方扩展点 | 插件能否改写宿主默认 |
|---|---|---|
| 提示词新增段 | `ctx.systemPrompt.section({name, order, text, complete})`，中央 order 表 `SECTION_ORDERS`（-1000…9900） | ✅ 只能新增自己的段；同层重名会 throw |
| 提示词整体改写 | `system-prompt/assemble` waterfall，返回值权威 | ✅ 但 `complete:true` 段会在瀑布后还原；无法"删除"别人的全局段，只能在 agent 作用域同名 shadow |
| 模板变量 | `ctx.systemPrompt.variable()`；`{{cwd}}/{{model}}/{{provider}}` 由 agent-loop 注册 | ✅ 新增变量 |
| 工具 | `ctx.tools.register()` | ✅ 新增；不能改内置工具 schema |
| 工具流水线 | `tools/pre-execute`（返回 allow/deny/ask）、`tools/execute`、`tools/post-execute`、`tools/result`、`ctx.tools.guard()`、`ctx.tools.restrict()` | ✅ 可拦截/否决/过滤（作用域内） |
| 审批 | `ctx.approval.request()`，fail-closed | ✅ 可发起；不能全局关闭宿主审批（只能 deny/ask） |
| 命令 | `ctx.commands.register({name, description, input, handler})` | ✅ 新增；重名可 shadow（scoped） |
| UI | `ctx.slots.register/inject` 到已声明槽：`conversation.session.header.actions`、`settings.section`、`details`、`tool.call.toolview`、`shell.overlay` 等 | ✅ 只能往已存在的槽注入；**新增槽名要改 `SlotMap`（编译期声明合并）** |
| 前端产物 | `package.json` 的 `dsh.client.inject` + `exports["./client"]`，由客户端模块图加载 | ✅ |
| 生命周期 | `agent/session-start`、`agent/pre-step`、`agent/request`、`agent/request-error`、`agent/turn-stopping`、`session/event` | ✅ |
| 配置持久化 | `ctx.settings.register(ns, schema, {base, applies, validate})` → `$DSH_HOME/settings.yaml` | ✅ |
| 结构化存储 | `ctx.storageDomain` + `storage-sqlite`（只有 kv facet） | ✅（无裸 SQL 句柄） |
| 预设 | 用户级 agent 预设（`$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`），只能复制/删除 | ⚠️ 不能在线编辑文案 |
| 安装/市场 | 只有 CLI `dsh plugin add`（spawn pnpm），**仓库内无 marketplace 代码** | ❌ 无 host 侧安装服务、无热安装 |

**结论**：dsh-purge 的"插件层"用的全是官方扩展点；"补丁层"针对的正是上表这些 ❌/⚠️ 格：宿主身份句、默认策略、预设文案、审批门、工具过滤的默认值。

---

## 4. GuaDa 现状盘点

### 4.1 已有的插件形态

```text
plugins/
  <plugin-id>/
    manifest.json      // id/name/version/description/author/icon/main/category/essential/provides
    index.js           // require 进后端主进程，导出 PluginBase 子类（new PluginClass()，无 DI）
    frontend/dist/*.js // IIFE，调用 window.__GuaDaModuleLoader__.register('id:Name', {default})
    themes/*.css
    lang/zh.json
```

- 扫描目录：`PLUGINS_BUILTIN_DIR`（随包）→ `PLUGINS_USER_DIR`（用户）→ `PLUGINS_DEV_DIR`（仅 dev）（`external-plugin-loader.ts:74-90`）。
- 安装源：`github:owner/repo[#ref]` / `gitee:` / `git:` / `local:`（`plugin-source.ts`），后台 job + 日志 + 取消（`plugins.controller.ts:369-393`）。
- 启停/卸载/更新/重载：`plugins.controller.ts:324-360`、`external-plugin-loader.ts:520+`。
- 数据自治：`getData/getValue/setValue/deleteValue` → `SettingsStorage` 的 `plugin:<id>` 命名空间（`plugin-api.ts:262-271`）。

### 4.2 PluginApi 扩展点（`backend-ts/src/modules/plugins/api/plugin-api.ts`）

| 扩展点 | 语义 | 现状 |
|---|---|---|
| `registerTool` / `registerRawTool` | 注册模型工具（Zod schema、display、dangerLevel、readOnly、allowedInPlanMode） | ✅ 完整 |
| `registerToolKit` | 工具包（eager/lazy/none、activator、requiresAnyKits、governance:'self'） | ✅ 完整 |
| `registerPrompt` | 追加提示词块（STATIC/REGULAR/VOLATILE，可为函数） | ⚠️ 只能追加，无命名/排序/作用域/覆盖 |
| `registerCommandProvider` | 斜杠/艾特命令（`fetchItems` + `parse`） | ⚠️ 只能文本展开（replacement + appendix），不能执行后端动作 |
| `registerTurnReminderProvider` | 每轮 LLM 前注入 persist/transient 消息 | ✅ 尚未被 dsh-purge 类插件利用，但是关键能力 |
| `registerSkill` | 内嵌技能正文 | ✅ |
| `registerSlot` / `registerUiPage` / `registerTheme` | UI 声明 | ⚠️ 实际消费方只有 `settings` slot（见 4.3） |
| `registerRpc` | 前端 → 后端方法（`/plugins/:id/rpc/:method`） | ✅ |
| `registerNls` | 插件隔离 i18n | ✅ |
| `registerAttachmentType` / `registerWorkspaceProvider` / `registerConnectionType` | 附件类型、连接方案 | ✅ |
| `registerProviderType` / `registerProtocolAdapter` | 供应商包 | ✅ |

### 4.3 提示词装配

```ts
// jsonl-session-context.ts:1605-1631
const systemPrompts = [this.effectiveSettings.systemPrompt];   // 会话/智能体 systemPrompt
systemPrompts.push(pluginPrompts.join('\n\n'));                // 所有插件 eager 提示词
const systemText = systemPrompts.filter(Boolean).join('\n\n');
```

- 排序只有 `frequency`（STATIC→REGULAR→VOLATILE），同频按 `pluginId` 字典序（`prompt-collector.service.ts:105-109`）。
- **没有 section 身份、没有 order 数值、没有作用域、没有"替换/删除"**。
- 好消息：GuaDa 的系统提示词本就由 `sessionSettings.systemPrompt || agentSettings.systemPrompt` 决定，**没有硬编码身份句**。所以 dsh-purge 花最大力气做的"去身份/换身份"，在 GuaDa 里只是"写智能体的 systemPrompt"。

### 4.4 Hook（钩子）现状

- 已有契约：`backend-ts/src/modules/chat/types/hooks.contract.ts`
  - `agent.pre_step`（serial，副作用管线）
  - `agent.request_error`（serial，可返回 `{kind:'retry'}`）
  - `turn.stopping`（parallel，可返回续跑消息）
  - `compaction.before`（parallel）
  - 领域事件：`memory.pre_compact`、`memory.compacted`、`todo.updated`、`goal.updated`
- 调度器：`EventBusService.emit/parallel/serial`，fail-open。
- **缺口**：这些事件只对 Nest 内部 `@OnEvent` 订阅者开放；外部插件是 `new PluginClass()`，拿不到 `EventBusService`，`PluginApi` 也没有 `registerHook`。
  另外，`ToolUsingEvent` / `LLMRequestEvent` 两个类型定义了但**全仓无消费方**（`plugin.types.ts:355-383`），属于"画了没接线"的扩展点。

### 4.5 UI 现状

- `PluginSlot.vue` + `usePluginSlots` 已实现"清单驱动 + 异步加载 + SSE 刷新 + 主题注册"。
- 但**唯一消费方是设置页**：`SystemSettings.vue:221-235` 读取 `settings` slot，渲染为侧边栏项。
- 会话标题旁、右侧 dock、composer 工具条、消息节点、全局 overlay **都没有挂点**；`PluginSlot.vue` 目前甚至没有被任何页面引用。
- 前端产物协议是 IIFE + `register('id:Name')`，共享依赖走 `window.__GuaDaShared__`（`plugin-loader.js`）。

### 4.6 其它相关能力

| 能力 | 位置 | 与插件的距离 |
|---|---|---|
| 斜杠命令 | `commands/command-provider-registry.service.ts` | 只做标签解析，无动作执行 |
| 命令策略 | `common/services/policy-rules.service.ts` + `policy.controller.ts` | 插件不能声明规则 |
| 沙箱档位 | `common/services/sandbox-policy.ts`（三档） | 会话/用户配置，插件不能改 |
| 计划模式 | `plan-mode.plugin.ts` + `readOnly/allowedInPlanMode` 声明 | 插件只能声明工具属性 |
| 审批 | 工具 execute 内主动发起（`agent-engine.service.ts:792`） | 无插件参与决策的钩子 |
| 技能 | `registerSkill` / 技能目录 / SkillHub | 可平替 dsh-purge 的 skills 包 |
| 存储 | `SettingsStorage`（JSON KV） | 无 SQLite/结构化表给插件 |
| 市场 | 只有 MCP 市场、SkillHub；插件页只有"本地工具/技能/MCP" | 无插件市场索引 |
| 隔离 | 外部插件 `require()` 进主进程，与技术债一致 | 见 `docs/technical-debt.md:14-48` |

---

## 5. 逐项平替映射

> 图例：✅ 可直接平替 ｜ 🟡 需小改/组合 ｜ 🔴 需新增机制 ｜ ⛔ 不建议复刻

| # | dsh-purge 机制 | GuaDa 对应 | 结论 |
|---|---|---|---|
| 1 | bundle + `cordis.patch.yml` 装配 | manifest.json + 目录扫描 + `register*` | ✅ 语义等价，且更适合目录式分发；不需要配置树 patch |
| 2 | `ctx.systemPrompt.section(order=-100000)` | `registerPrompt(frequency)` | 🟡 能"加"，不能"排到最前/覆盖/删除"；需 section 协议 |
| 3 | `system-prompt/assemble` 每轮改写 | 无 | 🔴 需装配期 transform 钩子 |
| 4 | 去身份句 / 换 persona | 智能体 `systemPrompt` 由用户配置，无硬编码身份 | ✅ 不是问题；"人格插件"直接写提示词即可 |
| 5 | `prompt-inject.md` 用户文件 | 智能体 systemPrompt / 会话设置 | ✅ 平替（甚至更安全） |
| 6 | 规则集（AGENTS.md/CLAUDE.md） | 无项目规则加载器 | 🔴 可用 `registerPrompt` + 插件自管文件；若要"按 cwd 自动发现"需新增规则 provider |
| 7 | `ctx.tools.register` | `registerTool` / `registerToolKit` | ✅ 完整 |
| 8 | `/purge apply|revert|status` 动作命令 | `registerCommandProvider` 只能文本展开 | 🔴 需动作型命令 |
| 9 | `purge_status/apply/revert` 三个工具 | `registerTool` | ✅ 模型侧等价 |
| 10 | 会话标题旁按钮 / 右侧 dock | `registerSlot`，但只有 `settings` 消费方 | 🔴 需新增聊天区挂点（header.actions / details / overlay） |
| 11 | 客户端 locale / 命令输入卡片 | `registerNls`；命令卡片无 | 🟡 文案可平替；自定义消息节点需新增 slot |
| 12 | `ctx.effect` 清理、热重载 | `onStop/onUnload` + registry 清理 | 🟡 基本可用；无"热替换后重新注册"的原子语义 |
| 13 | `session/created`、`agent/pre-step`、`agent-preset/selected` | `HOOKS` 有 PRE_STEP，但不向插件开放；无 session-created、无 preset | 🔴 需 Hook 注册 API + 补事件 |
| 14 | `agent/request-error` 自动重试 | `HOOKS.REQUEST_ERROR` 存在，但只有内部订阅者 | 🟡 开放即可 |
| 15 | `agent/turn-stopping` 自动续跑 | `HOOKS.TURN_STOPPING` 存在 | 🟡 开放即可 |
| 16 | 工具过滤 / 审批接管 / hooks deny | 无插件参与面 | 🔴 需 `tools/pre-execute` 等扩展点（谨慎开放） |
| 17 | 子代理控制 | 子代理是内置能力包，插件不能接管 | 🔴 不建议开放（风险高于收益） |
| 18 | 技能库随包分发 | `registerSkill` + 技能目录 | ✅ |
| 19 | agent 预设 | 智能体（agents）存在，但插件不能注册预设 | 🔴 需"预设贡献"扩展点（若市场要卖"能力包"） |
| 20 | SQLite 事实库 | `SettingsStorage` KV；结构化存储无 | 🟡 小数据用 KV；大数据需新增 storage API |
| 21 | 授权门/法律声明 UI | 插件可自绘（设置页 slot）+ RPC 存状态 | 🟡 设置页可做；聊天区门需 UI 挂点 |
| 22 | 更新检查（stable/beta） | 无 | 🔴 市场侧能力 |
| 23 | 改 node_modules + 备份/marker/回滚 | 无（也不该有） | ⛔ 不建议；替代方案见 §8 |
| 24 | 改沙箱/审批默认值 | 用户显式设置（sandboxMode / policy） | ⛔ 不应由插件改；若要"策略包"，走官方 policy overlay |

**统计**：24 项中 ✅ 6 项、🟡 7 项、🔴 9 项、⛔ 2 项。
也就是说：**"工具 + 技能 + 提示词追加 + 设置页"这类插件今天就能做**；**"类 dsh-purge 的完整形态"还差 8 项机制**。

---

## 6. 现有机制下能实现到什么程度

### 6.1 今天就能做出来的"dsh-purge 类插件"（不改宿主）

能做到：

- 自带技能包（`registerSkill`）；
- 自带规则文本，通过 `registerPrompt` 每轮注入（函数形式可读会话状态）；
- 提供模型工具（如 `lint_status`、`rules_apply`）；
- 提供设置页（`registerSlot('settings')`）做开关、文本编辑、状态展示；
- 用 `registerRpc` 读写插件数据；
- 用 `turn reminder` 做"每轮锚点"（dsh-purge 的 anchor 段）。

做不到（或体验残缺）：

- 在会话标题旁放按钮、开右侧 dock；
- `/xxx apply` 直接执行后端动作（只能把文本塞进消息，让模型去调工具）；
- 每轮对最终 system prompt 做统一改写/去重/裁剪；
- 在"工具即将执行"时介入决策；
- 会话创建时自动初始化（只能懒初始化）。

### 6.2 补齐 P0/P1 后的目标形态

```text
插件 = manifest + 后端 entry + 前端产物 + 资产
  ├─ 贡献：tools / toolkits / prompts(section) / commands(action) / skills / hooks / slots / themes / presets
  ├─ 配置：manifest.configSchema → 自动设置面板 → plugin data
  ├─ 生命周期：install → enable → (hooks) → disable → uninstall（原子、可回滚）
  └─ 市场：index → 版本/渠道/校验 → 安装 → 更新 → 权限确认 → 审计
```

---

## 7. 需要新增的机制（按优先级）

### P0：做插件市场之前必须有

#### P0-1 插件清单与市场协议

现在只有"从 git 源安装"，没有市场索引。建议：

```ts
// manifest 扩展（向后兼容）
interface PluginManifest {
  // ...现有字段
  /** 兼容的宿主版本范围（semver range） */
  engines?: { guada?: string };
  /** 配置 schema（JSON Schema），用于自动生成设置面板 */
  configSchema?: Record<string, unknown>;
  /** 声明的能力（安装时展示、运行时可审计） */
  permissions?: Array<"fs" | "net" | "shell" | "clipboard" | "workspace" | "session">;
  /** 插件级入口声明，替代隐式约定 */
  entries?: { backend?: string; frontend?: string; assets?: string };
}
```

市场索引（服务端）：

```jsonc
{
  "schemaVersion": 1,
  "plugins": [{
    "id": "guada-rules",
    "versions": [{
      "version": "1.2.0",
      "channel": "stable",           // stable | beta
      "minHost": "1.8.0",
      "tarball": "https://.../guada-rules-1.2.0.tgz",
      "sha256": "...",
      "size": 123456,
      "permissions": ["fs", "workspace"],
      "changelog": "...",
      "publishedAt": "..."
    }],
    "downloads": 0,
    "verified": true
  }]
}
```

配套：`GET /plugins/market/index`、`POST /plugins/market/install`（下载 → 校验 → 解包 → 扫描 → 权限确认 → 加载）、`POST /plugins/market/check-update`。

#### P0-2 插件配置 schema + 自动设置面板

- manifest 声明 `configSchema`，后端在 `GET /plugins/query` 里下发；
- 前端在插件页/设置页用统一表单渲染（项目已有 form 统一方案，见 `docs/design/form-unification.md`）；
- 读写走现有 `plugin data` API；
- 好处：大多数插件不需要自己写 Vue 组件，市场门槛大幅降低。

#### P0-3 权限声明 + 安装确认 + 审计

技术债已记录"外部插件无沙箱"（`docs/technical-debt.md:14-48`）。市场化后必须先补"声明 + 确认 + 审计"，再谈隔离：

- 安装前展示权限清单（读写文件、发网络、执行命令、访问工作区…）；
- 运行时记录高危调用（`child_process`/`fs` 越界/`net`）到审计日志；
- 卸载/禁用时清理插件注册的所有资源（slot/theme/tool/prompt/hook）。

#### P0-4 插件生命周期原子化

现状：`registerPlugin` 失败会留下半注册状态；工具重名"先到先得"且无仲裁（技术债已记录）。

需要：

- `install`（校验/扫描/落盘）→ `enable`（注册）→ `disable`（反注册）→ `uninstall`（清理）的**事务语义**；
- 注册冲突策略：工具名/命令名/slot 冲突 → 明确报错并回滚，而不是静默跳过；
- 依赖解析：`dependencies` 拓扑排序 + 缺失提示；
- 失败回滚：`onLoad` 抛错 → 撤销本次所有注册。

### P1：支撑"类 dsh-purge"插件

#### P1-1 提示词段协议（核心）

```ts
interface PluginApi {
  registerPromptSection(def: {
    /** 全局唯一段名，建议 `${pluginId}.${name}` */
    name: string;
    /** 排序，越小越靠前；内置段使用负数区间 */
    order?: number;
    /** 作用域：global（所有会话）/ agent（指定智能体）/ session（指定会话） */
    scope?: "global" | "agent" | "session";
    /** 是否可被同作用域的同名段覆盖（默认 false，重名报错） */
    shadowable?: boolean;
    /** 文本或动态文本；返回空串表示本轮不注入 */
    text: (ctx: PluginContext) => string | Promise<string>;
    /** 是否在装配后锁定（防被后续 transform 删除），默认 false */
    complete?: boolean;
  }): void;

  /** 装配后整体 transform（waterfall 语义，按 order 串行） */
  registerPromptTransform(def: {
    id: string;
    order?: number;
    transform: (
      assembly: { sections: PromptSection[]; systemText: string },
      ctx: PluginContext,
    ) => { sections?: PromptSection[]; systemText?: string } | void;
  }): void;
}
```

实现要点：

- `prompt-collector` 从"收集字符串"升级为"收集带 name/order/scope 的 section"；
- `buildSystemText` 改为 `assemble()` + `transforms` 两段；
- 内置 agent systemPrompt 作为一个 `builtin.agent-system` 段参与排序（默认 order 0），插件段可用负数插入其前；
- 段级权限：内置段 `shadowable:false`，插件段只能 shadow 自己插件的段（除非宿主显式放行）。

#### P1-2 Hook 注册 API

```ts
interface PluginApi {
  registerHook<K extends HookName>(def: {
    event: K;
    order?: number;
    /** serial: 返回非 undefined 接管；parallel: 收集；emit: 只通知 */
    handler: (payload: HookPayload<K>) => HookResult<K> | Promise<HookResult<K>>;
  }): void;
}
```

首批开放（风险从低到高）：

1. `agent.pre_step`（只读观察 / 追加 transient）
2. `turn.stopping`（续跑）
3. `agent.request_error`（重试）
4. `session.created` / `session.deleted`（新增）
5. `agent.preset.selected`（新增）

暂不开放：`tools/pre-execute` 的 `deny` 决策（若开放，必须配合权限声明与审计，且内置策略优先）。

#### P1-3 动作型斜杠命令

现状 `ICommandProvider.parse` 只返回文本；需要新增"命令即动作"：

```ts
interface ActionCommandProvider {
  id: string;                       // 命令名，如 "rules"
  description: string;
  /** 子命令补全：/rules list|use|create */
  subcommands?: Array<{ name: string; description: string; args?: JsonSchema }>;
  execute(args: string[], ctx: ActionCommandContext): Promise<CommandResult>;
}

interface CommandResult {
  /** 直接回显给用户的文本 */
  text: string;
  /** 是否作为新消息进入会话历史 */
  echoAs?: "user" | "system" | "none";
  /** 前端卡片（可选） */
  card?: { kind: "text" | "diff" | "table"; data: unknown };
}
```

前端：输入 `/` 时从 `GET /commands` 聚合（现有）；执行改为 `POST /commands/:id`，由后端路由到 provider。

#### P1-4 聊天区 UI 挂点

新增 slot 名（前端 `PluginSlot` 消费）：

| slot | 位置 | kind | 用途 |
|---|---|---|---|
| `conversation.header.actions` | 会话标题右侧 | list | 插件按钮（dsh-purge 的入口） |
| `conversation.composer.toolbar` | 输入框工具条 | list | 快捷动作 |
| `conversation.side.panel` | 右侧 dock | single/list | 插件的完整面板 |
| `conversation.message.node` | 消息节点（按 key） | keyed | 自定义消息渲染 |
| `shell.overlay` | 全局浮层 | list | 授权门/欢迎页 |

配套：插件前端产物需要能拿到 `sessionId`、`pluginApi.call`、`openPanel` 等注入 props（现有 `mergedProps` 已支持）。

#### P1-5 工具拦截与审批扩展点（谨慎）

若确实要做"安全/合规类插件"，建议只开放**观察 + 建议**：

```ts
registerHook({ event: "tools.pre_execute", handler: async (exec, next) => {
  if (ruleHit(exec)) return { kind: "deny", reason: "..." };  // 需要权限 "policy"
  return next();
}});
```

约束：

- 内置策略先于插件策略执行（插件不能放宽内置限制）；
- `deny` 需要 `permissions: ["policy"]`，安装时明示；
- 所有 deny 写审计日志；
- 与计划模式/沙箱的组合语义要有测试覆盖。

#### P1-6 插件存储

- P1：KV（现有）+ 命名空间 + 导出/导入；
- P2：`registerStorage({ tables })`，由宿主统一迁移，或允许插件在 `plugin:<id>/` 下自管 SQLite 文件（需路径校验）。

### P2：平台化

| 机制 | 说明 |
|---|---|
| 插件作用域 | 全局 / 智能体 / 会话三级启用（对齐 ToolKit 的两层模型） |
| 预设贡献 | 插件可注册 agent 预设（模型、工具包、提示词、技能组合） |
| 插件市场运营 | 评分、下载量、举报、下架、灰度、兼容性矩阵 |
| 隔离 | worker/子进程 + 能力清单（替代"完全可信"模型） |
| 插件调试 | dev 目录 + 热重载 + 日志面板 + 注册清单快照 |
| 契约测试 | 插件 API 版本号 + 兼容性测试套件（`apiVersion`） |

---

## 8. 如果要"覆盖宿主默认值"，正确做法是什么

dsh-purge 用"改 node_modules"解决的是"宿主默认值不可配"。GuaDa 应从平台侧提供**显式配置层**，而不是给插件改源码的权力：

1. **内置默认值集中化**：把"身份句/安全提示/工具说明"从代码里抽成 `defaults/*.yaml` 或常量表；
2. **配置覆盖层**：`PLUGIN_OVERLAY_DIR` 或 `guada.overlay.yml`，按 key 覆盖默认文案/策略，加载顺序固定（内置 → 发行版 → 用户 → 插件声明）；
3. **插件只能"声明式覆盖"**：manifest 里 `overrides: { "prompt.identity": "..." }`，由宿主校验白名单；
4. **可回滚**：每次覆盖写入版本化快照（`overlay/<pluginId>/<rev>.json`），禁用插件即恢复；
5. **审计**：覆盖了哪些默认值、被谁覆盖，插件页可见。

这样既能实现"人格/文案/策略包"类插件，又不需要 `.bak` 文件补丁，也不会出现"升级后补丁失配"的问题（dsh-purge 一半的代码都在处理版本适配和失配）。

---

## 9. 合规与产品边界（重要）

dsh-purge 的定位是"红队评测/破甲"，其 README 用大量篇幅做法律声明，并把"演练台"放在二次授权门之后。这反过来说明：**这类能力的风险主要不在代码，而在"默认放开"**。

对 GuaDa 的建议：

- **不建议**实现"绕过宿主安全策略/审批/沙箱"的插件能力；
- 若要做安全类插件，定位应为"策略增强/审计/演练"，且：
  - 默认关闭，显式启用；
  - 不放宽内置限制，只做"更严格"的约束；
  - 所有决策可审计、可回滚；
  - 不提供"一键破甲"式默认配置。
- "人格/文案"类插件完全正当：GuaDa 的 systemPrompt 本来就开放，插件只是提供模板与管理界面。

---

## 10. 建议的落地顺序（结合"先做几个三方插件"）

| 阶段 | 目标 | 交付 |
|---|---|---|
| 第 1 步 | 让"提示词/规则/技能"类插件能上架 | P0-1 市场协议 + P0-2 配置 schema + P1-1 prompt section |
| 第 2 步 | 让插件有"存在感" | P1-4 聊天区 slot（先做 `header.actions` + `side.panel`） |
| 第 3 步 | 让插件能"做事" | P1-3 动作命令 + P1-2 Hook（pre_step/turn_stopping/request_error） |
| 第 4 步 | 让插件"可信" | P0-3 权限/审计 + P0-4 生命周期原子化 + P2 隔离 |
| 第 5 步 | 平台化 | 预设贡献、作用域、市场运营、契约测试 |

每步都可以用一个真实三方插件验收：

1. **规则包插件**（AGENTS.md/项目规则）→ 验证 P1-1 + P0-2；
2. **演练台插件**（工具 + 面板 + 存储）→ 验证 P1-3 + P1-4 + P1-6；
3. **策略增强插件**（只读审计 + 更严格拦截）→ 验证 P1-5 + P0-3。

---

## 11. 证据索引

### dsh-purge（`tmp/ref/dsh-purge`）

- `package.json:67-88` — `dsh.bundle.patch` / `dsh.client.inject` / `dsh.install`
- `cordis.patch.yml:6-71` — 行覆盖 + insert 子插件
- `lib/index.js:62` — `inject = ["systemPrompt","tools"]`
- `lib/index.js:440-470` — `systemPrompt.section`
- `lib/index.js:913` — `system-prompt/assemble`
- `lib/index.js:791,1002,1011` — `session/created`、`agent-preset/selected`、`agent/pre-step`
- `lib/index.js:1874-1960` — `ctx.tools.register`
- `client.js:9330-9360` — `slots.inject("conversation.chat.node"/"shell.overlay")`
- `lib/core.js:2609+` — `PATCHES` 声明式补丁表
- `lib/core.js:6788+` — `targetFiles` 宿主文件映射
- `lib/core.js:2007` — `applyPatchesAllHosts`
- `lib/identity.js` — 装配改写/身份剥离
- `lib/hooks-deny.js` / `lib/subagent-control.js` / `lib/continue-retry.js`
- `scripts/ensure-profile-bundle.mjs` — postinstall 写 profile

### DSH 宿主

- `packages/boot/app-boot/src/profile.ts:49-61, 805-861` — bundle/profile/patch 合成
- `vendor/include/src/index.ts:58-128` — patch 三种语义
- `docs/cordis-primer.zh.md` — 五个核心概念与分发模式
- `packages/core/system-prompt/src/index.ts:121-152, 601-611` — SECTION_ORDERS 与 assemble waterfall
- `packages/core/tools/src/index.ts` — `tools.register` / `tools/pre-execute` 流水线
- `packages/interaction/commands/src/index.ts:274` — `commands.register`
- `packages/client/ui-conversation/src/client/apply.ts:257` — `conversation.session.header.actions`
- `packages/client/ui-layout/src/client/index.ts:86` — `shell.overlay`
- `packages/client/ui-settings-*/src/client/index.ts` — `settings.section`
- `docs/cookbook/extension-cookbook.md` — 产品特性 → 插件机制对照表

### GuaDa

- `backend-ts/src/modules/plugins/types/plugin.types.ts` — manifest / ToolKit / Slot / Theme
- `backend-ts/src/modules/plugins/api/plugin-api.ts` — 全部注册 API
- `backend-ts/src/modules/plugins/registry/plugin-registry.ts` — 注册表
- `backend-ts/src/modules/plugins/external/external-plugin-loader.ts:74-103, 542+` — 扫描与安装
- `backend-ts/src/modules/plugins/external/plugin-source.ts` — github/gitee/git/local
- `backend-ts/src/modules/plugins/prompt-collector.service.ts:105-109` — frequency 排序
- `backend-ts/src/modules/chat/jsonl-session-context.ts:1605-1631` — 系统提示词拼装
- `backend-ts/src/modules/chat/types/hooks.contract.ts` — Hook 契约
- `backend-ts/src/common/events/event-bus.service.ts` — emit/parallel/serial
- `backend-ts/src/modules/chat/agent-engine.service.ts:532,690,1041` — 钩子调用点
- `backend-ts/src/modules/commands/interfaces/command-provider.interface.ts` — 命令契约
- `backend-ts/src/modules/plugins/plugins.controller.ts:369-405,448-495,510+` — 安装/清单/资产
- `frontend/src/stores/pluginSlots.ts` + `components/ui/PluginSlot.vue` + `components/setting/SystemSettings.vue:221-235` — slot 消费现状
- `frontend/src/services/plugin-loader.js` — IIFE 产物协议
- `docs/technical-debt.md:14-48` — 插件隔离缺口
- `docs/plugin-theme-registration-plan.md` — 主题注册的历史设计（可复用的"清单驱动"范式）
