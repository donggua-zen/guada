# DeepSeek Harness（dsh）插件/扩展机制调研报告

调研对象：`D:\AI\work\public\deepseek-harness`（pnpm monorepo，`packages/*/*` 共 ~250 个包）。
所有路径均相对该仓库根。**未修改仓库内任何文件。**

---

## 0. 一句话结论

dsh 的插件机制 = **vendored Cordis（`vendor/cordis`）+ Cordis Loader/Include（`vendor/loader`、`vendor/include`）+ profile/bundle 两层包清单（`packages/boot/app-boot`）**。
「插件」= 一个导出 `name`/`inject`/`Config`/`apply` 的 ESM 模块；「能被 `dsh plugin add` 安装并自动生效」= 该 npm 包在 `package.json` 里声明 `dsh.bundle.patch`；「组合」= 一层层 YAML patch 列表在空 entry list 上叠加。所有扩展能力都通过 **ctx 上的 service + 事件 waterfall** 实现，没有第二套插件 API。

用户问题里几个前提需要先纠正（代码证据见下文）：

| 提问中的说法 | 代码实际情况 |
|---|---|
| patch 有 `-insert` / `-remove` / patch 条目 | **没有 `remove`**。patch 只有三种形态：`{insert: [...]}`（无 id 追加到根，有 id 插进该 group 的 config）、`{id, ...overrides}`（整字段覆盖，`name` 可做断言）、`{id, disabled: true}`（唯一「移除」手段）。见 `vendor/include/src/index.ts:58-128` 与 `PatchOptions`（`:145-156`） |
| `host.systemPrompt.section` | 真实 API 是 **`ctx.systemPrompt.section()`**（服务名 `systemPrompt`）。没有 `host.` 前缀的 API |
| `postinstall` 写 profile | **不存在**。是 `dsh plugin` CLI 子命令在 pnpm 退出后 reconcile（`apps/cli/src/plugin.ts:120-163`） |
| `toolFilter` 是工具层过滤器 | `toolFilter` 是 **subagent 委派请求字段**，最终落到 `childCtx.tools.restrict()`（`packages/subagent/subagent/src/child-agent.ts:217`）。工具层过滤器 API 叫 **`ctx.tools.restrict()`** |
| 有官方 plugin market（dsh-plugin.org） | 本仓库**完全没有** marketplace 代码（全库 grep `dsh-plugin.org` / `marketplace` 无命中）。市场是第三方社区产物 |
| `inject: [systemPrompt, tools]` 是某特殊语义 | 就是 Cordis 的普通依赖声明；写在 YAML 行上时会 **追加/覆盖该 entry 的 fiber inject 表**（`vendor/loader/src/index.ts:122`） |

---

## 1. 插件加载形态：plugin / bundle / profile

### 1.1 概念三分

| 概念 | 定义 | 载体 |
|---|---|---|
| **plugin（插件）** | 一个 ESM 模块，导出 `apply(ctx, config)`（函数/对象/类三种形态） | 任意 JS/TS 文件或 npm 包 |
| **bundle（包/层）** | 一个 npm 包，`package.json` 里有 `dsh.bundle.patch`，指向它自带的 `cordis.patch.yml` | `dsh.bundle` 清单 + patch 文件 |
| **profile（配置档）** | `$DSH_HOME/profiles/<name>/` 目录：`package.json`（`dsh.profile.bundles` 有序列表 + pnpm 依赖） + `cordis.patch.yml`（用户层） | 目录 |

证据：
- `packages/boot/app-boot/src/profile.ts:49-53` `DshBundleManifest { patch: string }`
- `packages/boot/app-boot/src/profile.ts:55-61` `DshProfileManifest { bundles?: string[]; patchReload?: 'live'|'startup' }`
- `packages/boot/app-boot/src/profile.ts:1-24` 模块头注释完整描述了合成顺序
- `docs/user/develop/basic/publish.md:9-17`「A bundle is what you author and distribute; a profile is what a user boots. Nothing is both.」

### 1.2 发现与加载流程（实现路径）

1. **launcher 解析 argv**：`apps/cli/src/args.ts` → `mode: 'profile' | 'plugin' | 'dump-config'`，`--patch` 可重复。
2. **准备 profile**：`apps/cli/src/profile-boot.ts` `prepareProfile()` → `loadProfile()`；每次启动都会**重写** `<profile>/cordis.yml` 为空数组 `[]`（`PROFILE_ROOT_CONFIG`），因为真正的配置全是 patch 层。
3. **`loadProfile`**（`packages/boot/app-boot/src/profile.ts:805-844`）：
   - 目录不存在且是内置模板名（`web|headless|sdk|sdk-minimal|acp`）→ 按 `PROFILE_TEMPLATES`（`:137-158`）初始化；
   - 读 `dsh.profile.bundles`，逐个 `resolveBundleDir`（`:778-789`，**先安装目录、后 profile 目录**），解析该包 `dsh.bundle.patch`，用 `loadOverlayPatches` 解析 YAML；
   - 读 profile 自己的 `cordis.patch.yml`（文件名常量 `PROFILE_PATCH_FILENAME`，`:44`）。
   - 列出的 bundle 若没有 `dsh.bundle` → **直接报错**（`:832-835`）。
4. **合成 entry list**：`composeEntries()`（`:854-861`）= `applyEntryPatches([], layers.flat())`。
5. **挂载**：`mountRootInclude`（`packages/boot/app-boot/src/index.ts:501-541`）把 `<profile>/cordis.yml` 作为 `cordis:include` 的根 entry，patch 列表作为 include 的 `config.patches` 传下去。
6. **模块解析两锚点**：bundle 名先从 dsh 安装解析（内置 bundle 永远来自同一安装），再从 profile 目录；`$DSH_HOME/profiles/node_modules` 是安装依赖闭包的 fallback（普通 Node 用 symlink，pkg 打包版用 ESM proxy）。见 `profile.ts:15-22`、`healProfilesModuleFallback`（`:579-605`）、`healProfileModuleFallback`（`:643-677`）。

`dsh.profile.patchReload`：
- `live` → `watchUserPatches`（`packages/boot/app-boot/src/index.ts:235-265`）用 `ctx.hmr.registerConfig(filename, ...)` 监听 profile 与 home 两层 `cordis.patch.yml`；
- `startup` → 只加载一次。
- **注意：`patchReload` 只覆盖 `cordis.patch.yml`，不覆盖 `dsh.profile.bundles`**（bundle 层只在 boot 时读一次）。

### 1.3 `cordis.patch.yml` 的语义（精确）

`applyEntryPatches(data, patches, warn)`（`vendor/include/src/index.ts:58-128`）：

```yaml
- insert:                       # 无 id → push 到根 entry list
    - id: hello
      name: dsh-hello-plugin
- insert:                       # 有 id → 必须是 group 行；push 进 target.config
    - id: my-group
      name: '@deepseek-ai/cordis-plugin-group'
      group: true
      config: [...]
- id: tools                    # id 定位 + 整字段覆盖
  name: '@deepseek-ai/dsh-tools'   # 可选：作为断言，名称不符则 warn + 跳过
  config: { mode: native }     # ⚠ 替换整个 config，不做深合并
- id: some-row
  disabled: true               # 唯一的“移除”方式（禁用整棵子树）
```

- 匹配不到 id / 类型不符 → `warn` 后**跳过**，不报错（`:83-90, 111-119`）。
- 同一 patch 列表里后一条可以 patch 前一条 insert 的行（`buildMap(insert)`，`:96-102`）。
- 覆盖是「整个字段替换」，所以覆盖别人的 config 必须重述全部键（`docs/user/develop/basic/publish.md:123-127`）。
- 层序（后层按 id 覆盖前层）：每个 bundle → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 每个 `--patch`（`apps/cli/reference/README.md`「Profile boot」段）。
- `!!js` 表达式：`entryListSchema` 扩展的 YAML tag（`vendor/include/src/index.ts:9-23`），在 **entry 激活后**、针对该 entry 自己的 ctx 求值（`vendor/loader/src/index.ts:91-103` 的 `internal/config` 钩子 + `interpolate`）。`disabled` 则在每次挂载决策时对 loader ctx 求值。

### 1.4 `inject: [systemPrompt, tools]` 在 YAML 行上的含义

- 类型：`vendor/cordis/src/registry.ts:19` `Inject<M> = (keyof M)[] | { [K in keyof M]?: M[K] }`（数组=只声明依赖；对象=可带 intercept config）。
- entry 上的 `inject` 会被 `Inject.resolve(fiber.entry.options.inject, fiber.inject)` 合并进该 fiber 的 inject 表（`vendor/loader/src/index.ts:120-123`），因此**行的 inject 与插件模块自己的 `export const inject` 是叠加关系**，不是替换。
- 作用：① 决定该行何时激活（服务就绪才 `apply`）；② 让该行 config 里的 `!!js ctx.xxx` 在注入就绪后才求值（`docs/user/develop/basic/publish.md:141-151` 给了 `inject: [myAppStartup]` + `port: !!js ctx.myAppStartup.port ?? 8080` 的官方范例）。
- 另有 `isolate:`（为一条 group 行开独立服务 realm）与 `intercept:`（消费某服务的 intercept config），见 `EntryOptions`（`vendor/loader/src/config/entry.ts:9-22`）与 `docs/user/develop/framework/service.md`「Service isolation」。

---

## 2. 插件能声明什么 + 生命周期 + ctx 能力

### 2.1 声明契约（Cordis `Plugin.Base`）

`vendor/cordis/src/registry.ts:100-137`：

| 字段 | 含义 |
|---|---|
| `name` | fiber 诊断/日志名 |
| `Config` | StandardSchema 校验器（dsh 用 schemastery `@deepseek-ai/schemastery`），**加载时校验，失败即加载失败** |
| `inject` | 依赖的服务 |
| `provide` | 该插件提供的服务名（`Service` 基类自动写） |
| `intercept` | 声明消费哪些服务的 intercept config |

三种形态：函数（`(ctx, config)`）、对象（`{ name, inject, Config, apply }`）、类（`class X extends Service`，`static inject`/`static Config`）。
教程：`docs/user/develop/basic/index.md:105-138`。

### 2.2 生命周期状态机

`docs/user/develop/framework/index.md:7-25`：`PENDING → LOADING → ACTIVE`，失败进 `FAILED`；`ACTIVE → UNLOADING → DISPOSED`。
- 依赖服务消失 → 自动卸载；服务回来 → 自动重载（`framework/index.md:38`）。
- **所有通过 ctx 做的注册都是可逆 effect**，卸载自动撤销（`ctx.on` / `ctx.tools.register` / `ctx.llm.registerAdapter` / `ctx.effect`）。
- disposer 逆序启动但并发执行，顺序敏感的清必须放进同一个 `ctx.effect()`（`framework/index.md:63`）。
- HMR：`packages/bundle/base/cordis.patch.yml` 的 `hmr` 行默认 `disabled: true`，需要 profile 打开；`docs/user/develop/framework/index.md:99-107`。

### 2.3 ctx 提供的能力（真实方法表）

| 能力 | 来源 | 说明 |
|---|---|---|
| `ctx.on(name, fn, opts?)` / `ctx.once` | `vendor/cordis/src/events.ts:288, 312` | 事件监听，卸载自动移除 |
| `ctx.emit` / `ctx.bail` / `ctx.serial` / `ctx.parallel` / `ctx.waterfall` | `events.ts:194/217/…/234` | 五种派发模式（`docs/cordis-primer.md:17-27`） |
| `ctx.effect(fn, label?)` | `vendor/cordis/src/fiber.ts:415-418` | 注册资源+disposer，返回 `Disposable` |
| `ctx.inject(deps, cb)` | `registry.ts:300` + `context.ts` 声明合并 | `ctx.plugin({inject, apply: cb})` 的语法糖 |
| `ctx.plugin(plugin, config?)` | `registry.ts:316` | 挂子 fiber |
| `ctx.get(name)` / `ctx.provide` / `ctx.set` / `ctx.accessor` | `vendor/cordis/src/reflect.ts:233/277/254/345` | 服务树按 key 解析（可选依赖 + 可选降级） |
| `ctx.registry` | `registry.ts:195-295` | 插件注册表 introspection |

### 2.4 服务（Service）声明与实现解耦：capability seam

- 定义：`docs/architecture.md:110-113`「A seam is a swappable capability with three roles: Service Definition（声明接口）/ Service Provider（实现）/ Consumer（通常是 model-facing tool）」。
- 可视化图谱（自动生成，列出每个 seam 的声明包、已知实现、直接消费者）：`docs/capability-seams.md`（约 340 行 mermaid）。
- 声明方式：`class X extends Service` + `declare module '@deepseek-ai/cordis' { interface Context { xxx: X } }`。
  范例：`packages/core/system-prompt/src/index.ts:13-16, 389-405`（`ctx.systemPrompt`）、`packages/interaction/commands/src/index.ts:106-110, 254-267`（`ctx.commands`）。
- 实现可替换：由 patch 行选择 provider 包，例如 `packages/bundle/base/cordis.patch.yml:145-160` 选 `dsh-storage-json`/`dsh-storage-domain`，`sandbox` 行选 `dsh-sandbox-local`。
- 一个服务可以被 `isolate:` 出独立 realm（`docs/user/develop/framework/service.md` 末尾）。

### 2.5 「官方运行时动态插件」这条额外通道

`packages/extensions/tool-cordis` + `packages/extensions/cordis-host-runner` + `cordis-client-runner`：模型可用 7 个工具（`cordis_inspect_list/query/self`、`cordis_define`、`cordis_run`、`cordis_stop`、`cordis_undefine`，`packages/extensions/tool-cordis/src/index.ts:45-355`）在**进程内**定义并运行一个 cordis 包（host half 跑在 `node:vm`，browser half 需人在页面上批准），定义只存在内存、重启即失。`packages/extensions/cordis-host-runner/src/index.ts` 里有 `awaiting-approval` 状态与 `approvalRequestId`。

---

## 3. 提示词装配（System Prompt）

实现包：**`packages/core/system-prompt`**（`ctx.systemPrompt`）。

### 3.1 注册面（API）

`packages/core/system-prompt/src/index.ts`：

| API | 行 | 说明 |
|---|---|---|
| `section({ name, order, text, complete? })` | `:432-441` | 有序段；`text` 可为字符串或 `(ctx)=>string` |
| `context({ name, order, text })` | `:467-476` | **动态运行时上下文**（作为 durable user-role snapshot 注入，不是 system prompt） |
| `tools(provider)` | `:499-505` | 贡献本 assembly 的工具 schema（`{schemas, knownNames?}`） |
| `variable(name, provider)` | `:515-524` | 注册 `{{name}}` 模板变量 |
| `suppressRuntimeContext()` | `:484-490` | 关闭运行时上下文快照 |
| `getSectionOrder(name)` / `getContextOrder(name)` | `:448-459` | 查中央分配的位置常量 |
| `assemble(context?)` | `:536-611` | 组装并跑 waterfall |

### 3.2 数值 order 表（中央分配，避免撞车）

`SECTION_ORDERS`（`:121-152`）：
`HARNESS_IDENTITY -1000` → `HARNESS_SOURCE -900` → `WEB_SURFACE -800` → `DEPLOYMENT_PERSONA 0` → `PLAN_POLICY 500` → `TEAM_POLICY 600` → `PTC_ONLY 800` → `FILE_REFERENCE 900` → `TOOL_BASH 1000` … `TOOL_SUBAGENT 2800` → `TOOLS_SDK 5000` → `DELIVERABLE_FILE_REFERENCES 9000` → `STRUCTURED_OUTPUT 9900`。
`CONTEXT_ORDERS`（`:157-161`）：`SANDBOX_POLICY 110`、`APPROVAL_POLICY 115`、`SUBAGENT_DELEGATION 120`。
同 order 时按 name 的 code-unit 排序（`:227-229`）。`order` 必须是有限数，否则 throw（`:433-435`）。

### 3.3 组装流程

`assemble()`（`:536-611`）：
1. 取 scope 链上的 layers（`@deepseek-ai/dsh-scope` 的 `ScopedLayers`），scoped 值覆盖 global；
2. 收集 sections/contexts/tool providers/variables；
3. `orderTools()`（`:205-219`）按插件 `Config.toolOrder` 排列工具，必须有 `TOOL_ORDER_REST ('<unlisted-tools>')` 占位；
4. `await ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', assembly, context, ...)`（`:601-604`）；
5. waterfall 返回值权威；但若有 `complete: true` 的段，**waterfall 之后会把它还原成唯一的 section**（`:605-611`），因此 complete 段之后的监听器加不进任何文字。

渲染：`renderPrompt()`（`:263-268`）逐段 `interpolate` 后按 `\n\n` 连接；`renderContextSnapshot()`（`:275-291`）生成 `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.` 前缀块。

### 3.4 `{{变量}}` 模板

- 语法校验：`VARIABLE_NAME = /^[a-z][a-z0-9_]*$/`（`:175`），未知变量/未定义值/畸形引用**都 throw**（`:317-346`）。
- 官方内置变量：`provider`、`model`、`cwd` —— `packages/core/agent-loop/src/index.ts:421-423`：
  ```ts
  ctx.systemPrompt.variable('provider', c => c.agent?.options.provider)
  ctx.systemPrompt.variable('model',    c => c.agent?.options.model)
  ctx.systemPrompt.variable('cwd',      c => c.agent?.session.header.cwd)
  ```
  → 所以 `{{cwd}}` 来自 agent-loop，**不是** system-prompt 包本身。

### 3.5 插件能改到什么程度？

| 诉求 | 官方支持？ | 方式 |
|---|---|---|
| 新增段 | ✅ | `ctx.systemPrompt.section({ name:'my:thing', order: 3000, text })`（自选 order，或 `getSectionOrder` 已有槽位） |
| 新增运行时上下文 | ✅ | `ctx.systemPrompt.context()` |
| 新增工具 schema（不注册工具） | ✅ | `ctx.systemPrompt.tools()` |
| 新增模板变量 | ✅ | `ctx.systemPrompt.variable()` |
| **改写他人全局段** | ❌ | 同层同名 → `NamedEntries` **直接 throw**（`:367-375`）。只能在 **scoped 层（`agent.ctx`）** 用同名段 shadow 全局段（`:424-431` 注释 + `packages/preset/persona/src/index.ts:1-14`） |
| **删除他人段** | ❌ | 无 delete API，只能靠 `complete: true` 段整体顶掉全部 section，或在 composition 里 `disabled: true` 掉产出该段的插件行 |
| 整段替换（部署级） | ✅ | `system-prompt` 行自己的 `config.persona`（`Config.persona`，`:246`）；注意它是 `deployment:persona` 段的初值，插件可通过 scoped 同名段覆盖 |
| 整段接管 waterfall | ✅ | 监听 `system-prompt/assemble`（`@mode waterfall`，`:31`），但必须自己保留 PTC/structured-output 协议贡献（`docs/cookbook/extension-cookbook.md:100`） |

`complete` 段冲突：同时两个生效 → 组装直接失败（`:574-577`）。

---

## 4. 工具注册、过滤、审批

实现包：**`packages/core/tools`**（`ctx.tools`，`ToolRuntime`）。

### 4.1 注册

- `ctx.tools.register(definition)`（`:1028-1053`）→ 返回 disposer。
- `ToolDefinition`（`:214-280`）必填 `name`/`description`/`parameters`/`output{schema,render,presentationMeta?}`/`execute`；可选 `finalizeContent`、`timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult`。
- 名字冲突：同层重名 throw（`:718-721`）；`run_code` 名字**永久保留**（`:1045-1047`）。
- 注册后 schema 自动进入 prompt assembly（`docs/architecture.md:127`「register on `ctx.tools`; its schema joins prompt assembly」）。
- 校验：`assertSupportedJsonSchema`、`defineTool`（`src/schema.ts`）、输出契约 `assertObjectJsonSchema`。

### 4.2 过滤 / 权限 / 审批的执行顺序

`prepareExecution()`（`:1458-1500`）：

```
tools/pre-execute (waterfall)  →  若返回 ask → ctx.approval.request()
      →  guard 链（单调否决，只能拒不能许）  →  dispatch
      →  tools/execute (waterfall, 只能改 exec.signal)  → body
      →  tools/post-execute (waterfall: accept/block/替换 content)
      →  tools/result (emit, 只观察, 失败被吞)
```

| 机制 | API | 位置 |
|---|---|---|
| 可重排策略层 | `ctx.on('tools/pre-execute', (exec, next) => …)` 返回 `{kind:'allow'|'deny'|'ask'}` | `:144` 声明，`:1466` 调用；范例 `docs/cookbook/extension-cookbook.md:11-33` |
| **ask→审批门** | `serviceAsk()` 调 `ctx.get('approval')!.request({agent, toolName, callId, reason, signal})`；`allowed-once` 放行，`rejected`/`cancelled`/`unavailable`/无 approval 服务 **全部拒绝** | `:1680-1720`（fail-closed） |
| 单调 guard | `ctx.tools.guard(exec => string | undefined)`，任何匹配 guard 拒绝即拒，谁也不能 force-allow | `:1101-1119` |
| **作用域工具过滤** | `ctx.tools.restrict({allow?, deny?})`，**必须在 `agent.ctx` 上调用**（全局层调用直接 throw），过滤「继承来的一切」，豁免「本层自己注册的」 | `:1062-1089`，`view()` `:1143-1150` |
| subagent 的 `toolFilter` | 请求字段 → `childCtx.tools.restrict(composition.toolFilter)` | `packages/subagent/subagent/src/child-agent.ts:163, 217` |
| 沙箱层拒绝 | 不是工具层的事，在 fs/shell 后端（见 §8） | `packages/fs/tool-fs/src/sandbox.ts`、`packages/sandbox/sandbox/src/escalation.ts` |
| 包装 dispatch（超时/重试/指标） | `ctx.on('tools/execute', …)`，只可替换 `exec.signal` | `:155`；`packages/guard/timeout-policy` 是范例 |

审批服务本体：**`packages/interaction/user-approval`**（`ctx.approval`，`ApprovalService`），返回 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`；审计事件 `approval/asked` / `approval/decided` 写入 session log（`:211` 附近）；策略 `approval/policy: 'ask' | 'never'`（`setApprovalPolicy`）。

`authorization`（`packages/credentials/authorization`，`ctx.authorization`）是 **凭据/OAuth 授权流注册表**，与工具审批是两件不同的事，别混淆。

---

## 5. 斜杠命令（`/xxx`）

实现包：**`packages/interaction/commands`**（`ctx.commands`，`CommandRuntime`）。

- 注册：`ctx.commands.register({ name, description, input?: {hint, images?}, recordInput?, handler })`（`:274-281`）。
- 名字规则：`/^[a-z][a-z0-9_-]*$/`（`:30, 173-175`）；`description` 非空；`handler` 必须函数（`:176-184`）。
- **冲突**：同层重名 → `NamedEntries.insert` throw：
  - global：`command "x" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)`（`:95-97`）
  - scoped：`command "x" is already registered in this scope`
  - **scope 层可 shadow global**（`:249-253` 类注释 + `view()`）。
- 解析：`parseCommand(line)`，正则 `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/`（`:118-125`）→ `{name, rawInput}`。
- 执行不经模型：handler 返回 `{kind:'success', text?, sourceEventSeq?}` 或 `{kind:'error', text}`（`:219-247`），日志事件 `command/run` + `command/done`。
- 范例：`packages/goal/command-goal/src/index.ts`（`export const inject = ['commands','goals']`）、`packages/compaction/command-compact`、`packages/feedback/command-feedback`。
- 客户端 `/` 菜单来自另一个注册表：`ctx.inputTriggers.registerSource()`（`packages/client/ui-input-trigger/src/client/service.ts`），冲突信息是 `slash source "/xxx" is already registered`（同文件 `:52`）。

> 你提到的 “already queued / name taken” 在本仓库里没有这两个字面量。命令侧的真实冲突文案见上；输入框的“排队”是另一套（`packages/client/ui-conversation/src/client/queue`、gateway 的 `journal-stream` 排队缓冲），与命令命名无关。

---

## 6. UI 扩展（官方 Web 客户端）

### 6.1 三层结构

1. **slot 注册核心**：`packages/client/ui-slots`（`SlotMap` 声明合并 + `kind: single|list|keyed|chain`、`scope: root|session-maybe|session`，`src/index.ts:26-130`）。
2. **各域声明自己的 slot**（`declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { … } }`）：
   - 会话标题旁：`'conversation.session.header.actions'`（list/session）、`'conversation.session.header.utilities'`、`'conversation.session.header.lineage'` — `packages/client/ui-conversation/src/client/contract/slots.ts:93-130`
   - 输入框周边：`'conversation.input.dock'`、`'conversation.composer.bar'`、`'conversation.input.left/right'`、`'conversation.composer.dock'`（同文件 `:190-200`）
   - 设置页：`'settings.section'`（list/root，带 `id/order/label`）、`'settings.plugins.tab'`、`'settings.action'`、`'settings.trigger'` — `packages/client/ui-settings/src/client/contract/slots.ts:15-70`
   - 右侧 dock：`'details'`（single/session，由 `ui-layout` 声明，`src/client/index.ts:75`；被 `ui-chat` 占位并声明子槽 `'conversation.details.tool'`，`packages/client/ui-chat/src/client/apply.ts:163`）
   - 工具卡片：`'tool.call.toolview'`（**keyed by 工具名**）、`'tool.call.images'` — `packages/client/ui-tool/src/client/contract/slots.ts:11-47`
   - 整页悬浮层：`'shell.overlay'`（list，点击穿透），`'root'` 是**替换整个框架**的危险槽（`packages/client/ui-renderer/src/client/registry.ts:28-40`）
3. **渲染器**：`packages/client/ui-renderer` 提供 `ctx.slots.register / inject / renderSlot`。

### 6.2 插件注册一个组件的真实写法

`packages/client/ui-jobs/src/client/index.ts`（完整 20 行，可直接照抄）：

```ts
export const inject = ['sessions', 'slots', 'locale']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register(
      { name: 'conversation.session.header.actions', id: 'job-list', order: 20, locale: NS },
      JobListAction,
    ),
  )
}
```

`ui-agent-preset` 同时往 `conversation.session.header.actions` 和 `settings.section` 注入（`packages/client/ui-agent-preset/src/client/index.ts:159, 196`）。

### 6.3 `dsh.client` 清单与 `dsh.client.inject` 到底干什么

`packages/client/modules/src/index.ts`：

| 字段 | 位置 | 语义 |
|---|---|---|
| `dsh.client.platform` | `:208-210` | 平台标签（如 `web`），必填字符串 |
| **`dsh.client.inject`** | `:210, 55, 69` | **包名数组**。双重用途：① 浏览器 boot 时「这些包的 factory 必须先到达」的依赖边（`packages/client/modules/src/client/manifest.ts:43-66`：`inject` names package rows whose factories must arrive before this row materializes）；② 同一条边也用于 cordis 客户端插件组合顺序（`client/manifest.ts:5-8`） |
| `dsh.client.immediately` | `:212-214, 55` | 一阶段预取（bootstrap 批次里先行加载 script） |
| `dsh.client.external` | `:211, 57-65` | 额外向模块表请求的非基线 specifier（含子路径） |

注意：`inject` 是**包名依赖排序**，不是 cordis 服务注入；真正的服务依赖仍写插件模块里的 `export const inject`。

### 6.4 前端产物如何被客户端加载

`packages/client/modules`（node half，服务名 `ctx.clientModules`）：
- `static inject = ['webServer', 'loader']`（`:534`）；
- 监听 Loader 的 `internal/plugin` 事件，**增量扫描**活着的 entry，读其包 `package.json` 的 `dsh.client`（`:1-24` 模块头）；
- 组成 `window.__DSH_BOOT__` 图（`WebBootGraph`），把注册门面、preload、bootstrap script 通过 `ctx.on('webserver/index-inject', …)`（`:589`）塞进 webserver 的 index 注入表；
- 每包一个 `./client` 导出（`exports["./client"]`），**缺产物时报** `client-modules: client bundle not found; run pnpm run build before launch`（`:106-121`）；
- 声明了 `dsh.client` 却没有 `./client` 导出（或反之）→ `scripts/verify-cordis-config.ts` 的 `validateClientHalvesDeclared()` 直接判构建失败。

结论：**前端不是 iframe/远程加载**，是宿主机把每个客户端包的 `lib/client.js` 组合成 combo script 端点 + 一张 boot graph，浏览器端用 `ClientModuleSystem` 物化。

### 6.5 UI 能改到什么程度

- 新增 slot 占位（往别人声明的 list/keyed 槽里加东西）：✅ 官方。
- 替换 single 槽的占位者：✅（`kind:'single'`，动态注册优先级低于内置，因此「你赢」——见 `ui-renderer/src/client/registry.ts:31-40` 关于 `root` 的警告）。
- **新增一个槽位名**：只有声明该槽的 owner 能做（`SlotMap` 声明合并 + `register(name, Comp, {children})`）；第三方包要加新槽，等于改 owner 包的 TypeScript 声明 —— 属于扩展点但不属于「纯配置」。
- 给已有业务行加渲染：`ConversationNodeDefinition` + `conversation.chat.node` keyed 渲染器（`docs/cookbook/extension-cookbook.md:127`）。

---

## 7. 安装与市场

### 7.1 `dsh plugin add` 到底做了什么

`apps/cli/src/plugin.ts`：

```ts
export function runPlugin(profile, args): number {
  // 1. profile 不存在 → initProfile（内置模板或 DEFAULT_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base']）
  // 2. before = readProfileManifest()
  // 3. spawnSync('pnpm', args.map(anchorPathSpec), { cwd: profileDir, stdio:'inherit', shell: win32 })
  // 4. exitCode === 0 → reconcilePlugins(before, dir)
}
```

- **完全是 pnpm 转发**：任何 pnpm verb 都能用；`add <tarball-url>`、`add github:you/x`、`add ./dir` 都只是 pnpm 的 spec（`anchorPathSpec` 只把相对路径锚定到用户的 cwd，`:104-112`）。
- `reconcilePlugins()`（`:59-91`）：pnpm 成功后，按**安装后的真实依赖名**逐个 `resolveBundleDir` + 读 `dsh.bundle.patch`：
  - 是 bundle 且不在 `dsh.profile.bundles` → 追加；
  - 不再是 bundle（被删/新版本去掉声明）→ 从列表移除；
  - 新装的普通库 → 打印 warning：`declares no dsh.bundle — installed as a plain dependency, not a profile layer`。
  - 模板 bundle（dsh-base 等）不是 dependency，永不被移除（`:78-81`）。
- **没有 postinstall**：全库 grep `postinstall` 只有根 `scripts/install-lefthook.mjs` 和 `packages/subprocess/subprocess-local` 的 spawn helper。profile 的 `dsh.profile.bundles` 只由这个 CLI 函数写。

### 7.2 市场（dsh-plugin.org / awesome-dsh-plugin）

- 本仓库**零代码**（grep `dsh-plugin.org`、`marketplace`、`awesome-dsh` 在 `packages/ apps/ docs/` 全无命中）。
- 网上现存的市场（`dsh-plugin.org`、`dshpluginhub.ai`、`dshplugin.dev`、`dshplugin.store`、`dshhub.org` 等）都是**社区站点**，其上架的 `dshmarket` / `dsh-plugin-market` 本身就是普通 dsh 插件（host half + web client half），安装命令就是 `npx -y @deepseek-ai/dsh plugin --profile web add dshmarket`。
- 所以「市场注册」= 发布一个 npm 包 + `dsh.bundle` +（可选）`dsh.client`，再由站点抓 `dsh-plugin` GitHub topic 或人工收录；**官方没有市场协议**。

### 7.3 一键安装为什么容易失败（代码可证的原因）

1. **没有 host 侧安装服务**：pnpm 只在 `apps/cli/src/plugin.ts` 被 spawn。UI 里点“安装”的插件必须自己 `spawn('pnpm', …)`，且 `cwd` 必须是 `$DSH_HOME/profiles/<name>`，还要自己重写 `dsh.profile.bundles`（`reconcilePlugins` 是 CLI 私有函数，未导出）。
2. **pnpm 不在 PATH**：`plugin.ts:142` `dsh: pnpm not found on PATH — install pnpm to manage profile plugins`。
3. **装了也不会立刻生效**：bundle 层只在 `loadProfile`（`profile.ts:805-844`）读一次；`patchReload: 'live'` 只 watch `cordis.patch.yml`（`app-boot/src/index.ts:235-265`），**不 watch `dsh.profile.bundles`**。必须重启进程。
4. **前端产物同理**：`dsh.client` 由客户端模块系统从**活着的 Loader entry** 扫描（`packages/client/modules/src/index.ts`）；没有 entry 就没有 browser 代码，装完也得重启。
5. **pnpm ≥10 拦 git 依赖的 `prepare`**：`docs/user/develop/basic/publish.md:153-178` 明确写了要先在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds:`，`plugin.ts:155-159` 也会在失败时打这条提示。
6. **Windows**：`spawnSync` 需要 `shell: true`（`plugin.ts:134-138`，CVE-2024-27980 硬化后）。

---

## 8. 沙箱 / 权限 / host 策略：在哪、能不能改

| 机制 | 服务/包 | 关键文件 | 官方修改途径 |
|---|---|---|---|
| **沙箱策略（模式 + workspaceRoot）** | `ctx.sandboxPolicy` / `packages/sandbox/sandbox-policy` | `src/index.ts`（`Config{mode, workspaceRoot}`，默认 `read-only` 的 fail-safe；`sandbox/mode` 事件 + `sandboxMode` projection） | patch `- id: sandbox-policy config: {...}`（`packages/bundle/base/cordis.patch.yml:214-219`，用 `!!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`）；运行时调服务写 `sandbox/mode` |
| **沙箱后端（bwrap/landlock/seatbelt/none）** | `ctx.sandbox` / `packages/sandbox/sandbox-local`、`sandbox-windows-acl` | 同上 | 换 provider 行 |
| **审批策略 `ask`/`never`** | `ctx.approval` / `packages/interaction/user-approval` | `src/index.ts`（`setApprovalPolicy`、`ApprovalService.request`） | patch `- id: approval config: {policy: …}`（`base:230-233`）；运行时 `ctx.approval.setPolicy(agent, …)` |
| **权限预设（三档打包）** | `ctx.permissionPresets` / `packages/interaction/permission-presets` | `src/types.ts`（`PresetSpec{sandbox, approval, name?, description?}`）、`src/index.ts` | patch `- id: permission config: { presets: {…} }`（`base:235-247`），可自定义/新增档位；settings 命名空间 `permission` |
| **工具限制** | `ctx.tools.restrict()`（scoped）、`ctx.tools.guard()` | `packages/core/tools/src/index.ts:1062-1107` | 只能由**插件代码**在 `agent.ctx` 上调用；没有 YAML 级「工具 allowlist」字段 |
| **host 平面（默认组合）** | 就是 `packages/bundle/base/cordis.patch.yml` + `packages/bundle/web-app/cordis.patch.yml` 的插入行 | — | 用户/第三方在 `cordis.patch.yml` 里按 `id` 覆盖或 `disabled: true` |
| **每会话的 agent 组合（“默认拷贝”）** | `ctx.agentPresets` / `packages/preset/agent-presets` | `presets/{standard,ptc,cordis,minimal}/{preset.yml,agent.cordis.yml}`；`discovery.ts`（`COMPOSITION_FILE='agent.cordis.yml'`、`USER_PRESET_DIR='.agent-presets'`、`SHIPPED_PRESET_ROOT`）；`authoring.ts`（`copyComposition` 整目录拷贝，`writableRoot` 只允许 trust==='user' 的根）；`composition-inventory.ts`（`CompositionRowEnablement`，读活挂载或读文件） | **官方**：在 `$DSH_HOME/.agent-presets/<id>/` 放 `agent.cordis.yml` 即可（discovery 每次重读，无需重启）；网页里只能「复制已有预设再改」或删除（`@Remote('copy'|'deletePreset'|'select'|'list'|'read')`，`src/index.ts:260,512,564,602,694`），**不能在线编辑文本**（`authoring.ts:10-16` 明确「No caller supplies composition text」） |
| **内置预设不可写** | `presets/` 在包内，`trust: 'system'`，`notWritable` 抛 `agent-preset/read-only` | `authoring.ts:23-31` | 只能复制 |

**「插件有没有官方途径改这些？」**

- 改**自己会话的**策略：✅ 通过服务 API（`ctx.approval.setPolicy`、`ctx.tools.restrict` on `agent.ctx`、`sandbox/mode` 事件）。
- 改**部署默认**：✅ 但路径是 **compose 层**（`cordis.patch.yml` 覆盖 `approval`/`permission`/`sandbox-policy`/`tools` 行的 config），不是插件代码里硬改；插件代码拿到的 `ctx.approval.config` 等是只读的已解析配置。
- 想改 `packages/bundle/base/cordis.patch.yml` 或 `dsh-base` 的默认行 → 那是安装目录里的文件，**升级会被覆盖**，不是扩展点。
- 没有任何官方途径让插件「关掉审批门」或「绕过沙箱」——`serviceAsk` 在无 approval 服务时 fail-closed（`:1685-1689`），`sdk-minimal` 才显式 pin `danger-full-access`。

---

## 9. 数据与配置持久化

### 9.1 插件配置（compose 级）

- 位置：**`cordis.patch.yml` 的行 `config:` 字段**（`EntryOptions.config`，`vendor/loader/src/config/entry.ts:9-22`）。
- 解析：`apply` 第二参数，先过插件的 `Config` schema（`docs/user/develop/basic/config.md`）。
- 运行时改配置：Loader 的 `internal/update` 钩子会写回**所属 tree 的文件**（`vendor/loader/src/index.ts:104-110`）。但 profile 的根 include 指向的是 `<profile>/cordis.yml`，而该文件**每次启动都被重写为 `[]`**（`apps/cli/src/profile-boot.ts` 的 `PROFILE_ROOT_CONFIG`）——所以**通过 fiber 改配置不会持久化**。要持久化请改 `cordis.patch.yml`（`live` profile 会热加载）或用下面的 settings。

### 9.2 用户设置（官方持久化面）

`packages/settings`（seam `ctx.settings`）+ `packages/settings/settings-file`（YAML 后端，默认 `$DSH_HOME/settings.yaml`）。

```ts
// packages/settings/settings/src/index.ts:409-465
const scope = ctx.settings.register('my-plugin', Schema.object({...}), {
  base: <composition 里该行的 config 子集>,   // SettingsRegisterOptions.base
  applies: 'live' | 'restart',               // 默认 'live'，仅用于向配置 UI 声明生效时机
  validate?: (value) => void,                // schema 表达不了的跨字段约束；抛错即拒绝这次写入
})
scope.get()            // 当前解析值
scope.watch(cb)        // 提交后回调
scope.update(patch)    // 合并持久化
scope.replace(section) // 整节替换
```

- 命名空间冲突：`settings namespace "x" is already registered`。
- 注册是 effect，随插件卸载撤销；非法存量值让**注册本身失败**（最早可判定点）。
- 后端 `settings-file` 带跨进程写锁 + 保留注释的 leaf diff + chokidar 热发布（`packages/settings/settings-file/src/index.ts:1-40`）。
- 官方范例：`permission`（`PERMISSION_SETTINGS_NAMESPACE`）、`agent-presets`（`SETTINGS_NAMESPACE='agent-presets'`）、`subagent` 的 model-selection settings 行。

### 9.3 非会话数据存储 / SQLite

- Hub：`packages/storage/storage`（`ctx.storage`，只做注册表，不 IO）。
- 后端：`storage-json`（文件树）、**`storage-sqlite`**（`node:sqlite` 的 `DatabaseSync`，一库多 unit，`key TEXT / value TEXT` JSON 行；`Config{path, journalMode='wal'}`；注册 backend 名 `sqlite`）。
- 数据形态：`storage-domain`（`ctx.storageDomain`，`defineDomain({global, tables})` + zod schema，`domainTable<K,V>(schema)`，见 `packages/storage/storage-domain/src/spec.ts:91-154`）。
- **插件能不能用 SQLite？**
  - ✅ 官方支持的方式：`ctx.storageDomain` 建 domain（底层路由到 `sqlite` backend），或自己实现一个 `StorageBackend` 注册到 `ctx.storage.backend`。
  - ⚠️ `storage-sqlite` 只暴露 `kv` facet（`SqliteStorageBackend.kv` 只实现 `{ open(descriptor) }`；`SqliteKvUnit` 的 `tables`/`globalUpsert`/`globalSelect` 全是 `private`），**不导出裸 `DatabaseSync`** 给插件做任意 SQL。想要原生 SQL 表，要么写自己的 backend 包，要么直接 `import { DatabaseSync } from 'node:sqlite'`（进程级旁路，不受 storage hub 管理，也不受沙箱保护）。
  - 另一条官方 SQLite 用法参考：`packages/session-query-sqlite`（会话检索索引，`path: ':memory:'`、`openAt: 'never'|'first-search'`，见 `packages/bundle/web-app/cordis.patch.yml:27-33`）。
- 会话语义数据不要放 storage：session log 是唯一事实来源（`docs/architecture.md`「Model-visible means logged」）。

---

## 10. 汇总对照表：官方扩展点 vs. 只能改源码

### ✅ 官方支持（不改任何已发布代码）

| 目标 | 接口 |
|---|---|
| 新增工具 | `ctx.tools.register(ToolDefinition)` / `defineTool` |
| 拦截/拒绝工具调用 | `ctx.on('tools/pre-execute')`、`ctx.tools.guard()`、`ctx.on('tools/post-execute')` |
| 审批问答 | `tools/pre-execute` 返回 `{kind:'ask'}` + `ctx.approval` |
| 新增斜杠命令 | `ctx.commands.register()` |
| 新增提示词段/上下文/变量/工具 schema | `ctx.systemPrompt.section/context/variable/tools` |
| 整段接管提示词 | `system-prompt/assemble` waterfall；或 `complete: true` 段 |
| 换模型供应商 | `ctx.llm.registerAdapter()` |
| 换文件/子进程/沙箱/编码运行时/skill 等 | 实现对应 seam provider 包并改 compose 行 |
| 浏览器 UI 组件 | `ctx.slots.register/inject` 到已声明槽（header.actions / settings.section / details / tool.call.toolview / shell.overlay …） |
| 前端包发布 | `dsh.client` + `exports["./client"]` |
| 每会话 agent 组合 | 用户预设目录 `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`（+`preset.yml`） |
| 部署级覆盖任何行 | `cordis.patch.yml` 按 id 覆盖 / `disabled: true` |
| 持久化插件设置 | `ctx.settings.register(ns, schema, {base})` |
| 非会话数据 | `ctx.storageDomain` / 自写 `StorageBackend` |
| 安装分发 | npm / tarball / git + `dsh.bundle.patch` |

### ❌ 官方没有提供（只能改包源码 / 自己造）

| 诉求 | 现实 |
|---|---|
| patch 里「删除」某行 | 无 `remove`；只能 `disabled: true`（仍占位、仍可能被后续 patch 命中） |
| 全局层覆盖/删除别人的 prompt 段或工具 | 无；同层重名 throw，只能在 `agent.ctx` scoped 覆盖 |
| YAML 级工具 allowlist | 无；只有代码里 `ctx.tools.restrict()` |
| 在线编辑 agent 预设文本 | 无；只有「复制」和「删除」（`authoring.ts`） |
| host 侧「安装插件」服务 / 官方市场 | 无；pnpm 只在 CLI，市场全在社区 |
| 热安装即生效（无需重启） | 无；bundle 层与 `dsh.client` 扫描都基于启动时组合 |
| 让插件持久化自己的 config 到 compose 层 | 无稳定面；用 settings 命名空间 |
| 绕过审批 / 沙箱 | 无（fail-closed） |
| 给 slot 表新增槽位名而不改 owner 包 | 不能（`SlotMap` 是编译期声明合并） |
| 从 `storage-sqlite` 拿裸 SQL 句柄 | 无（只有 kv facet） |

---

## 附：关键证据文件索引

```
packages/boot/app-boot/src/profile.ts            # bundle/profile 清单、合并、模块 fallback（862 行）
packages/boot/app-boot/src/index.ts              # boot()、mountRootInclude、watchUserPatches、HARNESS_SOURCE 段
apps/cli/src/plugin.ts                           # dsh plugin → pnpm 转发 + reconcilePlugins
apps/cli/src/profile-boot.ts                     # prepareProfile（重写 cordis.yml = []）
apps/cli/src/args.ts                             # profile / plugin / dump-config 三种模式
vendor/include/src/index.ts                      # applyEntryPatches —— patch 唯一权威语义
vendor/loader/src/config/entry.ts                # EntryOptions{id,name,config,group,disabled,inject}
vendor/loader/src/index.ts                       # entry.inject 合并、internal/config 求值、internal/update 写回
vendor/cordis/src/registry.ts                    # Plugin.Base、Inject 类型、ctx.inject/ctx.plugin
packages/core/system-prompt/src/index.ts         # SECTION_ORDERS、SystemPrompt、assemble/renderPrompt
packages/core/agent-loop/src/index.ts:421-423    # provider/model/cwd 变量
packages/core/tools/src/index.ts                 # 工具流水线、register/restrict/guard、approval 桥
packages/interaction/commands/src/index.ts       # 命令注册与冲突
packages/interaction/user-approval/src/index.ts  # ctx.approval
packages/interaction/permission-presets/src/     # 三档权限预设
packages/sandbox/sandbox-policy/src/index.ts     # ctx.sandboxPolicy
packages/preset/agent-presets/                   # 预设发现/挂载/复制/组合清单
packages/settings/settings/src/index.ts          # ctx.settings.register
packages/storage/{storage,storage-domain,storage-sqlite}/
packages/client/ui-slots/src/index.ts            # SlotMap / kind / scope
packages/client/ui-conversation/src/client/contract/slots.ts
packages/client/ui-layout/src/client/index.ts    # 'details' 等框架槽
packages/client/ui-settings/src/client/contract/slots.ts
packages/client/ui-tool/src/client/contract/slots.ts
packages/client/modules/src/{index.ts,client/manifest.ts}  # dsh.client 扫描 + __DSH_BOOT__ 图
packages/extensions/{tool-cordis,cordis-host-runner,cordis-client-runner}/  # 运行时动态插件
packages/bundle/{base,web-app}/cordis.patch.yml  # 官方默认组合（行 id 的权威来源）
docs/cookbook/extension-cookbook.md              # 特性 → 机制 对照表（最有用的一页）
docs/user/develop/{basic,framework}/*.md         # 官方插件教程
docs/architecture.md                             # seam / 事件扩展点
docs/capability-seams.md                         # 全部 seam 图谱
```
