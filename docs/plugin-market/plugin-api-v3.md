# PluginApi v3：HTTP 路由 / 模型调用 / 页面槽位

> 适用：`PLUGIN_API_VERSION = 3`（2026-11 起）
> 示例插件：`plugins/hello-plugin`（工具 / 提示词 / 路由 / 模型 / 两个槽位全覆盖）
> 完整契约见 `third-party-plugin-api.md`

---

## 1. 自定义 HTTP 路由

### 为什么需要

`registerRpc` 只能做「一次性 POST，返回 JSON」。需要以下场景时不够用：

- **流式响应**（SSE：生成进度、日志跟随）
- **大文件下载**（`fs.createReadStream().pipe(res)`）
- **图片/视频**（`<img src>` / `<video>` 直接引用）
- 自定义状态码 / header / CORS

### 用法

```js
api.registerRoute({
  method: "POST",              // GET | POST | PUT | DELETE | PATCH | ALL
  path: "api/ping",            // 相对插件命名空间，不含前导 /
  handler: (req, res, ctx) => {
    res.json({ ok: true, name: ctx.body?.name, dir: ctx.dataDir });
  },
});
```

对外 URL：`/api/v1/plugins/<pluginId>/http/<path>`

### 路径匹配

| 写法 | 匹配 |
|---|---|
| `api/ping` | 精确 |
| `api/items/:id` | 单段参数（`ctx.params.id`） |
| `files/*` | 末尾通配，吞掉剩余段 |
| `*` 只能出现在末尾 | `*/x` 会被拒绝 |

静态段优先于参数段：同时注册 `api/items/count` 与 `api/items/:id` 时，`/count` 走静态那条。

### 流式示例

```js
api.registerRoute({
  method: "GET",
  path: "api/stream",
  handler: async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders?.();
    for (let i = 1; i <= 3; i++) {
      res.write(`data: ${JSON.stringify({ tick: i })}\n\n`);
      await new Promise((r) => setTimeout(r, 150));
    }
    res.write("data: [DONE]\n\n");
    res.end();
  },
});
```

前端（`EventSource` 不能加 header，用 `?token=`）：

```js
const es = new EventSource(`/api/v1/plugins/my-plugin/http/api/stream?token=${token}`);
```

### 约束

| 项 | 规则 |
|---|---|
| 命名空间 | 只能注册在 `/plugins/<自己的 id>/http/` 下，无法覆盖宿主路由 |
| 鉴权 | **控制器级强制**（`AuthGuard`），支持 `Bearer` 与 `?token=`；v1 无匿名路由 |
| 公开媒体 | 用 `/plugins/<id>/assets/<path>`（已支持 Range，206 分块） |
| 禁用态 | 插件禁用 → 路由返回 404（注册保留，避免反复启停抖动） |
| 卸载 | `unregisterPlugin` 清空该插件全部路由 |
| 审计 | 每次调用记 `[plugin-http] <id> <method> <path> <status> <ms>` |
| 大文件 | 请用 `createReadStream().pipe(res)`，不要把整个文件读进内存 |

---

## 2. 调用宿主模型

### 为什么需要

插件想做「AI 生成」（写剧本、出分镜提示词、总结内容），不应该让用户再填一遍 API key。
宿主已有配置好的 provider / model / 用量统计，插件直接复用。

### 用法

```js
// 模型清单（与设置页一致）
const models = await api.listModels();
// [{ id, name, providerId, providerName, contextWindow, maxOutputTokens, features }]

// 非流式
const { text, model, usage } = await api.complete({
  modelId: models[0].id,      // 可省略 → 用第一个可用模型
  system: "你是简洁的助手。",
  prompt: "用一句话介绍你自己。",
  temperature: 0.7,
  maxTokens: 200,
});

// 流式
for await (const chunk of api.completeStream({ prompt: "数到三。" })) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
  if (chunk.type === "reasoning") { /* 思考内容 */ }
  if (chunk.type === "finish") break;
}
```

### 语义

| 项 | 规则 |
|---|---|
| 模型解析 | `modelId` 指定 > 不存在则**报错**（不静默换） > 否则第一个可用模型 |
| 会话模型 | 不隐式推断（多会话并发会串模型）；工具里如需跟随会话，显式传 `modelId: ctx.session.getModelConfig().modelId` |
| 用量 | `purpose` 默认 `plugin:<id>`，进宿主用量统计 |
| 凭据 | 插件不接触 key，全部走用户已配置的 provider |
| 超时 | 沿用宿主 LLM idle timeout；`signal` 可中止 |
| 无模型时 | 明确报「no model configured; add one in Settings → Model providers」 |

---

## 3. 页面槽位

### `main`（全页工作台）

```js
api.registerSlot({
  name: "main",
  component: "CanvasPage",       // frontend/dist/CanvasPage.js
  mode: "single",
  order: 200,
  meta: { label: "无限画布", icon: "puzzle" },
});
```

宿主行为：

- 左侧导航自动出现一项（`meta.label`），点击进入 `/plugin-page/<pluginId>/<component>`
- 全页渲染该组件（替换内容区，侧栏与标题栏不变）
- 插件禁用/卸载 → 入口消失，若正停在该页则自动回退 `/`
- 注入 props：`{ pluginId, sessionId: null, host }`

### `conversation.side.panel`（对话右侧面板）

```js
api.registerSlot({
  name: "conversation.side.panel",
  component: "CanvasPanel",
  mode: "tabs",
  order: 200,
  meta: { label: "画布", icon: "puzzle" },
});
```

宿主行为：

- 对话页标题栏出现「插件面板」按钮（有面板注册时）
- 右侧 dock 出现页签：`工作区概览` + 每个插件面板
- 与聊天并排，占用 `asideReserve` 让消息列避让；关闭后归零
- 同屏只显示一个面板（`usePluginPanels`）
- 注入 props：`{ pluginId, sessionId, host }`

### `host` 桥

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

---

## 4. 最小工作台示例

`plugins/hello-plugin` 同时用齐三项能力：

```ts
// index.ts
api.registerRoute({ method: "POST", path: "api/ping", handler: ... });
api.registerRoute({ method: "GET", path: "api/echo/:name", handler: ... });
api.registerRoute({ method: "GET", path: "api/stream", handler: ... });  // SSE
api.registerSlot({ name: "main", component: "Workbench", ... });
api.registerSlot({ name: "conversation.side.panel", component: "Workbench", ... });
api.registerRpc({ demo_complete, demo_stream, demo_models });
```

`frontend/dist/Workbench.js` 是同一份产物，按 props 自适应两种挂载点。

---

## 5. 权限声明

```jsonc
{
  "apiVersion": 3,
  "permissions": ["http", "llm"]
}
```

`http` / `llm` 目前只用于安装确认与审计展示（运行时未强制），与 `fs` / `shell` 同等对待。

---

## 6. 验收清单

| # | 项 | 命令 / 操作 | 期望 |
|---|---|---|---|
| 1 | 路由精确匹配 | `POST /plugins/hello-plugin/http/api/ping` | 200 + JSON |
| 2 | 路径参数 | `GET /plugins/hello-plugin/http/api/echo/张三` | `{ name: "张三" }` |
| 3 | 流式 | `curl -N .../http/api/stream` | 分块陆续到达，最后 `[DONE]` |
| 4 | 404 | 未注册路径 | 404 JSON |
| 5 | 鉴权 | 设密码后不带 token | 401 |
| 6 | 禁用插件 | 关闭 hello-plugin → 再请求 | 404 |
| 7 | 模型清单 | `rpc/demo_models` | 与设置页模型一致 |
| 8 | 非流式 | `rpc/demo_complete` | 返回 `{ ok, model, text, usage }` |
| 9 | 流式 | `rpc/demo_stream` | 返回 `{ ok, text, chunks }`，chunks > 1 |
| 10 | main 槽位 | 左导航「Hello 工作台」 | 进入全页，展示模型清单 |
| 11 | 右栏槽位 | 对话页标题栏插件按钮 → 页签「Hello」 | 右栏渲染，与聊天并排 |
| 12 | 禁用回退 | 禁用插件后停在插件页 | 自动回 `/`，入口消失 |
