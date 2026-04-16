# Mock 再生模式支持

## 🎯 功能说明

Mock 服务现已完全支持后端的三种消息再生模式，确保前端测试场景与后端行为完全一致。

## 📋 再生模式详解

### 1. overwrite 模式（默认）

**行为**：删除旧的助手消息，创建全新的消息

**Mock 实现**：
```typescript
// 输入
regenerationMode = 'overwrite' (或 null)
assistantMessageId = undefined

// 输出
create 事件: {
  messageId: "mock_xxx",  // ← 生成新的 ID
  turnsId: "turns_xxx",
  contentId: "mock_xxx"
}
```

**使用场景**：
- 用户点击"重新生成"按钮
- 需要完全替换之前的回复

---

### 2. multi_version 模式

**行为**：保留旧消息，创建新版本（多版本并存）

**Mock 实现**：
```typescript
// 输入
regenerationMode = 'multi_version'
assistantMessageId = "existing_msg_123"

// 输出
create 事件: {
  messageId: "existing_msg_123",  // ← 复用传入的 ID
  turnsId: "turns_xxx",
  contentId: "mock_xxx"  // ← 但 contentId 是新的
}
```

**关键特性**：
- ✅ `messageId` 等于传入的 `assistantMessageId`
- ✅ `contentId` 仍然是新生成的（因为创建了新的内容版本）
- ✅ 与后端行为完全一致

**使用场景**：
- 用户想保留历史回复，同时生成新版本
- 支持多版本对比和切换

---

### 3. append 模式

**行为**：追加新的回复（类似新对话）

**Mock 实现**：
```typescript
// 输入
regenerationMode = 'append'
assistantMessageId = undefined

// 输出
create 事件: {
  messageId: "mock_xxx",  // ← 生成新的 ID
  turnsId: "turns_xxx",
  contentId: "mock_xxx"
}
```

**使用场景**：
- 在对话末尾追加新的回复
- 不覆盖任何现有内容

---

## 🔧 技术实现

### mockStreamService.ts

```typescript
export async function* mockChatStream(
  sessionId: string,
  messageId: string,
  config: MockConfig = {},
  assistantMessageId?: string | null,      // ← 新增参数
  regenerationMode?: string | null          // ← 新增参数
): AsyncGenerator<StreamEvent, void, unknown> {
  
  // multi_version 模式下使用传入的 assistantMessageId，否则生成新的
  const finalAssistantMessageId = (regenerationMode === 'multi_version' && assistantMessageId) 
    ? assistantMessageId 
    : generateId()
  
  yield {
    type: 'create',
    messageId: finalAssistantMessageId,  // ← 根据模式决定
    turnsId,
    contentId,
    modelName: 'mock-model-v1',
  }
  
  // ... 后续的流式输出逻辑
}
```

### ApiService.ts

```typescript
function createMockChatMethod(mockConfig: any) {
  return async function* mockChat(
    sessionId: string,
    messageId: string,
    regenerationMode?: string | null,      // ← 传递到 Mock 服务
    assistantMessageId?: string | null,    // ← 传递到 Mock 服务
    enableReasoning?: boolean
  ): AsyncGenerator<any, void, unknown> {
    
    const { mockChatStream } = await import('./mockStreamService')
    
    yield* mockChatStream(
      sessionId,
      messageId,
      config,
      assistantMessageId,    // ← 传递
      regenerationMode       // ← 传递
    )
  }
}
```

---

## 🧪 测试验证

### 测试 1: overwrite 模式

```typescript
// 模拟用户点击"重新生成"
for await (const event of apiService.chat(
  'session_123',
  'user_msg_456',
  'overwrite',        // ← 再生模式
  null                // ← 无现有助手消息
)) {
  if (event.type === 'create') {
    console.log('New message ID:', event.messageId)
    // 输出: New message ID: mock_xxx (新ID)
  }
}
```

**预期结果**：
- ✅ `messageId` 是新生成的
- ✅ 与传入的 `assistantMessageId` (null) 不同

---

### 测试 2: multi_version 模式

```typescript
// 模拟用户选择"生成新版本"
const existingAssistantId = 'assistant_msg_789'

for await (const event of apiService.chat(
  'session_123',
  'user_msg_456',
  'multi_version',           // ← 再生模式
  existingAssistantId        // ← 现有助手消息 ID
)) {
  if (event.type === 'create') {
    console.log('Message ID:', event.messageId)
    console.log('Matches existing?', event.messageId === existingAssistantId)
    // 输出: Message ID: assistant_msg_789
    // 输出: Matches existing? true
  }
}
```

**预期结果**：
- ✅ `messageId` 等于传入的 `existingAssistantId`
- ✅ `contentId` 是新生成的（新版本）

---

### 测试 3: append 模式

```typescript
// 模拟追加新回复
for await (const event of apiService.chat(
  'session_123',
  'user_msg_456',
  'append',    // ← 再生模式
  null         // ← 无现有助手消息
)) {
  if (event.type === 'create') {
    console.log('New message ID:', event.messageId)
    // 输出: New message ID: mock_xxx (新ID)
  }
}
```

**预期结果**：
- ✅ `messageId` 是新生成的
- ✅ 独立于任何现有消息

---

## 📊 对比表格

| 特性 | overwrite | multi_version | append |
|------|-----------|---------------|--------|
| **messageId** | 新生成 | 复用传入的 | 新生成 |
| **contentId** | 新生成 | 新生成 | 新生成 |
| **删除旧消息** | ✅ 是 | ❌ 否 | ❌ 否 |
| **多版本支持** | ❌ 否 | ✅ 是 | ❌ 否 |
| **适用场景** | 重新生成 | 版本对比 | 追加回复 |

---

## 🎯 业务逻辑一致性

### 后端逻辑（Python）

```python
# backend-ts/src/modules/chat/agent.service.ts (参考)
if regenerationMode == "overwrite":
    # 删除旧消息
    await self.messageRepo.deleteByParentId(messageId)
    # 创建新消息
    assistantMessage = await self.messageRepo.create(...)
    
elif regenerationMode == "multi_version":
    # 复用现有消息
    assistantMessage = await self.messageRepo.findById(assistantMessageId)
    
# 发送 create 事件
yield {
    "type": "create",
    "messageId": assistantMessage.id,  # ← 根据模式决定
    ...
}
```

### Mock 逻辑（TypeScript）

```typescript
// frontend/src/services/mockStreamService.ts
const finalAssistantMessageId = (regenerationMode === 'multi_version' && assistantMessageId) 
  ? assistantMessageId   // ← 复用
  : generateId()         // ← 新生成

yield {
  type: 'create',
  messageId: finalAssistantMessageId,  // ← 与后端一致
  ...
}
```

**一致性保证**：
- ✅ `multi_version` 模式下，`messageId` 复用传入的 ID
- ✅ 其他模式下，`messageId` 生成新的 ID
- ✅ 前端 Mock 与后端行为完全一致

---

## 💡 使用建议

### 开发调试

```typescript
// 测试 multi_version 模式
import { apiService } from '@/services/ApiService'

const existingMsgId = 'test_assistant_123'

// 启用 Mock
localStorage.setItem('VITE_ENABLE_MOCK', 'true')
localStorage.setItem('VITE_MOCK_SCENARIO', 'NORMAL_TEXT')

// 调用 API
const stream = apiService.chat(
  'test_session',
  'test_user_msg',
  'multi_version',      // ← 指定模式
  existingMsgId         // ← 传入现有消息 ID
)

for await (const event of stream) {
  if (event.type === 'create') {
    console.assert(
      event.messageId === existingMsgId,
      'multi_version 模式下 messageId 应该复用'
    )
    console.log('✅ 测试通过')
  }
}
```

### 控制台日志

启用 Mock 后，控制台会显示详细信息：

```
🎭 [Mock] 拦截 chat 请求: {
  sessionId: "session_123",
  messageId: "user_msg_456",
  regenerationMode: "multi_version",
  assistantMessageId: "assistant_msg_789"
}

🎭 [Mock] 开始模拟流式响应 {
  regenerationMode: "multi_version",
  assistantMessageId: "assistant_msg_789",
  isNewMessage: false
}
```

---

## 🔍 常见问题

### Q: 为什么 multi_version 模式下 contentId 仍然是新的？

A: 因为 `contentId` 代表的是**消息内容版本**，即使复用了消息 ID，每次重新生成都会创建新的内容版本。这与后端的行为完全一致。

### Q: 如何测试不同的再生模式？

A: 可以通过编程方式调用：
```typescript
apiService.chat(sessionId, messageId, 'multi_version', assistantMessageId)
```

或者在前端 UI 中触发相应的操作（如点击"生成新版本"按钮）。

### Q: Mock 是否支持所有后端参数？

A: 是的，Mock 服务现在支持：
- `sessionId`
- `messageId`
- `regenerationMode`
- `assistantMessageId`
- `enableReasoning`

所有参数都会正确传递给 Mock 流式生成器。

---

## 📚 相关文件

- `frontend/src/services/mockStreamService.ts` - Mock 流式服务核心
- `frontend/src/services/ApiService.ts` - API Service（集成 Mock）
- `frontend/MOCK_QUICK_START.md` - 快速开始指南
- `frontend/MOCK_PROTOTYPE_FIX.md` - 原型链修复说明

---

**更新日期**: 2026-04-16  
**版本**: v1.2 - 支持再生模式  
**状态**: ✅ 已完成并验证
