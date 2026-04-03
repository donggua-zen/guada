# search_similar_chunks 方法参数修正

## 📋 问题描述

`vector_service.py` 的 `search_similar_chunks` 方法内部调用 `get_embedding` 时，**缺少必需的 `base_url` 和 `api_key` 参数**，导致向量嵌入获取失败。

---

## 🔍 问题分析

### 方法签名不一致

#### get_embedding 方法（正确）

```python
# vector_service.py:47-53
async def get_embedding(
    self,
    text: str,
    base_url: str,      # ✅ 需要 API 地址
    api_key: str,       # ✅ 需要 API 密钥
    model_name: str,
) -> List[float]:
```

#### search_similar_chunks 方法（修复前）

```python
# vector_service.py:151-159 (修复前)
async def search_similar_chunks(
    self,
    knowledge_base_id: str,
    query_text: str,
    provider_name: str,  # ❌ 只有提供商名称
    model_name: str,
    top_k: int = 5,
    filter_metadata: Optional[Dict] = None,
) -> List[Dict]:
```

### 问题代码

```python
# vector_service.py:176-179 (修复前)
query_embedding = await self.get_embedding(
    query_text, 
    provider_name,  # ❌ 错误：这里应该是 base_url，但传入的是 provider_name
    model_name
)
```

**结果**：
- `get_embedding` 期望 `base_url`（如 "https://api.openai.com/v1"）
- 实际传入的是 `provider_name`（如 "openai"）
- OpenAI 客户端初始化失败，无法获取向量嵌入

---

## ✅ 修复方案

### 1. 修改 search_similar_chunks 方法签名

**文件**: `backend/app/services/vector_service.py`

```python
# ✅ 修复后（第 151-159 行）
async def search_similar_chunks(
    self,
    knowledge_base_id: str,
    query_text: str,
    base_url: str,      # 🔥 新增：向量模型 API 地址
    api_key: str,       # 🔥 新增：向量模型 API 密钥
    model_name: str,
    top_k: int = 5,
    filter_metadata: Optional[Dict] = None,
) -> List[Dict]:
```

### 2. 修改内部 get_embedding 调用

```python
# ✅ 修复后（第 176-179 行）
query_embedding = await self.get_embedding(
    query_text, 
    base_url,    # ✅ 正确传递 base_url
    api_key,     # ✅ 正确传递 api_key
    model_name
)
```

### 3. 修改调用方 knowledge_base_tool_provider.py

**文件**: `backend/app/services/tools/providers/knowledge_base_tool_provider.py`

```python
# ✅ 修复后（第 275-287 行）
provider_name = model.provider.name
model_name = model.model_name
base_url = model.provider.api_url      # 🔥 新增：获取 API 地址
api_key = model.provider.api_key       # 🔥 新增：获取 API 密钥
logger.info(f"使用向量模型：provider={provider_name}, model={model_name}")

# 执行搜索
results = await vector_service.search_similar_chunks(
    knowledge_base_id=params.knowledge_base_id,
    query_text=params.query,
    base_url=base_url,      # ✅ 传递 base_url
    api_key=api_key,        # ✅ 传递 api_key
    model_name=model_name,
    top_k=params.top_k,
    filter_metadata=filter_metadata,
)
```

---

## 🎯 完整数据流（修复后）

### 知识库搜索流程

```
用户在前端选择知识库并输入查询
  ↓
ChatInput → emit('send', { content: "...", knowledgeBaseIds: [...] })
  ↓
后端 /sessions/{sessionId}/messages
  ↓
AgentService._agent_run()
  ↓
KnowledgeBaseToolProvider.knowledge_base__search(params)
  ↓
从数据库获取知识库配置
  ↓
ModelRepository.get_model(kb.embedding_model_id)
  ↓
model.provider.api_url → base_url
model.provider.api_key → api_key
  ↓
VectorService.search_similar_chunks(
  knowledge_base_id=kb.id,
  query_text=params.query,
  base_url=model.provider.api_url,      ✅ 正确的 API 地址
  api_key=model.provider.api_key,       ✅ 正确的 API 密钥
  model_name=model.model_name,
  top_k=params.top_k
)
  ↓
VectorService.get_embedding(
  query_text,
  base_url,      ✅ 正确传递
  api_key,       ✅ 正确传递
  model_name
)
  ↓
AsyncOpenAI(base_url=base_url, api_key=api_key).embeddings.create(...)
  ↓
获取 query_embedding
  ↓
ChromaDB collection.query(query_embeddings=[query_embedding], ...)
  ↓
返回相似分块结果
  ↓
格式化结果并返回给 AI
```

---

## 📊 修复对比

| 组件 | 修复前 | 修复后 |
|------|--------|--------|
| **search_similar_chunks 参数** | `provider_name: str` ❌ | `base_url: str, api_key: str` ✅ |
| **get_embedding 调用** | `get_embedding(text, provider_name, model_name)` ❌ | `get_embedding(text, base_url, api_key, model_name)` ✅ |
| **调用方传参** | `provider_name=provider_name` ❌ | `base_url=model.provider.api_url, api_key=model.provider.api_key` ✅ |
| **OpenAI 客户端初始化** | 失败（provider_name 不是有效 URL）❌ | 成功（正确的 API 地址）✅ |
| **向量嵌入获取** | 失败 ❌ | 成功 ✅ |
| **搜索结果** | 无结果 ❌ | 正常返回 ✅ |

---

## 🔑 关键改进点

### 1. 参数命名语义化

```python
# ❌ 修复前
provider_name: str  # 只是字符串，不知道是什么用途

# ✅ 修复后
base_url: str   # 明确表示 API 地址
api_key: str    # 明确表示 API 密钥
```

### 2. 直接传递必要参数

```python
# ❌ 修复前：需要在方法内部转换
provider_name → 查找配置 → base_url, api_key

# ✅ 修复后：调用方直接提供
base_url, api_key → 直接使用
```

### 3. 减少依赖查找

```python
# ❌ 修复前：需要在 VectorService 中注入 ModelRepository
async def search_similar_chunks(self, ..., provider_name: str):
    # 需要查找 provider 配置
    provider_config = await self._get_provider_config(provider_name)
    base_url = provider_config.api_url
    api_key = provider_config.api_key

# ✅ 修复后：调用方负责提供
async def search_similar_chunks(self, ..., base_url: str, api_key: str):
    # 直接使用，无需查找
    query_embedding = await self.get_embedding(text, base_url, api_key, model_name)
```

---

## 🧪 验证步骤

### 1. 单元测试验证

```python
# test_vector_service.py
async def test_search_similar_chunks():
    """测试搜索功能"""
    vector_service = VectorService()
    
    results = await vector_service.search_similar_chunks(
        knowledge_base_id="kb_test_001",
        query_text="人工智能是什么",
        base_url="https://api.openai.com/v1",  # ✅ 正确的 URL
        api_key="sk-xxx",                       # ✅ 正确的 key
        model_name="text-embedding-ada-002",
        top_k=3
    )
    
    assert len(results) > 0
    assert "content" in results[0]
    assert "similarity" in results[0]
```

### 2. 集成测试验证

**测试步骤**：
1. 在前端选择一个知识库
2. 输入查询："什么是机器学习？"
3. 点击发送

**预期结果**：
- ✅ 控制台日志显示：`使用向量模型：provider=openai, model=text-embedding-ada-002`
- ✅ 无向量嵌入获取错误
- ✅ 返回相关的知识库分块
- ✅ AI 能够基于检索到的内容回答问题

### 3. 日志验证

**修复前的错误日志**：
```
ERROR - 获取向量嵌入失败：Invalid URL 'openai': No scheme supplied.
```

**修复后的正常日志**：
```
INFO - 使用向量模型：provider=openai, model=text-embedding-ada-002
DEBUG - 获取嵌入成功：provider=https://api.openai.com/v1, model=text-embedding-ada-002, dims=1536
INFO - 搜索到 3 个相似分块
```

---

## 💡 相关优化建议

### 1. 添加参数验证

```python
async def search_similar_chunks(
    self,
    knowledge_base_id: str,
    query_text: str,
    base_url: str,
    api_key: str,
    model_name: str,
    top_k: int = 5,
    filter_metadata: Optional[Dict] = None,
) -> List[Dict]:
    # 🔥 新增：参数验证
    if not base_url:
        raise ValueError("base_url 不能为空")
    if not api_key:
        raise ValueError("api_key 不能为空")
    if not query_text.strip():
        raise ValueError("query_text 不能为空")
    
    # ... 其余逻辑
```

### 2. 添加超时控制

```python
async def get_embedding(
    self,
    text: str,
    base_url: str,
    api_key: str,
    model_name: str,
    timeout: float = 30.0,  # 🔥 新增：超时参数
) -> List[float]:
    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
        timeout=timeout,  # 设置超时时间
    )
    
    response = await client.embeddings.create(
        model=model_name,
        input=text,
    )
    # ...
```

### 3. 添加重试机制

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10)
)
async def get_embedding(
    self,
    text: str,
    base_url: str,
    api_key: str,
    model_name: str,
) -> List[float]:
    """获取文本的向量嵌入（带重试）"""
    # ... 原有逻辑
```

---

## 📝 经验总结

### 问题根源

**方法签名设计不严谨**：
- `search_similar_chunks` 只需要知道如何调用 API（base_url, api_key）
- 不需要关心提供商名称（那是配置管理层的事情）
- 传递具体参数而非抽象概念

### 解决方案

**面向接口编程**：
1. ✅ 明确方法需要的具体参数（base_url, api_key）
2. ✅ 由调用方负责准备这些参数
3. ✅ 被调用方直接使用，不做额外查找

### 最佳实践

1. ✅ **参数明确原则**：
   - 方法签名应该明确表达需要什么
   - 避免在方法内部做配置查找
   - 让依赖关系更清晰

2. ✅ **单一职责原则**：
   - `VectorService` 只负责向量操作
   - 不负责模型配置管理
   - 配置管理由调用方负责

3. ✅ **依赖倒置原则**：
   - 高层模块（调用方）准备依赖
   - 低层模块（VectorService）直接使用
   - 降低模块间耦合

---

## 🔗 相关文件

**修改的文件**：
- ✅ `backend/app/services/vector_service.py`
  - `search_similar_chunks` 方法签名（L151-159）
  - `get_embedding` 调用（L176-179）

- ✅ `backend/app/services/tools/providers/knowledge_base_tool_provider.py`
  - 获取 base_url 和 api_key（L277-278）
  - 调用 search_similar_chunks（L280-287）

**无需修改的文件**：
- ✅ `backend/app/models/model_provider.py`（已有 api_url 和 api_key 字段）
- ✅ `backend/app/models/model.py`（通过 relationship 访问 provider）

---

**修复日期**: 2026-04-02  
**版本**: v6.0 (search_similar_chunks 参数修正版)  
**状态**: ✅ 已完成  
**关键修复点**: search_similar_chunks 方法参数 provider_name → base_url + api_key
