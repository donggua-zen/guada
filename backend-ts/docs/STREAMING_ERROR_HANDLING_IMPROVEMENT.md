# 流式响应异常处理完善报告

## 📋 概述

本次更新完善了 TypeScript 后端的流式响应异常处理机制，使其与 Python 后端的实现保持一致。主要改进包括：异常捕获、部分数据保存、错误信息记录和资源清理。

## 🎯 核心改进

### 1. 异常分类与处理（agent.service.ts）

#### 新增的异常类型识别

```typescript
// 用户主动中止（客户端断开连接）
if (streamError.name === 'AbortError' || streamError.message.includes('abort')) {
    currentChunk.finishReason = 'user_abort';
    currentChunk.error = 'User aborted the request';
}

// 超时错误
else if (streamError.message.includes('timed out') || streamError.message.includes('timeout')) {
    currentChunk.finishReason = 'timeout';
    currentChunk.error = streamError.message;
}

// 其他 API 错误或运行时错误
else {
    currentChunk.finishReason = 'error';
    currentChunk.error = streamError.message;
}
```

#### try-catch-finally 结构

```typescript
try {
    // 流式 LLM 调用
    for await (const chunk of stream) {
        // 处理每个 chunk
    }
} catch (error) {
    // 捕获并分类错误
    // 设置 finishReason 和 error 字段
    // 记录思考结束时间
} finally {
    // 无论成功、失败还是中止，都要保存当前已生成的内容
    await this.updateMessageContent(...);
}
```

**对齐 Python 后端：**
- ✅ Python: `except asyncio.CancelledError` → TS: `error.name === 'AbortError'`
- ✅ Python: `complete_chunk["finish_reason"] = "user_stop"` → TS: `currentChunk.finishReason = 'user_abort'`
- ✅ Python: `finally` 块中保存资源 → TS: `finally` 块中调用 `updateMessageContent`

### 2. 错误信息记录（agent.service.ts & llm.service.ts）

#### 在 metaData 中记录错误

```typescript
private async updateMessageContent(...) {
    const metaData: any = {
        modelName: modelName,
        finishReason: chunk.finishReason
    };

    // 如果有错误信息，保存到 meta_data
    if (chunk.error) {
        metaData.error = chunk.error;
        this.logger.warn(`Error saved to metaData: ${chunk.error}`);
    }

    // ... 其他 metaData 字段
}
```

**对齐 Python 后端：**
- ✅ Python: `message_content.meta_data["error"] = complete_chunk.get("error")`
- ✅ TS: `metaData.error = chunk.error`

#### LLM 层的错误分类

```typescript
catch (error) {
    if (error instanceof APIError) {
        // OpenAI API 错误
        throw new Error(`LLM API Error: ${error.status} - ${error.message}`);
    } else if (error instanceof Error) {
        if (error.name === 'AbortError') {
            // 用户主动中止
            throw new Error('LLM request aborted');
        } else if (error.message.includes('timed out')) {
            // 超时错误
            throw new Error('LLM request timed out (60s)');
        } else {
            // 其他运行时错误
            throw error;
        }
    }
}
```

### 3. 部分数据保存机制

#### 关键改进点

1. **在 finally 块中保存**：确保即使发生异常，已生成的内容也会被保存
2. **保存完整状态**：包括 `content`、`reasoningContent`、`toolCalls`、`usage` 等
3. **记录错误原因**：在 `metaData.error` 中保存具体的错误信息

```typescript
finally {
    // 计算思考时长
    const thinkingDurationMs = this.calculateThinkingDuration(currentTurnThinkingInfo);

    // 更新消息内容（即使发生错误也要保存）
    await this.updateMessageContent(
        messageContent.id,
        currentChunk,  // 包含已生成的内容和错误信息
        session.model?.modelName,
        thinkingDurationMs
    );

    this.logger.debug(`Iteration ${iterationCount} cleanup completed. Finish reason: ${currentChunk.finishReason}`);
}
```

**对齐 Python 后端：**
- ✅ Python: 使用 `asyncio.shield()` 保护保存操作
- ✅ TS: 在 `finally` 块中直接调用保存（NestJS 的生成器在中断时仍会执行 finally）

### 4. 资源清理优化（llm.service.ts）

#### 改进的资源清理逻辑

```typescript
finally {
    // 清理资源：关闭流式响应（如果支持）
    if (response && typeof response.controller?.abort === 'function') {
        try {
            response.controller.abort();
            this.logger.debug('LLM response stream closed');
        } catch (e) {
            this.logger.warn('Failed to abort LLM response:', e);
        }
    }
}
```

**改进点：**
- ❌ 旧代码：尝试调用不存在的 `response.close()` 方法
- ✅ 新代码：使用 `response.controller.abort()` 正确中止流

## 📊 对比分析

### Python vs TypeScript 异常处理对照表

| 特性 | Python 后端 | TypeScript 后端 | 状态 |
|------|------------|----------------|------|
| 用户中止检测 | `asyncio.CancelledError` | `error.name === 'AbortError'` | ✅ 已对齐 |
| 超时错误处理 | `finish_reason = "error"` | `finishReason = 'timeout'` | ✅ 更细化 |
| 错误信息记录 | `meta_data["error"]` | `metaData.error` | ✅ 已对齐 |
| 部分数据保存 | `asyncio.shield(save())` | `finally { updateMessageContent() }` | ✅ 已对齐 |
| 思考时间记录 | `_record_thinking_finished()` | `recordThinkingFinished()` | ✅ 已对齐 |
| 资源清理 | `session.commit()` / `rollback()` | `controller.abort()` | ✅ 已优化 |

### 错误类型映射

| 错误场景 | finishReason | error 字段示例 | 前端展示建议 |
|----------|--------------|----------------|-------------|
| 用户主动中止 | `user_abort` | `"User aborted the request"` | 显示"已停止生成" |
| 请求超时 | `timeout` | `"LLM request timed out (60s)"` | 显示"请求超时，请重试" |
| API 错误 | `error` | `"LLM API Error: 429 - Rate limit exceeded"` | 显示具体错误信息 |
| 正常完成 | `stop` / `tool_calls` | `null` | 正常显示内容 |

## 🔍 测试场景

### 场景 1：用户主动中止

**触发条件：** 客户端在流式输出过程中断开连接

**预期行为：**
1. `req.on('close')` 触发，调用 `abortController.abort()`
2. LLM 服务抛出 `AbortError`
3. AgentService 捕获错误，设置 `finishReason = 'user_abort'`
4. 在 `finally` 块中保存已生成的内容到数据库
5. `metaData.error = "User aborted the request"`

**验证方法：**
```sql
SELECT finish_reason, meta_data FROM message_contents 
WHERE meta_data->>'error' LIKE '%aborted%';
```

### 场景 2：LLM API 超时

**触发条件：** LLM 响应超过 60 秒

**预期行为：**
1. OpenAI SDK 抛出超时错误
2. LLMService 转换为 `"LLM request timed out (60s)"`
3. AgentService 设置 `finishReason = 'timeout'`
4. 保存已生成的部分内容和错误信息

**验证方法：**
```sql
SELECT finish_reason, meta_data FROM message_contents 
WHERE finish_reason = 'timeout';
```

### 场景 3：API 速率限制错误

**触发条件：** API 返回 429 错误

**预期行为：**
1. OpenAI SDK 抛出 `APIError` (status: 429)
2. LLMService 转换为 `"LLM API Error: 429 - Rate limit exceeded"`
3. AgentService 设置 `finishReason = 'error'`
4. 向前端发送错误事件：`{ type: 'finish', finishReason: 'error', error: '...' }`
5. 保存已生成的内容和错误详情

**验证方法：**
```sql
SELECT finish_reason, meta_data FROM message_contents 
WHERE meta_data->>'error' LIKE '%429%';
```

### 场景 4：正常完成（无错误）

**触发条件：** LLM 正常返回完整响应

**预期行为：**
1. `finishReason = 'stop'` 或 `'tool_calls'`
2. `metaData.error` 为 `undefined` 或 `null`
3. 保存完整的内容、usage、thinkingDurationMs

**验证方法：**
```sql
SELECT finish_reason, meta_data FROM message_contents 
WHERE finish_reason IN ('stop', 'tool_calls') 
AND meta_data->>'error' IS NULL;
```

## 🛠️ 代码变更摘要

### 修改的文件

1. **agent.service.ts** (约 +190 行, -138 行)
   - 重构主循环，添加 try-catch-finally 结构
   - 在 catch 块中分类处理不同类型的错误
   - 在 finally 块中确保内容保存
   - 扩展 `currentChunk` 类型，添加 `error` 字段

2. **llm.service.ts** (约 +22 行, -6 行)
   - 改进异常分类逻辑（区分 AbortError、timeout、APIError）
   - 优化资源清理（使用 `controller.abort()` 替代 `response.close()`）
   - 增强错误日志记录

3. **chat.controller.ts** (无修改)
   - 已有的异常处理逻辑足够完善
   - 正确监听 `req.on('close')` 和 `res.on('close')`

## ✨ 优势总结

### 1. 数据完整性
- ✅ 即使用户中止或发生错误，已生成的内容也不会丢失
- ✅ 所有异常情况都会在数据库中留下记录

### 2. 可追溯性
- ✅ `metaData.error` 字段记录具体错误原因
- ✅ `finishReason` 明确标识完成状态
- ✅ 详细的日志记录便于问题排查

### 3. 用户体验
- ✅ 前端可以根据 `finishReason` 显示友好的提示信息
- ✅ 部分生成的内容仍然可用，用户可以基于此继续对话

### 4. 系统健壮性
- ✅ 防止无限循环（MAX_ITERATIONS = 10）
- ✅ 优雅处理各种异常场景
- ✅ 资源清理机制完善

## 📝 后续建议

### 1. 前端适配
建议前端根据 `finishReason` 显示不同的提示：

```javascript
if (chunk.finishReason === 'user_abort') {
    showMessage('生成已停止');
} else if (chunk.finishReason === 'timeout') {
    showMessage('请求超时，请重试');
} else if (chunk.finishReason === 'error') {
    showError(chunk.error);
}
```

### 2. 监控与告警
可以基于 `metaData.error` 字段建立监控：

```sql
-- 统计各类错误的发生频率
SELECT 
    meta_data->>'finishReason' as finish_reason,
    COUNT(*) as count
FROM message_contents 
WHERE meta_data->>'error' IS NOT NULL
GROUP BY finish_reason;
```

### 3. 重试机制
对于某些可恢复的错误（如 timeout），可以考虑自动重试：

```typescript
if (currentChunk.finishReason === 'timeout' && iterationCount < 3) {
    this.logger.warn('Retrying after timeout...');
    needToContinue = true;
    continue;
}
```

## ✅ 验证清单

- [x] 异常分类逻辑与 Python 后端对齐
- [x] 部分数据保存机制实现
- [x] 错误信息记录到 metaData
- [x] 资源清理逻辑优化
- [x] 思考时间记录保持完整
- [x] 日志记录完善
- [x] 代码注释清晰
- [x] 类型定义准确

## 🎉 总结

本次更新成功将 TypeScript 后端的异常处理机制提升到与 Python 后端同等的健壮性水平。通过完善的 try-catch-finally 结构、细粒度的错误分类、可靠的部分数据保存机制，确保了在各种异常场景下系统的稳定性和数据的完整性。
