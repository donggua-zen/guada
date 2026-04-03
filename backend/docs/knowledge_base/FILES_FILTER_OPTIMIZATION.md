# 文件列表过滤优化 - 只返回已完成处理的文件

## 📝 更新概述

**更新时间**: 2026-04-02  
**版本**: v1.1.1  
**变更类型**: 功能优化

---

## 🎯 更新内容

### 问题描述
在使用 `knowledge_base__list_files` 工具时，AI Agent 可能会获取到正在处理中（`processing`）、等待处理（`pending`）或失败（`failed`）的文件。这些文件：

❌ 无法进行语义搜索（向量化未完成）  
❌ 无法查看分块内容（分块未生成）  
❌ 可能导致 AI 提供错误信息  

### 解决方案
修改 `_list_files()` 方法，**自动过滤**出 `processing_status = "completed"` 的文件，确保返回给 AI 的都是可用的文件。

---

## 🔧 代码变更

### 修改文件 1: `kb_file_repository.py`
**文件**: `backend/app/repositories/kb_file_repository.py`

#### 新增方法
```python
async def get_files_by_knowledge_base_and_status(
    self,
    knowledge_base_id: str,
    statuses: List[str],
) -> List[KBFile]:
    """根据知识库 ID 和处理状态查询文件
    
    Args:
        knowledge_base_id: 知识库 ID
        statuses: 状态列表，如 ["completed"]
    
    Returns:
        List[KBFile]: 文件列表
    """
    stmt = select(KBFile).where(
        KBFile.knowledge_base_id == knowledge_base_id,
        KBFile.processing_status.in_(statuses)
    ).order_by(KBFile.uploaded_at.desc())
    
    result = await self.session.execute(stmt)
    return list(result.scalars().all())
```

### 修改文件 2: `knowledge_base_tool_provider.py`
**文件**: `backend/app/services/tools/providers/knowledge_base_tool_provider.py`

### 变更前
```python
# 获取文件列表
file_repo = KBFileRepository(self.session)
all_files = await file_repo.list_files(params.knowledge_base_id, skip=0, limit=100)

# 过滤出已完成处理的文件
completed_files = [
    file for file in all_files 
    if file.processing_status == "completed"
]
```

### 变更后
```python
# 获取文件列表（只返回已处理完成的文件）
file_repo = KBFileRepository(self.session)
completed_files = await file_repo.get_files_by_knowledge_base_and_status(
    knowledge_base_id=params.knowledge_base_id,
    statuses=["completed"]
)
```

### 响应格式变化
```json
{
  "success": true,
  "error": null,
  "data": {
    "files": [...],
    "total": 2,
    "knowledge_base_id": "kb_123",
    "filter": "completed_only",           // ✅ 新增字段
    "note": "只返回处理完成的文件"         // ✅ 新增字段
  }
}
```

---

## 📊 效果对比

### Before (包含所有状态的文件)
```json
{
  "data": {
    "files": [
      {
        "display_name": "文件 A.pdf",
        "processing_status": "completed",    // ✅ 可用
        "total_chunks": 45
      },
      {
        "display_name": "文件 B.docx",
        "processing_status": "processing",   // ❌ 不可用
        "total_chunks": 0
      },
      {
        "display_name": "文件 C.md",
        "processing_status": "failed",       // ❌ 不可用
        "total_chunks": 0
      }
    ],
    "total": 3
  }
}
```

### After (只返回 completed 状态)
```json
{
  "data": {
    "files": [
      {
        "display_name": "文件 A.pdf",
        "processing_status": "completed",    // ✅ 可用
        "total_chunks": 45
      }
    ],
    "total": 1,                              // ✅ 只统计可用文件
    "filter": "completed_only",
    "note": "只返回处理完成的文件"
  }
}
```

---

## 💡 优势

### 对 AI Agent 的好处
1. ✅ **准确性提升**: 只能看到可用的文件，避免推荐未处理完成的文件
2. ✅ **减少错误**: 不会尝试搜索或查看未处理完成的文件
3. ✅ **用户体验**: 提供的信息都是准确可靠的

### 对系统的好处
1. ✅ **性能优化**: 数据库层面过滤，减少数据传输
2. ✅ **代码简洁**: 使用专用方法，无需手动过滤
3. ✅ **职责清晰**: Repository 层负责数据查询逻辑
4. ✅ **可维护性**: 过滤逻辑集中在 Repository 层，易于修改

---

## 🎯 使用场景

### 场景 1: AI 回答用户问题
**Before**:
```
用户：这个知识库里有哪些文件？
AI: 有 3 个文件：
     1. 文件 A.pdf (已完成) ✅
     2. 文件 B.docx (处理中) ⏳
     3. 文件 C.md (失败) ❌
     
用户：那帮我搜索一下"数据分析"
AI: (在文件 A 中搜索，但文件 B 和 C 无法搜索，导致困惑)
```

**After**:
```
用户：这个知识库里有哪些文件？
AI: 有 1 个文件：
     1. 文件 A.pdf (已完成) ✅
     
用户：那帮我搜索一下"数据分析"
AI: (在文件 A 中搜索，直接给出准确答案) ✅
```

### 场景 2: 用户询问文件状态
**Before**: AI 可能会说"您的文件正在处理中"，但实际上用户可以看到所有状态的文件

**After**: AI 只会提到已完成的文件，如果用户问起其他文件，可以引导他们查看文件上传进度页面

---

## 📋 文件状态说明

### processing_status 枚举值

| 状态 | 说明 | 是否返回 |
|------|------|---------|
| `pending` | 等待处理 | ❌ 不返回 |
| `processing` | 正在处理 | ❌ 不返回 |
| `completed` | 已完成 | ✅ 返回 |
| `failed` | 处理失败 | ❌ 不返回 |

---

## 🔍 如何查看所有文件

如果需要查看所有文件（包括未完成的），建议：

### 方案 1: 使用原始 API
```typescript
// 直接调用后端 API，不使用工具
const response = await api.get(`/api/v1/knowledge-bases/${kbId}/files`)
// 这将返回所有文件，不受过滤限制
```

### 方案 2: 添加新参数（未来扩展）
```python
# 可以在未来添加一个可选参数
async def _list_files(
    self,
    params: ListKnowledgeBaseFilesParams,
    user_id: str,
):
    # 添加可选的 filter 参数
    # filter: Literal["all", "completed"] = "completed"
```

---

## 📈 影响范围

### 受影响的功能
✅ `knowledge_base__list_files` 工具调用

### 不受影响的功能
✅ `knowledge_base__search` - 搜索工具  
✅ `knowledge_base__get_chunks` - 分块详情工具  
✅ 其他所有工具  

### 向后兼容性
⚠️ **这是一个破坏性变更**，返回的文件数量可能会减少（只包含 completed 状态）

---

## ✅ 测试建议

### 测试用例 1: 知识库中有已完成文件
```python
# 准备数据
- 文件 A: completed
- 文件 B: completed

# 预期结果
- 返回 2 个文件
- 都包含完整的元数据
```

### 测试用例 2: 知识库中有未完成文件
```python
# 准备数据
- 文件 A: completed
- 文件 B: processing
- 文件 C: pending

# 预期结果
- 只返回 1 个文件（文件 A）
- 响应中包含 filter 字段
```

### 测试用例 3: 没有已完成文件
```python
# 准备数据
- 文件 A: processing
- 文件 B: failed

# 预期结果
- 返回空列表
- total: 0
- filter: "completed_only"
```

---

## 📝 文档更新

已同步更新以下文档：
- ✅ `KNOWLEDGE_BASE_TOOL_PROVIDER.md` - 详细设计文档
- ✅ `KNOWLEDGE_BASE_TOOL_PROVIDER_QUICKREF.md` - 快速参考
- ✅ 本文档 - 更新说明

---

## 🎉 总结

本次优化通过**自动过滤**机制，确保 AI Agent 只能看到已处理完成的文件，带来以下好处：

1. ✅ **提升准确性**: AI 只能访问可用的文件
2. ✅ **减少错误**: 避免对未处理文件的操作
3. ✅ **改善体验**: 用户获得的信息更可靠
4. ✅ **简化逻辑**: AI 不需要处理各种状态的文件

这是一个重要的质量改进，虽然可能减少返回的文件数量，但确保了所有返回的文件都是**真正可用**的。

---

**版本**: v1.1.1  
**更新日期**: 2026-04-02  
**状态**: ✅ 已完成
