# 知识库工具提供者使用示例

本文档提供详细的代码示例，展示如何在不同场景下使用知识库工具提供者。

## 目录

1. [基础使用示例](#基础使用示例)
2. [AI Agent 集成示例](#ai-agent-集成示例)
3. [前端调用示例](#前端调用示例)
4. [高级用法](#高级用法)
5. [常见问题](#常见问题)

---

## 基础使用示例

### 示例 1: 简单的知识库搜索

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.services.tools.providers.knowledge_base_tool_provider import KnowledgeBaseToolProvider
from app.services.tools.providers.tool_provider_base import ToolCallRequest

# 1. 初始化数据库会话
DATABASE_URL = "sqlite+aiosqlite:///./data/app.db"
engine = create_async_engine(DATABASE_URL)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def search_knowledge_base():
    async with async_session() as session:
        # 2. 初始化工具提供者
        provider = KnowledgeBaseToolProvider(session)
        
        # 3. 创建搜索请求
        request = ToolCallRequest(
            id="search_001",
            name="knowledge_base__search",
            arguments={
                "knowledge_base_id": "kb_123",  # 替换为实际的知识库 ID
                "query": "Python 数据分析基础",
                "top_k": 5
            }
        )
        
        # 4. 注入用户 ID（用于权限验证）
        inject_params = {"user_id": "user_456"}
        
        # 5. 执行工具调用
        response = await provider.execute_with_namespace(request, inject_params)
        
        # 6. 处理响应
        if response.is_error:
            print(f"❌ 搜索失败：{response.content}")
        else:
            print("✅ 搜索结果:")
            print(response.content)

# 运行
import asyncio
asyncio.run(search_knowledge_base())
```

**输出示例**:
```
✅ 搜索结果:
🔍 搜索完成（query='Python 数据分析基础'）:

1. 📄 [Python 数据分析教程.pdf] (相似度：95.3%)
Pandas 是 Python 中最常用的数据分析库，提供了强大的数据处理和分析功能...

---

2. 📄 [数据分析实战.md] (相似度：87.2%)
使用 Python 进行数据分析的一般流程包括：数据收集、数据清洗、数据探索...
```

---

### 示例 2: 查看知识库文件列表

```python
async def list_kb_files():
    async with async_session() as session:
        provider = KnowledgeBaseToolProvider(session)
        
        request = ToolCallRequest(
            id="list_files_001",
            name="knowledge_base__list_files",
            arguments={
                "knowledge_base_id": "kb_123"
            }
        )
        
        inject_params = {"user_id": "user_456"}
        response = await provider.execute_with_namespace(request, inject_params)
        
        print(response.content)

asyncio.run(list_kb_files())
```

**输出示例**:
```
📚 知识库文件列表（共 3 个文件）:

1. ✅ **Python 数据分析教程.pdf**
   - 大小：2.35 MB
   - 类型：pdf
   - 状态：completed
   - 分块数：45
   - ID: `file_001`

2. ✅ **数据分析实战.md**
   - 大小：156.78 KB
   - 类型：text
   - 状态：completed
   - 分块数：12
   - ID: `file_002`

3. 🔄 **机器学习笔记.docx**
   - 大小：1.02 MB
   - 类型：word
   - 状态：processing
   - 分块数：0
   - ID: `file_003`
```

---

### 示例 3: 获取文件分块详情

```python
async def get_file_chunks():
    async with async_session() as session:
        provider = KnowledgeBaseToolProvider(session)
        
        request = ToolCallRequest(
            id="get_chunks_001",
            name="knowledge_base__get_chunks",
            arguments={
                "knowledge_base_id": "kb_123",
                "file_id": "file_001",
                "chunk_index": 0,
                "limit": 3  # 每次最多获取 10 个，这里获取 3 个
            }
        )
        
        inject_params = {"user_id": "user_456"}
        response = await provider.execute_with_namespace(request, inject_params)
        
        print(response.content)

asyncio.run(get_file_chunks())
```

**输出示例**:
```
📖 文件《Python 数据分析教程.pdf》分块详情（索引 0-2）:

**分块 #0** (Token: 256)
Pandas 是 Python 中最常用的数据分析库，提供了强大的数据处理和分析功能。它基于 NumPy 构建，提供了 DataFrame 和 Series 等核心数据结构...

---

**分块 #1** (Token: 312)
DataFrame 是 Pandas 的核心数据结构，类似于 Excel 表格或 SQL 表。它具有行和列，可以轻松地读取、写入和操作数据...

---

**分块 #2** (Token: 289)
要使用 Pandas 进行数据分析，首先需要导入库：import pandas as pd。然后可以使用 read_csv()、read_excel() 等方法读取数据...
```

---

## AI Agent 集成示例

### 示例 4: 在对话系统中集成知识库工具

```python
from app.services.tools.tool_orchestrator import ToolOrchestrator
from app.services.tools.providers.knowledge_base_tool_provider import KnowledgeBaseToolProvider

class ChatBotWithKB:
    def __init__(self, session):
        self.session = session
        self.tool_orchestrator = ToolOrchestrator(session)
        
        # 注册知识库工具提供者
        kb_provider = KnowledgeBaseToolProvider(session)
        self.tool_orchestrator.register_provider(kb_provider)
    
    async def chat(self, user_message: str, user_id: str, knowledge_base_id: str):
        """与 AI 对话，AI 可以自动调用知识库工具"""
        
        # 构建系统提示词，包含知识库工具说明
        system_prompt = """
你是一个智能助手，可以访问用户的知识库来回答问题。
你拥有以下工具：
- knowledge_base__search: 在知识库中搜索相关内容
- knowledge_base__list_files: 查看知识库中的文件列表
- knowledge_base__get_chunks: 查看文件的详细内容

当用户询问与知识库相关的问题时，请先使用 search 工具搜索相关内容，
然后根据搜索结果回答用户。如果需要查看更多细节，可以使用 get_chunks 工具。
"""
        
        # 获取知识库工具的提示词注入
        kb_prompt = await self.tool_orchestrator.get_provider_prompt(
            "knowledge_base",
            inject_params={"user_id": user_id}
        )
        
        # 获取可用的工具列表
        available_tools = await self.tool_orchestrator.get_available_tools()
        
        # 调用 LLM（这里使用伪代码，实际项目中使用真实的 LLM 服务）
        response = await self.call_llm(
            system_prompt=system_prompt + "\n\n" + kb_prompt,
            user_message=user_message,
            tools=available_tools,
            inject_params={"user_id": user_id, "knowledge_base_id": knowledge_base_id}
        )
        
        return response
    
    async def call_llm(self, system_prompt, user_message, tools, inject_params):
        """调用 LLM 服务（示例伪代码）"""
        # 实际项目中这里会调用 OpenAI API 或其他 LLM 服务
        # LLM 会根据工具和用户消息自动决定是否调用知识库工具
        
        # 示例：LLM 可能返回需要调用的工具
        tool_calls = [
            {
                "id": "call_abc123",
                "type": "function",
                "function": {
                    "name": "knowledge_base__search",
                    "arguments": {
                        "knowledge_base_id": "kb_123",
                        "query": "Python 数据分析",
                        "top_k": 5
                    }
                }
            }
        ]
        
        # 执行工具调用
        tool_results = await self.tool_orchestrator.execute_tools(
            tool_calls=tool_calls,
            inject_params=inject_params
        )
        
        # 将工具结果返回给 LLM，生成最终回复
        final_response = f"根据知识库搜索的结果...\n\n{tool_results[0].content}"
        
        return final_response

# 使用示例
async def demo():
    async with async_session() as session:
        bot = ChatBotWithKB(session)
        
        # 用户提问
        user_question = "如何使用 Python 进行数据分析？"
        
        # AI 会自动调用知识库工具搜索相关内容
        response = await bot.chat(
            user_message=user_question,
            user_id="user_456",
            knowledge_base_id="kb_123"
        )
        
        print(f"AI 回答:\n{response}")

asyncio.run(demo())
```

---

## 前端调用示例

### 示例 5: Vue 3 + TypeScript 前端调用

```typescript
// frontend/src/composables/useKnowledgeBase.ts
import { ref } from 'vue'
import { apiService } from '@/services/api'

export function useKnowledgeBase() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  // 搜索知识库
  async function searchKB(params: {
    knowledge_base_id: string
    query: string
    file_id?: string
    top_k: number
  }) {
    loading.value = true
    error.value = null
    
    try {
      const result = await apiService.callTool('knowledge_base__search', params)
      return result.content
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }
  
  // 获取文件列表
  async function listFiles(params: { knowledge_base_id: string }) {
    loading.value = true
    error.value = null
    
    try {
      const result = await apiService.callTool('knowledge_base__list_files', params)
      return result.content
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }
  
  // 获取文件分块
  async function getChunks(params: {
    knowledge_base_id: string
    file_id: string
    chunk_index: number
    limit: number
  }) {
    loading.value = true
    error.value = null
    
    try {
      const result = await apiService.callTool('knowledge_base__get_chunks', params)
      return result.content
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }
  
  return {
    loading,
    error,
    searchKB,
    listFiles,
    getChunks
  }
}
```

### 示例 6: Vue 组件中使用

```vue
<!-- frontend/src/components/KBSearch.vue -->
<template>
  <div class="kb-search">
    <el-input
      v-model="searchQuery"
      placeholder="输入搜索关键词..."
      @keyup.enter="handleSearch"
    >
      <template #append>
        <el-button @click="handleSearch" :loading="loading">
          🔍 搜索
        </el-button>
      </template>
    </el-input>
    
    <div v-if="searchResults" class="search-results">
      <h3>搜索结果</h3>
      <div v-for="(result, index) in parseResults(searchResults)" :key="index" 
           class="result-item">
        <el-card>
          <div class="result-header">
            <span class="file-name">{{ result.fileName }}</span>
            <span class="similarity">相似度：{{ result.similarity }}</span>
          </div>
          <div class="result-content">{{ result.content }}</div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useKnowledgeBase } from '@/composables/useKnowledgeBase'

const props = defineProps<{
  knowledgeBaseId: string
}>()

const searchQuery = ref('')
const { searchKB, loading } = useKnowledgeBase()
const searchResults = ref<string>('')

// 解析返回的结果字符串（简单示例）
function parseResults(content: string) {
  // 实际项目中需要更完善的解析逻辑
  return content.split('\n\n---\n\n').map(item => {
    const match = item.match(/📄 \[(.*?)\] \(相似度：(.*?)\)/)
    return {
      fileName: match ? match[1] : '未知文件',
      similarity: match ? match[2] : '',
      content: item.replace(/.*?\n/, '').trim()
    }
  })
}

async function handleSearch() {
  if (!searchQuery.value.trim()) return
  
  try {
    const results = await searchKB({
      knowledge_base_id: props.knowledgeBaseId,
      query: searchQuery.value,
      top_k: 5
    })
    searchResults.value = results
  } catch (e) {
    console.error('搜索失败:', e)
  }
}
</script>

<style scoped>
.kb-search {
  max-width: 800px;
  margin: 0 auto;
}

.search-results {
  margin-top: 20px;
}

.result-item {
  margin-bottom: 16px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.file-name {
  font-weight: bold;
  color: #409eff;
}

.similarity {
  color: #67c23a;
  font-size: 14px;
}

.result-content {
  line-height: 1.6;
  color: #606266;
}
</style>
```

---

## 高级用法

### 示例 7: 分页获取文件分块

```python
async def get_all_chunks_with_pagination(file_id: str, knowledge_base_id: str, user_id: str):
    """分批获取所有分块（避免一次性加载过多数据）"""
    
    async with async_session() as session:
        provider = KnowledgeBaseToolProvider(session)
        
        all_chunks = []
        chunk_index = 0
        page_size = 10  # 每次获取 10 个分块
        
        while True:
            request = ToolCallRequest(
                id=f"get_chunks_{chunk_index}",
                name="knowledge_base__get_chunks",
                arguments={
                    "knowledge_base_id": knowledge_base_id,
                    "file_id": file_id,
                    "chunk_index": chunk_index,
                    "limit": page_size
                }
            )
            
            inject_params = {"user_id": user_id}
            response = await provider.execute_with_namespace(request, inject_params)
            
            # 检查是否还有更多分块
            if "未找到分块" in response.content:
                break
            
            all_chunks.append(response.content)
            chunk_index += page_size
            
            # 防止无限循环（可选的安全限制）
            if chunk_index > 1000:
                print("⚠️ 已达到最大分块数限制，停止加载")
                break
        
        return all_chunks

# 使用
chunks = asyncio.run(get_all_chunks_with_pagination(
    file_id="file_001",
    knowledge_base_id="kb_123",
    user_id="user_456"
))

print(f"✅ 共获取到 {len(chunks)} 批分块")
```

---

### 示例 8: 组合使用多个工具

```python
async def comprehensive_kb_analysis(knowledge_base_id: str, user_id: str):
    """综合分析知识库：先查看文件，再搜索，最后查看详情"""
    
    async with async_session() as session:
        provider = KnowledgeBaseToolProvider(session)
        inject_params = {"user_id": user_id}
        
        # 步骤 1: 查看知识库有哪些文件
        print("=" * 60)
        print("步骤 1: 查看知识库文件列表")
        print("=" * 60)
        
        list_request = ToolCallRequest(
            id="list_files",
            name="knowledge_base__list_files",
            arguments={"knowledge_base_id": knowledge_base_id}
        )
        list_response = await provider.execute_with_namespace(list_request, inject_params)
        print(list_response.content)
        
        # 步骤 2: 搜索相关内容
        print("\n" + "=" * 60)
        print("步骤 2: 搜索'数据分析'相关内容")
        print("=" * 60)
        
        search_request = ToolCallRequest(
            id="search",
            name="knowledge_base__search",
            arguments={
                "knowledge_base_id": knowledge_base_id,
                "query": "数据分析",
                "top_k": 3
            }
        )
        search_response = await provider.execute_with_namespace(search_request, inject_params)
        print(search_response.content)
        
        # 步骤 3: 获取最相关文件的前 10 个分块
        print("\n" + "=" * 60)
        print("步骤 3: 获取最相关文件的详细分块")
        print("=" * 60)
        
        # 假设从搜索结果中解析出 file_id
        target_file_id = "file_001"  # 实际项目中需要从搜索结果中提取
        
        chunks_request = ToolCallRequest(
            id="get_chunks",
            name="knowledge_base__get_chunks",
            arguments={
                "knowledge_base_id": knowledge_base_id,
                "file_id": target_file_id,
                "chunk_index": 0,
                "limit": 10
            }
        )
        chunks_response = await provider.execute_with_namespace(chunks_request, inject_params)
        print(chunks_response.content)

# 运行
asyncio.run(comprehensive_kb_analysis("kb_123", "user_456"))
```

---

## 常见问题

### Q1: 如何处理权限错误？

**A**: 所有工具都会自动验证 `user_id`，如果无权访问会返回错误信息：

```python
response = await provider.execute_with_namespace(request, {"user_id": "invalid_user"})

if response.is_error:
    print(f"权限错误：{response.content}")
    # 输出："❌ 错误：无权访问该知识库"
```

### Q2: 如何优化大量分块的加载性能？

**A**: 使用分页机制，每次只加载少量分块：

```python
# ❌ 不好的做法：一次性加载所有分块
chunks = await get_chunks(knowledge_base_id, file_id, 0, 1000)

# ✅ 好的做法：分批加载
for i in range(0, total_chunks, 10):
    chunks = await get_chunks(knowledge_base_id, file_id, i, 10)
    process(chunks)
```

### Q3: 如何在多个知识库之间切换？

**A**: 只需在调用时传入不同的 `knowledge_base_id`:

```python
# 切换到另一个知识库
request.arguments["knowledge_base_id"] = "kb_456"
response = await provider.execute_with_namespace(request, inject_params)
```

### Q4: 如何限制搜索结果数量？

**A**: 通过 `top_k` 参数控制：

```python
# 只返回前 3 个最相关的结果
arguments = {
    "knowledge_base_id": "kb_123",
    "query": "Python",
    "top_k": 3  # 最多 3 个结果
}
```

### Q5: 如何在搜索时限定特定文件？

**A**: 使用 `file_id` 参数：

```python
arguments = {
    "knowledge_base_id": "kb_123",
    "query": "数据分析",
    "file_id": "file_001",  # 只在该文件中搜索
    "top_k": 5
}
```

---

## 总结

知识库工具提供者提供了强大而灵活的工具集，使 AI Agent 能够：

1. ✅ **智能搜索**: 通过向量相似度搜索找到最相关的内容
2. ✅ **文件管理**: 查看知识库中的文件列表和状态
3. ✅ **深度阅读**: 分页查看文件的详细分块内容

通过合理组合使用这些工具，可以构建出智能、高效的知识库问答系统。
