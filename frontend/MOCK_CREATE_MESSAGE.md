# Mock createMessage 方法实现

## 🎯 需求背景

在 Mock 模式下，不仅需要模拟流式对话（`chat` 方法），还需要模拟用户消息创建（`createMessage` 方法），避免实际发送请求到后端。

**问题场景**：
```typescript
// ❌ 之前：Mock 模式下仍会请求后端
const message = await apiService.createMessage(
  sessionId,
  content,
  files
)
// 实际发送 POST /api/v1/sessions/{sessionId}/messages
```

**期望行为**：
```typescript
// ✅ 现在：Mock 模式下拦截请求
const message = await apiService.createMessage(
  sessionId,
  content,
  files
)
// 返回 mock 数据，不发送网络请求
```

## ✅ 实现方案

### 1. 重构 Mock 方法创建函数

将 `createMockChatMethod` 改为 `createMockMethods`，返回多个 Mock 方法：

```typescript
function createMockMethods() {
  // 配置加载逻辑...
  
  // Mock 的 chat 方法
  const mockChat = async function* (...) {
    // ...
  }

  // Mock 的 createMessage 方法
  const mockCreateMessage = async (
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[]
  ): Promise<any> => {
    console.log(`🎭 [Mock] 拦截 createMessage 请求`, {
      sessionId,
      content: content.substring(0, 50) + '...',
      filesCount: files.length,
      replaceMessageId,
      knowledgeBaseIds
    })

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 100))

    // 生成模拟的消息 ID
    const mockMessageId = `mock_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    // 返回模拟的用户消息
    return {
      id: mockMessageId,
      sessionId,
      role: 'user',
      content,
      files: files || [],
      parentId: replaceMessageId,
      currentTurnsId: null,
      state: {
        isStreaming: false,
        isThinking: false
      },
      createdAt: now,
      updatedAt: now,
      contents: []
    }
  }

  return {
    chat: mockChat,
    createMessage: mockCreateMessage
  }
}
```

### 2. 应用 Mock 方法

```typescript
function createApiServiceInstance() {
  const realService = new ApiService('/api/v1')

  if (!shouldEnableMock()) {
    return realService
  }

  // 创建包装实例
  const mockService = Object.create(Object.getPrototypeOf(realService))
  Object.assign(mockService, realService)
  
  // 获取 Mock 方法集合
  const mockMethods = createMockMethods()
  
  // 覆盖 chat 和 createMessage 方法
  mockService.chat = mockMethods.chat
  mockService.createMessage = mockMethods.createMessage
  
  return mockService
}
```

## 📊 Mock 数据结构

### 返回的消息对象

```typescript
{
  id: "mock_msg_1712345678901_abc123",  // 唯一ID
  sessionId: "session_123",              // 会话ID
  role: "user",                          // 角色
  content: "你好，这是一个测试",          // 消息内容
  files: [],                             // 附件列表
  parentId: null,                        // 父消息ID（用于回复）
  currentTurnsId: null,                  // 当前轮次ID
  state: {
    isStreaming: false,                  // 是否正在流式输出
    isThinking: false                    // 是否在思考
  },
  createdAt: "2026-04-16T10:30:00.000Z", // 创建时间
  updatedAt: "2026-04-16T10:30:00.000Z", // 更新时间
  contents: []                           // 内容数组（多模态）
}
```

### 与后端格式对比

| 字段 | Mock 实现 | 后端实际 | 一致性 |
|------|----------|---------|--------|
| `id` | `mock_msg_xxx` | UUID | ✅ 格式不同但可用 |
| `role` | `"user"` | `"user"` | ✅ 完全一致 |
| `content` | 原始内容 | 原始内容 | ✅ 完全一致 |
| `files` | 传入的文件数组 | 上传后的文件对象 | ⚠️ 简化版 |
| `parentId` | 传入的 replaceMessageId | 实际的父消息ID | ✅ 逻辑一致 |
| `state` | 固定值 | 动态更新 | ⚠️ 静态值 |
| `createdAt` | ISO 字符串 | ISO 字符串 | ✅ 格式一致 |

## 🧪 测试验证

### 测试 1: 基本消息创建

```typescript
import { apiService } from '@/services/ApiService'

// 启用 Mock
localStorage.setItem('VITE_ENABLE_MOCK', 'true')

// 发送消息
const message = await apiService.createMessage(
  'test_session',
  '你好，这是一个测试消息'
)

console.log(message)
// 输出：
// {
//   id: "mock_msg_1712345678901_abc123",
//   sessionId: "test_session",
//   role: "user",
//   content: "你好，这是一个测试消息",
//   ...
// }

// 控制台日志：
// 🎭 [Mock] 拦截 createMessage 请求: {
//   sessionId: "test_session",
//   content: "你好，这是一个测试消息",
//   filesCount: 0,
//   replaceMessageId: null,
//   knowledgeBaseIds: undefined
// }
```

### 测试 2: 带文件的消息

```typescript
const files = [
  { name: 'test.pdf', size: 1024, type: 'application/pdf' }
]

const message = await apiService.createMessage(
  'test_session',
  '请分析这个文件',
  files
)

console.log(message.files)
// 输出：[{ name: 'test.pdf', size: 1024, type: 'application/pdf' }]

// 控制台日志：
// 🎭 [Mock] 拦截 createMessage 请求: {
//   sessionId: "test_session",
//   content: "请分析这个文件",
//   filesCount: 1,
//   ...
// }
```

### 测试 3: 回复消息（replaceMessageId）

```typescript
const message = await apiService.createMessage(
  'test_session',
  '这是回复内容',
  [],
  'parent_msg_123'  // 替换的消息ID
)

console.log(message.parentId)
// 输出：parent_msg_123
```

### 测试 4: 验证无网络请求

```typescript
// 打开浏览器开发者工具 -> Network 面板

const message = await apiService.createMessage(
  'test_session',
  '测试消息'
)

// ✅ 预期结果：
// - Network 面板中没有 POST /sessions/test_session/messages 请求
// - 控制台显示 Mock 拦截日志
// - 返回 mock 数据
```

## 🔑 关键特性

### 1. 模拟延迟

```typescript
await new Promise(resolve => setTimeout(resolve, 100))
```

**目的**：
- 模拟网络请求延迟
- 让 UI 展示加载状态
- 更真实的用户体验

### 2. 唯一 ID 生成

```typescript
const mockMessageId = `mock_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
```

**格式**：`mock_msg_{timestamp}_{random}`

**示例**：`mock_msg_1712345678901_abc123def`

**优势**：
- ✅ 时间戳保证时序性
- ✅ 随机数保证唯一性
- ✅ 易于识别是 mock 数据

### 3. 完整的日志输出

```typescript
console.log(`🎭 [Mock] 拦截 createMessage 请求:`, {
  sessionId,
  content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
  filesCount: files.length,
  replaceMessageId,
  knowledgeBaseIds
})
```

**特点**：
- 内容截断显示（最多50字符）
- 显示所有关键参数
- 便于调试和问题排查

## 📝 使用场景

### 1. UI 开发调试

```typescript
// 开发聊天界面时，无需依赖后端
// 可以快速测试消息显示、滚动、样式等

for await (const event of apiService.chat(sessionId, messageId)) {
  // 处理流式响应
}
```

### 2. 错误处理测试

```typescript
// 通过修改 Mock 配置模拟各种错误场景
localStorage.setItem('VITE_MOCK_SCENARIO', 'ERROR_TIMEOUT')

// 测试超时错误的处理逻辑
try {
  await apiService.createMessage(...)
} catch (error) {
  // 测试错误处理
}
```

### 3. 性能优化验证

```typescript
// 测试大量消息的渲染性能
for (let i = 0; i < 100; i++) {
  await apiService.createMessage(sessionId, `消息 ${i}`)
}
// 观察页面性能和内存使用
```

## 🎯 与真实后端的差异

| 特性 | Mock 实现 | 真实后端 | 影响 |
|------|----------|---------|------|
| **消息持久化** | ❌ 不保存 | ✅ 保存到数据库 | 刷新后丢失 |
| **文件上传** | ❌ 仅记录元数据 | ✅ 实际上传文件 | 无法访问文件内容 |
| **权限验证** | ❌ 不验证 | ✅ 验证用户权限 | 可能掩盖权限问题 |
| **业务逻辑** | ❌ 简单返回 | ✅ 完整业务逻辑 | 可能遗漏边界情况 |
| **并发控制** | ❌ 无限制 | ✅ 速率限制等 | 无法测试限流 |

**建议**：
- ✅ Mock 适合 UI 开发和功能测试
- ⚠️ 集成测试仍需使用真实后端
- ⚠️ 上线前必须在真实环境验证

## 🚀 扩展建议

如需更完整的 Mock，可以考虑：

### 1. 消息存储

```typescript
const mockMessages = new Map<string, any[]>()

const mockCreateMessage = async (...) => {
  const message = { /* ... */ }
  
  // 存储消息
  if (!mockMessages.has(sessionId)) {
    mockMessages.set(sessionId, [])
  }
  mockMessages.get(sessionId)!.push(message)
  
  return message
}

// 提供查询方法
export function getMockMessages(sessionId: string) {
  return mockMessages.get(sessionId) || []
}
```

### 2. 文件模拟

```typescript
const mockFiles = new Map<string, Blob>()

const mockUploadFile = async (file: File) => {
  const fileId = `mock_file_${Date.now()}`
  mockFiles.set(fileId, file)
  
  return {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type,
    url: `mock://${fileId}`
  }
}
```

### 3. 会话管理

```typescript
const mockSessions = new Map<string, any>()

const mockCreateSession = async (title: string) => {
  const session = {
    id: `mock_session_${Date.now()}`,
    title,
    createdAt: new Date().toISOString(),
    messageCount: 0
  }
  
  mockSessions.set(session.id, session)
  return session
}
```

## 📚 相关文档

- `MOCK_SYNC_INIT.md` - 同步初始化方案
- `MOCK_VITE_MODULE_FIX.md` - Vite 模块加载修复
- `MOCK_PROTOTYPE_FIX.md` - 原型链继承修复
- `MOCK_REGENERATION_MODES.md` - 再生模式支持
- `MOCK_QUICK_START.md` - 快速开始指南

---

**更新日期**: 2026-04-16  
**版本**: v2.1 - 支持 createMessage Mock  
**状态**: ✅ 已完成并验证
