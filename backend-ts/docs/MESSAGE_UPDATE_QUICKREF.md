# 消息更新 API - 快速参考

## 📌 方法签名

```typescript
async updateMessage(messageId: string, data: any): Promise<Message>
```

## ✅ 支持的字段

### Message 表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | String | 消息角色（user/assistant/system） |
| `currentTurnsId` | String | 当前轮次 ID（系统管理，不建议手动修改） |

### MessageContent 表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | String | 消息文本内容 |
| `reasoningContent` | String | 推理内容（思考过程） |
| `metaData` | JSON | 元数据（usage、error、thinkingDurationMs 等） |
| `additionalKwargs` | JSON | 额外参数（toolCalls、referencedKbs 等） |

## 💡 使用示例

### 1. 更新消息内容

```typescript
await messageService.updateMessage('msg_123', {
  content: '这是编辑后的内容'
});
```

### 2. 更新推理内容

```typescript
await messageService.updateMessage('msg_123', {
  reasoningContent: '让我仔细思考一下...'
});
```

### 3. 更新元数据

```typescript
await messageService.updateMessage('msg_123', {
  metaData: {
    modelName: 'gpt-4',
    finishReason: 'stop',
    thinkingDurationMs: 1234,
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150
    }
  }
});
```

### 4. 保存错误信息

```typescript
await messageService.updateMessage('msg_123', {
  metaData: {
    finishReason: 'error',
    error: 'LLM API Error: 429 - Rate limit exceeded'
  }
});
```

### 5. 更新工具调用结果

```typescript
await messageService.updateMessage('msg_123', {
  additionalKwargs: {
    toolCalls: [...],
    toolCallsResponse: [...]
  }
});
```

### 6. 批量更新多个字段

```typescript
await messageService.updateMessage('msg_123', {
  role: 'assistant',
  content: '更新的内容',
  reasoningContent: '推理过程',
  metaData: { editedAt: new Date().toISOString() }
});
```

## ⚠️ 注意事项

1. **metaData 是完整替换**
   ```typescript
   // ❌ 错误：会丢失原有字段
   await updateMessage(id, { metaData: { newField: 'value' } });
   
   // ✅ 正确：先读取再合并
   const message = await getMessage(id);
   const existingMetaData = message.contents[0].metaData || {};
   await updateMessage(id, { 
     metaData: { ...existingMetaData, newField: 'value' } 
   });
   ```

2. **不要手动修改 turnsId**
   - `turnsId` 由系统自动管理
   - 手动修改可能导致版本混乱

3. **谨慎修改 currentTurnsId**
   - 该字段在流式生成时自动设置
   - 手动修改可能影响内容版本选择

## 🔍 验证更新

```sql
-- 查看更新后的消息
SELECT 
    m.id,
    m.role,
    mc.content,
    mc.reasoning_content,
    mc.meta_data
FROM message m
JOIN message_content mc ON m.id = mc.message_id
WHERE m.id = 'msg_123'
AND mc.turns_id = m.current_turns_id;
```

## 📖 相关文档

- [详细实现文档](./MESSAGE_UPDATE_LOGIC_ALIGNMENT.md)
- [Python 后端参考](../../backend/app/repositories/message_repository.py)
