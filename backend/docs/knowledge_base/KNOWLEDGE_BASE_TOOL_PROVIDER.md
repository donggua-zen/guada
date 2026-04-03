# 知识库工具提供者 (Knowledge Base Tool Provider)

## 概述

知识库工具提供者是一个基于现有知识库后端框架实现的新工具提供者，它封装了三个核心功能接口，使 AI Agent 能够直接调用知识库相关功能。

**文件位置**: `backend/app/services/tools/providers/knowledge_base_tool_provider.py`

## 设计架构

### 继承关系

```
IToolProvider (基类)
    ↑
    |
KnowledgeBaseToolProvider
```

### 命名空间

- **命名空间**: `knowledge_base`
- **工具前缀**: `knowledge_base__`

## 核心功能

### 1. 知识库语义搜索接口 (`search`)

在知识库中进行向量相似度搜索，找到最相关的内容。

**输入参数**:
- `knowledge_base_id` (必填): 目标知识库 ID
- `query` (必填): 用户搜索的自然语言文本
- `file_id` (可选): 限制搜索范围的特定文件 ID
- `top_k` (必填): 期望返回的最相似分块数量（1-20）

**功能要求**:
- ✅ 调用向量服务（Vector Service）在 ChromaDB 中进行相似度检索
- ✅ 返回包含内容、元数据及相似度分数的结果列表
- ✅ 参考现有 `search_knowledge_base` 路由逻辑
- ✅ 自动验证用户权限

**示例调用**:
```json
{
  "name": "knowledge_base__search",
  "arguments": {
    "knowledge_base_id": "kb_123",
    "query": "如何使用 Python 进行数据分析？",
    "top_k": 5
  }
}
```

**返回格式**:
```json
{
  "success": true,
  "error": null,
  "data": {
    "query": "如何使用 Python 进行数据分析？",
    "results": [
      {
        "content": "Pandas 是 Python 中最常用的数据分析库，提供了强大的数据处理和分析功能...",
        "metadata": {
          "file_id": "file_001",
          "file_name": "Python 数据分析教程.pdf",
          "chunk_index": 0
        },
        "similarity": 0.953
      },
      {
        "content": "使用 Python 进行数据分析的一般流程包括：数据收集、数据清洗、数据探索...",
        "metadata": {
          "file_id": "file_002",
          "file_name": "数据分析实战.md",
          "chunk_index": 5
        },
        "similarity": 0.872
      }
    ],
    "total": 2
  }
}
```

---

### 2. 知识库文件列表接口 (`list_files`)

获取该知识库下所有已上传文件的元数据列表。

**输入参数**:
- `knowledge_base_id` (必填): 目标知识库 ID

**功能要求**:
- ✅ 获取该知识库下所有已上传文件的元数据列表
- ✅ 包括文件名、状态、大小等信息
- ✅ 参考现有 `list_kb_files` 仓库方法或 `fetchKBFiles` API 逻辑
- ✅ 自动验证用户权限

**示例调用**:
```json
{
  "name": "knowledge_base__list_files",
  "arguments": {
    "knowledge_base_id": "kb_123"
  }
}
```

**返回格式**:
```json
{
  "success": true,
  "error": null,
  "data": {
    "files": [
      {
        "id": "file_001",
        "display_name": "Python 数据分析教程.pdf",
        "file_name": "abc123.pdf",
        "file_size": 2463744,
        "file_size_formatted": "2.35 MB",
        "file_type": "pdf",
        "file_extension": "pdf",
        "processing_status": "completed",
        "progress_percentage": 100,
        "current_step": null,
        "total_chunks": 45,
        "uploaded_at": "2026-04-01T10:00:00Z",
        "processed_at": "2026-04-01T10:01:30Z"
      },
      {
        "id": "file_002",
        "display_name": "数据分析实战.md",
        "file_name": "def456.md",
        "file_size": 160358,
        "file_size_formatted": "156.78 KB",
        "file_type": "text",
        "file_extension": "md",
        "processing_status": "completed",
        "progress_percentage": 100,
        "current_step": null,
        "total_chunks": 12,
        "uploaded_at": "2026-04-01T11:00:00Z",
        "processed_at": "2026-04-01T11:00:45Z"
      }
    ],
    "total": 2,
    "knowledge_base_id": "kb_123",
    "filter": "completed_only",
    "note": "只返回处理完成的文件"
  }
}
```

**注意**: 该工具只会返回 `processing_status` 为 `"completed"` 的文件，确保所有返回的文件都已完成处理并可用于搜索和查看。

---

### 3. 知识库文件分块详情接口 (`get_chunks`)

从数据库或向量库元数据中提取指定文件的特定分块内容。

**输入参数**:
- `knowledge_base_id` (必填): 目标知识库 ID
- `file_id` (必填): 指定文件 ID
- `chunk_index` (必填): 起始分块的索引位置（从 0 开始）
- `limit` (必填): 获取的分块数量（1-10，防止过量 token 消耗）

**功能要求**:
- ✅ 从数据库或向量库元数据中提取指定文件的特定分块内容
- ✅ 需实现分页逻辑，确保单次调用不超过 10 个分块
- ✅ 参考 `KBChunk` 模型及 `kb_chunk_repository.py` 中的查询逻辑
- ✅ 自动验证用户权限

**示例调用**:
```json
{
  "name": "knowledge_base__get_chunks",
  "arguments": {
    "knowledge_base_id": "kb_123",
    "file_id": "file_001",
    "chunk_index": 0,
    "limit": 5
  }
}
```

**返回格式**:
```json
{
  "success": true,
  "error": null,
  "data": {
    "chunks": [
      {
        "id": "chunk_001",
        "chunk_index": 0,
        "content": "Pandas 是 Python 中最常用的数据分析库，提供了强大的数据处理和分析功能。它基于 NumPy 构建，提供了 DataFrame 和 Series 等核心数据结构...",
        "token_count": 256,
        "vector_id": "vec_abc123",
        "embedding_dimensions": 1536,
        "metadata": {}
      },
      {
        "id": "chunk_002",
        "chunk_index": 1,
        "content": "DataFrame 是 Pandas 的核心数据结构，类似于 Excel 表格或 SQL 表。它具有行和列，可以轻松地读取、写入和操作数据...",
        "token_count": 312,
        "vector_id": "vec_def456",
        "embedding_dimensions": 1536,
        "metadata": {}
      },
      {
        "id": "chunk_003",
        "chunk_index": 2,
        "content": "要使用 Pandas 进行数据分析，首先需要导入库：import pandas as pd。然后可以使用 read_csv()、read_excel() 等方法读取数据...",
        "token_count": 289,
        "vector_id": "vec_ghi789",
        "embedding_dimensions": 1536,
        "metadata": {}
      }
    ],
    "total": 3,
    "file_id": "file_001",
    "file_name": "Python 数据分析教程.pdf",
    "chunk_index": 0,
    "limit": 3,
    "has_more": true
  }
}
```

---

## 使用方法

### 1. 初始化工具提供者

```python
from app.services.tools.providers.knowledge_base_tool_provider import KnowledgeBaseToolProvider

# 在会话中初始化
provider = KnowledgeBaseToolProvider(session)
```

### 2. 获取工具列表

```python
# 获取所有工具
tools = await provider.get_tools_namespaced(enabled_ids=True)

# 输出:
# [
#   {"function": {"name": "knowledge_base__search", ...}},
#   {"function": {"name": "knowledge_base__list_files", ...}},
#   {"function": {"name": "knowledge_base__get_chunks", ...}}
# ]
```

### 3. 执行工具调用

```python
from app.services.tools.providers.tool_provider_base import ToolCallRequest

# 创建请求
request = ToolCallRequest(
    id="call_001",
    name="knowledge_base__search",
    arguments={
        "knowledge_base_id": "kb_123",
        "query": "Python 数据分析",
        "top_k": 5
    }
)

# 注入参数（用于权限验证）
inject_params = {"user_id": "user_456"}

# 执行调用
response = await provider.execute_with_namespace(request, inject_params)

# 处理响应
print(response.content)
```

### 4. 获取提示词注入

```python
prompt = await provider.get_prompt({"user_id": "user_456"})
# 返回详细的工具使用说明
```

---

## 集成到系统

### 在 Tool Orchestrator 中注册

编辑 `backend/app/services/tools/tool_orchestrator.py`，添加知识库工具提供者：

```python
from app.services.tools.providers.knowledge_base_tool_provider import KnowledgeBaseToolProvider

async def initialize_providers(self):
    # ... 其他提供者
    
    # 添加知识库工具提供者
    kb_provider = KnowledgeBaseToolProvider(self.session)
    self.providers["knowledge_base"] = kb_provider
```

### 在前端 ApiService 中添加调用接口

编辑 `frontend/src/services/api.ts`，添加相应的方法：

```typescript
// 知识库工具调用
async callKnowledgeBaseSearch(params: {
    knowledge_base_id: string;
    query: string;
    file_id?: string;
    top_k: number;
}): Promise<any> {
    return this.callTool('knowledge_base__search', params);
}

async callKnowledgeBaseListFiles(params: {
    knowledge_base_id: string;
}): Promise<any> {
    return this.callTool('knowledge_base__list_files', params);
}

async callKnowledgeBaseGetChunks(params: {
    knowledge_base_id: string;
    file_id: string;
    chunk_index: number;
    limit: number;
}): Promise<any> {
    return this.callTool('knowledge_base__get_chunks', params);
}
```

---

## 错误处理

所有工具方法都包含完善的错误处理机制：

1. **权限验证失败**: 返回 `"❌ 错误：无权访问该知识库"`
2. **资源不存在**: 返回 `"❌ 错误：知识库/文件不存在"`
3. **参数验证失败**: Pydantic 自动验证并返回错误信息
4. **系统异常**: 捕获异常并返回友好的错误提示

---

## 测试

运行测试脚本验证功能：

```bash
cd backend
python app/tests/test_kb_tool_provider.py
```

**注意**: 测试需要真实的数据库记录，请根据实际情况修改测试脚本中的参数。

---

## 性能优化

1. **缓存策略**: 可以考虑缓存频繁访问的文件名、知识库信息等
2. **批量查询**: 对于多个文件的查询，可以考虑批量操作减少数据库访问次数
3. **分页限制**: `get_chunks` 方法已实现最大 10 个分块的限制，防止 token 消耗过大

---

## 安全考虑

1. **权限验证**: 所有工具都会验证 `user_id`，确保只能访问自己的知识库
2. **参数校验**: 使用 Pydantic 严格验证输入参数
3. **防止滥用**: 限制 `top_k` 和 `limit` 的最大值，防止过量查询

---

## 扩展建议

未来可以考虑添加以下工具：

1. **文件管理工具**: 上传、删除文件
2. **分块管理工具**: 手动添加、编辑、删除分块
3. **统计工具**: 获取知识库的统计信息（文件数、分块数等）
4. **批量操作工具**: 批量处理多个文件或知识库

---

## 相关文件

- **实现文件**: `backend/app/services/tools/providers/knowledge_base_tool_provider.py`
- **测试文件**: `backend/app/tests/test_kb_tool_provider.py`
- **基类接口**: `backend/app/services/tools/providers/tool_provider_base.py`
- **向量服务**: `backend/app/services/vector_service.py`
- **仓库层**: 
  - `backend/app/repositories/kb_repository.py`
  - `backend/app/repositories/kb_file_repository.py`
  - `backend/app/repositories/kb_chunk_repository.py`
- **路由层**: 
  - `backend/app/routes/kb_search.py`
  - `backend/app/routes/kb_files.py`
  - `backend/app/routes/knowledge_bases.py`

---

## 版本历史

- **v1.0** (2026-04-02): 初始版本，实现三个核心工具
  - ✅ 知识库语义搜索
  - ✅ 知识库文件列表
  - ✅ 知识库文件分块详情
