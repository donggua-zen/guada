# Browser Automation Service - 多窗口功能说明

## 概述

BrowserAutomationService 现已支持多窗口管理，允许同时操作多个浏览器窗口，每个窗口拥有独立的会话隔离。

## 核心特性

### 1. 多窗口支持（最多5个窗口）

- 默认最大窗口数：**5个**
- 可通过配置自定义：`maxWindows` 参数
- 超过限制时会抛出错误

### 2. 窗口会话隔离

- 每个窗口使用独立的 Electron Session
- Session ID 格式：`browser_automation_{windowId}`
- 窗口间的数据完全隔离（cookies、localStorage等）
- 关闭窗口时自动清理所有会话数据

### 3. 超时自动关闭

- 默认超时时间：**5分钟**（300000ms）
- 可通过配置自定义：`inactivityTimeout` 参数
- 每次窗口操作会重置超时计时器
- 超时后自动关闭并清理窗口

### 4. 窗口列表查询

- Agent 可以获取当前所有窗口的列表
- 包含窗口ID、URL、标题、创建时间等信息
- 标识哪个窗口是默认窗口

## API 使用示例

### 初始化服务

```typescript
import { BrowserAutomationService } from './browser-automation-service'

// 使用默认配置
const service = new BrowserAutomationService()

// 自定义配置
const service = new BrowserAutomationService({
  width: 1920,
  height: 1080,
  show: true,
  maxWindows: 5,              // 最大窗口数
  inactivityTimeout: 300000,  // 超时时间（毫秒）
})
```

### 创建和管理窗口

```typescript
// 创建新窗口（返回 windowId）
const windowId1 = await service.createWindow()
const windowId2 = await service.createWindow()

// 获取窗口列表
const windows = service.getWindowList()
console.log(windows)
// [
//   {
//     windowId: "window_1234567890_abc123",
//     url: "https://example.com",
//     title: "Example",
//     createdAt: 1234567890,
//     lastActivityAt: 1234567890,
//     isActive: true  // 是否为默认窗口
//   },
//   ...
// ]

// 设置默认窗口
service.setDefaultWindow(windowId2)

// 获取窗口数量
const count = service.getWindowCount()
```

### 执行窗口操作

所有操作方法都支持可选的 `windowId` 参数：
- 如果提供 `windowId`，则在指定窗口执行
- 如果不提供，则在默认窗口执行

```typescript
// 在默认窗口导航
await service.navigate('https://www.example.com')

// 在指定窗口导航
await service.navigate('https://www.google.com', windowId2)

// 截图
const screenshot = await service.screenshot({
  format: 'png',
  quality: 90,
  windowId: windowId1  // 可选
})

// 执行 JavaScript
const result = await service.executeJavaScript(
  'document.title',
  windowId1  // 可选
)

// 获取页面内容
const content = await service.getMainStructure(windowId1)

// 点击元素
await service.click('#submit-button', windowId1)

// 填充表单
await service.fillForm('#username', 'admin', windowId1)

// 页面导航
await service.goBack(windowId1)
await service.goForward(windowId1)
await service.reload(windowId1)

// 等待元素
await service.waitForSelector('.content', 10000, windowId1)
```

### 窗口生命周期管理

```typescript
// 关闭指定窗口
await service.closeWindow(windowId1)

// 打开新窗口（不关闭现有窗口）
const newWindowId = await service.openNewWindow('https://example.com')

// 销毁所有窗口
await service.destroy()

// 检查服务状态
const isReady = service.isReady()
```

## Tool Call 接口

Agent 可以通过工具调用接口使用多窗口功能：

### 基础操作

```json
{
  "id": "req_001",
  "method": "navigate",
  "params": {
    "url": "https://www.example.com",
    "window_id": "window_123"  // 可选
  }
}
```

### 获取窗口列表

```json
{
  "id": "req_002",
  "method": "get_window_list",
  "params": {}
}
```

响应：
```json
{
  "id": "req_002",
  "result": {
    "success": true,
    "windows": [
      {
        "windowId": "window_123",
        "url": "https://example.com",
        "title": "Example",
        "createdAt": 1234567890,
        "lastActivityAt": 1234567890,
        "isActive": true
      }
    ],
    "count": 1
  }
}
```

### 设置默认窗口

```json
{
  "id": "req_003",
  "method": "set_default_window",
  "params": {
    "window_id": "window_456"
  }
}
```

### 其他操作

所有操作方法都支持 `window_id` 参数：

- `navigate`: 导航到URL
- `screenshot`: 截图
- `execute_js`: 执行JavaScript
- `get_page_content`: 获取页面内容
- `get_raw_html`: 获取原始HTML
- `get_plain_text`: 获取纯文本
- `get_main_structure`: 获取主要内容结构
- `wait_for_selector`: 等待元素
- `click`: 点击元素
- `fill_input`: 填充表单
- `go_back`: 后退
- `go_forward`: 前进
- `reload`: 刷新
- `open_new_window`: 打开新窗口
- `close_window`: 关闭窗口

## 最佳实践

### 1. 窗口复用策略

```typescript
// 为不同的任务创建专用窗口
const searchWindow = await service.createWindow()
const loginWindow = await service.createWindow()

// 在搜索窗口中进行搜索
await service.navigate('https://google.com', searchWindow)

// 在登录窗口中进行认证
await service.navigate('https://example.com/login', loginWindow)
```

### 2. 错误处理

```typescript
try {
  const windowId = await service.createWindow()
  await service.navigate('https://example.com', windowId)
} catch (error) {
  console.error('操作失败:', error)
  // 窗口会自动清理，无需手动处理
}
```

### 3. 资源管理

```typescript
// 使用完毕后及时清理
await service.destroy()

// 或者单独关闭不需要的窗口
await service.closeWindow(windowId)
```

### 4. 超时配置

根据任务类型设置合适的超时时间：

```typescript
// 短时间任务：1分钟
const shortTaskService = new BrowserAutomationService({
  inactivityTimeout: 60000
})

// 长时间任务：10分钟
const longTaskService = new BrowserAutomationService({
  inactivityTimeout: 600000
})
```

## 注意事项

1. **窗口数量限制**：默认最多5个窗口，超过会抛出错误
2. **内存占用**：每个窗口都会占用一定内存，及时关闭不需要的窗口
3. **会话隔离**：不同窗口间的认证状态、cookies等完全隔离
4. **超时机制**：无操作超时后窗口会自动关闭，注意保存重要数据
5. **默认窗口**：第一个创建的窗口会成为默认窗口，关闭后会自动选择下一个

## 迁移指南

从单窗口模式迁移到多窗口模式：

### 旧代码（单窗口）
```typescript
const service = new BrowserAutomationService()
await service.initialize()
await service.navigate('https://example.com')
await service.destroy()
```

### 新代码（多窗口）
```typescript
const service = new BrowserAutomationService()
const windowId = await service.createWindow()  // 自动初始化
await service.navigate('https://example.com', windowId)
await service.destroy()  // 或使用 closeWindow(windowId)
```

主要变化：
- `initialize()` 方法已移除，改为 `createWindow()`
- 所有操作方法增加可选的 `windowId` 参数
- 新增窗口管理方法：`getWindowList()`, `setDefaultWindow()`, `getWindowCount()`
