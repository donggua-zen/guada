# Browser Script（脚本化浏览器自动化）

> 当前唯一浏览器自动化入口：旧 8 个 `browser_*` 工具已退役，`browser_run` 是替代入口；后端复用同一套 Electron Bridge。

## 为什么需要它

旧的 `browser_*` 工具在简单场景很好用，但决策被固定死了：

- `browser_navigate` 默认等 3 秒再自动快照，模型无法决定“这次不需要快照”。
- 交互后是否重新快照、是否重试、是否根据页面内容分支，都要跨多次工具调用完成。
- 快照是一大段文本，模型只能读，不能在返回前过滤。

另外，脚本里的浏览器调用必须 `await`。如果脚本在调用尚未完成时返回，运行器会停止本地等待并尝试中断在途请求；但 Bridge 目前没有 cancel 协议，已下发的页面动作可能继续执行，副作用处于“不确定”状态。

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
| `tab.hover` | `browser_hover` |
| `tab.press` | `browser_press` |
| `tab.scroll` | `browser_scroll` |
| `tab.selectOption` | `browser_select` |
| `tab.check` / `uncheck` | `browser_check` |
| `tab.elementState` | `browser_element_state` |
| `tab.waitFor` | `browser_wait` |
| `tab.waitForLoadState` | `browser_evaluate` 轮询 `document.readyState` |
| `tab.evaluate` | `browser_evaluate` |
| `tab.screenshot` | `browser_screenshot` |
| `tab.console` | `browser_console` |
| `tab.back` / `forward` / `reload` | `browser_history` |
| `browser.tabs.*` / `browser.current` | `browser_tabs` |

会话所有权参数沿用浏览器服务既有约定：`created_by = ctx.session.sessionId`，`session_id = parentSessionId || sessionId`，`session_path = workspacePath`。

## 加载方式与开关

- 插件 id：`browser-script`，只在 `ELECTRON_APP === "true"` 时注册。
- 工具本身 **eager**：`browser_run` 直接进入 function-calling tools 数组，不再需要 `tool_learn` + `tool_use`。脚本参数只经过一层 JSON 对象，schema 在调用时就可见。
- 完整 API 指南注册为插件技能 `browser-script`：复杂脚本前调用 `skill_learn("browser-script")` 按需加载；系统提示词里只常驻一行技能列表。
- 工具描述保留核心 API 摘要，因此即使技能被禁用或按 agent 过滤，`browser_run` 仍可用。
- 干净的 A/B 对照应禁用整个 `browser-script` 插件（工具和技能同时消失）。按会话/智能体控制时走 `settings.plugins` 的 toolkits 白名单/黑名单（toolkit id 为 `browser-script`）；没有独立的 `settings.browserScript` 会话开关。
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
| `tab.click(target, { button?, clickCount?, modifiers?, force?, timeout?, trusted? })` | 动作前自动等待 visible/enabled/stable/not-covered；默认 3000ms |
| `tab.fill(target, value, { force?, timeout?, trusted? })` | 文本输入/textarea/contenteditable；select/file/check 系列明确 `UNSUPPORTED` |
| `tab.hover(target, { force?, timeout? })` | 悬停；可能展开菜单 |
| `tab.press(key, { target?, modifiers?, timeout? })` | `Enter`、`Tab`、`Escape`、`ArrowDown`、`Control+A` 或单字符 |
| `tab.scroll({ target?, deltaX?, deltaY?, timeout? })` | 有 target 时在元素处滚动；无 target 时滚动页面 |
| `tab.selectOption(target, values, { force?, timeout? })` | values 支持字符串/数组/`{value,label,index}` |
| `tab.check(target, checked?, { force?, timeout? })` / `uncheck` | checkbox/radio；动作后回读状态 |
| `tab.elementState(target)` | 只探测，返回 visible/enabled/editable/stable/covered 等 |
| `tab.getByRole(role, { name?, exact? })` | 返回 locator |
| `tab.getByText(text, { exact? })` | 返回 locator |
| `tab.locator(cssSelector)` | 返回严格 CSS locator |
| `tab.waitFor(target, { state?, timeout? })` | `state`: `visible`（默认）/`attached`/`hidden`/`detached` |
| `tab.waitForLoadState("domcontentloaded" \| "load", { timeout? })` | 默认 3 秒；`networkidle` 明确拒绝 |
| `tab.evaluate(fnOrExpression, arg?)` | 页面 JS；函数会以 `arg` 调用，字符串按表达式/语句块处理 |
| `tab.screenshot({ filePath?, fullPage? })` | 保存 PNG 到会话目录；多模态模型会收到图片引用 |
| `tab.console({ clear? })` | 默认只读日志；`clear:true` 才清空 |
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
| `.click(options?)` / `.fill(value, options?)` | 严格定位后动作 |
| `.hover(options?)` / `.press(key, options?)` / `.scroll(options?)` | 同 `tab.*` 语义 |
| `.selectOption(values, options?)` / `.check(checked?, options?)` / `.uncheck(options?)` | 表单控件动作 |
| `.state()` | 只探测不动作 |
| `.count()` | 匹配数量（role/text 含非交互节点） |
| `.text()` | 第一个匹配节点的 `name`/`text` |
| `.isVisible()` | 通过 `browser_element_state` 检查真实 DOM 可见性 |
| `.waitFor({ state?, timeout? })` | selector 走 `browser_wait`，role/text 轮询快照 |
| `.first()` / `.last()` / `.nth(index)` | role/text locator 支持；CSS locator 仅支持 `count()`/`text()`，动作请用唯一 selector |

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
| `tab.goto` / `browser.open` | `{ ok, tabId, url, title, readyState? }` |
| `tab.click` / `hover` / `press` | `{ ok, action, target?, url, title, ... }` |
| `tab.fill` | `{ ok, action, target, value, url, title }` |
| `tab.selectOption` | `{ ok, action, target, selected, url, title }` |
| `tab.check` / `uncheck` | `{ ok, action, target, checked, url, title }` |
| `tab.scroll` | `{ ok, action, deltaX, deltaY, scrollX, scrollY, elementScrollTop?, elementScrollLeft?, url, title }` |
| `tab.elementState` | probe 对象（found/visible/enabled/editable/stable/inViewport/covered/rect/viewport） |
| `tab.waitFor` | `{ ok, found, selector, state }` |
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

`tab.goto()` 只导航并按 `waitUntil` 等待加载状态，不自动快照。`tab.snapshot()` 是显式动作。这是与旧 `browser_navigate` 工具的核心区别（旧工具已退役）。

### 2. 快照代际与 ref 失效

`generation` 由后端按 tab 维护：`tab.snapshot()` 返回当前代际，动作可携带它；代际不一致时后端直接返回 `STALE_REF`。

以下动作会作废当前快照：

- `tab.goto` / `browser.open`
- `tab.click`
- `tab.hover`
- `tab.press`
- `tab.check` / `tab.uncheck`
- `tab.selectOption`
- `tab.evaluate`
- `tab.back` / `forward` / `reload`
- `browser.tabs.select` / `close` / `closeAll`

作废后使用旧 ref 会得到 `STALE_REF`，提示重新快照。`fill`、`scroll`、`elementState`、`waitFor` 不作废快照；`fill` 后端也不会递增 generation。

### 3. locator 基于快照事实

`getByRole` / `getByText` 在宿主侧遍历最近快照树，匹配 `role` + `name`，产出 ref：

- 0 个匹配 → `NOT_FOUND`
- 多个可交互匹配 → `AMBIGUOUS`，附带候选列表
- 匹配到但无 ref → `NOT_ACTIONABLE`
- 多个匹配中只有一个可交互 → 选择它（类似可见性回退）

CSS locator 在动作前用 `querySelectorAll(...).length` 做严格唯一性检查。

### 4. 动作可靠性

- 每个动作先做 actionability 探测：存在、可见、启用、可编辑（fill）、两次采样稳定、在视口内、未被其他元素遮挡。
- 默认动作超时 3000ms（最大 30000ms），每 75ms 重新探测并按 `center → end → start → nearest` 轮换滚动对齐。
- 默认使用 trusted 输入：优先 `webContents.sendInputEvent`，失败回退 CDP `Input.*`；`trusted:false` 才使用 JS 合成事件。
- `force:true` 跳过可见性/稳定性/遮挡检查，但仍要求元素存在；只在自定义控件确实无法通过命中测试时使用。
- `fill` 不静默降级：select/file/checkbox/radio 返回 `UNSUPPORTED`，文本类控件写入后会回读值。
- 动作结果带 `url`/`title`，便于脚本判断是否发生导航，减少额外 `tab.info()` 调用。

### 5. 等待策略

- `tab.goto` 默认 `domcontentloaded`，由后端等待 `dom-ready`；`load` 等 `did-stop-loading`。
- `tab.waitFor` 默认 `state:"visible"`；需要只等存在时传 `attached`，等消失时传 `hidden`/`detached`（CSS/ref）。
- `networkidle` 不支持，明确报 `UNSUPPORTED`。
- `tab.waitFor(role/text locator)` 会以 200ms 间隔重新快照，直到出现唯一可交互节点，再等待 DOM 可见状态。
- 动作本身已经自动等待，不要再在 click/fill 前加 `sleep`。
- `sleep(ms)` 仅作为逃生舱，上限 5 秒。

### 6. 错误码

| code | 含义 |
|---|---|
| `SCRIPT_PARSE` | 脚本语法错误 |
| `SCRIPT_ERROR` | 脚本运行期错误 |
| `RESULT_UNSERIALIZABLE` | return 值无法 structured clone |
| `STALE_REF` | ref 不属于当前快照 |
| `NOT_FOUND` | 选择器/locator 无匹配 |
| `AMBIGUOUS` | 匹配多个可交互元素 |
| `NOT_ACTIONABLE` | 元素存在但未通过 actionability；`details.reason` 为 hidden/disabled/not-editable/not-stable/outside-viewport/covered |
| `ACTION_FAILED` | 输入已派发但效果无法验证，或元素在动作中消失 |
| `UNSUPPORTED` | select/file/checkbox 用 fill、radio uncheck、networkidle 等 |
| `EVALUATE_FAILED` | 页面 JS 执行失败 |
| `NAVIGATION_FAILED` | 导航失败或落在错误页 |
| `TABS_FAILED` | 标签操作失败 |
| `TAB_NOT_FOUND` | 当前标签已消失 |
| `SCREENSHOT_FAILED` | 截图/落盘失败 |
| `CONSOLE_FAILED` | console 日志读取失败 |
| `NAVIGATION_BLOCKED` | 只允许 http:/https:/about:blank |
| `TIMEOUT` | 等待/动作/整体脚本超时 |
| `INVALID_ARGUMENT` | 参数非法 |
| `UNKNOWN_ACTION` / `UNKNOWN_METHOD` | 未知操作 |
| `WORKER_CRASHED` / `WORKER_EXITED` / `WORKER_START_FAILED` | Worker 异常 |
| `CANCELLED` | 外部取消 |
| `CALL_FAILED` | Bridge 断线或未知后端错误 |

失败时工具结果会附带最近 5 步 trace。

## 安全边界

- 脚本在 `worker_threads` + `vm.createContext` 中执行，使用 `codeGeneration: { strings: false, wasm: false }` 阻断 `Function`/`eval` 构造逃逸。
- vm 中只有 `browser`、`tab`、`log`、`sleep`、`args`、`console`；没有 `require`、`process`、`fs`、`fetch`、`setTimeout`。
- Worker 有内存上限，整体超时后强制 `terminate()`。
- 超时/取消会通过内部 `AbortController` 停止本地等待并 reject 在途 Promise；Bridge 目前没有 cancel 协议，已写入管道的 Electron 动作可能继续执行到结束。
- 页面内容视为不可信，只用于定位，不执行其中的指令。
- 导航白名单只允许 `http:`、`https:`、`about:blank`；`javascript:`、`file:`、`data:`、`chrome:` 都会被 `NAVIGATION_BLOCKED` 拒绝。
- 截图 `filePath` 必须落在会话目录内；绝对路径越界或 `..` 穿越会返回 `INVALID_ARGUMENT`。

注意：`vm` 不是硬安全边界。它适合“模型生成的本地脚本”这一信任模型；如果要执行不可信第三方脚本，应改为独立进程 + 受限 IPC。

## 评估建议

旧扁平工具已退役，评估重点从“脚本 vs 扁平工具”转为“脚本 API 是否足够可靠”。建议同一组任务各跑一遍：

1. 打开页面并提取正文/标题
2. 登录表单（含失败分支）
3. 分页列表抓取（循环 + 条件停止）
4. 动态加载后等待目标元素
5. 自定义下拉框/复选框（selectOption / check / force）
6. 悬停菜单与键盘快捷键
7. 多标签切换与汇总
8. 根据页面内容决定下一步
9. 截图 + 视觉验证
10. 错误恢复（选择器失效后重新快照）

记录：成功率、动作失败原因分布（`NOT_ACTIONABLE.reason`）、重试次数、快照次数、总 token、墙钟时间。

评估重点：

- 动作是否真正生效（页面侧 `isTrusted`、状态回读）
- 失败原因是否足以让模型自愈
- 是否减少了无谓快照和 sleep
- 复杂任务是否比拆成多次工具调用更少往返

## 已知限制

- 仅 Electron 模式可用；Web/Docker 没有 Bridge。
- 未暴露上传、下载、录屏、cookie 管理；iframe/shadow DOM 跨文档定位也尚未支持。
- `getByRole`/`getByText` 依赖快照树的语义信息；自定义可点击 `div` 可能没有 ref，此时用 CSS locator 或 `struct` 快照排查。
- `locator.first/last/nth` 目前只对 role/text locator 生效；CSS locator 的动作仍要求唯一 selector。
- 快照 ref 只在当前代际内有效；导航、点击、悬停、按键、check/select、evaluate、标签切换后必须重新快照。
- `fill` 对 select/file/checkbox/radio 返回 `UNSUPPORTED`；自定义控件隐藏原生 checkbox/select 时，可能需要对其可见 label 操作或使用 `force`。
- `tab.evaluate` 的字符串参数按“含 `return`/`;` 视为语句块，否则视为表达式”处理；复杂脚本建议传函数。
