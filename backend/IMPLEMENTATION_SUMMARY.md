# Tokens Usage 记录功能 - 实现总结

## ✅ 已完成的工作

### 1. 核心代码修改

#### 📄 app/services/domain/llm_service.py
- ✅ 扩展 `LLMServiceChunk` 类，添加 `usage: Optional[dict] = None` 属性
- ✅ 更新 `to_dict()` 方法，返回包含 usage 的字典
- ✅ 在流式处理中检测并提取 OpenAI API 的 usage 信息
- ✅ 在 `_handle_stream_chunk()` 方法中解析 usage 数据并传递给 complete_chunk

**关键变更：**
```python
# 新增 usage 属性
class LLMServiceChunk:
    usage: Optional[dict] = None

# 提取 usage 逻辑
if hasattr(chunk, 'usage') and chunk.usage is not None:
    response_chunk.usage = {
        "prompt_tokens": chunk.usage.prompt_tokens,
        "completion_tokens": chunk.usage.completion_tokens,
        "total_tokens": chunk.usage.total_tokens,
    }
```

#### 📄 app/services/agent_service.py
- ✅ 在 `_save_generation_resources()` 方法中添加 usage 保存逻辑
- ✅ 将 usage 信息存入 `MessageContent.meta_data` 字段
- ✅ 添加详细的日志输出，便于监控和调试

**关键变更：**
```python
# 保存 usage 到 meta_data
if complete_chunk.get("usage"):
    message_content.meta_data["usage"] = complete_chunk["usage"]
    logger.info(
        f"Tokens saved: prompt={complete_chunk['usage']['prompt_tokens']}, "
        f"completion={complete_chunk['usage']['completion_tokens']}, "
        f"total={complete_chunk['usage']['total_tokens']}"
    )
```

---

### 2. 测试和验证工具

#### 📄 test_usage_recording.py
完整的自动化测试脚本，用于：
- 检查最近的消息记录是否包含 usage 信息
- 验证特定 MessageContent 记录的完整性
- 统计 usage 数据的保存情况

**使用方法：**
```bash
# 查看最近消息
python test_usage_recording.py

# 验证特定记录
python test_usage_recording.py <message_content_id>
```

#### 📄 verify_code_changes.py
快速验证脚本，用于检查代码修改是否正确应用：
- 检查 LLMServiceChunk.usage 属性是否存在
- 验证 to_dict() 方法返回值
- 检查关键方法的源码是否包含 usage 处理逻辑

**使用方法：**
```bash
python verify_code_changes.py
```

#### 📄 verify_usage_sql.sql
SQL 查询脚本集合，用于手动验证数据库记录：
- 查询最近 10 条包含 usage 的记录
- 统计 usage 数据覆盖率
- 按模型分组统计 tokens 消耗
- 查看完整 meta_data JSON 内容

**使用方法：**
```bash
sqlite3 data/app.db < verify_usage_sql.sql
```

---

### 3. 文档

#### 📄 TOKENS_USAGE_FEATURE.md
完整的功能说明文档，包含：
- 功能概述和实现细节
- 数据结构说明
- 兼容性保证
- 测试验证方法
- 故障排查指南
- 未来扩展建议

---

## 🎯 功能特性

### 数据存储结构
```json
{
  "model_name": "gpt-4",
  "finish_reason": "stop",
  "thinking_duration_ms": 1523,
  "usage": {
    "prompt_tokens": 95,
    "completion_tokens": 210,
    "total_tokens": 305
  }
}
```

### 日志输出示例
```
INFO - Got usage from chunk: prompt=95, completion=210, total=305
INFO - Tokens saved: prompt=95, completion=210, total=305
INFO - Thinking duration saved to meta_data: 1523ms
```

---

## ✅ 兼容性验证

### 向后兼容
- ✅ `usage` 字段为可选（Optional），不影响现有功能
- ✅ 即使 API 不返回 usage，也不会报错
- ✅ 数据库 schema 无需修改（`meta_data` 已存在）
- ✅ 历史消息不受影响

### 流式响应
- ✅ 只在最后一个 chunk 处理 usage
- ✅ 不改变现有的流式传输逻辑
- ✅ 错误处理完善

### 安全性
- ✅ 使用 `hasattr` 安全访问属性
- ✅ 即使 usage 提取失败也不影响消息保存
- ✅ 详细的日志记录

---

## 🚀 下一步操作

### 1. 启动服务进行测试
```bash
cd backend
python run.py
```

### 2. 进行一次对话
通过前端界面发送一条消息，触发完整的聊天流程。

### 3. 查看日志
在 backend 日志中查找：
```
Tokens saved: prompt=XX, completion=XX, total=XX
```

### 4. 验证数据库
```bash
# 运行测试脚本
python test_usage_recording.py

# 或使用 SQL 查询
sqlite3 data/app.db < verify_usage_sql.sql
```

### 5. 检查前端展示
如果前端已有 tokens 统计功能，应该能看到最新的 tokens 数据。

---

## 📊 预期结果

### 成功标志
1. ✅ 代码中没有语法错误
2. ✅ 日志中出现 "Tokens saved: ..." 信息
3. ✅ 数据库中 `MessageContent.meta_data.usage` 包含完整数据
4. ✅ 验证脚本显示所有检查项通过

### 示例输出
```
============================================================
Tokens Usage 记录功能 - 代码验证
============================================================

1. 检查 LLMServiceChunk.usage 属性...
   ✅ LLMServiceChunk 包含 usage 属性
      默认值：None

2. 检查 to_dict() 方法...
   ✅ to_dict() 包含 usage 字段
      返回值：{'content': 'test', 'usage': {'prompt_tokens': 10, ...}}

3. 检查 _handle_stream_chunk 方法...
   ✅ _handle_stream_chunk 包含 usage 提取逻辑

4. 检查 _save_generation_resources 方法...
   ✅ _save_generation_resources 包含 usage 保存逻辑

5. 检查日志配置...
   ✅ Logger 已配置：app.services.agent_service

============================================================
代码验证完成！
============================================================
```

---

## 🔍 可能的问题

### 问题 1：没有看到 usage 信息
**原因：**
- OpenAI API 未返回 usage（某些供应商可能不支持）
- 网络问题导致数据丢失

**解决方案：**
1. 检查日志是否有 "Got usage from chunk" 信息
2. 确认使用的模型供应商支持返回 usage
3. 尝试直接使用 OpenAI 官方 API 测试

### 问题 2：导入错误
**原因：**
- Python 环境缺少依赖

**解决方案：**
```bash
pip install -r requirements.txt
```

---

## 📝 文件清单

### 修改的文件
1. `app/services/domain/llm_service.py` - 核心数据结构和服务
2. `app/services/agent_service.py` - 业务逻辑和数据持久化

### 新增的文件
1. `test_usage_recording.py` - 完整测试脚本
2. `verify_code_changes.py` - 快速验证脚本
3. `verify_usage_sql.sql` - SQL 查询集合
4. `TOKENS_USAGE_FEATURE.md` - 功能说明文档
5. `IMPLEMENTATION_SUMMARY.md` - 本文档

---

## 🎉 总结

本次实现完成了以下目标：

1. ✅ **数据采集**：从 OpenAI API 响应中提取 usage 信息
2. ✅ **数据传输**：通过 LLMServiceChunk 传递 usage 数据
3. ✅ **数据持久化**：保存到 MessageContent.meta_data 字段
4. ✅ **监控日志**：详细的日志输出便于调试
5. ✅ **测试工具**：提供完整的测试和验证工具
6. ✅ **文档完善**：详细的使用说明和故障排查指南

所有修改都遵循了向后兼容原则，不会影响现有功能。

**实现时间**: 2026-03-24  
**状态**: ✅ 完成，等待测试验证
