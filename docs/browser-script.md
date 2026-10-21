# Browser Script（脚本化浏览器自动化）

> 当前唯一浏览器自动化入口：旧 8 个 `browser_*` 工具已退役，`browser_run` 是替代入口；后端复用同一套 Electron Bridge。

## 为什么需要它

旧的 `browser_*` 工具在简单场景很好用，但决策被固定死了：

- `browser_navigate` 默认等 3 秒再自动快照，模型无法决定“这次不需要快照”。
- 交互后是否重新快照、是否重试、是否根据页面内容分支，都要跨多次工具调用完成。
- 快照是一大段文本，模型只能读，不能在返回前过滤。

另外，脚本里的浏览器调用必须 `await`。如果脚本在调用尚未完成时返回，运行器会取消在途 Bridge 请求；该动作可能已经下发，副作用处于“不确定”状态。

脚本化路径把“观察时机”交还给模型：

```js
await tab.goto("https://example.com");   // 只导航，不自动快照
const page = await tab.snapshot();        // 需要时才取
const link = page.find({ role: "link", name: "More information" });
if (!link) return { found: false, title: page.title };
await tab.click(link.ref);
await tab.waitForLoadState("domcontentloaded");
const next = await tab.snapshot();
return { url: next.url, headings: next.findAll({ role: "heading" }).slice(0, 5).map(n => n.name) };
```

## 架构

```
LLM
 → browser_run（browser-script 工具包，eager）
 → BrowserScriptRuntime（NestJS 后端）
 → Worker + vm（模型脚本执行，可强制终止）
 → host calls
 → BridgeClient（Named Pipe / UDS）
 → Electron BridgeServer
 → BrowserAutomationService
 → <webview> guest WebContents
```

脚本运行器不直接操作 Electron，只把 `tab.*` / `browser.*` 翻译成既有 bridge 方法：

| 脚本调用 | Bridge 方法 |
|---|---|
| `tab.goto` / `browser.open` | `browser_navigate` |
| `tab.snapshot` / `browser.snapshot` | `browser_snapshot` |
| `tab.click` | `browser_click` |
| `tab.fill` | `browser_input` |
| `tab.waitFor` | `browser_wait` |
| `tab.waitForLoadState` | `browser_evaluate` 轮询 `document.readyState` |
| `tab.evaluate` | `browser_evaluate` |
| `tab.screenshot` | `browser_screenshot` |
| `tab.console` | `browser_console` |
| `tab.back` / `forward` | `browser_history` |
| `tab.reload` | `browser_reload` |
| `browser.tabs.*` / `browser.current` | `browser_tabs` |

会话所有权参数沿用浏览器服务既有约定：`created_by = ctx.session.sessionId`，`session_id = parentSessionId || sessionId`，`session_path = workspacePath`。

## 加载方式与开关

- 插件 id：`browser-script`，只在 `ELECTRON_APP === "true"` 时注册。
- 工具本身 **eager**：`browser_run` 直接进入 function-calling tools 数组，不再需要 `tool_learn` + `tool_use`。脚本参数只经过一层 JSON 对象，schema 在调用时就可见。
- 完整 API 指南注册为插件技能 `browser-script`：复杂脚本前调用 `skill_learn("browser-script")` 按需加载；系统提示词里只常驻一行技能列表。
- 工具描述保留核心 API 摘要，因此即使技能被禁用或按 agent 过滤，`browser_run` 仍可用。
- 干净的 A/B 对照应禁用整个 `browser-script` 插件（工具和技能同时消失）。会话设置 `browserScript = { "enabled": false }` 只隐藏工具包，技能列表仍可能显示该技能，因为技能可见性跟随插件启用状态，不跟随会话级设置。
- 原 `browser` 工具包已退役，`browser_run` 是唯一浏览器自动化入口。

### 为什么工具 eager、指南放 skill

- `browser_run` 是单工具，lazy 的 `tool_use` 嵌套对每次调用都是额外一层；eager 后模型直接调用，参数校验使用真实 schema。
- 完整指南约 5–8KB，放进 skill 后只在 `skill_learn` 时进入上下文；每轮固定成本只剩短工具描述 + 一行技能列表。
- `computer`、`workflow` 等其他多工具或低频 kit 仍保持 lazy；项目里的 `tool_learn`/`tool_use` 不会因此消失。

## 模型 API

### browser

| 调用 | 说明 |
|---|---|
| `browser.open(url, { newTab? })` | 导航；不自动快照 |
| `browser.tabs.list()` | 列出当前会话标签，返回 `TabInfo[]`（可直接 `.map()`） |
| `browser.tabs.select(index)` | 切换当前标签，返回选中的 `TabInfo` |
| `browser.tabs.close(index?)` | 关闭标签，返回 `{ ok, closedTabId, currentTabId }` |
| `browser.tabs.closeAll()` | 关闭当前会话全部标签，返回 `{ ok, closedCount }` |
| `browser.snapshot({ type? })` | 同 `tab.snapshot` |
| `browser.current()` | `{ index, tabId, url, title, isCurrent }` 或 `null` |

### tab

| 调用 | 说明 |
|---|---|
| `tab.goto(url, { newTab?, waitUntil? })` | `waitUntil`: `"domcontentloaded"`（默认）、`"load"`、`"none"` |
| `tab.snapshot({ type? })` | `simple`（默认）/ `struct` / `summary` |
| `tab.click(target, { fullSimulation? })` | 点击 |
| `tab.fill(target, value, { fullSimulation? })` | 填入文本 |
| `tab.getByRole(role, { name?, exact? })` | 返回 locator |
| `tab.getByText(text, { exact? })` | 返回 locator |
| `tab.locator(cssSelector)` | 返回严格 CSS locator |
| `tab.waitFor(target, { timeout? })` | selector 走 `browser_wait`；role/text 轮询新快照 |
| `tab.waitForLoadState("domcontentloaded" \| "load", { timeout? })` | 默认 3 秒；`networkidle` 明确拒绝 |
| `tab.evaluate(fnOrExpression, arg?)` | 页面 JS；函数会以 `arg` 调用，字符串按表达式/语句块处理 |
| `tab.screenshot({ filePath?, fullPage? })` | 保存 PNG；多模态模型会收到图片引用 |
| `tab.console()` | 读取并清空 console 日志 |
| `tab.back()` / `forward()` / `reload()` | 历史导航 |
| `log(message)` / `sleep(ms)` / `args` | `sleep` 上限 5 秒 |

### target

`target` 可以是：

- 最近一次快照里的 ref 字符串，例如 `"e3"`
- CSS selector
- 带 `ref` 的快照节点对象
- `getByRole` / `getByText` / `locator` 返回的 locator 对象

### locator

| 方法 | 说明 |
|---|---|
| `.click()` / `.fill(value)` | 严格定位后动作 |
| `.count()` | 匹配数量（role/text 含非交互节点） |
| `.text()` | 第一个匹配节点的 `name`/`text` |
| `.isVisible()` | 有 ref 时检查页面可见性 |
| `.waitFor({ timeout? })` | selector 走 `browser_wait`，role/text 轮询快照 |

### 返回值

所有 action 返回普通 JS 对象/数组，不再暴露 Bridge 的 `{ success, windowId, tabs, current_tab_id, ... }` 信封。

```ts
type TabInfo = {
  index: number;
  tabId: string;
  url: string;
  title: string;
  isCurrent: boolean;
};
```

| 调用 | 返回 |
|---|---|
| `tab.goto` / `browser.open` | `{ ok, tabId, url, title }` |
| `tab.click` | `{ ok, target }` |
| `tab.fill` | `{ ok, target, value }` |
| `tab.waitFor` | `{ ok, found, selector }` |
| `tab.waitForLoadState` | `{ state }` |
| `tab.screenshot` | `{ ok, path, width, height }` |
| `tab.back` / `forward` / `reload` | `{ ok, url }` |
| `tab.console` | console 日志数组 |
| `browser.tabs.list` | `TabInfo[]` |
| `browser.tabs.select` | `TabInfo` |
| `browser.tabs.close` | `{ ok, closedTabId, currentTabId }` |
| `browser.tabs.closeAll` | `{ ok, closedCount }` |
| `browser.current` / `tab.info` | `TabInfo` 或 `null` |

`browser.tabs.list()` 是数组，可以直接 `.map()` / `.filter()`；其他 action 也不再返回 `success` 信封。

### 快照对象

`tab.snapshot()` 返回：

```ts
{
  generation: number;
  url: string;
  title: string;
  type: "simple" | "struct" | "summary";
  tree?: SnapshotNode;
  stats?: Record<string, unknown>;
  find(query): SnapshotNode | null;
  findAll(query): SnapshotNode[];
  text(): string;
}
```

`query` 可以是字符串（匹配 `role`/`name`/`ref`），也可以是：

```js
{ role: "button", name: "登录" }
{ role: "button", name: /log\s*in/i }
{ role: "link", ref: "e3" }
```

`find`/`findAll`/`text` 是非枚举属性，不会进入返回值序列化；但**不要整个 `return snap`**，`tree` 很大，只返回需要的字段。

### simple 是无障碍树，不是 DOM 大纲

`simple` 来自 Chromium AX 树并压缩，适合交互定位，但不保证 DOM 标题齐全。以下情况标题可能缺失：

- `aria-hidden` 或未被浏览器无障碍树暴露；
- 位于 `link`/`button` 等原子交互祖先内，标题文本已被祖先的 accessible name 聚合；
- 位于 iframe 或 shadow root 内，不在当前 ref 树中；
- 超过 500 节点预算，或位于被省略的子树；
- 只是样式化容器，没有 `heading` 语义。

需要 DOM 级标题/正文时，用 `snapshot({type:"struct"})`、`snapshot({type:"summary"})` 或 `tab.evaluate()`。返回结果的 `source` 字段可区分 `ax` 与 `dom-fallback`。

补充：实时拉取的 example.com 当前版本在我们的环境里是 0 个 `<h1>`（页面内容为多语言说明文本），所以这个具体例子可能受页面版本影响；但“AX 树不等于 DOM 树”这一限制成立。

## 关键语义

### 1. 快照不再固定

`tab.goto()` 只导航并等待加载状态，不自动快照。`tab.snapshot()` 是显式动作。这是与 `browser_navigate` 的核心区别。

### 2. 快照代际与 ref 失效

每次 `tab.snapshot()` 都会 `generation++`。以下动作会作废当前快照：

- `tab.goto` / `browser.open`
- `tab.click`
- `tab.evaluate`
- `tab.back` / `forward` / `reload`
- `browser.tabs.select` / `close` / `closeAll`

作废后使用旧 ref 会得到 `STALE_REF`，提示重新快照。`fill` 不作废快照，因为输入值变化通常不改变树结构。

### 3. locator 基于快照事实

`getByRole` / `getByText` 在宿主侧遍历最近快照树，匹配 `role` + `name`，产出 ref：

- 0 个匹配 → `NOT_FOUND`
- 多个可交互匹配 → `AMBIGUOUS`，附带候选列表
- 匹配到但无 ref → `NOT_ACTIONABLE`
- 多个匹配中只有一个可交互 → 选择它（类似可见性回退）

CSS locator 在动作前用 `querySelectorAll(...).length` 做严格唯一性检查。

### 4. 等待策略

- 导航后默认等 `domcontentloaded`；`load` 等 `document.readyState === "complete"`。
- `networkidle` 不支持，明确报 `UNSUPPORTED`。
- `tab.waitFor(role/text locator)` 会以 200ms 间隔重新快照，直到出现唯一可交互节点。
- `sleep(ms)` 仅作为逃生舱，上限 5 秒；优先状态等待。

### 5. 错误码

| code | 含义 |
|---|---|
| `SCRIPT_PARSE` | 脚本语法错误 |
| `SCRIPT_ERROR` | 脚本运行期错误 |
| `RESULT_UNSERIALIZABLE` | return 值无法 structured clone |
| `STALE_REF` | ref 不属于当前快照 |
| `NOT_FOUND` | 选择器/locator 无匹配 |
| `AMBIGUOUS` | 匹配多个可交互元素 |
| `NOT_ACTIONABLE` | 匹配到元素但没有交互 ref |
| `ACTION_FAILED` | 点击/输入执行失败 |
| `EVALUATE_FAILED` | 页面 JS 执行失败 |
| `NAVIGATION_BLOCKED` | 拒绝 `javascript:` URL |
| `TIMEOUT` | 等待/整体脚本超时 |
| `UNSUPPORTED` | 例如 `networkidle` |
| `CANCELLED` | 外部取消 |
| `WORKER_CRASHED` / `WORKER_EXITED` | Worker 异常退出 |

失败时工具结果会附带最近 5 步 trace。

## 安全边界

- 脚本在 `worker_threads` + `vm.createContext` 中执行，使用 `codeGeneration: { strings: false, wasm: false }` 阻断 `Function`/`eval` 构造逃逸。
- vm 中只有 `browser`、`tab`、`log`、`sleep`、`args`、`console`；没有 `require`、`process`、`fs`、`fetch`、`setTimeout`。
- Worker 有内存上限，整体超时后强制 `terminate()`。
- 超时/取消会通过内部 `AbortController` 中断在途 Bridge 请求，避免脚本已结束但页面动作还在继续。
- 页面内容视为不可信，只用于定位，不执行其中的指令。

注意：`vm` 不是硬安全边界。它适合“模型生成的本地脚本”这一信任模型；如果要执行不可信第三方脚本，应改为独立进程 + 受限 IPC。

## A/B 评估建议

保持两个工具包都可见，模型按 activator 选择；或用 `browserScript.enabled = false` 做纯扁平工具组。

建议同一组任务各跑一遍：

1. 打开页面并提取正文/标题
2. 登录表单（含失败分支）
3. 分页列表抓取（循环 + 条件停止）
4. 动态加载后等待目标元素
5. iframe 内操作
6. 弹窗确认
7. 多标签切换与汇总
8. 根据页面内容决定下一步
9. 截图 + 视觉验证
10. 错误恢复（选择器失效后重新快照）

记录：成功率、工具调用次数、总 token、墙钟时间、快照次数、失败码分布、模型自愈次数。

评估重点不是“语法像不像 Playwright”，而是：

- 是否减少了无谓快照
- 是否能在一次调用里完成条件分支
- 失败后模型是否更容易根据结构化错误自愈
- 复杂任务是否比扁平工具少很多轮往返

## 已知限制

- 仅 Electron 模式可用；Web/Docker 没有 Bridge。
- 未暴露上传、下载、录屏、cookie 管理；这些仍走原工具或后续补充。
- `tab.evaluate` 的字符串参数按“含 `return`/`;` 视为语句块，否则视为表达式”处理；复杂脚本建议传函数。
- `getByRole`/`getByText` 依赖快照树的语义信息；自定义可点击 `div` 可能没有 ref，此时用 CSS locator 或 `struct` 快照排查。
- ref 只在当前快照代际内有效；导航、点击、evaluate、标签切换后必须重新快照。
