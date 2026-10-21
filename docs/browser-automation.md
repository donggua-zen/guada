# 浏览器自动化

> **已退役（2026-10）**：本文描述的扁平 `browser_*` 工具已从内置插件移除。当前浏览器自动化入口是 `browser-script` 插件的 `browser_run`，见 [browser-script.md](./browser-script.md)。底层 `BrowserAutomationService`、`BrowserWebviewManager`、`BrowserActionEngine` 与 CDP 快照管线仍被复用。

Electron 桌面端内嵌 Chromium 浏览器引擎，Agent 可直接操控浏览器完成各种 Web 操作。默认 `simple` 快照通过 Chromium 无障碍树生成精简的 role/name/ref YAML；需要排查无障碍语义缺失的元素时可使用 `struct` 获取详细 DOM JSON，阅读正文时可使用 `summary`。

## 架构

```
Electron 主进程
└── BrowserAutomationService
    ├── BrowserActionEngine → 动作探测 + trusted input
    ├── BrowserWindowManager → <webview> 标签管理
    │   ├── createWindow   → 新建标签
    │   ├── closeWindow    → 关闭标签
    │   └── getWindowList  → 标签列表
    ├── 窗口生命周期：无数量上限、无空闲自动关闭
    └── 操作引擎
        ├── navigate / goBack / goForward / reload
        ├── click / fillForm / hover / press / scroll / select / check
        ├── waitForSelector（attached/visible/hidden/detached）
        ├── executeJavaScript
        ├── getPageSimpleSnapshot ← AX 无障碍树（默认）
        ├── getPageStruct         ← 详细 DOM JSON
        └── getPageSummary        ← 页面摘要

后端（Named Pipe / Unix Domain Socket）
└── BrowserScriptPlugin (browser_run) → BridgeClient → Electron BridgeServer
    └── BrowserAutomationService.handleToolCall()
```

## 输入捕获与释放

预览窗口是主窗口内的 `<webview>`，页面可以通过 Pointer Lock 或 HTML Fullscreen 捕获鼠标/键盘（three.js 的 PointerLockControls、FPS 类游戏等很常见）。一旦捕获，宿主界面收不到鼠标事件，光标也会隐藏。

浏览器自动化为此提供宿主级释放机制：

| 操作 | 行为 |
|------|------|
| `Esc` | 释放指针锁 / 退出 HTML 全屏；**不拦截按键**，页面仍能收到 Esc（游戏自己的暂停菜单可用） |
| `Ctrl+Alt+R` | 宿主键，完全拦截；释放指针锁 / 全屏 / 键盘锁，并把焦点交回应用 |
| 切换标签、隐藏工作区、关闭标签 / 窗口 | 自动释放，避免后台页面继续锁定输入 |

释放后，主进程会在页面主世界设置临时封锁（`__guadaBlockPointerLock`），阻止页面在没有新用户手势的情况下立即重新 `requestPointerLock()`；下一次真实 `pointerdown` 会自动解除封锁，因此再次点击游戏画面即可重新锁定，行为类似虚拟机的 Host Key 切换。

实现位置：

- `electron/browser-tab-manager.ts`：在 guest WebContents 的 `before-input-event` 中拦截按键；释放脚本遍历主 frame 与所有 iframe 执行。
- `electron/browser-preload.ts`：监听 `pointerlockchange` / `fullscreenchange`，把状态上报主进程。
- `frontend/src/components/BrowserWebviewLayer.vue`：在预览区显示锁定提示与释放说明。

## 三种快照类型

| type | AI 输出格式 | 默认 | 适用场景 |
|------|----------|:---:|----------|
| **`simple`** | AX role/name/ref YAML | ✓ | 默认浏览和交互，token 最低 |
| **`struct`** | DOM role/ref JSON | | 无障碍树遗漏元素时深入检查 |
| **`summary`** | 文本 + 链接 + 标题 | | 阅读页面主要内容 |

`simple` 通过 CDP `Accessibility.getFullAXTree` 获取语义树，仅为可交互 DOM 节点分配 ref；CDP 不可用时自动回退到 DOM struct 压缩。实测见 [浏览器快照实测报告](./browser-snapshot-benchmark.md)。

---

## 详细 DOM 快照 (`struct`)

这是 GuaDa 浏览器自动化的**特色功能**。传统方案直接塞 HTML 给 AI，Token 消耗巨大。GuaDa 在浏览器端执行一系列压缩，将 DOM 树变成极精简的 YAML 结构树，每个节点用语义化的 `role` + `ref` 标识。

### 输出格式示例

```json
{
  "role": "document",
  "ref": "e0",
  "children": [
    {
      "role": "navigation",
      "ref": "e1",
      "children": [
        { "role": "link", "ref": "e2", "text": "首页", "href": "/" },
        { "role": "link", "ref": "e3", "text": "番剧", "href": "/anime" },
        { "role": "link", "ref": "e4", "text": "直播", "href": "/live" }
      ]
    }
  ]
}
```

AI 可直接使用 `ref` 值（如 `e2`）在 `browser_run` 的 `tab.click` / `tab.fill` 中定位元素，无需构造 CSS 选择器。

### ref ID 机制

- 每次 `simple` 或 `struct` 快照调用时，在真实 DOM 元素上设置 `data-ai-ref` 属性（如 `data-ai-ref="e0"`）
- `simple` 通过 AX 节点的 `backendDOMNodeId` 将 ref 写回 DOM；`struct` 在 DOM 遍历时写入
- `tab.click` / `fill` / `hover` / `press` / `scroll` / `selectOption` / `check` / `elementState` 的 target 同时支持 ref ID（`e0`）、CSS 选择器、快照节点和 locator
- 页面导航或改变 DOM 的动作后旧 ref 失效，模型应重新调用 `tab.snapshot()` 获取新 ref

### 压缩管线（6 层）

#### 第 1 层：无用元素跳过

遍历时跳过 `script / style / link / noscript / meta / iframe`，不修改真实 DOM：

```javascript
var unwantedTags = ['script', 'style', 'link', 'noscript', 'meta', 'iframe'];
// 在 getFilteredChildren 中跳过这些标签
```

#### 第 2 层：空元素折叠

遍历时跳过无文本、无子节点、无重要属性的容器元素（div/span/p/section/article/aside），保留交互元素（button/input/a/select）：

```javascript
function getFilteredChildren(element) {
  // 跳过空容器：!hasText && !hasChildren && !hasImportantAttrs
}
```

#### 第 3 层：role/ref 序列化

每个节点转为语义化的 `role` + 短 `ref` ID，而非 CSS 选择器字符串：

- `role`：显式 ARIA role > tag→role 映射（a→link, button→button, nav→navigation 等）> tag 名
- `ref`：自增短 ID（e0, e1, e2...），同时设置到真实 DOM 的 `data-ai-ref` 属性

```yaml
# 压缩前
<div class="video-list" id="feed">
  <a href="/video/BV1xx">视频标题</a>
</div>

# 压缩后
role: div
ref: e5
children:
  - role: link
    ref: e6
    text: 视频标题
    href: /video/BV1xx
```

#### 第 4 层：同源 URL 精简

站内链接从 `https://www.bilibili.com/video/BV1xx` 精简为 `/video/BV1xx`，去除协议和域名：

```javascript
if (attr.name === 'href' && value) {
  var urlObj = new URL(value, window.location.href);
  if (urlObj.host === currentHost) {
    value = urlObj.pathname + urlObj.search + urlObj.hash;
  }
}
```

#### 第 5 层：列表智能压缩（核心省 Token 手段）

同类型兄弟节点 > 10 个时，只保留头 5 个 + 尾 3 个，中间插入省略标记：

```javascript
groupMap.forEach(function(group, groupKey) {
  if (group.length > CONFIG.MAX_SIBLINGS) {
    // 保留头部 5 个
    for (var i = 0; i < headCount; i++) children.push(domToRefTree(group[i], depth + 1));
    // 插入省略标记
    children.push({ role: '...', text: 'Omitted N similar elements', omittedCount: N });
    // 保留尾部 3 个
    for (var j = group.length - tailCount; j < group.length; j++) children.push(domToRefTree(group[j], depth + 1));
  }
});
```

以 B 站首页为例，视频卡片列表从 50+ 项压缩为 8 项（5 头 + 省略标记 + 3 尾），AI 仍然知道列表结构和末尾项内容。

#### 第 6 层：深度限幅 + 极简优化

| 配置 | 值 | 作用 |
|------|-----|------|
| `MAX_DEPTH` | 50 | 最大递归深度，防止无限递归 |
| `SIMPLE_DEPTH` | 15 | 超过此深度只输出 `role` + `ref`，不展开 |
| `MAX_SIBLINGS` | 10 | 同类型兄弟节点超过此数触发列表压缩 |
| `KEEP_HEAD_COUNT` | 5 | 列表压缩保留的头部数量 |
| `KEEP_TAIL_COUNT` | 3 | 列表压缩保留的尾部数量 |
| `MAX_TEXT_LENGTH` | 100 | 单个节点文本截断长度 |
| `MAX_ATTR_VALUE_LENGTH` | 300 | 属性值截断长度 |
| 属性白名单 | href, data-\*-id, data-\*-url | 其他属性全部丢弃 |

**极简子节点优化**：当节点的所有子节点都只有 `role` + `ref` 时，自动转为 ref 字符串数组：

```yaml
# 展开形式
role: ul
ref: e3
children:
  - role: listitem
    ref: e4
  - role: listitem
    ref: e5

# 极简形式（省 50%+）
role: ul
ref: e3
children: [e4, e5]
```



## 当前 Bridge 契约

旧的 8 个 `browser_*` 扁平工具已退役；下面只列 `browser-script` runtime 实际使用的方法。

| method | 请求 | 成功返回 |
|---|---|---|
| `browser_navigate` | `url, new_tab?, wait_until?, session_path?, session_id?, created_by?` | `{ok, tabId, url, title, readyState?}` |
| `browser_snapshot` | `type?, wait_for_load?, created_by` | `{generation, type, url, title, source?, stats?, tree}` |
| `browser_click` | `selector, generation?, button?, click_count?, modifiers?, force?, timeout?, trusted?, created_by` | `{ok, action, target, url, title}` |
| `browser_input` | `selector, value, generation?, force?, timeout?, trusted?, created_by` | `{ok, action, target, value, url, title}` |
| `browser_hover` | `selector, generation?, force?, timeout?, trusted?, created_by` | `{ok, action, target, url, title}` |
| `browser_press` | `selector?, key, generation?, modifiers?, timeout?, trusted?, created_by` | `{ok, action, target?, key, url, title}` |
| `browser_scroll` | `selector?, delta_x?, delta_y?, timeout?, generation?, created_by` | `{ok, action, deltaX, deltaY, scrollX, scrollY, url, title}` |
| `browser_select` | `selector, values, generation?, force?, timeout?, created_by` | `{ok, action, target, selected, url, title}` |
| `browser_check` | `selector, checked?, generation?, force?, timeout?, trusted?, created_by` | `{ok, action, target, checked, url, title}` |
| `browser_element_state` | `selector, generation?, created_by` | probe 对象 |
| `browser_wait` | `selector, timeout?, state?, generation?, created_by` | `{ok, found, selector, state}` |
| `browser_evaluate` | `code, timeout_ms?, mutates?, created_by` | 页面结果原值 |
| `browser_screenshot` | `file_path?, session_path?, full_page?, created_by` | `{ok, path, width, height}` |
| `browser_console` | `created_by, clear?` | `string[]` |
| `browser_history` | `action: "back"\|"forward"\|"reload", created_by` | `{ok, url}` |
| `browser_tabs` | `action: "list"\|"current"\|"select"\|"close"\|"close_all", index?, tab_id?, created_by` | list: `TabInfo[]`；current: `TabInfo\|null`；select: `TabInfo`；close: `{ok,closedTabId,currentTabId}`；close_all: `{ok,closedCount}` |
| `browser_close_by_creator` | `created_by` | `{closedCount}` |

`TabInfo = { index, tabId, url, title, isCurrent }`。

### 导航等待

`browser_navigate.wait_until`：

- `none`：发起导航后立即返回，不等待加载；`readyState` 为 `loading`。
- `domcontentloaded`：等待 Electron `dom-ready`。
- `load`：等待 `did-stop-loading`（默认，保持旧行为）。

脚本的 `tab.goto` 默认传 `domcontentloaded`；`tab.waitForLoadState` 仍可用于显式等待。

### 快照 generation

- 每个 tab 维护一个 `generation`。
- `snapshot`、`navigate`、`reload`、`back/forward`、`click`、`hover`、`press`、`check`、`select`、`evaluate` 会递增；`fill`、`scroll`、`elementState`、`wait` 不递增。
- 动作可携带 `generation`；与当前 tab 不一致时返回 `STALE_REF`。
- 快照返回统一 `tree` 字段；`summary` 的 `tree` 是 `{text, links, headings}`。

### 动作可靠性

- 动作先经过 `BrowserActionEngine` 探测：存在、可见、启用、可编辑（fill）、稳定（两次采样）、在视口内、未被遮挡。
- 默认动作超时 3000ms；重试时按 `center → end → start → nearest` 轮换滚动对齐。
- 默认 trusted 输入：`webContents.sendInputEvent` 优先，CDP `Input.*` 兜底；`trusted:false` 才使用 JS 合成事件。
- `force:true` 跳过可见性/稳定性/遮挡检查，但仍要求元素存在。
- 失败返回 `NOT_ACTIONABLE`，`details.reason` 为 `hidden/disabled/not-editable/not-stable/outside-viewport/covered`。
- `fill` 对 select/file/checkbox/radio 返回 `UNSUPPORTED`；select/check 有独立方法。
- `browser_console` 默认只读，`clear:true` 才清空。

### 导航与截图安全

- 导航只允许 `http:`、`https:`、`about:blank`；`javascript:`、`file:`、`data:`、`chrome:` 返回 `NAVIGATION_BLOCKED`。newTab、当前 tab、`window.open` 转发统一校验。
- 截图 `file_path` 必须落在 `session_path` 内；绝对路径越界或 `..` 穿越返回 `INVALID_ARGUMENT`；无会话路径时只写临时目录。

### 错误

Bridge response 的错误统一为：

```typescript
interface BridgeError {
  code: string;       // 如 NOT_FOUND / STALE_REF / TIMEOUT / NAVIGATION_FAILED
  message: string;
  details?: unknown;
}
```

backend 的 `BridgeClient` 保留 `code/details`，runtime 再映射为脚本错误码。

### 窗口与隔离

- 所有标签共用 `persist:browser_shared`；会话隔离是 `createdBy` 过滤，**不是** cookie/localStorage 隔离。
- 当前没有窗口数量上限、空闲自动关闭或崩溃恢复；这些是后续资源治理项。
- 子 Agent 关闭时由 `browser-script` 插件调用 `browser_close_by_creator` 清理其标签。
