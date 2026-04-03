# 知识库工具提供者 - JSON 格式化返回更新说明

## 📝 更新概述

**更新时间**: 2026-04-02  
**版本**: v1.1  
**变更类型**: 返回格式优化

---

## 🔄 主要变更

### 变更内容
将所有工具的返回格式从 **Markdown 文本** 改为 **结构化 JSON**。

### 变更原因
1. ✅ **易于解析**: JSON 格式更容易被前端程序化解析
2. ✅ **类型安全**: 结构化数据支持 TypeScript 类型定义
3. ✅ **灵活性**: 前端可以自由控制展示样式，不再受限于固定格式
4. ✅ **可扩展**: 更容易添加新字段而不破坏现有功能
5. ✅ **错误处理**: 统一的错误响应格式

---

## 📊 格式对比

### Before (Markdown 文本)
```
🔍 搜索完成（query='Python'）:

1. 📄 [文件.pdf] (相似度：95.3%)
内容...

---

2. 📄 [文件.md] (相似度：87.2%)
内容...
```

### After (JSON)
```json
{
  "success": true,
  "error": null,
  "data": {
    "query": "Python",
    "results": [
      {
        "content": "内容...",
        "metadata": {
          "file_name": "文件.pdf",
          "file_id": "file_001"
        },
        "similarity": 0.953
      }
    ],
    "total": 2
  }
}
```

---

## 🛠️ 修改的文件

### 1. 核心实现
**文件**: `backend/app/services/tools/providers/knowledge_base_tool_provider.py`

**修改的方法**:
- ✅ `_search()` - 搜索工具
- ✅ `_list_files()` - 文件列表工具
- ✅ `_get_chunks()` - 分块详情工具

**代码行数变化**: +183 行，-114 行

### 2. 文档更新
**已更新的文档**:
- ✅ `KNOWLEDGE_BASE_TOOL_PROVIDER.md` - 详细设计文档
- ✅ `KNOWLEDGE_BASE_TOOL_PROVIDER_QUICKREF.md` - 快速参考
- ✅ `FRONTEND_INTEGRATION_GUIDE.md` - 前端集成指南

---

## 📦 新的返回格式规范

### 统一响应结构
所有工具都遵循统一的响应结构：

```typescript
interface ToolResponse {
    success: boolean      // 是否成功
    error: string | null  // 错误信息（如果有）
    data: any            // 实际数据（根据不同工具而变化）
}
```

### 1. Search 工具返回格式

```typescript
{
    "success": true,
    "error": null,
    "data": {
        "query": string,           // 搜索关键词
        "results": Array<{         // 结果列表
            "content": string,     // 分块内容
            "metadata": {          // 元数据
                "file_id": string,
                "file_name": string,
                "chunk_index": number,
                ...
            },
            "similarity": number   // 相似度分数（0-1）
        }>,
        "total": number           // 结果总数
    }
}
```

### 2. List Files 工具返回格式

```typescript
{
    "success": true,
    "error": null,
    "data": {
        "files": Array<{          // 文件列表
            "id": string,
            "display_name": string,
            "file_name": string,
            "file_size": number,
            "file_size_formatted": string,
            "file_type": string,
            "file_extension": string,
            "processing_status": string,
            "progress_percentage": number,
            "current_step": string | null,
            "total_chunks": number,
            "uploaded_at": string | null,
            "processed_at": string | null
        }>,
        "total": number,
        "knowledge_base_id": string
    }
}
```

### 3. Get Chunks 工具返回格式

```typescript
{
    "success": true,
    "error": null,
    "data": {
        "chunks": Array<{         // 分块列表
            "id": string,
            "chunk_index": number,
            "content": string,
            "token_count": number,
            "vector_id": string | null,
            "embedding_dimensions": number | null,
            "metadata": object | null
        }>,
        "total": number,
        "file_id": string,
        "file_name": string,
        "chunk_index": number,    // 起始索引
        "limit": number,          // 请求的数量
        "has_more": boolean       // 是否还有更多分块
    }
}
```

---

## 💻 前端解析示例

### Vue Composable 中的解析代码

```typescript
// 解析搜索结果（JSON 格式）
function parseSearchResults(jsonContent: string): ParsedSearchResult[] {
    try {
        const response = JSON.parse(jsonContent)
        if (!response.success || !response.data) {
            return []
        }
        
        return response.data.results.map((result: any) => ({
            fileName: result.metadata?.file_name || '未知文件',
            similarity: (result.similarity * 100).toFixed(1) + '%',
            content: result.content,
            metadata: result.metadata
        }))
    } catch (e) {
        console.error('解析搜索结果失败:', e)
        return []
    }
}

// 解析文件列表（JSON 格式）
function parseFileList(jsonContent: string): KBFileInfo[] {
    try {
        const response = JSON.parse(jsonContent)
        if (!response.success || !response.data) {
            return []
        }
        
        return response.data.files.map((file: any) => ({
            id: file.id,
            name: file.display_name,
            size: file.file_size,
            type: file.file_type,
            status: file.processing_status,
            chunks: file.total_chunks
        }))
    } catch (e) {
        console.error('解析文件列表失败:', e)
        return []
    }
}

// 解析分块内容（JSON 格式）
function parseChunks(jsonContent: string): KBChunkInfo[] {
    try {
        const response = JSON.parse(jsonContent)
        if (!response.success || !response.data) {
            return []
        }
        
        return response.data.chunks.map((chunk: any) => ({
            index: chunk.chunk_index,
            tokenCount: chunk.token_count || 0,
            content: chunk.content
        }))
    } catch (e) {
        console.error('解析分块内容失败:', e)
        return []
    }
}
```

---

## ⚠️ 错误处理

### 错误响应格式

```json
{
    "success": false,
    "error": "错误信息",
    "data": null
}
```

### 常见错误示例

#### 1. 知识库不存在
```json
{
    "success": false,
    "error": "知识库不存在",
    "data": null
}
```

#### 2. 权限错误
```json
{
    "success": false,
    "error": "无权访问该知识库",
    "data": null
}
```

#### 3. 系统异常
```json
{
    "success": false,
    "error": "搜索时出错：具体错误信息",
    "data": null
}
```

---

## 🎯 优势对比

### Markdown 格式的劣势
❌ 需要使用正则表达式解析  
❌ 难以处理特殊情况  
❌ 样式固定，不够灵活  
❌ 容易受到内容格式影响  
❌ 扩展性差  

### JSON 格式的优势
✅ 原生支持，无需复杂解析  
✅ 类型安全，支持 IDE 提示  
✅ 前端自由控制展示样式  
✅ 数据结构稳定可靠  
✅ 易于扩展和维护  

---

## 📈 迁移指南

### 如果您之前使用了旧版本

#### 旧代码（Markdown 解析）
```typescript
// ❌ 复杂的字符串解析
const sections = content.split('\n\n---\n\n')
const match = section.match(/📄 \[(.*?)\] \(相似度：(.*?)\)/)
```

#### 新代码（JSON 解析）
```typescript
// ✅ 简单的 JSON 解析
const response = JSON.parse(content)
const results = response.data.results
```

---

## 🔗 相关文档

- **详细设计文档**: [KNOWLEDGE_BASE_TOOL_PROVIDER.md](KNOWLEDGE_BASE_TOOL_PROVIDER.md)
- **快速参考**: [KNOWLEDGE_BASE_TOOL_PROVIDER_QUICKREF.md](KNOWLEDGE_BASE_TOOL_PROVIDER_QUICKREF.md)
- **前端集成指南**: [FRONTEND_INTEGRATION_GUIDE.md](FRONTEND_INTEGRATION_GUIDE.md)
- **使用示例**: [KNOWLEDGE_BASE_TOOL_PROVIDER_EXAMPLES.md](KNOWLEDGE_BASE_TOOL_PROVIDER_EXAMPLES.md)

---

## ✅ 测试建议

### 1. 单元测试
```python
def test_search_json_format():
    """测试搜索返回 JSON 格式"""
    response = await provider._search(params, user_id)
    data = json.loads(response)
    
    assert data["success"] == True
    assert "error" in data
    assert "data" in data
    assert "results" in data["data"]
```

### 2. 前端测试
```typescript
describe('parseSearchResults', () => {
    it('should parse JSON response correctly', () => {
        const jsonResponse = JSON.stringify({
            success: true,
            data: {
                results: [{
                    content: 'test',
                    metadata: { file_name: 'test.pdf' },
                    similarity: 0.95
                }]
            }
        })
        
        const results = parseSearchResults(jsonResponse)
        expect(results.length).toBe(1)
        expect(results[0].fileName).toBe('test.pdf')
    })
})
```

---

## 📝 总结

本次更新将返回格式改为 JSON，主要带来以下好处：

1. ✅ **更易解析**: 前端可以直接使用 `JSON.parse()`
2. ✅ **类型安全**: 支持 TypeScript 类型定义
3. ✅ **灵活展示**: 前端可以自由控制 UI 样式
4. ✅ **稳定可靠**: 不受内容格式影响
5. ✅ **易于扩展**: 可以轻松添加新字段

这是一个**向后不兼容**的更新，需要同时更新前端解析代码。

---

**版本**: v1.1  
**更新日期**: 2026-04-02  
**状态**: ✅ 已完成
