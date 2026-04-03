# 知识库工具提供者 - 快速参考卡片

## 🚀 快速开始

### 1. 初始化
```python
from app.services.tools.providers.knowledge_base_tool_provider import KnowledgeBaseToolProvider

provider = KnowledgeBaseToolProvider(session)
```

### 2. 调用工具
```python
from app.services.tools.providers.tool_provider_base import ToolCallRequest

request = ToolCallRequest(
    id="call_001",
    name="knowledge_base__search",
    arguments={
        "knowledge_base_id": "kb_123",
        "query": "搜索关键词",
        "top_k": 5
    }
)

response = await provider.execute_with_namespace(
    request, 
    inject_params={"user_id": "user_456"}
)
```

---

## 📦 工具列表

| 工具名称 | 用途 | 必填参数 | 可选参数 |
|---------|------|---------|---------|
| `knowledge_base__search` | 语义搜索 | knowledge_base_id, query, top_k | file_id |
| `knowledge_base__list_files` | 文件列表 | knowledge_base_id | - |
| `knowledge_base__get_chunks` | 分块详情 | knowledge_base_id, file_id, chunk_index, limit | - |

---

## 🔑 关键参数

### search 工具
- **knowledge_base_id**: 知识库 ID（必填）
- **query**: 搜索文本（必填）
- **top_k**: 返回数量 1-20（必填）
- **file_id**: 限定文件（可选）

### list_files 工具
- **knowledge_base_id**: 知识库 ID（必填）
- **filter**: 自动过滤，只返回 `completed` 状态的文件

### get_chunks 工具
- **knowledge_base_id**: 知识库 ID（必填）
- **file_id**: 文件 ID（必填）
- **chunk_index**: 起始索引 0+（必填）
- **limit**: 数量限制 1-10（必填）

---

## ⚠️ 重要注意事项

### 权限验证
所有工具都需要注入 `user_id`：
```python
inject_params = {"user_id": "your_user_id"}
```

### 参数限制
- `top_k`: 最大 20
- `limit`: 最大 10
- `chunk_index`: 从 0 开始

### 错误处理
```python
if response.is_error:
    print(f"错误：{response.content}")
else:
    print(f"成功：{response.content}")
```

---

## 💡 常用示例

### 示例 1: 搜索知识库
```python
{
    "name": "knowledge_base__search",
    "arguments": {
        "knowledge_base_id": "kb_xxx",
        "query": "Python 数据分析",
        "top_k": 5
    }
}
```

### 示例 2: 查看文件列表
```python
{
    "name": "knowledge_base__list_files",
    "arguments": {
        "knowledge_base_id": "kb_xxx"
    }
}
```

### 示例 3: 获取文件分块
```python
{
    "name": "knowledge_base__get_chunks",
    "arguments": {
        "knowledge_base_id": "kb_xxx",
        "file_id": "file_xxx",
        "chunk_index": 0,
        "limit": 5
    }
}
```

---

## 🎯 最佳实践

### ✅ 推荐做法
1. 先搜索，再根据结果查看详细分块
2. 使用分页机制查看大量分块
3. 设置合理的 top_k 和 limit 值
4. 始终验证 user_id 权限

### ❌ 避免的做法
1. 一次性加载过多分块（>100）
2. 不验证权限直接调用
3. 忽略错误响应
4. 使用过大的 top_k 值

---

## 📊 输出格式

### 搜索结果
```json
{
  "success": true,
  "error": null,
  "data": {
    "query": "xxx",
    "results": [
      {
        "content": "...",
        "metadata": {
          "file_name": "文件名",
          "file_id": "file_xxx"
        },
        "similarity": 0.953
      }
    ],
    "total": 2
  }
}
```

### 文件列表
```json
{
  "success": true,
  "error": null,
  "data": {
    "files": [
      {
        "id": "file_xxx",
        "display_name": "文件名.pdf",
        "file_size": 2463744,
        "file_size_formatted": "2.35 MB",
        "file_type": "pdf",
        "processing_status": "completed",
        "total_chunks": 45
      }
    ],
    "total": 3,
    "knowledge_base_id": "kb_xxx",
    "filter": "completed_only",
    "note": "只返回处理完成的文件"
  }
}
```

**注意**: 只返回 `processing_status="completed"` 的文件

### 分块详情
```json
{
  "success": true,
  "error": null,
  "data": {
    "chunks": [
      {
        "id": "chunk_001",
        "chunk_index": 0,
        "content": "内容...",
        "token_count": 256,
        "vector_id": "vec_xxx"
      }
    ],
    "total": 3,
    "file_id": "file_xxx",
    "file_name": "文件名",
    "has_more": true
  }
}
```

---

## 🔗 相关文档

- **详细文档**: KNOWLEDGE_BASE_TOOL_PROVIDER.md
- **使用示例**: KNOWLEDGE_BASE_TOOL_PROVIDER_EXAMPLES.md
- **实现总结**: KNOWLEDGE_BASE_TOOL_PROVIDER_SUMMARY.md

---

**版本**: v1.0 | **更新时间**: 2026-04-02
