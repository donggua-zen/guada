# Qdrant 向量数据库集成指南

## 概述

TypeScript 后端已完整集成 Qdrant 向量数据库，支持：
- ✅ 密集向量语义搜索（Cosine 相似度）
- ✅ BM25 稀疏向量关键词搜索
- ✅ 混合搜索（语义 + 关键词加权融合）
- ✅ 集合管理、批量上传、条件删除

## 前置要求

### 1. 安装 Docker

Qdrant 需要运行在独立的服务器上。推荐使用 Docker 快速部署：

```bash
# 下载并安装 Docker Desktop
# https://www.docker.com/products/docker-desktop/
```

### 2. 启动 Qdrant 服务器

在项目根目录或任意位置运行：

```bash
docker run -p 6333:6333 -v $(pwd)/data/qdrant_db:/qdrant/storage qdrant/qdrant
```

**参数说明**：
- `-p 6333:6333`: 将容器的 6333 端口映射到主机
- `-v $(pwd)/data/qdrant_db:/qdrant/storage`: 持久化存储向量数据到 `./data/qdrant_db` 目录
- `qdrant/qdrant`: 官方 Qdrant 镜像

**Windows PowerShell 版本**：
```powershell
docker run -p 6333:6333 -v ${PWD}\data\qdrant_db:/qdrant/storage qdrant/qdrant
```

### 3. 验证 Qdrant 是否运行

访问 http://localhost:6333/dashboard 查看 Qdrant Web UI，或运行：

```bash
curl http://localhost:6333/collections
```

预期返回：
```json
{
  "result": {
    "collections": []
  },
  "status": "ok",
  "time": 0.0001
}
```

## 配置说明

### VectorService 配置

文件：`backend-ts/src/modules/knowledge-base/vector.service.ts`

```typescript
private async getQdrantClient(): Promise<QdrantClient> {
  if (!this.qdrantClient) {
    // 连接到本地运行的 Qdrant 服务器
    this.qdrantClient = new QdrantClient({
      url: 'http://127.0.0.1:6333',
    });
    this.logger.log(`Qdrant 客户端已初始化：http://127.0.0.1:6333`);
  }
  return this.qdrantClient;
}
```

**如需修改连接地址**，编辑上述代码中的 `url` 参数。

## 功能实现

### 1. 集合管理

**自动创建集合**：当首次上传文件到知识库时，VectorService 会自动创建对应的集合。

集合命名规则：`kb_{knowledge_base_id}`

集合配置：
- **密集向量**：Cosine 距离，维度由 Embedding 模型决定（如 1536）
- **稀疏向量**：BM25 索引，启用磁盘存储优化内存

### 2. 向量嵌入

使用 OpenAI 兼容 API 生成文本嵌入：

```typescript
const embedding = await vectorService.getEmbedding(
  text,
  baseUrl,    // 向量模型 API 地址
  apiKey,     // API 密钥
  modelName   // 模型名称
);
```

### 3. 添加分块

批量上传分块到 Qdrant：

```typescript
const ids = await vectorService.addChunksToCollection(
  chunks,       // 分块数据数组
  embeddings,   // 对应的向量嵌入数组
  knowledgeBaseId
);
```

每个分块的 payload 包含：
- `content`: 分块文本内容
- `file_id`: 文件 ID
- `chunk_index`: 分块索引
- 其他自定义元数据

### 4. 语义搜索

基于密集向量的余弦相似度搜索：

```typescript
const results = await vectorService.searchSimilarChunks(
  knowledgeBaseId,
  queryText,
  baseUrl,
  apiKey,
  modelName,
  topK,           // 默认 5
  filterMetadata  // 可选，如 { file_id: "xxx" }
);
```

返回结果：
```typescript
[
  {
    content: "分块内容",
    metadata: { file_id: "...", chunk_index: 0, ... },
    distance: 0.85,
    similarity: 0.85
  }
]
```

### 5. 关键词搜索（BM25）

基于稀疏向量的关键词匹配：

```typescript
const results = await vectorService['bm25Search'](
  knowledgeBaseId,
  queryText,
  topK,           // 默认 20
  filterMetadata
);
```

返回结果：
```typescript
[
  {
    content: "分块内容",
    metadata: { ... },
    bm25_score: 0.75
  }
]
```

**注意**：当前实现使用简单的关键词匹配分数替代真正的 BM25 算法。如需更精确的 BM25，可集成 `rank-bm25` 库。

### 6. 混合搜索

结合语义搜索和关键词搜索，按权重融合结果：

```typescript
const results = await vectorService.searchSimilarChunksHybrid(
  knowledgeBaseId,
  queryText,
  baseUrl,
  apiKey,
  modelName,
  topK,              // 默认 5
  filterMetadata,
  useHybrid,         // 默认 true
  semanticWeight,    // 默认 0.6
  keywordWeight      // 默认 0.4
);
```

**融合算法**：
1. 分别执行语义搜索和关键词搜索（扩大召回至 `topK * 4`）
2. Min-Max 归一化两种分数到 [0, 1]
3. 加权融合：`final_score = semantic_weight * semantic_norm + keyword_weight * keyword_norm`
4. 按最终分数排序，返回 Top-K

### 7. 删除操作

**删除整个集合**：
```typescript
await vectorService.deleteCollection(knowledgeBaseId);
```

**根据条件删除向量**：
```typescript
await vectorService.deleteVectorsByWhere(
  knowledgeBaseId,
  { file_id: "xxx" }  // 删除指定文件的所有向量
);
```

### 8. 统计信息

获取集合的向量数量：

```typescript
const stats = await vectorService.getCollectionStats(knowledgeBaseId);
// 返回：{ total_count: 1234, collection_name: "kb_xxx" } | null
```

## API 端点

知识库模块提供以下 REST API：

### 知识库管理
- `GET /api/v1/knowledge-bases` - 列出知识库
- `POST /api/v1/knowledge-bases` - 创建知识库
- `GET /api/v1/knowledge-bases/:id` - 获取知识库详情
- `PUT /api/v1/knowledge-bases/:id` - 更新知识库
- `DELETE /api/v1/knowledge-bases/:id` - 删除知识库（同时删除向量集合）

### 文件管理
- `POST /api/v1/knowledge-bases/:kb_id/files/upload` - 上传文件
- `GET /api/v1/knowledge-bases/:kb_id/files` - 列出文件
- `GET /api/v1/knowledge-bases/:kb_id/files/:file_id` - 获取文件详情
- `GET /api/v1/knowledge-bases/:kb_id/files/:file_id/status` - 获取处理状态
- `POST /api/v1/knowledge-bases/:kb_id/files/status/batch` - 批量获取状态
- `DELETE /api/v1/knowledge-bases/:kb_id/files/:file_id` - 删除文件及向量
- `POST /api/v1/knowledge-bases/:kb_id/files/:file_id/retry` - 重新处理文件
- `GET /api/v1/knowledge-bases/:kb_id/files/:file_id/chunks` - 查看分块

### 搜索
- `POST /api/v1/knowledge-bases/:kb_id/search` - 混合搜索
- `GET /api/v1/knowledge-bases/:kb_id/search/test` - 测试搜索

## 测试流程

### 1. 启动服务

```bash
# 终端 1：启动 Qdrant
docker run -p 6333:6333 -v ${PWD}\data\qdrant_db:/qdrant/storage qdrant/qdrant

# 终端 2：启动后端
cd backend-ts
npx ts-node src/main.ts
```

### 2. 创建知识库

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试知识库",
    "description": "用于测试 Qdrant 集成",
    "embedding_model_id": "your-model-id"
  }'
```

### 3. 上传文件

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/files/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test.txt"
```

### 4. 等待处理完成

轮询文件状态：
```bash
curl http://localhost:3000/api/v1/knowledge-bases/KB_ID/files/FILE_ID/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. 执行搜索

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/search \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "搜索关键词",
    "top_k": 5,
    "use_hybrid": true,
    "semantic_weight": 0.6,
    "keyword_weight": 0.4
  }'
```

### 6. 验证数据存储

访问 Qdrant Web UI：http://localhost:6333/dashboard

查看集合列表和向量数据。

## 故障排查

### 问题 1：无法连接到 Qdrant

**错误信息**：
```
Error: connect ECONNREFUSED 127.0.0.1:6333
```

**解决方案**：
1. 确认 Docker 正在运行
2. 确认 Qdrant 容器已启动：`docker ps | grep qdrant`
3. 检查端口是否被占用：`netstat -ano | findstr :6333`

### 问题 2：向量搜索返回空结果

**可能原因**：
1. 文件尚未处理完成（状态仍为 `processing`）
2. Embedding 模型配置错误
3. 查询文本与知识库内容不相关

**解决方案**：
1. 检查文件状态是否为 `completed`
2. 验证 `embedding_model_id` 是否正确
3. 尝试不同的查询文本

### 问题 3：混合搜索效果不佳

**可能原因**：
1. BM25 实现过于简单（当前使用关键词匹配）
2. 权重配置不合理

**解决方案**：
1. 调整 `semantic_weight` 和 `keyword_weight`
2. 集成真正的 BM25 库（如 `rank-bm25` 的 JS 版本）
3. 优先使用纯语义搜索（设置 `use_hybrid: false`）

## 性能优化建议

### 1. 批量上传

使用 `batch_add_chunks` 方法分批处理大量分块：

```typescript
await vectorService.batch_add_chunks(
  knowledgeBaseId,
  chunksWithEmbeddings,
  100  // 批次大小
);
```

### 2. 并发控制

在 `KbFileService.processFile` 中使用信号量限制并发文件处理。

### 3. 索引优化

Qdrant 自动优化索引，但可以通过以下方式提升性能：
- 增加 HNSW 图的 `m` 和 `ef_construct` 参数
- 使用 SSD 存储向量数据
- 定期优化集合：`client.optimize(collectionName)`

### 4. 内存管理

- 启用稀疏向量的 `on_disk: true` 选项（已配置）
- 限制单次查询的 `top_k` 值
- 定期清理无用集合

## 后续改进方向

### 1. 集成真正的 BM25

当前 BM25 使用简单的关键词匹配，可以集成以下库：
- [`bm25`](https://www.npmjs.com/package/bm25) (npm)
- 自行实现完整的 BM25Okapi 算法

### 2. 中文分词优化

对于中文内容，集成 jieba 分词：
- [`nodejieba`](https://www.npmjs.com/package/nodejieba)

修改 `bm25Search` 方法中的 tokenization 逻辑。

### 3. 向量模型缓存

缓存常用的 Embedding 结果，减少 API 调用：
```typescript
private embeddingCache = new Map<string, number[]>();
```

### 4. 异步任务队列

使用 Bull 或 Agenda 管理后台文件处理任务，替代当前的 Promise 链。

### 5. 监控与日志

- 添加向量操作的 metrics（延迟、成功率）
- 记录搜索查询和结果，用于分析优化

## 参考资料

- [Qdrant 官方文档](https://qdrant.tech/documentation/)
- [Qdrant JavaScript SDK](https://github.com/qdrant/qdrant-js)
- [Qdrant Docker Hub](https://hub.docker.com/r/qdrant/qdrant)
- [向量搜索原理](https://qdrant.tech/articles/vector-search/)
- [BM25 算法详解](https://en.wikipedia.org/wiki/Okapi_BM25)
