# 流式响应异常处理完善 - 快速参考

## 🎯 核心改进

### 1. 异常分类（agent.service.ts）

```typescript
try {
    // 流式 LLM 调用
    for await (const chunk of stream) { ... }
} catch (error) {
    if (error.name === 'AbortError') {
        currentChunk.finishReason = 'user_abort';
        currentChunk.error = 'User aborted the request';
    } else if (error.message.includes('timeout')) {
        currentChunk.finishReason = 'timeout';
        currentChunk.error = error.message;
    } else {
        currentChunk.finishReason = 'error';
        currentChunk.error = error.message;
    }
} finally {
    // 保存已生成的内容（即使发生错误）
    await this.updateMessageContent(...);
}
```

### 2. 错误信息记录

在 `metaData` 中记录错误：
```json
{
  "modelName": "gpt-4",
  "finishReason": "user_abort",
  "error": "User aborted the request",
  "thinkingDurationMs": 1234,
  "usage": { ... }
}
```

### 3. 资源清理（llm.service.ts）

```typescript
finally {
    if (response && typeof response.controller?.abort === 'function') {
        response.controller.abort();
    }
}
```

## 📊 错误类型对照

| finishReason | 触发场景 | metaData.error | 前端提示 |
|--------------|---------|----------------|---------|
| `user_abort` | 客户端断开连接 | `"User aborted the request"` | "生成已停止" |
| `timeout` | 请求超过 60 秒 | `"LLM request timed out (60s)"` | "请求超时，请重试" |
| `error` | API 错误或其他异常 | 具体错误信息 | 显示错误详情 |
| `stop` | 正常完成 | `null` | 无提示 |
| `tool_calls` | 工具调用完成 | `null` | 无提示 |

## 🔍 验证方法

### 数据库查询

```sql
-- 查看所有错误记录
SELECT id, finish_reason, meta_data 
FROM message_contents 
WHERE meta_data->>'error' IS NOT NULL 
ORDER BY created_at DESC LIMIT 10;

-- 查看用户中止的记录
SELECT id, finish_reason, meta_data 
FROM message_contents 
WHERE meta_data->>'error' LIKE '%abort%' 
ORDER BY created_at DESC LIMIT 5;

-- 查看超时记录
SELECT id, finish_reason, meta_data 
FROM message_contents 
WHERE finish_reason = 'timeout' 
ORDER BY created_at DESC LIMIT 5;
```

### 日志检查

```bash
# 查看后端日志
tail -f logs/app.log | grep -E "(Abort|timeout|error)"

# 应该看到类似以下日志：
# [AgentService] User stopped generation (AbortError)
# [LLMService] LLM request timed out (60s)
# [AgentService] Error saved to metaData: User aborted the request
```

## ✨ 关键特性

✅ **数据不丢失**：即使发生错误，已生成的内容也会保存到数据库  
✅ **错误可追溯**：`metaData.error` 记录具体错误原因  
✅ **资源正确清理**：使用 `controller.abort()` 关闭流  
✅ **与 Python 对齐**：异常处理逻辑与 Python 后端保持一致  

## 📖 详细文档

完整的实现细节和测试报告请查看：
- [STREAMING_ERROR_HANDLING_IMPROVEMENT.md](./STREAMING_ERROR_HANDLING_IMPROVEMENT.md)

## 🧪 运行测试

```bash
# 1. 启动后端服务
npm run start:dev

# 2. 运行测试脚本（需要先修改 token）
npx ts-node test-streaming-error-handling.ts
```
