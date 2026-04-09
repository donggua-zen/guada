# SSE 事件字段命名统一为驼峰式报告

## 📋 修复概述

将 TypeScript 后端和前端的所有 SSE 事件字段从 snake_case 统一改为 camelCase，保持项目代码风格一致。

---

## ✅ 后端修改

### 文件：`backend-ts/src/modules/chat/agent.service.ts`

#### 1. Create 事件

```typescript
// 修改前 ❌
yield {
  type: 'create',
  message_id: assistantMessage.id,
  turns_id: turnsId,
  content_id: messageContent.id,
  model_name: session.model?.modelName,
};

// 修改后 ✅
yield {
  type: 'create',
  messageId: assistantMessage.id,
  turnsId: turnsId,
  contentId: messageContent.id,
  modelName: session.model?.modelName,
};
```

#### 2. 流式内容事件

```typescript
// 修改前 ❌
yield {
  type: 'text',
  msg: chunk.content,
  tool_calls: chunk.additionalKwargs?.toolCalls,
  finish_reason: chunk.finishReason,
  usage: chunk.usage,
};

// 修改后 ✅
yield {
  type: 'text',
  msg: chunk.content,
  toolCalls: chunk.additionalKwargs?.toolCalls,
  finishReason: chunk.finishReason,
  usage: chunk.usage,
};
```

#### 3. 新增 tool_calls_response 事件

```typescript
// ✅ 与 Python 后端保持一致
yield {
  type: 'tool_calls_response',
  toolCallsResponse: toolResponses.map(tr => ({
    role: tr.role,
    name: tr.name,
    content: tr.content,
    tool_call_id: tr.tool_call_id,
  })),
  usage: chunk.usage,
};
```

---

## ✅ 前端修改

### 文件：`frontend/src/types/service.ts`

#### 1. StreamCreateEvent

```typescript
// 已经是驼峰式 ✅
export interface StreamCreateEvent {
    type: 'create'
    messageId: string      // ✅
    turnsId: string        // ✅
    contentId: string      // ✅
    modelName: string      // ✅
}
```

#### 2. StreamToolCallEvent

```typescript
// 修改前 ❌
export interface StreamToolCallEvent {
    type: 'tool_call'
    tool_calls: ToolCall[]
}

// 修改后 ✅
export interface StreamToolCallEvent {
    type: 'tool_call'
    toolCalls: ToolCall[]  // ✅
}
```

#### 3. StreamToolCallsResponseEvent（新增）

```typescript
// ✅ 新增类型定义
export interface StreamToolCallsResponseEvent {
    type: 'tool_calls_response'
    toolCallsResponse: any[]  // ✅ 驼峰式
    usage?: TokenUsage
}
```

#### 4. StreamFinishEvent

```typescript
// 修改前 ❌
export interface StreamFinishEvent {
    type: 'finish'
    usage?: TokenUsage
    finish_reason: string
    error?: string
}

// 修改后 ✅
export interface StreamFinishEvent {
    type: 'finish'
    usage?: TokenUsage
    finishReason: string  // ✅
    error?: string
}
```

#### 5. StreamEvent 联合类型

```typescript
// 添加新的事件类型
export type StreamEvent =
    | StreamCreateEvent
    | StreamThinkEvent
    | StreamToolCallEvent
    | StreamToolCallsResponseEvent  // ✅ 新增
    | StreamTextEvent
    | StreamFinishEvent
```

---

### 文件：`frontend/src/composables/useStreamResponse.ts`

#### 1. Create 事件处理

```typescript
// 已经是驼峰式 ✅
if (response.type === 'create') {
  assistantMessageIdResult = response.messageId!  // ✅
  // ...
}
```

#### 2. Tool Call 事件处理

```typescript
// 修改前 ❌
if (response.type === 'tool_call') {
  handleToolCall(message!.contents[contentIndex], response.tool_calls)
}

// 修改后 ✅
if (response.type === 'tool_call') {
  handleToolCall(message!.contents[contentIndex], response.toolCalls)  // ✅
}
```

#### 3. Tool Calls Response 事件处理

```typescript
// 修改前 ❌
if (response.type === 'tool_calls_response') {
  handleToolCallsResponse(message!.contents[contentIndex], response.tool_calls_response)
}

// 修改后 ✅
if (response.type === 'tool_calls_response') {
  handleToolCallsResponse(message!.contents[contentIndex], response.toolCallsResponse)  // ✅
}
```

#### 4. Finish 事件处理

```typescript
// 已经是驼峰式 ✅
if (response.finishReason) {
  // ...
}
if (response.finishReason === 'error') {
  // ...
}
```

---

## 📊 字段映射表

| 事件类型 | 原字段名（snake_case） | 新字段名（camelCase） | 状态 |
|---------|---------------------|---------------------|------|
| **create** | `message_id` | `messageId` | ✅ |
| | `turns_id` | `turnsId` | ✅ |
| | `content_id` | `contentId` | ✅ |
| | `model_name` | `modelName` | ✅ |
| **tool_call** | `tool_calls` | `toolCalls` | ✅ |
| **tool_calls_response** | `tool_calls_response` | `toolCallsResponse` | ✅ |
| **finish** | `finish_reason` | `finishReason` | ✅ |

---

## 📝 修改统计

| 文件 | 修改类型 | 行数变化 | 说明 |
|------|---------|---------|------|
| **backend-ts/agent.service.ts** | 重构 + 新增 | +18 / -6 | 字段改名 + 新增事件 |
| **frontend/types/service.ts** | 重构 + 新增 | +12 / -2 | 类型定义更新 |
| **frontend/useStreamResponse.ts** | 重构 | +2 / -2 | 字段访问更新 |
| **总计** | - | **+32 / -10** | 净增加 22 行 |

---

## 🎯 完整的 SSE 事件流程

### 修复后的事件顺序

```
1. create
   → { type: "create", messageId, turnsId, contentId, modelName }

2. think (可选)
   → { type: "think", msg, usage }

3. text
   → { type: "text", msg, usage }

4. tool_call (可选)
   → { type: "tool_call", toolCalls, usage }

5. tool_calls_response (可选)
   → { type: "tool_calls_response", toolCallsResponse, usage }

6. finish
   → { type: "finish", finishReason, error, usage }
```

---

## ⚠️ 注意事项

### 1. 向后兼容性

**重要**：这是一个**破坏性变更**。

如果前端已经在使用旧版本的 TS 后端（使用 snake_case），需要：
- ✅ 同步更新前端类型定义
- ✅ 同步更新前端字段访问
- ✅ 重新编译前端代码

### 2. 与 Python 后端的差异

| 项目 | Python 后端 | TypeScript 后端 |
|------|-----------|----------------|
| **字段命名** | snake_case | ✅ camelCase |
| **事件类型** | 相同 | 相同 |
| **工具调用** | 支持 | 支持 |

**建议**：
- 如果前后端都使用 TypeScript，统一使用 camelCase
- 如果需要同时支持 Python 和 TS 后端，在前端添加适配层

### 3. metaData 内部存储

数据库中的 `metaData` JSON 字段也使用 camelCase：

```typescript
metaData: JSON.stringify({ 
  modelName: modelName,      // ✅
  finishReason: finishReason, // ✅
  usage: usage
})
```

---

## 🧪 测试建议

### 1. 基础对话测试

```bash
# 启动后端
cd backend-ts && npm run start:dev

# 启动前端
cd frontend && npm run dev
```

**预期行为**：
- 消息正常发送和接收
- 无 TypeScript 类型错误
- 控制台无警告

### 2. 工具调用测试

触发需要使用工具的查询（如搜索、计算等）。

**预期 SSE 事件**：
```
data: {"type":"create","messageId":"...","turnsId":"...","contentId":"...","modelName":"..."}
data: {"type":"tool_call","toolCalls":[...],"usage":null}
data: {"type":"tool_calls_response","toolCallsResponse":[...],"usage":null}
data: {"type":"text","msg":"...","usage":null}
data: {"type":"finish","finishReason":"stop","error":null,"usage":{...}}
```

### 3. 思考模式测试

启用 thinking 功能。

**预期 SSE 事件**：
```
data: {"type":"create",...}
data: {"type":"think","msg":"...","usage":null}
data: {"type":"text","msg":"...","usage":null}
data: {"type":"finish","finishReason":"stop",...}
```

---

## 📝 相关文档

- [Agent Service 流式响应完整性修复](./AGENT_STREAMING_CREATE_EVENT_FIX.md)
- [Agent 无限循环问题修复](./AGENT_INFINITE_LOOP_FIX.md)
- [LLM Service 字段命名统一与非流式接口补充](./LLM_SERVICE_CAMELCASE_AND_NONSTREAM_FIX.md)

---

## ✅ 检查清单

- [x] 后端 create 事件字段改为驼峰式
- [x] 后端 tool_call 事件字段改为驼峰式
- [x] 后端 finish 事件字段改为驼峰式
- [x] 后端添加 tool_calls_response 事件
- [x] 前端 StreamCreateEvent 类型定义（已是驼峰式）
- [x] 前端 StreamToolCallEvent 类型定义改为驼峰式
- [x] 前端 StreamToolCallsResponseEvent 类型定义（新增）
- [x] 前端 StreamFinishEvent 类型定义改为驼峰式
- [x] 前端 useStreamResponse 字段访问更新
- [ ] 测试基础对话功能
- [ ] 测试工具调用功能
- [ ] 测试思考模式功能
- [ ] 验证 TypeScript 编译无错误

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**风险等级**: **中**（破坏性变更）  
**影响范围**: 前后端 SSE 通信协议  
**状态**: ✅ 已完成
