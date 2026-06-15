# 浏览器自动化

Electron 桌面端内嵌 Chromium 浏览器引擎，Agent 可直接操控浏览器完成各种 Web 操作。核心亮点是 **智能页面压缩**：将完整 HTML DOM 蒸馏为极简的选择器结构树，为 AI 提供完整的页面骨骼与全局视野。当需要深入特定区域时，AI 可通过 `executeJavaScript` 注入 JS 精确获取该片段的完整细节，在 Token 成本与信息完备性之间取得动态平衡。

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
        ├── getPageStruct   ← 智能压缩
        ├── getPageText     ← 纯文本提取
        ├── getPageSummary  ← 页面摘要
        └── 截图（内置于 getPageStruct）

后端 (IPC 通信)
└── browser-tool.provider.ts
    └── handleToolCall(request) → Electron → 结果回传 Agent
```

## 三种页面读取方式

| 方式 | 输出格式 | Token 消耗 | 适用场景 |
|------|----------|-----------|----------|
| **`getPageStruct`** | 选择器树 JSON | 🔥 极低（省 70%+） | AI 理解页面结构和内容 |
| **`getPageText`** | 纯文本 | 🔥 低 | 仅需文本内容 |
| **`getPageSummary`** | 结构化摘要（文本+链接+标题） | 🔥 最低 | 快速浏览页面概要 |

---

## 🔥 核心特色：智能页面压缩 (`getPageStruct`)

这是 GuaDa 浏览器自动化的**特色功能**。传统方案直接塞 HTML 给 AI，Token 消耗巨大。GuaDa 在浏览器端执行一系列压缩，将 DOM 树变成极精简的选择器 JSON。

### 压缩管线（6 层）

#### 第 1 层：无用元素剥离

```javascript
// 1. 移除 script / style / link / noscript / meta / iframe
const unwantedElements = clone.querySelectorAll('script, style, link, noscript, meta, iframe');

// 2. 清空 SVG（仅保留占位，移除所有属性和子节点）
svgs.forEach(svg => {
  while (svg.attributes.length > 0) svg.removeAttribute(...);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
});

// 3. 清理 blob: / object: URL（克隆后无法访问，避免引用错误）
function cleanBlobUrls(node) { ... }

// 4. 移除注释节点
function removeComments(node) { ... }
```

#### 第 2 层：空元素折叠

递归移除无文本、无子节点、无重要属性的容器元素（div/span/p/section/article/aside），保留交互元素（button/input/a/select）：

```javascript
function removeEmptyElements(node) {
  const isFormElement = ['button', 'input', 'select', 'textarea', 'form'].includes(tagName);
  const isInteractive = ['a', 'label'].includes(tagName);
  
  if (!isFormElement && !isInteractive && /* 容器标签 */) {
    if (!hasText && !hasChildren && !hasImportantAttrs) {
      child.parentNode.removeChild(child); // ← 直接移除
    }
  }
}
```

#### 第 3 层：选择器序列化

每个节点转为 `tag.class1.class2#id` 格式的选择器字符串，而非完整 HTML：

```json
// 压缩前
<div class="video-list" id="feed">
  <div class="video-item">...</div>
</div>

// 压缩后
{ "node": "div.video-list#feed", "child": [...] }
```

#### 第 4 层：同源 URL 精简

站内链接从 `https://www.bilibili.com/video/BV1xx` 精简为 `/video/BV1xx`，去除协议和域名：

```javascript
if (attr.name === 'href' && value) {
  const urlObj = new URL(value, window.location.href);
  if (urlObj.host === currentHost) {
    value = urlObj.pathname + urlObj.search + urlObj.hash;
  }
}
```

#### 第 5 层：列表智能压缩（核心省 Token 手段）

同类型兄弟节点 > 10 个时，只保留头 5 个 + 尾 3 个，中间插入省略标记：

```javascript
groupMap.forEach((group, groupKey) => {
  if (group.length > CONFIG.MAX_SIBLINGS) {
    // 保留头部 5 个
    for (let i = 0; i < headCount; i++) children.push(group[i]);
    // 插入省略标记
    children.push({
      node: '...',
      warning: `Omitted ${omittedCount} similar ${groupKey} elements...`,
      omittedCount: omittedCount
    });
    // 保留尾部 3 个
    for (let i = group.length - tailCount; i < group.length; i++) children.push(group[i]);
  }
});
```

以 B 站首页为例，视频卡片列表从 50+ 项压缩为 8 项（5 头 + 省略标记 + 3 尾），AI 仍然知道列表结构和末尾项内容。

#### 第 6 层：深度限幅 + 极简优化

| 配置 | 值 | 作用 |
|------|-----|------|
| `MAX_DEPTH` | 50 | 最大递归深度，防止无限递归 |
| `SIMPLE_DEPTH` | 15 | 超过此深度只输出 `node` 字段，不展开 |
| `MAX_SIBLINGS` | 10 | 同类型兄弟节点超过此数触发列表压缩 |
| `KEEP_HEAD_COUNT` | 5 | 列表压缩保留的头部数量 |
| `KEEP_TAIL_COUNT` | 3 | 列表压缩保留的尾部数量 |
| `MAX_TEXT_LENGTH` | 2000 | 单个节点文本截断长度 |
| `MAX_ATTR_VALUE_LENGTH` | 300 | 属性值截断长度 |
| 属性白名单 | href, role, data-\*-id, data-\*-url | 其他属性全部丢弃 |

**极简子节点优化**：当节点的所有子节点都只有 `node` 字段时，自动转为字符串数组：

```json
// 展开形式
{ "node": "div.menu", "child": [
  { "node": "a.item" },
  { "node": "a.item" }
]}

// 极简形式（省 50%+）
{ "node": "div.menu", "child": ["a.item", "a.item"] }
```



## 其他操作

### 页面操作

| 操作 | 说明 |
|------|------|
| **navigate(url)** | 打开 URL，等待 `did-finish-load` 事件 |
| **click(selector)** | CSS 选择器定位元素并触发 click |
| **fillForm(selector, value)** | 输入框赋值并触发 input/change 事件 |
| **executeJavaScript(code, isAsync)** | 页面上下文执行任意 JS |
| **goBack / goForward / reload** | 浏览器导航 |
| **waitForSelector(selector, timeout)** | 等待元素出现（默认 10 秒） |

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
