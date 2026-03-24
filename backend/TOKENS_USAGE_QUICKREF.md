# Tokens Usage 记录功能 - 快速参考

## 🎯 一句话总结
在每次对话完成后，自动将 tokens 消耗数据（prompt/completion/total）保存到 MessageContent 的 meta_data 字段中。

---

## 📁 修改的文件

| 文件 | 变更内容 |
|------|----------|
| `app/services/domain/llm_service.py` | 添加 usage 属性到 LLMServiceChunk，提取 OpenAI API 的 usage 数据 |
| `app/services/agent_service.py` | 保存 usage 到 MessageContent.meta_data |

---

## 🔍 验证方法

### 方法 1: 查看日志
启动服务后进行对话，查找日志：
```
INFO - Tokens saved: prompt=100, completion=200, total=300
```

### 方法 2: 运行测试脚本
```bash
python test_usage_recording.py
```

### 方法 3: SQL 查询
```sql
SELECT 
    id,
    json_extract(meta_data, '$.usage.total_tokens') as total_tokens
FROM message_content
WHERE json_extract(meta_data, '$.usage') IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

---

## 📊 MetaData 结构

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

---

## ✅ 兼容性

- ✅ 向后兼容，不影响现有功能
- ✅ 即使 API 不返回 usage 也不会报错
- ✅ 数据库 schema 无需修改
- ✅ 流式响应逻辑不变

---

## 🐛 故障排查

**没有 usage 信息？**
1. 检查日志是否有 "Got usage from chunk"
2. 确认模型供应商支持返回 usage
3. 某些供应商可能在最后一个 chunk 才返回 usage

**导入错误？**
```bash
pip install -r requirements.txt
```

---

## 📚 详细文档

- **完整说明**: TOKENS_USAGE_FEATURE.md
- **实现总结**: IMPLEMENTATION_SUMMARY.md
- **测试脚本**: test_usage_recording.py
- **SQL 查询**: verify_usage_sql.sql

---

**更新时间**: 2026-03-24
