# GuaDa 三方插件开发契约（PluginApi v2）

> 适用：`backend-ts` 插件系统 v2（2026-11 起）
> 参考实现：[`donggua-zen/guada-purge`](https://github.com/donggua-zen/guada-purge)
> 本文是三方插件作者的唯一契约来源；宿主内部实现细节不构成契约。

---

## 1. 插件形态

三方插件是一个**目录**，宿主按目录名扫描并 `require` 入口文件：

```text
<plugin-dir>/
  manifest.json          # 必需
  index.js               # 后端入口（CommonJS，零依赖最佳）
  frontend/dist/*.js      # 可选：前端产物（IIFE）
  frontend/dist/*.css     # 可选
  assets/                 # 可选：图标等
  lang/zh.json            # 可选：语言包
  skills/                 # 可选：自带技能（由插件自己读取）
  presets/                # 可选：插件自己的预设
```

扫描目录（优先级从高到低）：

| 来源 | 环境变量 | 说明 |
|---|---|---|
| `builtin` | `PLUGINS_BUILTIN_DIR` | 随安装包分发（只读） |
| `user` | `PLUGINS_USER_DIR` | 用户安装目录 |
| `dev` | `PLUGINS_DEV_DIR` | 开发目录（仅 dev 模式注入） |

加载流程（`backend-ts/src/modules/plugins/external/external-plugin-loader.ts`）：

1. 读取 `manifest.json` → `validateManifest`（id/name/version/description/apiVersion）；
2. `require(index.js)` → 取 default / 命名导出 / CommonJS 直出类；
3. 用 `manifest.json` 覆盖类内 `manifest`，注入 `source` 与 `pluginPath`；
4. `registerPlugin` → `new PluginApiImpl(...)` → `plugin.onLoad(api)`；
5. `api.flush()` 把工具/提示词/slot/主题/命令/Hook 写入注册表；
6. 按启用态调用 `onStart`。

**硬性约束**：插件只能使用 `onLoad(api)` 暴露的 API，不得 `require` 宿主内部模块；不得修改宿主文件。

---

## 2. manifest.json

```jsonc
{
  "id": "my-plugin",                 // 必需，[A-Za-z0-9][A-Za-z0-9._-]*
  "name": "My Plugin",               // 必需
  "version": "1.0.0",                // 必需（semver）
  "description": "...",              // 必需
  "author": "...",
  "category": "user",                // system | core | extended | user
  "essential": false,                // 外部插件会被强制改为 false
  "icon": "assets/icon.svg",         // 相对插件根
  "main": "index.js",                // 入口；缺省 index.js
  "apiVersion": 2,                   // 声明使用的 PluginApi 版本；缺省 1
  "permissions": ["prompt", "fs"],   // 权限声明（安装确认/审计展示）
  "configSchema": { },               // 可选：JSON Schema（下期市场自动表单）
  "entries": {                       // 可选：显式入口
    "backend": "index.js",
    "frontend": "frontend/dist"
  }
}
```

### apiVersion 兼容

- 宿主支持的最高版本：`PLUGIN_API_VERSION = 2`（`types/plugin.types.ts`）。
- 缺省按 1 处理（历史行为）。
- `apiVersion > 宿主` → **拒绝加载**，错误信息提示升级宿主或换旧版插件。
- 破坏性变更必须升版本，并在本文件写迁移说明。

### permissions（声明，不强制）

| 值 | 含义 |
|---|---|
| `prompt` | 注册提示词段 / 装配 transform |
| `fs` | 读取插件目录、读写插件数据目录 |
| `net` | 发起网络请求 |
| `shell` | 执行子进程 |
| `policy` | 参与工具策略（本期未开放） |
| `session` | 读写会话级状态 |

> 当前版本只做"展示 + 审计"，运行时隔离见 `docs/technical-debt.md`。**不要**把权限声明当成安全边界。

---

## 3. 生命周期

```js
class MyPlugin {
  constructor() {
    this.manifest = { id: 'my-plugin', name: 'My Plugin', version: '1.0.0', description: '...' };
  }

  /** 声明阶段：注册工具/提示词/slot/命令/Hook */
  async onLoad(api) {}

  /** 启用阶段：启动定时器、连接、读数据目录 */
  async onStart() {}

  /** 禁用阶段：释放 onStart 的资源（注册项由宿主统一摘除） */
  async onStop() {}

  /** 卸载阶段：最终清理（数据目录默认保留） */
  async onUnload() {}
}

module.exports = MyPlugin;
module.exports.default = MyPlugin;
```

要点：

- `onLoad` 只调用一次；禁用/启用不会重新 `onLoad`。
- 注册项（工具/提示词/命令/Hook/slot）随插件启用态过滤；禁用后不生效。
- 禁用不会删除插件数据；卸载由宿主删除插件目录。

---

## 4. PluginApi 清单

### 4.1 v1（稳定）

| 方法 | 说明 |
|---|---|
| `registerTool(def)` | 注册模型工具（Zod schema / JSON schema） |
| `registerRawTool(def)` | 注册底层工具定义 |
| `registerToolKit(def)` | 注册工具包（eager/lazy/none、activator、requiresAnyKits） |
| `registerPrompt(def)` | 追加提示词（STATIC/REGULAR/VOLATILE）——v3 起是 `registerPromptSection` 的语法糖 |
| `registerCommandProvider(def)` | 文本型斜杠/艾特命令（replacement + appendix） |
| `registerTurnReminderProvider(provider)` | 每轮 LLM 前注入 persist/transient 消息 |
| `registerSkill(input)` | 注册内嵌技能正文 |
| `registerSlot(reg)` | 注册前端 slot（已消费：`settings` / `main` / `conversation.side.panel`） |
| `registerUiPage(reg)` | 注册 UI 页面 |
| `registerTheme(reg)` | 注册主题 |
| `registerRpc(methods)` | 前端 `apiService.call(pluginId, method, args)` → 后端 |
| `registerNls(locale, messages)` | 插件隔离 i18n |
| `registerAttachmentType(reg)` | 附件类型 |
| `registerWorkspaceProvider(factory)` | 连接/工作区方案 |
| `registerConnectionType(factory)` | 连接类型（同 workspace provider） |
| `registerProviderType(card)` | 供应商类型卡 |
| `registerProtocolAdapter(def)` | wire 协议适配器 |
| `getData()` / `getValue(k)` / `setValue(k,v)` / `deleteValue(k)` | 插件 KV 数据 |

### 4.2 v2（新增）

| 方法 | 说明 |
|---|---|
| `registerPromptSection(def)` | 命名提示词段（order/scope/shadowable/complete） |
| `registerPromptTransform(def)` | 装配后整体变换（串行，默认禁止删 `builtin.*`） |
| `registerLocalCommand(def)` | 动作型斜杠命令（不落库、不调模型） |
| `registerHook(def)` | 生命周期 Hook（白名单） |
| `getPluginDir()` | 插件安装目录（只读） |
| `getDataDir()` | 插件数据目录（可写，自动创建） |
| `getApiVersion()` | 宿主支持的 PluginApi 版本 |

### 4.3 v3（新增）

| 方法 | 说明 |
|---|---|
| `registerRoute(def)` | 自定义 HTTP 路由（原生 req/res，可流式）→ `/plugins/:id/http/<path>` |
| `complete(opts)` | 非流式调用宿主已配置的模型 |
| `completeStream(opts)` | 流式调用（chunk 归一化为 text / reasoning / finish） |
| `listModels()` | 宿主已配置的模型清单 |
| `startJob(def, sessionId?)` | 登记后台作业（复用 `job_read` / `job_stop`） |

> 详细用法与验收见 `plugin-api-v3.md`。

---

## 5. 提示词段（v2）

```js
api.registerPromptSection({
  name: 'my-plugin.persona',
  order: -100,                 // 越小越靠前；内置段 order=0
  scope: 'global',             // global | agent | session
  text: 'You are ...',         // 或 (ctx) => string
  description: '人格',
});
```

装配顺序（`prompt-assembler.service.ts`）：

```text
builtin.agent-system (order 0)
  + 提示词段（order asc, name asc）
      ├─ 显式 registerPromptSection
      ├─ registerPrompt 折算（`${pluginId}.prompt.N`，order 5000/6000/7000）
      └─ toolkit.registerPrompt 折算（`${pluginId}.toolkit.<kitId>.N`，
         order 5500/6500/7500；仅当该工具包本轮 loadMode=eager 时生效）
  → 按 order 串行执行 registerPromptTransform
  → systemText = sections.join('\n\n')
```

约束：

- `name` 不能以 `builtin.` 开头（保留前缀）。
- 同插件、同作用域、同名 → 注册期抛错。
- 返回空串 = 本轮不注入。
- `scope`：`agent` 需要 `ctx.session.agentId`，`session` 需要 `ctx.session.sessionId`。
- `complete: true` 为保留字段（接管整段提示词），当前版本不生效。

### 提示词只有一条注入管线

v3 起所有提示词都折算成「段」，区别只在**何时生效**：

| 写法 | 折算 | 生效时机 |
|---|---|---|
| `registerPromptSection(def)` | 原样 | 每轮装配 |
| `registerPrompt({content, frequency})` | `${pluginId}.prompt.N`，order 5000/6000/7000 | 每轮装配 |
| `toolkit.registerPrompt({content, frequency})` | `${pluginId}.toolkit.<kitId>.N`，order 5500/6500/7500 | 仅当该工具包 `loadMode=eager` |
| `toolkit.registerPrompt` + kit `loadMode=lazy` | 同上（段存在但装配时跳过） | `skill_learn` / `tool_load` 后由 `PromptCollector.collectLazyPrompts` 注入消息 |

> `lazy` 分支不走系统提示词，是唯一的例外；它的内容仍从工具包注册表读取，不经过装配器。

### `registerPrompt` 与 `registerPromptSection` 的关系

`registerPrompt` 是简写，内部直接调用 `registerPromptSection`：

| registerPrompt | 折算结果 |
|---|---|
| `content` | `text` |
| `frequency: STATIC` | `order = 5000 + 序号` |
| `frequency: REGULAR`（缺省） | `order = 6000 + 序号` |
| `frequency: VOLATILE` | `order = 7000 + 序号` |
| — | `name = ${pluginId}.prompt.<序号>`，`scope = global` |
| `description` | 原样保留 |

因此**两者没有功能重叠**：`registerPrompt` 是"内容 + 次频"的便捷写法，需要 `order` / `scope` / 覆盖能力时用 `registerPromptSection`。

`toolkit.registerPrompt` 同样在 `flush()` 时折算为段（带 `toolkitId`），
装配器按该工具包本轮的 `loadMode` 决定是否生效：`eager` 进系统提示词，
`lazy` / `none` 跳过（lazy 内容改由 `collectLazyPrompts` 在工具加载后注入）。

### 装配后变换

```js
api.registerPromptTransform({
  id: 'dedupe',
  order: 10,
  transform: (assembly, ctx) => {
    // assembly = { sections: [{name, order, text, pluginId}], systemText }
    return { sections: assembly.sections, systemText: assembly.systemText };
  },
});
```

- 默认禁止删除 `builtin.*` 段：若 transform 返回的 sections 不含任何 `builtin.*`，整次变换被忽略并告警。
- 需要改写内置段时，宿主侧需显式开启（`allowBuiltinRewrite`），当前由宿主策略控制，插件不能自行决定。

---

## 6. 动作型本地命令（v2）

```js
api.registerLocalCommand({
  name: 'demo-status',              // ^[a-z][a-z0-9-]*$
  description: '查看状态',
  aliases: ['ds'],
  handler: async ({ sessionId, args, raw }) => {
    return { text: 'ok', data: { sessionId } };
  },
});
```

语义：

- 只有"整段输入就是一条命令"才命中（`/demo-status`、`/demo-status arg`）。
- 命中后**不写用户消息、不建流、不进 LLM 上下文**。
- 前端命令列表来自 `GET /commands?trigger=slash`，插件命令带 `local: true`。
- 返回 `{ text, data }`；`text` 由前端提示/展示，`data` 供插件前端读取。
- 名称/别名冲突 → 注册期抛错（含内置 `/compact`、`/goal`）。

---

## 7. Hook（v2）

```js
api.registerHook({
  event: 'session.created',
  order: 0,
  handler: async (payload) => {
    // payload: { sessionId, timestamp, source, payload: { session } }
  },
});
```

白名单与决策语义：

| 事件 | 调度 | 允许返回值 |
|---|---|---|
| `agent.pre_step` | serial | **只允许副作用**；返回非 undefined 会被忽略并告警 |
| `agent.request_error` | serial | `{ kind: 'retry' }` |
| `turn.stopping` | parallel | `{ kind: 'continue', messages: string[] }` |
| `session.created` | emit | 忽略 |

- 内置订阅者先注册 → 决策型钩子上内置逻辑优先。
- 插件异常 fail-open（只记日志，不影响主流程）。
- 插件禁用后 hook 不执行（注册保留，避免抖动）。

---

## 8. 前端 slot

前端产物协议（`frontend/src/services/plugin-loader.js`）：

- 文件位置：`frontend/dist/<Component>.js`；
- 形态：IIFE，执行时调用
  ```js
  window.__GuaDaModuleLoader__.register('my-plugin:Component', { default: VueComponent });
  ```
- Vue 从 `window.__GuaDaShared__.vue` 取，**不要打包 Vue**；
- 共享环境：`__GuaDaShared__.runtime`（user/session/locale/theme）、`i18n`、`pluginApi`。

当前已消费的 slot：

| slot | 位置 | meta | props |
|---|---|---|---|
| `settings` | 设置页侧边栏 | 需要 `meta.label` | — |
| `main` | 全页工作台（左导航自动出现入口） | 需要 `meta.label` / `meta.icon` | `{ pluginId, sessionId: null, host }` |
| `conversation.side.panel` | 对话右侧 dock（页签） | 需要 `meta.label` | `{ pluginId, sessionId, host }` |

已规划（宿主实现后可用）：

| slot | 位置 |
|---|---|
| `conversation.header.actions` | 会话标题右侧 |
| `conversation.composer.toolbar` | 输入框工具条 |
| `conversation.message.node` | 消息节点 |
| `shell.overlay` | 全局浮层 |

> 在宿主实现前，注册这些 slot 不会渲染；不会报错。

### `host` 桥（容器型 slot 注入）

```ts
interface PluginHost {
  call(pluginId, method, args?): Promise<T>        // → POST /plugins/:id/rpc/:method
  getData(pluginId): Promise<Record<string, unknown>>
  setValue(pluginId, key, value): Promise<void>
  url(pluginId, path): string                      // → /plugins/:id/http/<path>
  openPanel(pluginId, slotKey): void
  closePanel(): void
  openPage(pluginId, slotKey?): void
}
```

> v3 的 HTTP 路由与模型调用详见 `plugin-api-v3.md`。

---

## 9. 插件数据目录

```js
const dir = api.getDataDir();      // $USERDATA_DIR/plugins-data/<pluginId>/
const pluginDir = api.getPluginDir(); // 插件安装目录（只读）
```

建议布局：

```text
<dataDir>/
  prompt-inject.md
  rules/*.md
  state.json
  snapshots/*.json
```

- 目录由宿主按需创建；
- 插件 ID 严格校验，路径越界会被拒绝；
- 卸载默认保留数据（用户可手动删除）。

---

## 10. 安装 / 更新 / 卸载

安装源（`plugin-source.ts`）：

```text
github:owner/repo[#ref]
gitee:owner/repo[#ref]
git:https://host/path.git[#ref]
local:/absolute/path
```

接口：

```http
POST /api/v1/plugins/install          { "source": "github:owner/repo#v1.0.0" }
GET  /api/v1/plugins/install-log/:jobId
POST /api/v1/plugins/install-cancel/:jobId
POST /api/v1/plugins/:pluginId/update
POST /api/v1/plugins/reload/:pluginId
DELETE /api/v1/plugins/:pluginId
```

开发期建议：

- 本地目录安装：`local:D:\AI\work\my-plugin`；
- 或设置 `PLUGINS_DEV_DIR` 指向插件仓库，改完调 `POST /plugins/reload/:id`；
- 前端产物需要先构建（`npm run build`），宿主不执行构建。

---

## 11. 调试与排错

| 现象 | 排查 |
|---|---|
| 插件列表不出现 | `manifest.json` 是否合法；目录名是否与 id 一致；`main` 是否存在 |
| 加载失败 | 后端日志 `Failed to load external plugin from ...`；先 `node --check index.js` |
| slot 不渲染 | `registerSlot` 的 `component` 是否对应 `frontend/dist/<Component>.js`；`meta.label` 是否存在 |
| 提示词不生效 | 段是否 `order` 过大/被同名冲突；`text` 是否返回空串；插件是否启用 |
| 命令不出现 | `registerLocalCommand` 是否在 `onLoad` 中调用；`GET /commands?trigger=slash` 是否包含 |
| Hook 不触发 | 事件名是否在白名单；插件是否启用；`agent.pre_step` 是否返回了值被忽略 |

---

## 12. 版本策略

- `PLUGIN_API_VERSION` 只在**破坏性变更**时 +1。
- 新增可选方法/字段不升版本。
- 宿主必须保证：旧 `apiVersion` 的插件在新增能力后仍可加载。
- 插件应在 README 标注 `apiVersion` 与最低宿主版本。

---

## 13. 安全边界（必读）

- 插件运行在**后端主进程**内，拥有与后端相同的 Node 权限；`permissions` 目前只是声明。
- 不要加载不可信来源的插件；安装前审查代码。
- 宿主不提供"修改默认安全策略/绕过审批/沙箱"的插件 API；需要更严格策略时，走宿主 policy 配置。
- 插件不得把凭据写入仓库、日志或插件数据目录。
