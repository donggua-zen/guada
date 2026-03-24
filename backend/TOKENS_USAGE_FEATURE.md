# Tokens 消耗记录功能实现说明

## 📋 功能概述

本功能实现了在每次对话完成后，自动将消耗的 tokens 数量记录到 `MessageContent` 模型的 `meta_data` 字段中。

### 数据来源
- OpenAI API 响应对象中的 `usage` 字段
- 包含：`prompt_tokens`、`completion_tokens`、`total_tokens`

### 存储位置
- `MessageContent.meta_data` (JSON 类型)

---

## 🔧 实现细节

### 1. 修改的文件

#### app/services/domain/llm_service.py
**变更内容：**
- ✅ 扩展 `LLMServiceChunk` 类，添加 `usage` 属性
- ✅ 更新 `to_dict()` 方法，包含 usage 信息
- ✅ 在 `_handle_stream_chunk()` 方法中提取 OpenAI API 的 usage 数据

**关键代码片段：**
```python
class LLMServiceChunk:
    # ... 其他属性 ...
    usage: Optional[dict] = None  # 新增：usage 信息
    
    def to_dict(self):
        return {
            # ... 其他字段 ...
            "usage": self.usage,  # 新增
        }

def _handle_stream_chunk(self, chunk, complete_chunk: LLMServiceChunk = None):
    response_chunk = LLMServiceChunk()
    
    # 提取 usage 信息（如果存在）
    if hasattr(chunk, 'usage') and chunk.usage is not None:
        response_chunk.usage = {
            "prompt_tokens": chunk.usage.prompt_tokens,
            "completion_tokens": chunk.usage.completion_tokens,
            "total_tokens": chunk.usage.total_tokens,
        }
        if complete_chunk is not None:
            complete_chunk.usage = response_chunk.usage
    
    # ... 其余逻辑 ...
```

#### app/services/agent_service.py
**变更内容：**
- ✅ 在 `_save_generation_resources()` 方法中保存 usage 到 `meta_data`
- ✅ 添加日志输出，方便调试和监控

**关键代码片段：**
```python
async def _save_generation_resources(
    self,
    assistant_content: MessageContent,
    complete_chunk: dict,
    model,
    safesave=False,
):
    async def save(message_content: MessageContent):
        # ... 现有代码 ...
        
        # 构建 meta_data，添加思考时长和 usage 信息
        message_content.meta_data = {
            "model_name": model.model_name,
            "finish_reason": complete_chunk.get("finish_reason"),
            "error": complete_chunk.get("error"),
        }
        
        # 如果有 usage 信息，保存到 meta_data
        if complete_chunk.get("usage"):
            message_content.meta_data["usage"] = complete_chunk["usage"]
            logger.info(
                f"Tokens saved: prompt={complete_chunk['usage']['prompt_tokens']}, "
                f"completion={complete_chunk['usage']['completion_tokens']}, "
                f"total={complete_chunk['usage']['total_tokens']}"
            )
        
        # ... 其余代码 ...
```

---

## 📊 数据结构

### MetaData 完整结构
```json
{
  "model_name": "gpt-4",
  "finish_reason": "stop",
  "thinking_duration_ms": 1234,
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

### 字段说明
| 字段名 | 类型 | 说明 |
|--------|------|------|
| `model_name` | string | 使用的模型名称 |
| `finish_reason` | string | 完成原因（stop, tool_calls, error 等） |
| `thinking_duration_ms` | integer | 思考时长（毫秒），仅当有思考过程时存在 |
| `usage.prompt_tokens` | integer | 提示词消耗的 tokens |
| `usage.completion_tokens` | integer | 生成内容消耗的 tokens |
| `usage.total_tokens` | integer | 总消耗 tokens |

---

## ✅ 兼容性保证

### 向后兼容
- ✅ `usage` 字段为可选（Optional），不影响现有功能
- ✅ 即使 API 不返回 usage，也不会报错
- ✅ 数据库 schema 无需修改（`meta_data` 已存在）

### 流式响应不受影响
- ✅ 只在最后一个 chunk 处理 usage
- ✅ 不改变现有的流式传输逻辑
- ✅ 错误处理完善（使用 `hasattr` 和 `None` 检查）

### 安全性
- ✅ 使用 `hasattr` 安全访问属性
- ✅ 即使 usage 提取失败也不影响消息保存
- ✅ 日志记录详细，便于排查问题

---

## 🧪 测试验证

### 方法一：运行测试脚本

```bash
# 查看最近的消息记录
python test_usage_recording.py

# 验证特定 ID 的记录
python test_usage_recording.py <message_content_id>
```

### 方法二：使用 SQL 查询

```bash
# 连接到数据库
sqlite3 data/app.db

# 运行验证脚本
.read verify_usage_sql.sql
```

或者手动执行查询：
```sql
-- 查看最近 10 条记录的 usage 信息
SELECT 
    id,
    json_extract(meta_data, '$.usage.prompt_tokens') as prompt_tokens,
    json_extract(meta_data, '$.usage.completion_tokens') as completion_tokens,
    json_extract(meta_data, '$.usage.total_tokens') as total_tokens,
    created_at
FROM message_content
ORDER BY created_at DESC
LIMIT 10;
```

### 方法三：查看日志

启动后端服务后，进行一次对话，查看日志输出：
```
INFO - Tokens saved: prompt=100, completion=200, total=300
```

---

## 📈 预期效果

### 成功标志
1. ✅ 日志中出现 `Tokens saved: ...` 信息
2. ✅ 数据库中 `MessageContent.meta_data.usage` 包含完整的 tokens 数据
3. ✅ 前端可以正常获取并展示 tokens 统计信息

### 示例输出
```
=== Usage 记录功能测试 ===

找到 5 条最近的 MessageContent:

1. ID: 01KABCD1234EFGH5678IJKL9M
   Created: 2026-03-24 10:30:45
   Model: gpt-4
   ✅ Has Usage: prompt=95, completion=210, total=305
   ⏱ Thinking Duration: 1523ms

2. ID: 01KABCD1234EFGH5678IJKL9N
   Created: 2026-03-24 10:28:32
   Model: claude-3-sonnet
   ✅ Has Usage: prompt=120, completion=185, total=305

...
```

---

## 🔍 故障排查

### 问题 1：没有 usage 信息
**可能原因：**
- OpenAI API 未返回 usage（某些供应商可能不支持）
- 网络问题导致 usage 丢失

**解决方案：**
1. 检查日志是否有 "Got usage from chunk" 信息
2. 确认使用的模型供应商支持返回 usage
3. 检查 OpenAI SDK 版本是否支持流式 usage

### 问题 2：测试脚本报错
**可能原因：**
- 数据库路径不正确
- 权限问题

**解决方案：**
1. 确保在 backend 目录下运行脚本
2. 确认 data/app.db 文件存在
3. 检查 Python 环境是否正确安装依赖

---

## 📝 注意事项

1. **首次部署**：新功能对历史消息无影响，只有新产生的消息会包含 usage 信息
2. **性能影响**：几乎无性能影响，只是简单的数据传递和存储
3. **存储空间**：每条记录增加约 50-100 字节的 JSON 数据
4. **隐私考虑**：tokens 数据不包含敏感信息，可以安全存储

---

## 🚀 未来扩展

### 可能的增强功能
1. **前端展示**：在消息详情中显示 tokens 消耗
2. **统计分析**：按会话、角色、时间段统计 tokens 使用情况
3. **成本计算**：根据 tokens 和使用单价计算费用
4. **配额管理**：设置 tokens 使用上限和告警

### API 扩展建议
```python
# 添加 endpoints 用于查询统计信息
GET /api/v1/sessions/{session_id}/usage-summary
GET /api/v1/characters/{character_id}/usage-stats
GET /api/v1/users/me/usage-daily
```

---

## 👤 维护者

如有问题，请查看日志或联系开发团队。

**最后更新**: 2026-03-24
