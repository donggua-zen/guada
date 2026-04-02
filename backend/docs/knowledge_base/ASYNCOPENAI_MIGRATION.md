# OpenAI 异步 SDK 迁移说明

## 🎯 迁移目标

将 `VectorService` 从使用同步 OpenAI SDK 改为使用异步 SDK (`AsyncOpenAI`)。

---

## 📝 修改内容

### 文件：`app/services/vector_service.py`

#### 1. 导入语句修改

```python
# ❌ 之前
from openai import OpenAI
import httpx

# ✅ 现在
from openai import AsyncOpenAI
# 不再需要 import httpx
```

#### 2. get_embedding() 方法修改

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
- `OpenAI` → `AsyncOpenAI`
- `.acreate()` → `.create()`
- 移除 `import httpx`

---

## 🔑 核心区别

### 方法命名

| SDK | 同步方法 | 异步方法 |
|-----|---------|---------|
| **OpenAI** (同步) | `.create()` | `.acreate()` (兼容) |
| **AsyncOpenAI** (异步) | ❌ 不支持 | `.create()` (原生) |

### 代码示例

```python
# 同步 SDK
from openai import OpenAI
client = OpenAI(api_key="xxx")
response = client.embeddings.create(...)      # 同步
response = await client.embeddings.acreate(...)  # 异步（兼容模式）

# 异步 SDK
from openai import AsyncOpenAI
client = AsyncOpenAI(api_key="xxx")
response = await client.embeddings.create(...)  # 异步（原生）
# 注意：没有 .acreate() 方法！
```

---

## ✅ 为什么要迁移？

### v5.0.2 的问题（临时方案）

```python
# 使用同步 SDK 调用异步方法
client = OpenAI(...)
await client.embeddings.acreate(...)
```

**问题**:
- ⚠️ 这是兼容模式，不是原生异步
- ⚠️ 可能在某些场景下性能不佳
- ⚠️ 不符合 FastAPI 的纯异步最佳实践

### v5.0.3 的优势（最终方案）

```python
# 使用异步 SDK
client = AsyncOpenAI(...)
await client.embeddings.create(...)
```

**优势**:
- ✅ 原生异步实现
- ✅ 更好的性能
- ✅ 类型安全
- ✅ 符合 FastAPI 异步特性
- ✅ 官方推荐方案

---

## 🧪 测试验证

### 1. 语法检查

```bash
cd backend
python -m py_compile app/services/vector_service.py
```

应该无错误输出。

### 2. 功能测试

```bash
# 重启服务
python run.py

# 上传文件
curl -X POST http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/upload \
  -F "file=@test.pdf"
```

### 3. 观察日志

**应该看到**:
```
INFO: 开始处理文件：test.pdf
INFO: 使用向量模型：provider=..., model=...
INFO: 向量化完成 (XX/XX)
INFO: 文件处理完成：test.pdf
```

**不应该看到**:
```
ERROR: 获取向量嵌入失败
ERROR: Invalid `http_client` argument
```

---

## ⚠️ 注意事项

### 1. 不要混用 SDK

```python
# ❌ 错误：在异步 SDK 上调用 acreate
client = AsyncOpenAI(api_key="xxx")
await client.embeddings.acreate(...)  # AttributeError!

# ✅ 正确：使用 create
client = AsyncOpenAI(api_key="xxx")
await client.embeddings.create(...)
```

### 2. 不需要 httpx 导入

```python
# ❌ 不再需要
import httpx

# ✅ 简洁版本
from openai import AsyncOpenAI
```

### 3. 如果需要自定义 HTTP 配置

```python
# 只有在这种场景下才需要 httpx
import httpx
from openai import AsyncOpenAI

client = AsyncOpenAI(
    api_key="xxx",
    http_client=httpx.AsyncClient(
        timeout=30.0,
        limits=httpx.Limits(max_connections=100),
    ),
)
```

---

## 📊 迁移效果

### 代码行数

| 项目 | v5.0.2 | v5.0.3 | 变化 |
|------|--------|--------|------|
| 导入语句 | 2 行 | 1 行 | -1 行 |
| 客户端初始化 | 4 行 | 3 行 | -1 行 |
| API 调用 | 3 行 | 3 行 | 0 行 |
| **总计** | **9 行** | **6 行** | **-3 行** |

### 性能对比

| 指标 | v5.0.2 (同步 SDK) | v5.0.3 (异步 SDK) |
|------|------------------|------------------|
| 异步性 | 兼容模式 | 原生异步 |
| 连接复用 | 有限 | 更优 |
| 并发性能 | 一般 | 更好 |
| 类型安全 | ⚠️ 隐式 any | ✅ 显式类型 |

---

## 🎯 最佳实践

### 在 FastAPI 中使用异步 SDK

```python
from fastapi import Depends
from openai import AsyncOpenAI
from app.database import get_db_session

# 创建全局异步客户端
openai_client = AsyncOpenAI(
    api_key=settings.OPENAI_API_KEY,
    base_url=settings.OPENAI_BASE_URL,
)

# 在路由中使用
@router.post("/embeddings")
async def get_embeddings(text: str):
    response = await openai_client.embeddings.create(
        model="text-embedding-ada-002",
        input=text,
    )
    return response.data[0].embedding
```

### 依赖注入模式

```python
# 如果需要多个客户端实例
async def get_openai_client():
    client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
    )
    try:
        yield client
    finally:
        await client.close()

@router.post("/embeddings")
async def get_embeddings(
    text: str,
    client: AsyncOpenAI = Depends(get_openai_client)
):
    response = await client.embeddings.create(...)
```

---

## 📚 相关资源

### OpenAI SDK 文档

- [Python SDK](https://github.com/openai/openai-python)
- [Async Usage](https://github.com/openai/openai-python?tab=readme-ov-file#async-usage)
- [API Reference](https://platform.openai.com/docs/api-reference)

### 迁移指南

- [Migrating to v1.0](https://github.com/openai/openai-python/discussions/719)
- [Type Safety](https://github.com/openai/openai-python?tab=readme-ov-file#type-safety)

---

## ✅ 总结

### 迁移步骤

1. ✅ 修改导入：`OpenAI` → `AsyncOpenAI`
2. ✅ 删除导入：移除 `import httpx`
3. ✅ 修改客户端：`OpenAI()` → `AsyncOpenAI()`
4. ✅ 修改方法：`.acreate()` → `.create()`
5. ✅ 测试验证

### 迁移效果

- ✅ 代码更简洁（减少 3 行）
- ✅ 性能更优（原生异步）
- ✅ 类型安全（无类型混淆）
- ✅ 符合最佳实践

---

**迁移日期**: 2026-04-01  
**版本**: v5.0.3 (AsyncOpenAI Migration)  
**状态**: ✅ 已完成  
**影响文件**: `app/services/vector_service.py`
