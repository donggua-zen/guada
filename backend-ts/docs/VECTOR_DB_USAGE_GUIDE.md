# 向量数据库模块使用指南

## 📋 概述

向量数据库模块提供统一的抽象层，支持多种后端实现（LanceDB、Qdrant 等），并规范化了 API 接口。

### 核心特性

- ✅ **统一接口**：所有后端实现遵循相同的接口规范
- ✅ **Metadata 过滤**：支持基于 `document_id` 的高效过滤
- ✅ **灵活扩展**：易于添加新的向量数据库后端
- ✅ **简化 API**：提供高层服务封装，降低使用复杂度

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────┐
│     VectorDbService (服务层)        │
│  - addChunks()                      │
│  - deleteChunks()                   │
│  - deleteTable()                    │
│  - searchChunksHybrid()             │
│  - searchChunksSemantic()           │
│  - searchChunksKeyword()            │
└──────────────┬──────────────────────┘
               │ 依赖注入
┌──────────────▼──────────────────────┐
│   VectorDatabase (接口层)           │
│  - addDocuments()                   │
│  - deleteDocuments()                │
│  - semanticSearch()                 │
│  - keywordSearch()                  │
│  - hybridSearch()                   │
└──────────────┬──────────────────────┘
               │ 实现
┌──────────────▼──────────────────────┐
│  LanceDBVectorDB (实现层)           │
│  QdrantVectorDB (未来)              │
│  ChromaVectorDB (未来)              │
└─────────────────────────────────────┘
```

---

## 🚀 快速开始

### 1. 基本使用

```typescript
import { VectorDbService } from '@/common/vector-db';

@Injectable()
export class MyService {
  constructor(private readonly vectorDb: VectorDbService) {}

  // 添加 chunks
  async addData() {
    const chunks = [
      {
        id: 'chunk_1',
        content: 'LanceDB 是一个嵌入式向量数据库',
        metadata: { document_id: 'file_001', source: 'test' },
      },
      {
        id: 'chunk_2',
        content: 'Qdrant 需要独立服务器部署',
        metadata: { document_id: 'file_002', source: 'test' },
      },
    ];

    const embeddings = [
      Array(1536).fill(0.1), // 第一个 chunk 的向量
      Array(1536).fill(0.2), // 第二个 chunk 的向量
    ];

    const ids = await this.vectorDb.addChunks('my_table', chunks, embeddings);
    console.log('添加的 IDs:', ids);
  }

  // 混合搜索
  async searchData(queryEmbedding: number[], queryText: string) {
    const results = await this.vectorDb.searchChunksHybrid(
      'my_table',
      queryEmbedding,
      queryText,
      5, // topK
      0.6, // 语义权重
      0.4, // 关键词权重
      { document_id: 'file_001' }, // 可选：metadata 过滤
    );

    results.forEach((result) => {
      console.log(`ID: ${result.id}`);
      console.log(`内容: ${result.content}`);
      console.log(`分数: ${result.score}`);
      console.log(`元数据:`, result.metadata);
    });
  }

  // 删除 chunks
  async deleteData() {
    // 方式 1：按 IDs 删除
    await this.vectorDb.deleteChunks('my_table', {
      ids: ['chunk_1', 'chunk_2'],
    });

    // 方式 2：按 metadata 过滤删除
    await this.vectorDb.deleteChunks('my_table', {
      filterMetadata: { document_id: 'file_001' },
    });

    // 方式 3：同时使用 IDs 和 metadata 过滤
    await this.vectorDb.deleteChunks('my_table', {
      ids: ['chunk_1'],
      filterMetadata: { document_id: 'file_001' },
    });
  }

  // 删除整个表
  async deleteTable() {
    await this.vectorDb.deleteTable('my_table');
  }
}
```

---

## 📝 API 参考

### VectorDbService

#### `addChunks(tableId, chunks, embeddings)`

添加 chunks 到指定表。

**参数：**
- `tableId` (string): 表 ID（集合名称）
- `chunks` (VectorChunk[]): Chunk 列表
  - `id` (string): Chunk ID
  - `content` (string): 文本内容
  - `metadata` (Record<string, any>, 可选): 元数据
- `embeddings` (number[][]): 对应的向量列表

**返回：** `Promise<string[]>` - 添加的 chunk IDs

**示例：**
```typescript
const chunks = [
  {
    id: 'chunk_1',
    content: '这是第一个 chunk',
    metadata: { 
      document_id: 'file_001',  // ✅ 标准过滤字段
      page: 1,
      section: 'intro'
    },
  },
];

const embeddings = [Array(1536).fill(0.1)];
const ids = await vectorDb.addChunks('my_table', chunks, embeddings);
```

---

#### `deleteChunks(tableId, options)`

删除 chunks（支持 IDs 或 metadata 过滤）。

**参数：**
- `tableId` (string): 表 ID
- `options` (可选): 删除选项
  - `ids` (string[], 可选): 要删除的 chunk IDs
  - `filterMetadata` (Record<string, any>, 可选): metadata 过滤条件
  - ⚠️ **注意**：`ids` 和 `filterMetadata` 至少提供一个

**返回：** `Promise<number>` - 删除的数量

**示例：**
```typescript
// 按 IDs 删除
await vectorDb.deleteChunks('my_table', {
  ids: ['chunk_1', 'chunk_2'],
});

// 按 metadata 过滤删除
await vectorDb.deleteChunks('my_table', {
  filterMetadata: { document_id: 'file_001' },
});

// 组合使用
await vectorDb.deleteChunks('my_table', {
  ids: ['chunk_1'],
  filterMetadata: { document_id: 'file_001' },
});
```

---

#### `deleteTable(tableId)`

删除整个表。

**参数：**
- `tableId` (string): 表 ID

**返回：** `Promise<boolean>` - 是否删除成功

**示例：**
```typescript
const success = await vectorDb.deleteTable('my_table');
```

---

#### `searchChunksHybrid(tableId, queryEmbedding, queryText, ...)`

混合搜索（语义 + 关键词加权融合）。

**参数：**
- `tableId` (string, 必选): 表 ID
- `queryEmbedding` (number[]): 查询向量
- `queryText` (string): 查询文本
- `topK` (number, 默认 5): 返回结果数量
- `semanticWeight` (number, 默认 0.6): 语义权重 (0-1)
- `keywordWeight` (number, 默认 0.4): 关键词权重 (0-1)
- `filterMetadata` (Record<string, any>, 可选): metadata 过滤条件

**返回：** `Promise<SearchResult[]>`
- `id` (string): Chunk ID
- `content` (string): 文本内容
- `metadata` (Record<string, any>): 元数据
- `score` (number): 最终分数
- `semantic_score` (number): 语义分数
- `bm25_score` (number): BM25 分数

**示例：**
```typescript
const results = await vectorDb.searchChunksHybrid(
  'my_table',
  queryEmbedding,
  '向量数据库',
  10,
  0.7, // 更重视语义
  0.3,
  { document_id: 'file_001' }, // 只搜索 file_001
);
```

---

#### `searchChunksSemantic(tableId, queryEmbedding, ...)`

纯语义搜索。

**参数：**
- `tableId` (string): 表 ID
- `queryEmbedding` (number[]): 查询向量
- `topK` (number, 默认 5): 返回结果数量
- `filterMetadata` (Record<string, any>, 可选): metadata 过滤条件

**返回：** `Promise<SearchResult[]>`

---

#### `searchChunksKeyword(tableId, queryText, ...)`

纯关键词搜索（BM25）。

**参数：**
- `tableId` (string): 表 ID
- `queryText` (string): 查询文本
- `topK` (number, 默认 5): 返回结果数量
- `filterMetadata` (Record<string, any>, 可选): metadata 过滤条件

**返回：** `Promise<SearchResult[]>`

---

#### `tableExists(tableId)`

检查表是否存在。

**参数：**
- `tableId` (string): 表 ID

**返回：** `Promise<boolean>`

---

#### `getTableStats(tableId)`

获取表的统计信息。

**参数：**
- `tableId` (string): 表 ID

**返回：** `Promise<Record<string, any>>`

---

## 🔍 Metadata 过滤规范

### 标准字段

- **`document_id`**: 源文档 ID，用于缩小搜索范围
  ```typescript
  { document_id: 'file_001' }
  ```

### 自定义字段

如果底层数据库不支持某些 metadata 字段的过滤，可以使用 `__metadata_xxxx` 形式作为独立列：

```typescript
const chunks = [
  {
    id: 'chunk_1',
    content: '内容',
    metadata: {
      document_id: 'file_001',
      __metadata_page: 1,  // 会被提取为独立列
      __metadata_section: 'intro',  // 会被提取为独立列
    },
  },
];

// 过滤时可以直接使用
await vectorDb.searchChunksHybrid(
  'my_table',
  embedding,
  'query',
  5,
  0.6,
  0.4,
  { 
    document_id: 'file_001',
    __metadata_page: 1,  // ✅ 支持过滤
  },
);
```

**注意：**
- 返回时会自动将 `__metadata_xxxx` 字段重组为 `metadata` 对象
- 当前 LanceDB 实现只支持 `document_id` 和 `file_id` 过滤
- 未来版本会扩展支持更多字段

---

## 🔄 迁移指南

### 从旧 API 迁移

**之前：**
```typescript
// 旧的 VectorService
await vectorService.addChunksToCollection(chunks, embeddings, kbId);
await vectorService.searchSimilarChunks(kbId, query, ...);
```

**现在：**
```typescript
// 新的 VectorDbService
await vectorDb.addChunks(`kb_${kbId}`, chunks, embeddings);
await vectorDb.searchChunksHybrid(`kb_${kbId}`, embedding, query, ...);
```

---

## 🧪 测试示例

查看 `test-metadata-filtering.ts` 了解完整的测试用例。

```bash
npx ts-node test-metadata-filtering.ts
```

---

## 📦 扩展新后端

要添加新的向量数据库后端（如 Qdrant），只需：

1. 实现 `VectorDatabase` 接口
2. 在 `implementations/` 目录下创建新文件
3. 导出新实现

```typescript
// src/common/vector-db/implementations/qdrant-vector-db.ts
export class QdrantVectorDB implements VectorDatabase {
  // 实现所有接口方法
}
```

---

## 📚 相关文档

- [LanceDB 官方文档](https://lancedb.github.io/lancedb/)
- [向量数据库模块重构报告](./VECTOR_DB_MODULE_REFACTORING.md)
- [Metadata 过滤说明](./LANCEDB_METADATA_FILTERING.md)
