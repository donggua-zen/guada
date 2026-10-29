# Browser Script（脚本化浏览器自动化）

> 当前唯一浏览器自动化入口：旧扁平 `browser_*` 工具已退役，`browser_run` 是替代入口；后端通过 Bridge 复用 Electron 的浏览器服务。

## 设计

`browser_run` 里运行一段 JavaScript，模型通过 `tab.*` / `browser.*` 编排浏览器操作。API 是 Playwright 风格的子集：

- `tab.snapshot()` 只用于**观察页面**，返回语义树，不返回 ref。
- 动作使用 **locator**：`getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle/locator(css)`。
- locator 在动作时由 Electron 注入的 ivya 引擎 live 解析，不再有 `ref` / `generation` / `STALE_REF`。

这样页面重新渲染后，同一个 locator 仍然可以在下一次动作时重新找到元素；模型也不需要把 ref 从一个脚本带到另一个脚本。

## 架构

```
LLM
 → browser_run（browser-script 工具包，eager）
 → BrowserScriptRuntime（NestJS 后端）
 → Worker + vm（模型脚本执行，可强制终止）
 → BridgeClient（Named Pipe / UDS）
 → Electron BridgeServer
 → BrowserAutomationService
 → BrowserLocatorEngine（ivya，isolated world）
 → BrowserActionEngine（actionability + trusted input）
 → <webview> guest WebContents
```

## Bridge 映射

| 脚本调用 | Bridge 方法 |
|---|---|
| `tab.goto` / `browser.open` | `browser_navigate` |
| `tab.snapshot` / `browser.snapshot` | `browser_snapshot` |
| `tab.click/fill/hover/press/scroll/selectOption/check/uncheck/elementState/waitFor` | `browser_locator` |
| `locator.*` | `browser_locator` |
| `tab.press(key)`（无 target） | `browser_press` |
| `tab.scroll({deltaX,deltaY})`（无 target） | `browser_scroll` |
| `tab.waitForLoadState` | `browser_evaluate` 轮询 `document.readyState` |
| `tab.evaluate` | `browser_evaluate` |
| `tab.screenshot` | `browser_screenshot` |
| `tab.setViewportSize` | `browser_set_viewport` |
| `tab.console` | `browser_console` |
| `tab.back/forward/reload` | `browser_history` |
| `browser.tabs.*` / `browser.current` | `browser_tabs` |

会话所有权沿用既有约定：`created_by = ctx.session.sessionId`，`session_id = parentSessionId || sessionId`，`session_path = workspacePath`。

## 加载方式

- 插件 id：`browser-script`，只在 `ELECTRON_APP === "true"` 时注册。
- 工具本身 **eager**：`browser_run` 直接进入 function-calling tools 数组。
- 完整 API 指南注册为插件技能 `browser-script`：复杂脚本前调用 `skill_learn("browser-script")` 按需加载。
- 按智能体控制时走 `settings.plugins` 的 toolkits 白名单/黑名单（toolkit id 为 `browser-script`）。

## 模型 API

### browser

| 调用 | 说明 |
|---|---|
| `browser.open(url, { newTab? })` | 导航；不自动快照 |
| `browser.tabs.list()` | 列出当前会话标签，返回 `TabInfo[]` |
| `browser.tabs.select(index)` | 切换当前标签，返回选中的 `TabInfo` |
| `browser.tabs.close(index?)` | 关闭标签，返回 `{ ok, closedTabId, currentTabId }` |
| `browser.tabs.closeAll()` | 关闭当前会话全部标签，返回 `{ ok, closedCount }` |
| `browser.snapshot({ type? })` | 同 `tab.snapshot` |
| `browser.current()` | `TabInfo` 或 `null` |

### tab

| 调用 | 说明 |
|---|---|
| `tab.goto(url, { newTab?, waitUntil? })` | `waitUntil`: `"domcontentloaded"`（默认）、`"load"`、`"none"` |
| `tab.snapshot({ type? })` | `simple`（默认）/ `struct` / `summary`；只观察，不产生动作句柄 |
| `tab.click(target, options)` | 任意元素；动作前自动等待可操作性 |
| `tab.fill(target, value, options)` | 文本输入/textarea/contenteditable |
| `tab.hover(target, options)` | 悬停 |
| `tab.press(key, { target?, modifiers?, timeout? })` | `Enter`、`Tab`、`Escape`、`ArrowDown`、`Control+A` 或单字符 |
| `tab.scroll({ target?, deltaX?, deltaY?, timeout? })` | 有 target 时在元素处滚动；无 target 时滚动页面 |
| `tab.selectOption(target, values, options)` | `<select>`；values 支持字符串/数组/`{value,label,index}` |
| `tab.check(target, checked?, options)` / `uncheck` | checkbox/radio；动作后回读状态 |
| `tab.elementState(target)` | 只探测，不动作 |
| `tab.waitFor(target, { state?, timeout? })` | `visible`（默认）/`attached`/`hidden`/`detached` |
| `tab.getByRole(...)` / `getByText` / `getByLabel` / `getByPlaceholder` / `getByTestId` / `getByAltText` / `getByTitle` / `locator(css)` | 创建 locator |
| `tab.waitForLoadState("domcontentloaded" \| "load", { timeout? })` | 默认 3 秒；`networkidle` 明确拒绝 |
| `tab.evaluate(fnOrExpression, arg?)` | 页面 JS |
| `tab.screenshot({ fullPage?, saveTo? })` | 截图只落一份到会话附件目录；工具结果给出绝对路径，最近 6 张附图；`saveTo` 额外导出原始 PNG 到工作区 |
| `tab.setViewportSize({ width, height, tabId? })` | 设置固定渲染视口（整数，宽 320–3840、高 240–2160）；不导航、不激活标签；返回实际生效尺寸与 `applied` |
| `tab.console({ clear? })` | 默认只读日志；`clear:true` 才清空 |
| `tab.back()` / `forward()` / `reload()` | 历史导航 |
| `log(message)` / `sleep(ms)` / `args` | `sleep` 上限 5 秒 |

### locator

| 方法 | 说明 |
|---|---|
| `.click(options?)` / `.fill(value, options?)` | 动作 |
| `.hover(options?)` / `.press(key, options?)` / `.scroll(options?)` | 动作 |
| `.selectOption(values, options?)` / `.check(checked?, options?)` / `.uncheck(options?)` | 表单控件动作 |
| `.state()` | 只探测不动作 |
| `.count()` | 匹配数量 |
| `.text()` | 第一个匹配元素的 `innerText`/`textContent` |
| `.isVisible()` | 当前是否有可见匹配 |
| `.waitFor({ state?, timeout? })` | 等待 `attached/visible/hidden/detached` |
| `.first()` / `.last()` / `.nth(index)` | 显式位置选择 |
| `.locator(css)` / `.getByRole(...)` 等 | 在父级匹配元素内继续查询，可链式 |

链式 locator 等价于 Playwright 的作用域 locator：父级先解析成元素集合，子查询只在每个父元素内部进行，结果按元素身份去重；`first/last/nth` 作用于调用它的那一级。

```js
const row = tab.getByRole("row", { name: "Bob" });
await row.getByRole("button", { name: "Delete" }).click();

const target = tab.locator("article").nth(4);
await target.locator("p").first().hover();
```

未实现的其他 Playwright Locator 方法（`filter`、`all`、`getAttribute`、`inputValue`、`isChecked`、`dragTo`、`setInputFiles` 等）会抛 `UNSUPPORTED`，错误信息列出当前支持的方法；读取属性或计算样式请用 `tab.evaluate(...)`。

### target

`target` 可以是：

- CSS selector 字符串
- `getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle/locator` 返回的 locator 对象

**不再接受** `eN` ref 或带 `ref` 的快照节点；旧写法会返回 `INVALID_ARGUMENT` 迁移提示。

### 返回值

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
| `locator.click` / `hover` / `press` | `{ ok, action, target?, url, title, ... }` |
| `locator.fill` | `{ ok, action, target, value, url, title }` |
| `locator.selectOption` | `{ ok, action, target, selected, url, title }` |
| `locator.check` / `uncheck` | `{ ok, action, target, checked, url, title }` |
| `locator.scroll` | `{ ok, action, deltaX, deltaY, scrollX, scrollY, url, title }` |
| `locator.state` | probe 对象（found/visible/enabled/editable/stable/inViewport/covered/rect/viewport） |
| `locator.count` | number |
| `locator.text` | string |
| `locator.isVisible` | boolean |
| `locator.waitFor` | `{ ok, found, state, descriptor }` |
| `tab.snapshot` | `{ type, url, title, tree, source?, stats? }` |
| `tab.waitForLoadState` | `{ state }` |
| `tab.screenshot` | `{ ok, path, width, height }` |
| `tab.back` / `forward` / `reload` | `{ ok, url }` |
| `tab.console` | console 日志数组 |
| `browser.tabs.list` | `TabInfo[]` |
| `browser.tabs.select` | `TabInfo` |
| `browser.tabs.close` | `{ ok, closedTabId, currentTabId }` |
| `browser.tabs.closeAll` | `{ ok, closedCount }` |
| `browser.current` / `tab.info` | `TabInfo` 或 `null` |

## 快照对象

`tab.snapshot()` 返回：

```ts
{
  type: "simple" | "struct" | "summary";
  url: string;
  title: string;
  tree?: SnapshotNode;
  source?: "ax" | "dom-fallback";
  stats?: Record<string, unknown>;
  find(query): SnapshotNode | null;
  findAll(query): SnapshotNode[];
  text(): string;
}
```

快照节点只包含语义信息（role/name/value/state/children），**没有 ref**。`find`/`findAll` 用于从快照事实中挑选节点，然后根据 role/name/text 构造 locator。

### simple 是无障碍树，不是 DOM 大纲

`simple` 来自 Chromium AX 树并压缩，适合交互定位，但不保证 DOM 标题齐全。以下情况标题可能缺失：

- `aria-hidden` 或未被浏览器无障碍树暴露；
- 位于 `link`/`button` 等原子交互祖先内，标题文本已被祖先的 accessible name 聚合；
- 位于 iframe 或 shadow root 内，不在当前语义树中；
- 超过 500 节点预算，或位于被省略的子树；
- 只是样式化容器，没有 `heading` 语义。

需要 DOM 级标题/正文时，用 `snapshot({type:"struct"})`、`snapshot({type:"summary"})` 或 `tab.evaluate()`。

## 关键语义

### 1. 快照只观察

`tab.goto()` 只导航并按 `waitUntil` 等待加载状态，不自动快照。`tab.snapshot()` 是显式观察动作。快照可能过期，但 locator 动作不依赖快照，动作时会重新解析当前 DOM。

### 2. locator 是 live 的

`getByRole/getByText/...` 返回查询条件，不是元素。点击/输入时由 Electron 的 ivya 引擎在 isolated world 重新查询当前页面：

- 0 个匹配 → `NOT_FOUND`
- 1 个匹配 → 执行动作
- 多个匹配 → `AMBIGUOUS`，details 带候选

`first()/last()/nth()` 是显式消歧；默认不会自动取第一个。

### 3. 动作可靠性

- 动作前探测：存在、可见、启用、可编辑（fill）、稳定（两次采样）、视口内、未被遮挡。
- 默认动作超时 3000ms（最大 30000ms），每 75ms 重新探测并按 `center → end → start → nearest` 轮换滚动对齐。
- 默认 trusted 输入：`webContents.sendInputEvent` 优先，CDP `Input.*` 兜底；`trusted:false` 才使用 JS 合成事件。
- `force:true` 跳过可见性/稳定性/遮挡检查，但仍要求元素存在。
- `fill` 对 select/file/checkbox/radio 返回 `UNSUPPORTED`，文本类控件写入后会回读值。
- 动作结果带 `url`/`title`。

### 4. 等待策略

- `tab.goto` 默认 `domcontentloaded`。
- `locator.waitFor` 默认 `state:"visible"`；支持 `attached`、`hidden`、`detached`。
- `networkidle` 不支持，明确报 `UNSUPPORTED`。
- 动作本身已经自动等待，不要再在 click/fill 前加 `sleep`。
- `sleep(ms)` 仅作为逃生舱，上限 5 秒。

### 5. 错误码

| code | 含义 |
|---|---|
| `SCRIPT_PARSE` | 脚本语法错误 |
| `SCRIPT_ERROR` | 脚本运行期错误 |
| `RESULT_UNSERIALIZABLE` | return 值无法 structured clone |
| `NOT_FOUND` | locator 无匹配 |
| `AMBIGUOUS` | 匹配多个元素；details.candidates |
| `NOT_ACTIONABLE` | 元素存在但未通过 actionability；details.reason |
| `ACTION_FAILED` | 输入已派发但效果无法验证 |
| `UNSUPPORTED` | select/file/checkbox 用 fill、shadow 动作、networkidle 等 |
| `EVALUATE_FAILED` | 页面 JS 执行失败 |
| `NAVIGATION_FAILED` | 导航失败或落在错误页 |
| `TABS_FAILED` | 标签操作失败 |
| `TAB_NOT_FOUND` | 当前标签已消失 |
| `SCREENSHOT_FAILED` | 截图/落盘失败 |
| `CONSOLE_FAILED` | console 日志读取失败 |
| `NAVIGATION_BLOCKED` | 只允许 http:/https:/about:blank |
| `TIMEOUT` | 等待/动作/整体脚本超时 |
| `INVALID_ARGUMENT` | 参数非法，包括已移除的 ref target |
| `UNKNOWN_ACTION` / `UNKNOWN_METHOD` | 未知操作 |
| `WORKER_CRASHED` / `WORKER_EXITED` / `WORKER_START_FAILED` | Worker 异常 |
| `CANCELLED` | 外部取消 |
| `CALL_FAILED` | Bridge 断线或未知后端错误 |

失败时工具结果会附带最近 5 步 trace 和 error details。

## 安全边界

- 脚本在 `worker_threads` + `vm.createContext` 中执行，使用 `codeGeneration: { strings: false, wasm: false }` 阻断 `Function`/`eval` 构造逃逸。
- vm 中只有 `browser`、`tab`、`log`、`sleep`、`args`、`console`；没有 `require`、`process`、`fs`、`fetch`、`setTimeout`。
- Worker 有内存上限，整体超时后强制 `terminate()`。
- 超时/取消会通过内部 `AbortController` 停止本地等待并 reject 在途 Promise；Bridge 没有 cancel 协议，已写入管道的 Electron 动作可能继续执行到结束。
- ivya 注入在 isolated world，页面脚本不能替换查询引擎；查询结果通过临时 `data-guada-loc` 属性交给动作引擎，动作结束后清理。
- 导航白名单只允许 `http:`、`https:`、`about:blank`。
- 截图不再写工作区：字节回传后端转码后只落一份会话副本（`sessions/<id>/images|previews/`）；`saveTo` 是唯一显式导出通道，目标必须落在工作区内，`read-only` 沙箱拒绝。

## 已知限制

- 仅 Electron 模式可用；Web/Docker 没有 Bridge。
- 未暴露上传、下载、录屏、cookie 管理。
- Shadow DOM：open shadow root 可查询/计数/读取，但动作暂不支持；closed shadow root 不可见。
- iframe：locator 只查顶层文档，iframe 内元素不可见。
- `locator.first/last/nth` 对 CSS locator 的动作也生效；CSS 选择器本身仍建议唯一。
- `locator.text()` 返回 `innerText`/`textContent`，不是 accessible name。
- `tab.evaluate` 的字符串参数按“含 `return`/`;` 视为语句块，否则视为表达式”处理；复杂脚本建议传函数。
