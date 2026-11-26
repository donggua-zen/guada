# GuaDa 插件 API 参考（PluginApi v4）

> **本文是三方插件开发的唯一权威入口。**
> 适用宿主：`PLUGIN_API_VERSION = 4`（含 v4.1 能力包技能）。
>
> 维护约定：本文声明的方法与字段**必须**与
> `backend-ts/src/modules/plugins/api/plugin-api.ts`、
> `backend-ts/src/modules/plugins/types/plugin.types.ts` 保持一致，
> 由 `backend-ts/src/modules/plugins/docs-api-contract.spec.ts` 自动校验（改实现忘了改文档会测试失败）。

---

## 0. 三分钟上手

最小可运行插件（零 npm 依赖）：

```js
// manifest.json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "示例",
  "author": "you",
  "category": "user",
  "main": "index.js",
  "apiVersion": 4,
  "permissions": ["net"]
}
```

```js
// index.js —— 纯 CommonJS，无需继承 PluginBase
const { z } = require("zod"); // 宿主自带，无需自己装

class MyPlugin {
  manifest = { id: "my-plugin", name: "我的插件", version: "0.1.0", description: "示例" };

  async onLoad(api) {
    // 声明阶段：只注册，不做 I/O
    api.registerToolKit({
      id: "my_kit",
      loadMode: "eager",
      onLoad: (toolkit) => {
        toolkit.registerTool({
          name: "my_tool",
          description: "做一件具体的事",
          inputSchema: z.object({ q: z.string().describe("查询词") }),
          execute: async (args, ctx, signal) => `收到: ${args.q}`,
          readOnly: true,
        });
      },
    });
  }
}

module.exports = MyPlugin;
module.exports.default = MyPlugin;
```

**为什么推荐 `registerToolKit` 而不是 `api.registerTool`**：两者现在都能保留嵌套 schema
（限深 3 层），但工具包额外提供 `loadMode`（lazy/eager 门控）、`requiresAnyKits`、
随包显隐的技能，以及运行时 `handler` 决策——这些是"能力包"的治理能力。
只有单个扁平工具、且不需要门控时，用顶层 `registerTool` 更省事。

---

## 1. 生命周期

```js
class MyPlugin {
  manifest = { /* ... */ };
  constructor() {}
  async onLoad(api) {}   // 只调用一次：只做「声明」
  async onStart() {}     // 启用（含运行时再次启用）：这里做 I/O / 定时器 / 连接
  async onStop() {}      // 禁用：只释放 onStart 里创建的东西
  async onUnload() {}    // 卸载：最终清理（技能等）
}
module.exports = MyPlugin;
```

| 钩子 | 时机 | 硬性约定 |
| --- | --- | --- |
| `onLoad(api)` | 加载时**仅一次** | 只注册；不读盘、不连云、不起定时器 |
| `onStart()` | 每次启用 | 建立连接、启动轮询 |
| `onStop()` | 每次禁用 | 释放 `onStart` 创建的资源 |
| `onUnload()` | 卸载 | 清理技能等长期资源 |

**关键**：禁用 → 启用**不会重跑 `onLoad`**，只会 `onStop`/`onStart`。
所以"注册类"的工作放 `onLoad`，"运行时状态"放 `onStart`。

`onLoad` 抛错时：普通插件只记日志并继续（可能留下半注册状态）；供应商包则整包失败并回滚。

---

## 2. manifest.json 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 正则 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，**禁止路径分隔符**；安装目录名=id |
| `name` | ✅ | 显示名，支持 `%key%` NLS 引用 |
| `version` | ✅ | 语义化版本 |
| `description` | ✅ | 一句话说明 |
| `apiVersion` | — | 缺省 1；**大于宿主值拒绝加载**；声明你实际用到的最低版本 |
| `category` | — | `system` \| `core` \| `extended` \| `user`；决定默认启停（system/core 默认开，extended/user 默认关） |
| `essential` | — | 不可禁用；外部插件不应自封 |
| `main` | — | 入口文件，缺省 `index.js` |
| `icon` | — | 相对插件目录，如 `assets/icon.svg` |
| `permissions` | — | **仅用于安装确认/审计展示，运行时不强制** |
| `configSchema` | — | `{ fields: [...] }` 或 JSON Schema 子集；写配置时按此白名单过滤 |
| `dependencies` | — | 依赖的其他插件 id，缺失则拒绝加载 |
| `providerApi` / `provides` | — | 供应商包专用，普通插件不要写 |

`permissions` 可用值：`prompt` `fs` `net` `shell` `policy` `session` `http` `llm`。

---

## 3. 能力矩阵（PluginApi v4 完整方法）

按用途分组。**「生效方式」一列说明它如何影响运行时**，这是最容易踩坑的地方。

### 3.1 工具与能力包

| 方法 | 版本 | 生效方式 |
| --- | --- | --- |
| `registerToolKit(def)` | v4 | 返回 `ToolKitHandle`；flush 时写入 `PluginRegistry` |
| `registerTool(def)` | v1 | 顶层工具；嵌套 schema 同样限深保留，但无 `loadMode` 门控 |
| `registerRawTool(def)` | v1 | 直接提交 `ToolHandlerDef`，无 schema 生成 |

### 3.2 提示词

| 方法 | 版本 | 生效方式 |
| --- | --- | --- |
| `registerPrompt(def)` | v1 | 语法糖，折算为提示词段 |
| `registerPromptSection(def)` | v2 | 具名段 + `order` + `scope`；同名同作用域冲突**注册期报错** |
| `registerPromptTransform(def)` | v2 | 装配后流水线变换；默认禁止删除 `builtin.*` 段 |

工具包内的 `toolkit.registerPrompt` 会折算成段，且**只有该包本轮为 `eager` 时才注入**。

### 3.3 命令

| 方法 | 版本 | 生效方式 |
| --- | --- | --- |
| `registerCommandProvider(def)` | v1 | 文本型：插入 `[/name:...]` 标签随用户消息落库 |
| `registerLocalCommand(def)` | v2 | 动作型：后端直接执行，不写消息、不建流、**不进 LLM** |

### 3.4 前端

| 方法 | 版本 | 生效方式 |
| --- | --- | --- |
| `registerSlot(reg)` | v1 | `GET /plugins/slots` 消费；产物固定放 `frontend/dist` |
| `registerUiPage(reg)` | v1 | 独立 UI 页面 |
| `registerTheme(reg)` | v1 | 主题 |
| `registerSkin(reg)` | v3 | 富主题（`registerSkin` 是 `registerTheme` 的别名） |
| `registerAttachmentType(reg)` | v1 | 自定义附件类型 |

### 3.5 前后端通道

| 方法 | 版本 | 生效方式 |
| --- | --- | --- |
| `registerRpc(methods)` | v1 | `POST /plugins/:id/rpc/:method`；方法名 `^[a-z][a-zA-Z0-9_]*$` |
| `registerRoute(def)` | v3 | `/api/v1/plugins/:id/http/<path>`；控制器级 `AuthGuard` |

### 3.6 模型

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `complete(options)` | v3 | 非流式补全，复用宿主已配置模型 + 用量统计 |
| `completeStream(options)` | v3 | 流式；chunk 已归一化为 `text`/`reasoning`/`finish` |
| `listModels()` | v3 | 可用模型清单 |

### 3.7 智能体与技能

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `registerAgent(def)` | v4 | 插件专属智能体；id 归一化为 `plugin-<pluginId>-<id>` |
| `registerSkill(def)` | v4.1 | 插件级技能（`provider = plugin:<id>`） |

### 3.8 数据与路径

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `getPluginDir()` | v2 | 插件安装目录（只读），可能为 `undefined` |
| `getDataDir()` | v2 | 数据目录 `$USERDATA_DIR/plugins-data/<id>`（自动创建、防穿越） |
| `getData()` | v1 | 读取本插件全部配置 |
| `getValue(key, defaultValue?)` | v1 | 读单键（可带默认值） |
| `setValue(key, value)` | v1 | 写单键 |
| `deleteValue(key)` | v1 | 删单键 |
| `getApiVersion()` | v2 | 返回宿主版本（当前 4） |

### 3.9 进阶

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `registerHook(def)` | v2 | 白名单 4 事件：`agent.pre_step` `agent.request_error` `turn.stopping` `session.created` |
| `startJob(def, sessionId?)` | v2.1 | 后台作业，复用宿主 `job_read`/`job_list`/`job_stop`；每会话配额 10 |
| `registerNls(locale, messages)` | v2 | 插件隔离字典，`%key%` 解析 |
| `registerTurnReminderProvider(provider)` | v2 | 每轮提醒注入 |
| `registerWorkspaceProvider(factory)` | v2 | 自定义工作区协议 |
| `registerConnectionType(factory)` | v2 | 远程连接类型 |
| `registerProviderType(card)` | v3 | 供应商类型卡（供应商包用） |
| `registerProtocolAdapter(def)` | v3 | 协议适配器（供应商包用） |

---

## 4. 工具定义详解

### 4.1 `toolkit.registerTool(def)`

```js
toolkit.registerTool({
  name: "search_thing",              // 全局唯一！跨插件重名无仲裁，先注册者胜
  description: "给模型看的说明，写清何时用",
  inputSchema: z.object({ ... }),    // 推荐：Zod，自动转 JSON Schema + 运行时校验

  execute: async (args, ctx, signal) => {
    // ctx.session：会话上下文（工作区路径等）
    // signal：AbortSignal，长任务要检查
    return "纯字符串最省事";
    // 或结构化：
    // return { content: "...", imageRefs: [...], meta: {...}, isError: false };
  },

  // ── 声明式能力位（如实填写，影响宿主闸门）──
  readOnly: true,                    // 计划模式权限门的唯一依据；缺省 false
  allowedInPlanMode: false,          // 非只读工具在计划模式的逃生舱
  requiresUserInteraction: false,    // 会阻塞等待人类应答（审批/提问）
  exemptFromLargeResult: false,      // 自行管理返回长度，不让宿主裁剪

  display: {
    argsKey: "q",                    // 从参数里取摘要展示
    icon: "search",                  // file/read/write/search/edit/browser/vision/todo/...
    text: { executing: "搜索中", completed: "搜索完成" },
  },
});
```

**返回值三种形态**：

| 形态 | 说明 |
| --- | --- |
| `string` | 最简，直接作为结果文本 |
| `{ content, ... }` | `ToolResultObject`，支持 `images` / `imageRefs` / `meta` / `isError` / `followUpUserInput` |
| 其他对象 | 会被 `JSON.stringify` |

**返回图片**优先用 `imageRefs`（字节已在磁盘）而不是 `images`（base64）：

```js
return {
  content: "已生成 3 张图",
  imageRefs: [{ url: "/abs/path/a.jpg", refType: "local", media_type: "image/jpeg", bytes: 1234, name: "a.jpg" }],
};
```

引擎会把 `imageRefs` 物化进会话图片目录并统一转码（工具图按 150KB 预算），
持久化只落路径指针——**不要在插件里 base64 内联**。

### 4.2 工具包定义 `ToolKitDef`

| 字段 | 说明 |
| --- | --- |
| `id` | 插件内唯一 |
| `name` / `description` | 显示用，支持 `%key%` |
| `loadMode` | `eager`（默认，工具进模型 function list）/ `lazy`（需先 `skill_learn`）/ `none` |
| `enabled` | 默认 `true` |
| `activator` | 告诉模型何时加载本包 |
| `handler(ctx)` | 运行时决定 `loadMode`（如子代理会话返回 `none`） |
| `onLoad(toolkit)` | 在这里注册工具/提示词/技能 |
| `requiresAnyKits` | `["pluginId:kitId"]`，OR 语义；全不可用则整包消失 |
| `visibleTo` | `["self"]` = 仅本插件注册的智能体可见 |
| `governance` | `"self"` 自治理；**外部插件声明会被静默剥离** |

### 4.3 `ToolKitHandle`

`registerTool` / `registerRawTool` / `registerPrompt` / `registerSkill`，
以及只读属性 `id`、`name`。

---

## 5. 提示词段

```js
api.registerPromptSection({
  name: "my-plugin.usage",   // 不得以 builtin. 开头
  order: 1000,               // 越小越靠前；内置段在 0 附近，插件建议 1000+
  scope: "global",           // global | agent | session
  content: "…",              // 也支持 (ctx) => string
  visibleTo: ["self"],       // 可选：仅本插件智能体可见
});
```

---

## 6. HTTP 路由

```js
api.registerRoute({
  method: "GET",              // GET|POST|PUT|DELETE|PATCH|ALL
  path: "hello/:name",        // 相对命名空间，支持 :param 与末尾 *
  handler: async (req, res, ctx) => {
    // ctx: { pluginId, params, query, body, dataDir, method, url, headers }
    res.json({ hi: ctx.params.name });
  },
});
```

- 对外 URL：`/api/v1/plugins/<id>/http/<path>`
- **控制器级 `AuthGuard`**：需要登录态。`<img>` 等无法带 Authorization 的请求要改用
  `?token=`（`AuthGuard` 支持 query token 与 `ws_token` cookie）
- 插件禁用后立即 404；卸载清空

---

## 7. 已知陷阱（务必先读）

这些是行为反直觉、或历史上文档与实现不一致的地方。

### 7.1 已修复（v4 起行为已变，旧经验不再适用）

| # | 曾经的陷阱 | 现在的行为 |
| --- | --- | --- |
| 1 | `entries` 字段无效 | ✅ **已支持**：`entries.backend` 优先于 `main`；`entries.frontend` 作为前端产物目录（缺省 `frontend/dist`），由 `/plugins/slots` 的 `assetDir` 下发给前端 |
| 2 | 顶层 `registerTool` 丢嵌套 schema | ✅ **已修复**：复用工具包的限深展平器（3 层），数组元素与子对象形状保留，与 `toolkit.registerTool` 结果一致 |
| 3 | 本地命令不跟随启停 | ✅ **已修复**：插件禁用后命令不再列出、不可执行；内置命令（无 `pluginId`）不受影响 |

### 7.2 仍然存在

| # | 陷阱 | 实际行为 |
| --- | --- | --- |
| 4 | `governance: "self"` 对外部插件被剥离 | 只有内建插件能自封；外部插件声明无效（静默） |
| 5 | **工具重名无仲裁** | 跨插件同名工具，先注册者胜、后者不可达。命名请带插件前缀 |
| 6 | 插件无沙箱 | 与后端同进程、同权限；`permissions` 不构成隔离 |
| 7 | `category:"system"` 可被伪造 | 普通外部插件不会被拦（供应商包会被降级）；市场侧会拒收 |
| 8 | 旧式 `parameters` 字段**默认全必填** | 用 `parameters` 手写 schema 时，可选字段必须显式 `required: false` |
| 9 | Zod `.default()` 会进 `required` | Zod v4 的 `z.toJSONSchema` 把带默认值的字段列为必填。用 `.optional()` + 代码兜底，**不要指望宿主修正** |
| 10 | 大结果会被裁剪 | >20000 tokens 且未声明 `exemptFromLargeResult` 时落盘并只回预览 |
| 11 | `dangerLevel` 无消费方 | 不拦截、不分级，别指望它做安全控制 |
| 12 | 技能卸载清理放 `onUnload` | 放 `onStop` 会导致禁用后永久消失 |
| 13 | `registerAgent.toolkits` 在 flush 时定格 | 之后新增的工具包不会追溯纳入该智能体 |
| 14 | RPC 有 `AuthGuard` | 启用态下任何登录用户都能调用；敏感逻辑仍需在 handler 内自查 |

---

## 8. 测试与验收

宿主仓库内：

```bash
cd backend-ts
pnpm test                                    # 全部
npx jest src/modules/plugins --silent        # 插件内核
```

插件仓库内（自带 node:test，无需依赖宿主）：

```bash
node --test test/*.test.js
```

**上线前必查**：

- [ ] `manifest.id` 合法且与目录名一致
- [ ] `apiVersion` ≤ 宿主（当前 4）
- [ ] 工具名不与内置工具（`web_search`、`read`、`write`…）冲突
- [ ] `readOnly` / `allowedInPlanMode` 如实声明
- [ ] `onLoad` 无 I/O；`onStart` 才建连接
- [ ] 数据只写 `getDataDir()`，不写安装目录
- [ ] 单测覆盖：参数校验失败、空结果、外部依赖失败降级

---

## 9. 相关文档

| 文档 | 内容 |
| --- | --- |
| 本文 | 唯一权威入口 |
| [`plugin-agents.md`](./plugin-agents.md) | 插件专属智能体（v4）设计细节 |
| [`plugin-capability-packs.md`](./plugin-capability-packs.md) | 能力包/技能门控（v4.1） |
| [`plugin-market/registry-guide.md`](./plugin-market/registry-guide.md) | 上架官网市场的流程与要求 |
| [`technical-debt.md`](./technical-debt.md) | 已知设计缺口 |

> `plugin-market/third-party-plugin-api.md`（v2）与 `plugin-market/plugin-api-v3.md`（v3）
> 是历史文档，**版本已过时**，仅作演进参考；冲突时以本文为准。
