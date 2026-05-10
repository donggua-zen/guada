# Browser Bridge 架构重构说明

## 架构设计原则

**关注点分离（Separation of Concerns）**：将通信协议层与业务逻辑层完全解耦。

## 新架构

```
┌─────────────────────────────────────────────────┐
│           Backend (NestJS)                       │
│                                                  │
│  BrowserToolProvider                             │
│    - 支持 IPC 和 TCP 双模式                      │
│    - 根据环境变量自动选择                        │
└──────────────┬──────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
   IPC Mode      TCP Mode
   (生产环境)    (开发环境)
        │             │
        ▼             ▼
┌──────────────┐  ┌──────────────────┐
│browser-      │  │browser-          │
│bridge.ts     │  │bridge-tcp.ts     │
│              │  │                  │
│职责:         │  │职责:             │
│- 监听 IPC    │  │- HTTP Server     │
│- process.send│  │- POST /browser   │
│- 消息序列化  │  │- JSON 解析       │
└──────┬───────┘  └──────┬───────────┘
       │                  │
       └────────┬─────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  browser-automation-service.ts          │
│                                         │
│  BrowserAutomationService (核心服务)    │
│                                         │
│  职责:                                  │
│  ✓ 管理 BrowserWindow 生命周期          │
│  ✓ 执行浏览器自动化操作                 │
│    - navigate()                         │
│    - screenshot()                       │
│    - executeJavaScript()                │
│    - getPageContent()                   │
│    - waitForSelector()                  │
│    - click()                            │
│    - fillForm()                         │
│  ✓ 无痕数据清理                         │
│  ✓ handleToolCall() 统一分发            │
└─────────────────────────────────────────┘
```

## 文件职责

### 1. `browser-automation-service.ts` (核心业务层)
- **405 行代码**
- 包含所有浏览器自动化相关的业务逻辑
- 与通信协议完全解耦
- 可被任何协议适配器复用

### 2. `browser-bridge.ts` (IPC 协议适配器)
- **87 行代码** (从 337 行减少到 87 行，减少 74%)
- 仅负责 Electron IPC 通信
- 监听 `process.on('message')`
- 通过 `process.send()` 发送响应

### 3. `browser-bridge-tcp.ts` (TCP 协议适配器)
- **103 行代码** (从 364 行减少到 103 行，减少 72%)
- 仅负责 HTTP Server 通信
- 监听 `http://127.0.0.1:3001/browser-tool`
- 处理 POST 请求

## 优势

### 1. 消除代码冗余
- **之前**: 两个文件共 701 行，大量重复的浏览器自动化代码
- **之后**: 三个文件共 595 行，业务逻辑只写一次

### 2. Session 隔离（重要）
BrowserAutomationService 使用**独立的持久化 session**，与主窗口完全隔离：

```typescript
// 创建独立 session
const sessionId = `browser_automation_${Date.now()}`
this.automationSession = session.fromPartition(`persist:${sessionId}`, { cache: true })

// 在 BrowserWindow 中使用
webPreferences: {
  session: this.automationSession, // 独立 session
}
```

**好处：**
- ✅ 浏览器自动化操作不会影响主窗口的认证状态
- ✅ 清除浏览器数据时不会误删主窗口的 localStorage/token
- ✅ 每个自动化窗口有独立的会话空间
- ✅ 主窗口的 JWT token、cookies 等认证信息保持安全

### 3. 易于扩展新协议
如果未来需要支持 UDP、WebSocket 等协议，只需：
1. 创建新的协议适配器文件（如 `browser-bridge-ws.ts`）
2. 实现通信层的接收和发送逻辑
3. 调用 `BrowserAutomationService.handleToolCall()`

**无需复制任何业务代码！**

示例（假设未来添加 WebSocket 支持）：
```typescript
// browser-bridge-ws.ts - 仅需 ~50 行代码
import { WebSocketServer } from 'ws'
import { BrowserAutomationService } from './browser-automation-service'

const automationService = new BrowserAutomationService()
const wss = new WebSocketServer({ port: 3002 })

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const request = JSON.parse(data.toString())
    const result = await automationService.handleToolCall(request)
    ws.send(JSON.stringify({ id: request.id, result }))
  })
})
```

### 4. 单一职责原则
- **BrowserAutomationService**: 只关心"做什么"（浏览器操作）
- **Protocol Adapters**: 只关心"怎么传"（通信方式）

### 5. 便于测试和维护
- 可以独立测试业务逻辑（不依赖特定协议）
- 修改通信协议不影响业务逻辑
- 修改业务逻辑不影响通信协议

## 使用方式

### 开发模式（TCP）
```bash
# 自动启动 TCP Server
npm run dev:electron

# 测试连接
curl -X POST http://127.0.0.1:3001/browser-tool \
  -H "Content-Type: application/json" \
  -d '{"id":"test","method":"navigate","params":{"url":"https://example.com"}}'
```

### 生产模式（IPC）
```bash
# 自动使用 IPC 通信
npm run start:electron
```

## 环境变量配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `BROWSER_BRIDGE_MODE` | 通信模式 (`tcp` / `ipc`) | 开发:`tcp`, 生产:`ipc` |
| `BROWSER_BRIDGE_PORT` | TCP 端口号 | `3001` |
| `ELECTRON_APP` | 标识是否在 Electron 环境中 | `true` |

## 总结

这次重构遵循了以下设计原则：
1. **DRY (Don't Repeat Yourself)**: 业务逻辑只写一次
2. **SRP (Single Responsibility Principle)**: 每个模块职责单一
3. **OCP (Open-Closed Principle)**: 对扩展开放，对修改关闭
4. **DIP (Dependency Inversion Principle)**: 高层模块不依赖低层模块

通过这种架构，未来添加新协议的成本从"复制 300+ 行业务代码"降低到"编写 50 行协议适配代码"。
