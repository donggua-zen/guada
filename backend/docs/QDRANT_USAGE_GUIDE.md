# Qdrant 向量服务使用指南

## 📦 安装依赖

首先需要安装 Qdrant 客户端：

```bash
cd backend
pip install -r requirements.txt
```

这会自动安装 `qdrant-client==1.13.2`，替代原来的 `chromadb`。

---

## 🚀 快速开始

### 基本使用

```python
from app.services.vector_service import VectorService

# 初始化服务（默认数据路径：./data/qdrant_db）
vector_service = VectorService()

# 或指定自定义路径
vector_service = VectorService(persist_directory="./custom/qdrant_data")
```

### 添加分块到知识库

```python
# 准备数据
chunks = [
    {
        "content": "Python 是一种高级编程语言",
        "chunk_index": 0,
        "metadata": {"file_id": "file_123"}
    },
    {
        "content": "Java 也是一种流行的编程语言",
        "chunk_index": 1,
        "metadata": {"file_id": "file_123"}
    }
]

# 计算向量嵌入（使用外部 API）
embeddings = [
    [0.1, 0.2, ..., 0.9],  # 1536 维向量
    [0.2, 0.3, ..., 0.8]
]

# 添加到向量库
kb_id = "knowledge_base_001"
ids = await vector_service.add_chunks_to_collection(
    chunks=chunks,
    embeddings=embeddings,
    knowledge_base_id=kb_id
)

print(f"添加了 {len(ids)} 个向量：{ids}")
```

### 语义搜索

```python
# 执行语义相似度搜索
results = await vector_service.search_similar_chunks(
    knowledge_base_id="knowledge_base_001",
    query_text="Python 编程",
    base_url="https://api.openai.com/v1",  # Embedding API 地址
    api_key="sk-xxx",  # API 密钥
    model_name="text-embedding-ada-002",  # Embedding 模型
    top_k=5,  # 返回结果数量
    filter_metadata={"file_id": "file_123"}  # 可选：按文件过滤
)

for result in results:
    print(f"内容：{result['content']}")
    print(f"相似度：{result['similarity']}")
    print(f"元数据：{result['metadata']}")
```

### BM25 关键词搜索

```python
# 执行 BM25 关键词搜索
results = await vector_service._bm25_search(
    knowledge_base_id="knowledge_base_001",
    query_text="Python 编程 教程",
    top_k=10,
    filter_metadata={"file_id": "file_123"}
)

for result in results:
    print(f"内容：{result['content']}")
    print(f"BM25 分数：{result['bm25_score']}")
```

### 混合搜索（语义 + BM25）

```python
# 执行混合搜索（推荐）
results = await vector_service.search_similar_chunks_hybrid(
    knowledge_base_id="knowledge_base_001",
    query_text="Python 编程",
    base_url="https://api.openai.com/v1",
    api_key="sk-xxx",
    model_name="text-embedding-ada-002",
    top_k=5,
    use_hybrid=True,  # 启用混合搜索
    semantic_weight=0.6,  # 语义权重
    keyword_weight=0.4    # 关键词权重
)

for result in results:
    print(f"内容：{result['content']}")
    print(f"综合分数：{result.get('final_score', 'N/A')}")
```

### 删除操作

#### 删除整个知识库

```python
success = await vector_service.delete_collection(
    knowledge_base_id="knowledge_base_001"
)
```

#### 按 ID 删除向量

```python
vector_ids = ["chunk_0_file_123", "chunk_1_file_123"]
success = await vector_service.delete_vectors_by_ids(
    knowledge_base_id="knowledge_base_001",
    vector_ids=vector_ids
)
```

#### 按条件删除向量

```python
success = await vector_service.delete_vectors_by_where(
    knowledge_base_id="knowledge_base_001",
    where_filter={"file_id": "file_123"}
)
```

### 获取统计信息

```python
stats = await vector_service.get_collection_stats(
    knowledge_base_id="knowledge_base_001"
)

if stats:
    print(f"集合名称：{stats['collection_name']}")
    print(f"向量总数：{stats['total_count']}")
else:
    print("集合不存在")
```

---

## 🔧 高级功能

### 批量添加分块

```python
# 分批处理大量分块（推荐批次大小：100）
chunks_with_embeddings = [
    (chunk_data_1, embedding_1),
    (chunk_data_2, embedding_2),
    ...
]

all_ids = await vector_service.batch_add_chunks(
    knowledge_base_id="knowledge_base_001",
    chunks_with_embeddings=chunks_with_embeddings,
    batch_size=100
)
```

### 自定义 BM25 配置

在创建集合时可以自定义 BM25 索引参数：

```python
from qdrant_client import models

await client.create_collection(
    collection_name="kb_001",
    vectors_config=models.VectorParams(size=1536, distance=models.Distance.COSINE),
    sparse_vectors_config={
        "bm25": models.SparseVectorParams(
            index=models.SparseIndexParams(
                on_disk=True,      # 使用磁盘存储
                block_size=4096,   # 块大小（可选）
            )
        )
    }
)
```

---

## 📊 性能优化建议

### 1. 批次大小调优

根据内存和性能需求调整批次大小：

```python
# 小数据集（< 1000 条）
batch_size = 50

# 中等数据集（1000-10000 条）
batch_size = 100

# 大数据集（> 10000 条）
batch_size = 200
```

### 2. 中文分词优化

为了更好的 BM25 效果，建议使用中文分词：

```python
import jieba

def tokenize_chinese(text):
    """使用 jieba 进行中文分词"""
    return list(jieba.cut(text))

# 在 BM25 搜索中使用
tokens = tokenize_chinese(query_text)
```

### 3. 缓存策略

```python
from functools import lru_cache

@lru_cache(maxsize=100)
def get_cached_embedding(text_hash):
    """缓存 Embedding 结果"""
    ...
```

---

## 🧪 测试验证

运行基础验证脚本：

```bash
cd backend
python verify_qdrant_service.py
```

这将执行以下测试：
1. ✅ VectorService 初始化
2. ✅ Qdrant 异步客户端获取
3. ✅ 集合创建（包含 BM25 配置）
4. ✅ 添加分块和搜索功能
5. ✅ 删除操作验证

---

## ⚠️ 注意事项

### 数据迁移

**重要**：ChromaDB 和 Qdrant 数据格式不兼容！

如果你之前使用 ChromaDB，需要：
1. 导出原有数据
2. 重新向量化
3. 导入到 Qdrant

### 路径配置

默认数据路径为 `./data/qdrant_db`，可以在初始化时自定义：

```python
# 生产环境建议使用绝对路径
vector_service = VectorService(
    persist_directory="/var/data/qdrant_db"
)
```

### 并发控制

Qdrant 异步客户端支持高并发，但建议控制同时处理的文件数：

```python
import asyncio

# 使用信号量控制并发
semaphore = asyncio.Semaphore(3)  # 最多 3 个并发任务

async def process_file(file_data):
    async with semaphore:
        await vector_service.add_chunks_to_collection(...)
```

---

## 🔍 故障排查

### 问题 1: 集合创建失败

**症状**: `Exception: Collection already exists`

**解决方案**: 
```python
# 先删除旧集合
await vector_service.delete_collection(kb_id)
# 再重新创建
```

### 问题 2: BM25 搜索结果为空

**原因**: 可能是分词不当或数据未正确索引

**解决方案**:
1. 检查文本是否已正确分词
2. 确认集合已创建并包含 BM25 配置
3. 增加 `top_k` 值测试

### 问题 3: 异步操作阻塞

**症状**: 界面卡顿，响应慢

**解决方案**:
1. 确保所有调用都使用 `await`
2. 避免在异步函数中使用同步阻塞调用
3. 检查是否有死循环或长时间运行的任务

---

## 📚 API 参考

### VectorService 公共方法

| 方法 | 描述 | 异步 |
|------|------|------|
| `add_chunks_to_collection` | 添加分块到集合 | ✅ |
| `search_similar_chunks` | 语义相似度搜索 | ✅ |
| `search_similar_chunks_hybrid` | 混合搜索 | ✅ |
| `delete_collection` | 删除集合 | ✅ |
| `delete_vectors_by_ids` | 按 ID 删除向量 | ✅ |
| `delete_vectors_by_where` | 按条件删除向量 | ✅ |
| `get_collection_stats` | 获取统计信息 | ✅ |
| `batch_add_chunks` | 批量添加分块 | ✅ |

### 私有方法

| 方法 | 描述 |
|------|------|
| `_get_qdrant_client` | 获取 Qdrant 异步客户端（单例） |
| `_ensure_collection_with_bm25` | 确保集合存在并配置 BM25 |
| `_bm25_search` | BM25 关键词搜索 |

---

## 🎯 最佳实践

### 1. 单例模式

在整个应用中使用单个 VectorService 实例：

```python
# 推荐：全局单例
vector_service = VectorService(persist_directory="./data/qdrant_db")
```

### 2. 错误处理

```python
try:
    results = await vector_service.search_similar_chunks(...)
except Exception as e:
    logger.error(f"搜索失败：{e}")
    results = []
```

### 3. 日志记录

```python
import logging

logger = logging.getLogger(__name__)

# 在关键操作处添加日志
logger.info(f"开始处理知识库：{kb_id}")
logger.debug(f"添加了 {len(ids)} 个向量")
```

---

## 🔗 相关资源

- [Qdrant 官方文档](https://qdrant.tech/documentation/)
- [Qdrant Python Client](https://github.com/qdrant/qdrant-client)
- [Qdrant 本地模式](https://qdrant.tech/documentation/quick-start/local-mode/)
- [BM25 稀疏向量](https://qdrant.tech/documentation/concepts/sparse-vectors/)

---

**最后更新**: 2026-04-03  
**版本**: v1.0  
**维护者**: AI Chat 开发团队
