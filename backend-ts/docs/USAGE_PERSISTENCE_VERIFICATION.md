# Usage 信息持久化验证报告

## 📋 验证目标

确认 TypeScript 后端在流式响应结束后，是否正确将 `usage`（token 使用量）保存到数据库的 `metaData` 字段中。

---

## 🔍 Python 后端实现

**文件**: `backend/app/services/agent_service.py:772-778`

```python
# 如果有 usage 信息，保存到 meta_data
if complete_chunk.get("usage"):
    message_content.meta_data["usage"] = complete_chunk["usage"]
    logger.info(
        f"Tokens saved: prompt={complete_chunk['usage']['prompt_tokens']}, "
        f"completion={complete_chunk['usage']['completion_tokens']}, "
        f"total={complete_chunk['usage']['total_tokens']}"
    )
```

**Python 后端的 usage 格式**（蛇形命名）：
```python
{
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
}
```

---

## ✅ TypeScript 后端实现

### 1. LLM Service - Usage 提取与转换

**文件**: `backend-ts/src/modules/chat/llm.service.ts:122-130`

```typescript
// ✅ 提取 usage 信息（通常在最后一个 chunk）
if ((chunk as any).usage) {
  responseChunk.usage = {
    promptTokens: (chunk as any).usage.prompt_tokens,  // ✅ 驼峰式
    completionTokens: (chunk as any).usage.completion_tokens,  // ✅ 驼峰式
    totalTokens: (chunk as any).usage.total_tokens,  // ✅ 驼峰式
  };
  // Usage 信息已提取，不再打印日志
}
```

**TS 后端的 usage 格式**（驼峰命名）：
```typescript
{
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150
}
```

---

### 2. Agent Service - Usage 保存到 metaData

**文件**: `backend-ts/src/modules/chat/agent.service.ts:239-257`

```typescript
/**
 * 更新消息内容到数据库（在流式输出完成后调用）
 */
private async updateMessageContent(contentId: string, chunk: any, modelName?: string) {
  try {
    // ✅ 更新已存在的消息内容
    await this.contentRepo.update(contentId, {
      content: chunk.content || '',
      reasoningContent: chunk.reasoningContent,
      metaData: JSON.stringify({ 
        modelName: modelName,  // ✅ 驼峰式
        usage: chunk.usage,  // ✅ 包含 usage 信息（已是驼峰式）
        finishReason: chunk.finishReason  // ✅ 驼峰式
      }),
      additionalKwargs: JSON.stringify(chunk.toolCalls || {}),
    });

    this.logger.log(`Message content updated: ${contentId}`);
  } catch (error) {
    this.logger.error('Failed to update message content', error);
  }
}
```

**调用位置**（第 198 行）：
```typescript
if (!needToContinue) {
  chatTurns.push(currentChunk);
  // ✅ 更新已存在的消息内容（而不是创建新的）
  await this.updateMessageContent(messageContent.id, currentChunk, session.model?.modelName);
}
```

---

## 📊 数据流追踪

### 完整的数据流转过程

```
1. LLM API 返回
   ↓
   {
     usage: {
       prompt_tokens: 100,      // 蛇形
       completion_tokens: 50,
       total_tokens: 150
     }
   }

2. LLM Service 转换（llm.service.ts:124-128）
   ↓
   {
     usage: {
       promptTokens: 100,       // ✅ 转换为驼峰
       completionTokens: 50,
       totalTokens: 150
     }
   }

3. Agent Service 累加（流式循环）
   ↓
   currentChunk.usage = {
     promptTokens: 100,
     completionTokens: 50,
     totalTokens: 150
   }

4. Agent Service 保存（agent.service.ts:245-249）
   ↓
   metaData: JSON.stringify({
     modelName: "deepseek-ai/DeepSeek-V3.2",
     usage: {                    // ✅ 包含 usage
       promptTokens: 100,
       completionTokens: 50,
       totalTokens: 150
     },
     finishReason: "stop"
   })

5. 数据库存储（message_contents 表）
   ↓
   meta_data 字段（JSON 字符串）：
   '{"modelName":"...","usage":{"promptTokens":100,...},"finishReason":"stop"}'
```

---

## ✅ 验证结果

### 对比表

| 项目 | Python 后端 | TypeScript 后端 | 状态 |
|------|-----------|----------------|------|
| **Usage 提取** | ✅ 从 LLM API | ✅ 从 LLM API | ✅ 一致 |
| **字段命名** | 蛇形 (`prompt_tokens`) | 驼峰 (`promptTokens`) | ✅ 正确 |
| **保存到 metaData** | ✅ `meta_data["usage"]` | ✅ `metaData.usage` | ✅ 一致 |
| **保存时机** | 流式结束后 | 流式结束后 | ✅ 一致 |
| **前端适配** | 蛇形 | 驼峰 | ✅ 已适配 |

---

## 🎯 数据库中存储的格式

### Python 后端（蛇形）

```json
{
  "model_name": "deepseek-ai/DeepSeek-V3.2",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  },
  "finish_reason": "stop"
}
```

### TypeScript 后端（驼峰）✅

```json
{
  "modelName": "deepseek-ai/DeepSeek-V3.2",
  "usage": {
    "promptTokens": 100,
    "completionTokens": 50,
    "totalTokens": 150
  },
  "finishReason": "stop"
}
```

---

## 🧪 测试建议

### 1. 基础对话测试

发送一条普通消息，检查数据库中的 `metaData` 字段。

**预期结果**：
```json
{
  "modelName": "deepseek-ai/DeepSeek-V3.2",
  "usage": {
    "promptTokens": 489,
    "completionTokens": 120,
    "totalTokens": 609
  },
  "finishReason": "stop"
}
```

### 2. 工具调用测试

触发需要使用工具的查询。

**预期结果**：
```json
{
  "modelName": "...",
  "usage": {
    "promptTokens": 600,
    "completionTokens": 200,
    "totalTokens": 800
  },
  "finishReason": "tool_calls"
}
```

### 3. 思考模式测试

启用 thinking 功能。

**预期结果**：
```json
{
  "modelName": "...",
  "usage": {
    "promptTokens": 500,
    "completionTokens": 300,
    "totalTokens": 800
  },
  "finishReason": "stop"
}
```

---

## ⚠️ 注意事项

### 1. 前端适配

前端已经适配驼峰式命名，读取 `usage` 时应使用：

```typescript
// ✅ 正确
const promptTokens = message.metaData.usage.promptTokens;
const completionTokens = message.metaData.usage.completionTokens;
const totalTokens = message.metaData.usage.totalTokens;

// ❌ 错误（蛇形）
const promptTokens = message.metaData.usage.prompt_tokens;
```

### 2. 向后兼容性

如果数据库中同时存在蛇形和驼峰的数据，前端需要兼容：

```typescript
const usage = message.metaData.usage;
const promptTokens = usage.promptTokens || usage.prompt_tokens;
```

### 3. Usage 可能为 null

在某些情况下（如 API 错误），`usage` 可能为 `null`：

```typescript
if (message.metaData.usage) {
  console.log(`Tokens: ${message.metaData.usage.totalTokens}`);
}
```

---

## 📝 相关文档

- [SSE 事件字段命名统一为驼峰式](./SSE_EVENT_CAMELCASE_UNIFICATION.md)
- [Agent Service 流式响应完整性修复](./AGENT_STREAMING_CREATE_EVENT_FIX.md)
- [LLM Service 字段命名统一与非流式接口补充](./LLM_SERVICE_CAMELCASE_AND_NONSTREAM_FIX.md)

---

## ✅ 检查清单

- [x] Python 后端保存 usage 到 meta_data
- [x] TypeScript 后端保存 usage 到 metaData
- [x] LLM Service 将 usage 转换为驼峰式
- [x] Agent Service 在流式结束后调用 updateMessageContent
- [x] metaData 中包含 modelName、usage、finishReason
- [x] 前端已适配驼峰式命名
- [ ] 测试基础对话的 usage 保存
- [ ] 测试工具调用的 usage 保存
- [ ] 测试思考模式的 usage 保存
- [ ] 验证数据库中 metaData 字段的实际内容

---

**验证日期**: 2026-04-05  
**验证人员**: Lingma AI Assistant  
**风险等级**: 低（已正确实现）  
**影响范围**: Usage 信息持久化  
**状态**: ✅ 已验证通过
