# 向量数据库模块 (Vector DB Module)

## 📖 概述

这是一个通用的向量数据库抽象层，提供统一的接口来操作多种向量数据库后端。

### 核心特性

- **统一的抽象接口** - 所有实现遵循相同的 `VectorDatabase` 接口
- **嵌入式部署** - 基于 SQLite + sqlite-vec，无需外部服务器
- **混合搜索** - 支持语义搜索、关键词搜索和加权融合
- **中文友好** - 集成 jieba 分词器，支持中文全文搜索
- **零依赖部署** - 纯嵌入式实现，开箱即用

---

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install @lancedb/lancedb @node-rs/jieba
```

### 2. 基本使用

```typescript
import { VectorDatabase, SqliteVectorDB } from '@/common/vector-db';

// 创建实例
const vectorDb: VectorDatabase = new SqliteVectorDB();

// 初始化
await vectorDb.initialize();

// 创建集合
await vectorDb.createCollection('my_kb', 1536);

// 添加文档
await vectorDb.addDocuments('my_kb', [
  {
    id: 'doc_1',
    content: 'LanceDB 是一个嵌入式向量数据库',
    embedding: [...], // 1536 维向量
    metadata: { source: 'test' },
  },
]);

// 清理
await vectorDb.close();
```

---

## 🔍 搜索功能

### 语义搜索

基于向量相似度的搜索：

```typescript
const results = await vectorDb.semanticSearch(
  "my_kb",
  queryEmbedding, // 查询向量
  5, // topK
);

console.log(results[0].content); // 文档内容
console.log(results[0].semantic_score); // 相似度分数
```

### 关键词搜索

基于 BM25 的全文搜索（支持中文）：

```typescript
const results = await vectorDb.keywordSearch(
  "my_kb",
  "向量数据库", // 查询文本
  5, // topK
);

console.log(results[0].content); // 文档内容
console.log(results[0].bm25_score); // BM25 分数
```

### 混合搜索

语义 + 关键词加权融合：

```typescript
const results = await vectorDb.hybridSearch(
  "my_kb",
  queryEmbedding, // 查询向量
  "向量数据库", // 查询文本
  5, // topK
  0.6, // 语义权重
  0.4, // 关键词权重
);

console.log(results[0].content); // 文档内容
console.log(results[0].score); // 最终融合分数
```

---

## 📦 NestJS 依赖注入

### 1. 配置模块

```typescript
// knowledge-base.module.ts
import { Module } from "@nestjs/common";
import { VectorDatabase, SqliteVectorDB } from "@/common/vector-db";

@Module({
  providers: [
    {
      provide: "VECTOR_DB",
      useClass: SqliteVectorDB,
    },
    KnowledgeBaseService,
  ],
  exports: ["VECTOR_DB"],
})
export class KnowledgeBaseModule {}
```

### 2. 在服务中使用

```typescript
// knowledge-base.service.ts
import { Injectable, Inject } from "@nestjs/common";
import { VectorDatabase } from "@/common/vector-db";

@Injectable()
export class KnowledgeBaseService {
  constructor(@Inject("VECTOR_DB") private vectorDb: VectorDatabase) {}

  async searchKnowledgeBase(query: string) {
    const embedding = await this.getEmbedding(query);

    return await this.vectorDb.hybridSearch(
      "knowledge_base",
      embedding,
      query,
      10,
      0.6,
      0.4,
    );
  }
}
```

---

## 🏗️ 架构设计

### 目录结构

```
src/common/vector-db/
├── interfaces/
│   └── vector-database.interface.ts    # 抽象接口定义
├── implementations/
│   ├── index.ts                        # 导出所有实现
│   └── sqlite-vector-db.ts             # SQLite 实现
├── index.ts                            # 模块入口
└── README.md                           # 本文档
```

### 核心接口

```typescript
interface VectorDatabase {
  initialize(): Promise<void>;
  createCollection(name: string, vectorSize: number): Promise<void>;
  deleteCollection(name: string): Promise<boolean>;
  collectionExists(name: string): Promise<boolean>;

  addDocuments(collection: string, docs: VectorDocument[]): Promise<string[]>;
  deleteDocuments(collection: string, ids: string[]): Promise<number>;

  semanticSearch(collection: string, embedding: number[], topK?: number): Promise<SearchResult[]>;
  keywordSearch(collection: string, query: string, topK?: number): Promise<SearchResult[]>;
  hybridSearch(collection: string, embedding: number[], query: string, ...): Promise<SearchResult[]>;

  getCollectionStats(collection: string): Promise<CollectionStats>;
  close(): Promise<void>;
}
```

---

## 🔧 扩展新的向量数据库

虽然当前项目使用 SQLite + sqlite-vec，但架构设计支持未来扩展其他向量数据库。

要添加新的向量数据库实现，只需：

### 1. 创建实现类

```typescript
// src/common/vector-db/implementations/other-vector-db.ts
import { Injectable } from '@nestjs/common';
import { VectorDatabase, SearchResult, VectorDocument } from '../interfaces/vector-database.interface';

@Injectable()
export class OtherVectorDB implements VectorDatabase {
  async initialize(): Promise<void> {
    // 实现初始化逻辑
  }

  async semanticSearch(...): Promise<SearchResult[]> {
    // 实现语义搜索
  }

  // ... 实现其他方法
}
```

### 2. 导出新实现

```typescript
// src/common/vector-db/implementations/index.ts
export { SqliteVectorDB } from "./sqlite-vector-db";
// export { OtherVectorDB } from "./other-vector-db"; // 未来扩展
```

### 3. 在模块中配置

```typescript
{
  provide: 'VECTOR_DB',
  useClass: OtherVectorDB, // 切换到其他实现
}
```

---

## 📊 支持的向量数据库

| 数据库        | 模式       | 中文支持  | BM25        | 状态     |
| ------------- | ---------- | --------- | ----------- | -------- |
| **SQLite**    | 本地文件   | jieba     | FTS5        | ✅ 已实现 |

> 注：当前项目仅使用 SQLite + sqlite-vec 实现，架构设计支持未来扩展其他向量数据库。

---

## 🎯 最佳实践

### 1. 单例模式

在 NestJS 中，通过依赖注入自动管理单例：

```typescript
// 整个应用中只有一个 VectorDatabase 实例
constructor(@Inject('VECTOR_DB') private vectorDb: VectorDatabase) {}
```

### 2. 错误处理

```typescript
try {
  const results = await vectorDb.semanticSearch("collection", embedding);
  if (results.length === 0) {
    console.log("未找到相关文档");
  }
} catch (error) {
  logger.error(`搜索失败: ${error.message}`);
  return [];
}
```

### 3. 资源清理

在应用关闭时清理资源：

```typescript
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 注册优雅关闭
  app.enableShutdownHooks();

  await app.listen(3000);
}
```

```typescript
// vector-db 实现中
async close(): Promise<void> {
  this.db = null;
  this.jieba = null;
}
```

### 4. 批量操作

```typescript
// 批量添加文档（更高效）
const documents: VectorDocument[] = chunks.map((chunk, i) => ({
  id: `chunk_${i}`,
  content: chunk.text,
  embedding: chunk.embedding,
  metadata: { file_id: fileId },
}));

await vectorDb.addDocuments("collection", documents);
```

---

## 🧪 测试

运行测试脚本：

```bash
npx ts-node test-lancedb.ts
```

测试覆盖：

- 初始化和连接
- 集合管理（创建、删除、存在性检查）
- 文档操作（添加、删除）
- 语义搜索
- 关键词搜索（中文 FTS）
- 混合搜索
- 资源清理

---

## 📝 技术细节

### 中文分词策略

采用**双字段存储**：

```typescript
{
  content: '向量数据库支持语义搜索',           // 原文（用于展示）
  content_tokens: '向量 数据库 支持 语义 搜索'  // 分词结果（用于搜索）
}
```

**优势**：

- 搜索结果返回原文，用户体验好
- 搜索时使用分词结果，准确性高
- 利用 LanceDB FTS 的高性能

### 混合搜索融合算法

```typescript
// Min-Max 归一化
const semanticNorm = (score - min) / (max - min);
const keywordNorm = (score - min) / (max - min);

// 加权融合
const finalScore = α * semanticNorm + β * keywordNorm;
```

**参数建议**：

- 通用场景：α=0.6, β=0.4
- 精确匹配：α=0.4, β=0.6
- 语义理解：α=0.8, β=0.2

---

## 📄 许可证

MIT License
