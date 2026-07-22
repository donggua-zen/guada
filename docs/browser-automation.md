# 浏览器自动化

Electron 桌面端内嵌 Chromium 浏览器引擎，Agent 可直接操控浏览器完成各种 Web 操作。默认 `simple` 快照通过 Chromium 无障碍树生成精简的 role/name/ref YAML；需要排查无障碍语义缺失的元素时可使用 `struct` 获取详细 DOM JSON，阅读正文时可使用 `summary`。

## 架构

```
Electron 主进程
└── BrowserAutomationService
    ├── BrowserWindowManager → 多窗口管理
    │   ├── createWindow   → 新建浏览器窗口
    │   ├── closeWindow    → 关闭窗口
    │   └── getWindowList  → 窗口列表
    ├── 窗口生命周期
    │   ├── 5 分钟无操作自动关闭
    │   └── 最多 6 个并发窗口
    └── 操作引擎（14 种操作）
        ├── navigate / goBack / goForward / reload
        ├── click / fillForm / waitForSelector
        ├── executeJavaScript
        ├── getPageSimpleSnapshot ← AX 无障碍树（默认）
        ├── getPageStruct         ← 详细 DOM JSON
        ├── getPageText           ← 纯文本提取
        └── getPageSummary        ← 页面摘要

后端（Named Pipe / Unix Domain Socket）
└── BrowserPlugin → BridgeClient → Electron BridgeServer
    └── BrowserAutomationService.handleToolCall()
```

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

AI 可直接使用 `ref` 值（如 `e2`）在 `browser_interact` 中定位元素，无需构造 CSS 选择器。

### ref ID 机制

- 每次 `simple` 或 `struct` 快照调用时，在真实 DOM 元素上设置 `data-ai-ref` 属性（如 `data-ai-ref="e0"`）
- `simple` 通过 AX 节点的 `backendDOMNodeId` 将 ref 写回 DOM；`struct` 在 DOM 遍历时写入
- `browser_interact` 和 `browser_wait` 的 `selector` 参数同时支持 ref ID（`e0`）和 CSS 选择器
- 页面导航后旧 ref 失效，AI 应重新调用 `browser_snapshot` 获取新 ref

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



## 其他操作

### 页面操作

| 操作 | 说明 |
|------|------|
| **navigate(url)** | 打开 URL，等待 `did-finish-load` 事件 |
| **click(selector)** | ref ID（如 `e0`）或 CSS 选择器定位元素并触发 click |
| **fillForm(selector, value)** | ref ID 或 CSS 选择器定位输入框，赋值并触发 input/change 事件 |
| **executeJavaScript(code, isAsync)** | 页面上下文执行任意 JS |
| **goBack / goForward / reload** | 浏览器导航 |
| **waitForSelector(selector, timeout)** | 等待元素出现（ref ID 或 CSS 选择器，默认 10 秒） |

### 窗口管理

| 操作 | 说明 |
|------|------|
| **createWindow(url?)** | 创建新窗口，默认 6 个并发上限 |
| **closeWindow(windowId)** | 关闭指定窗口 |
| **getWindowList()** | 获取所有窗口（URL、标题、加载状态） |
| **openNewWindow(url, sessionPath?)** | 打开独立 session 的窗口 |

### 窗口隔离安全机制

每个自动化窗口使用独立的 Chromium session（`partition` 隔离），与主窗口 cookie/ localStorage 完全隔离，避免影响用户登录态。

### 超时回收

窗口无操作超过阈值（默认 5 分钟）自动关闭。超时时间可通过 `inactivityTimeout` 配置。

### 通信协议

```typescript
interface ToolRequest {
  id: string;      // 请求 ID
  method: string;  // 操作名
  params: any;     // 参数
}
interface ToolResponse {
  id: string;
  result?: any;    // 成功结果
  error?: string;  // 错误信息
}
```
