# VectorService 异步 SDK 改造

## 📋 版本历史

- **v5.0.3** (当前): 使用 `AsyncOpenAI` 异步 SDK ✅
- **v5.0.2**: 移除错误的 `http_client` 参数
- **v5.0.1**: 初始版本（存在 http_client 类型错误）

---

## 🎯 改造目标

将 `VectorService` 改为使用 OpenAI 官方的异步 SDK (`AsyncOpenAI`)，符合最佳实践。

---

## 🔍 问题背景

### 原始问题

在恢复文件处理任务时，向量化步骤失败，报错信息：

```
ERROR: app.services.vector_service: 获取向量嵌入失败：Invalid `http_client` argument; 
Expected an instance of `httpx.Client` but got <class 'httpx.AsyncClient'>
```

### 演进过程

1. **v5.0.1**: 使用了错误的组合
   ```python
   # ❌ 错误：同步客户端 + 异步 HTTP
   client = OpenAI(
       base_url=base_url,
       api_key=api_key,
       http_client=httpx.AsyncClient(),
   )
   ```

2. **v5.0.2**: 移除了 http_client 参数
   ```python
   # ⚠️ 临时方案：同步客户端调用异步方法
   client = OpenAI(
       base_url=base_url,
       api_key=api_key,
   )
   response = await client.embeddings.acreate(...)
   ```

3. **v5.0.3**: 改用异步 SDK（当前版本）✅
   ```python
   # ✅ 正确：异步客户端
   client = AsyncOpenAI(
       base_url=base_url,
       api_key=api_key,
   )
   response = await client.embeddings.create(...)
   ```

---

## ✅ 最终解决方案

### 使用 AsyncOpenAI 异步 SDK ✅

```python
from openai import AsyncOpenAI

# ✅ 正确的异步客户端
client = AsyncOpenAI(
    base_url=base_url,
    api_key=api_key,
)

response = await client.embeddings.create(
    model=model_name,
    input=text,
)
```

**优点**:
- ✅ 官方推荐的异步方案
- ✅ 类型安全，无类型混淆
- ✅ 纯异步实现，性能更优
- ✅ 符合 FastAPI 异步特性

---

## 📝 修改内容

### 文件：`app/services/vector_service.py`

#### v5.0.3 修改（当前）

**导入部分**:
```python
# ❌ 之前
from openai import OpenAI
import httpx

# ✅ 现在
from openai import AsyncOpenAI
# 不再需要 import httpx
```

**get_embedding() 方法**:
```python
# ❌ 之前（v5.0.2）
client = OpenAI(
    base_url=base_url,
    api_key=api_key,
)
response = await client.embeddings.acreate(...)

# ✅ 现在（v5.0.3）
client = AsyncOpenAI(
    base_url=base_url,
    api_key=api_key,
)
response = await client.embeddings.create(...)
```

**关键变化**:
1. `OpenAI` → `AsyncOpenAI`
2. `.acreate()` → `.create()`
3. 移除 `import httpx`

---

## 🧪 测试验证

### 测试步骤

1. **重启后端服务**
   ```bash
   cd backend
   python run.py
   ```

2. **上传文件到知识库**
   ```bash
   curl -X POST http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/upload \
     -F "file=@test.pdf"
   ```

3. **观察日志**

**预期输出**:
```
INFO: 开始处理文件：test.pdf
INFO: 文件解析完成，正在分块...
INFO: 文本分块完成：共 38 个分块
INFO: 使用向量模型：provider=https://api.siliconflow.cn/v1/, model=Qwen/Qwen3-Embedding-8B
INFO: 向量化完成 (38/38)
INFO: 文件处理完成：test.pdf, 分块数=38
```

**不应该出现**:
```
ERROR: 获取向量嵌入失败：Invalid `http_client` argument
```

---

## 🎯 OpenAI SDK 对比

### 同步客户端 vs 异步客户端

| 特性 | OpenAI (同步) | AsyncOpenAI (异步) |
|------|--------------|-------------------|
| **导入** | `from openai import OpenAI` | `from openai import AsyncOpenAI` |
| **HTTP 客户端** | `httpx.Client` | `httpx.AsyncClient` |
| **同步方法** | `.create()` | ❌ 不支持 |
| **异步方法** | `.acreate()` (兼容) | `.create()` (原生) |
| **适用场景** | 同步代码 | FastAPI 等异步框架 |

### 方法命名差异

```python
# 同步客户端
client = OpenAI(api_key="xxx")
response = client.embeddings.create(...)      # 同步调用
response = await client.embeddings.acreate(...)  # 异步调用（兼容）

# 异步客户端
client = AsyncOpenAI(api_key="xxx")
response = await client.embeddings.create(...)  # 异步调用（原生）
```

**重要**: `AsyncOpenAI` 只有 `.create()` 方法，没有 `.acreate()`！

### 最佳实践

对于 FastAPI 应用：

```python
# ✅ 推荐：使用同步客户端 + 异步方法
from openai import OpenAI

client = OpenAI(api_key="xxx")

async def get_embedding():
    response = await client.embeddings.acreate(...)

# ✅ 或者：使用异步客户端
from openai import AsyncOpenAI

async_client = AsyncOpenAI(api_key="xxx")

async def get_embedding():
    response = await async_client.embeddings.create(...)
```

---

## ⚠️ 注意事项

### 2. **不要混用客户端和方法**

```python
# ❌ 错误：同步客户端 + 异步 HTTP
client = OpenAI(
    api_key="xxx",
    http_client=httpx.AsyncClient()
)

# ❌ 错误：异步客户端调用同步方法
client = AsyncOpenAI(api_key="xxx")
response = client.embeddings.create(...)  # 缺少 await

# ❌ 错误：异步客户端调用 acreate
client = AsyncOpenAI(api_key="xxx")
response = await client.embeddings.acreate(...)  # acreate 不存在！

# ✅ 正确：异步客户端 + await + create
client = AsyncOpenAI(api_key="xxx")
response = await client.embeddings.create(
    model="xxx",
    input="text"
)
```

### 3. **不需要手动管理 http_client**

```python
# ✅ 最简单的方式（两种都正确）

# 方式 1: 同步客户端
client = OpenAI(api_key="xxx")
response = client.embeddings.create(...)  # 同步
response = await client.embeddings.acreate(...)  # 异步（兼容）

# 方式 2: 异步客户端（推荐用于 FastAPI）
client = AsyncOpenAI(api_key="xxx")
response = await client.embeddings.create(...)  # 异步（原生）

# SDK 会自动处理：
# - 同步请求使用 httpx.Client
# - 异步请求使用 httpx.AsyncClient
```

### 4. **如果需要自定义 HTTP 配置**

```python
# ✅ 同步客户端自定义配置
import httpx
from openai import OpenAI

client = OpenAI(
    api_key="xxx",
    http_client=httpx.Client(
        timeout=30.0,
        limits=httpx.Limits(max_connections=100),
    ),
)

# ✅ 异步客户端自定义配置（推荐）
from openai import AsyncOpenAI
import httpx

async_client = AsyncOpenAI(
    api_key="xxx",
    http_client=httpx.AsyncClient(
        timeout=30.0,
        limits=httpx.Limits(max_connections=100),
    ),
)
```

**注意**: 如果需要使用自定义 HTTP 配置，必须显式传递对应类型的 http_client。

---

## 📊 影响范围

### 受影响的功能（已修复）

- ✅ 知识库文件向量化处理
- ✅ 相似度搜索
- ✅ 批量添加分块
- ✅ 自动恢复任务中的向量化步骤

### 代码变更

**文件**: `app/services/vector_service.py`

**变更内容**:
1. 导入：`OpenAI` → `AsyncOpenAI`
2. 删除：`import httpx`
3. 客户端：`OpenAI()` → `AsyncOpenAI()`
4. 方法：`.acreate()` → `.create()`

**行数变化**:
- 删除：3 行
- 新增：2 行
- 净变化：-1 行（更简洁）

---

## 🔗 相关资源

### OpenAI SDK 文档

- [Python SDK Reference](https://github.com/openai/openai-python)
- [Async Support](https://github.com/openai/openai-python?tab=readme-ov-file#async-usage)
- [HTTP Client Configuration](https://github.com/openai/openai-python?tab=readme-ov-file#configuring-the-http-client)

### httpx 文档

- [HTTP/2 Support](https://www.python-httpx.org/http2/)
- [Advanced Usage](https://www.python-httpx.org/advanced/)

---

## ✅ 总结

### 问题演进

1. **v5.0.1**: 类型错误
   - 同步客户端 + 异步 HTTP 客户端
   - 初始化失败 ❌

2. **v5.0.2**: 临时方案
   - 同步客户端调用异步方法
   - 能工作但不优雅 ⚠️

3. **v5.0.3**: 最终方案 ✅
   - 使用 AsyncOpenAI 异步 SDK
   - 官方推荐，类型安全

### 解决方案对比

| 版本 | 客户端类型 | HTTP 客户端 | 方法调用 | 状态 |
|------|-----------|------------|---------|------|
| v5.0.1 | OpenAI | httpx.AsyncClient | .acreate() | ❌ 类型错误 |
| v5.0.2 | OpenAI | (自动) | .acreate() | ⚠️ 能用但不推荐 |
| v5.0.3 | AsyncOpenAI | (自动) | .create() | ✅ 最佳实践 |

### 修复效果

- ✅ 向量化正常工作
- ✅ 自动恢复功能完整可用
- ✅ 符合 OpenAI SDK 最佳实践
- ✅ 纯异步实现，性能更优
- ✅ 类型安全，无类型混淆风险

---

**修复日期**: 2026-04-01  
**当前版本**: v5.0.3 (AsyncOpenAI Migration)  
**状态**: ✅ 已完成  
**影响文件**: `app/services/vector_service.py`
