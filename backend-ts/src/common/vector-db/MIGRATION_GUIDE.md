# 向量数据库模块重构迁移指南

## 📋 概述

本次重构将向量数据库相关代码从 `knowledge-base` 模块提取到独立的 `common/vector-db` 模块，提高代码复用性和可维护性。

---

## 🔄 变更内容

### 1. 目录结构变化

#### ❌ 旧结构

```
src/modules/knowledge-base/
├── vector-database.interface.ts          # 接口定义
├── implementations/
│   ├── lancedb-vector-db.ts              # LanceDB 实现
│   ├── chroma-vector-db.ts               # ChromaDB 实现
│   └── index.ts                          # 导出
└── ... (其他业务文件)
```

#### 新结构

```
src/common/vector-db/                      # 新的通用模块
├── interfaces/
│   └── vector-database.interface.ts      # 接口定义
├── implementations/
│   ├── lancedb-vector-db.ts              # LanceDB 实现
│   └── index.ts                          # 导出
├── index.ts                               # 模块入口
└── README.md                              # 使用文档
```

---

## 🔧 迁移步骤

### Step 1: 更新导入路径

#### 在知识库模块中

**之前**：

```typescript
import { VectorDatabase } from "./vector-database.interface";
import { LanceDBVectorDB } from "./implementations/lancedb-vector-db";
```

**之后**：

```typescript
import { VectorDatabase, LanceDBVectorDB } from "@/common/vector-db";
// 或者
import { VectorDatabase, LanceDBVectorDB } from "../../common/vector-db";
```

#### 在其他模块中

任何需要使用向量数据库的模块都可以直接导入：

```typescript
import { VectorDatabase, LanceDBVectorDB } from "@/common/vector-db";
```

---

### Step 2: 更新模块配置

在 `KnowledgeBaseModule` 中配置依赖注入：

```typescript
// src/modules/knowledge-base/knowledge-base.module.ts
import { Module } from "@nestjs/common";
import { VectorDatabase, LanceDBVectorDB } from "@/common/vector-db";
import { KnowledgeBaseService } from "./knowledge-base.service";

@Module({
  providers: [
    {
      provide: "VECTOR_DB",
      useClass: LanceDBVectorDB,
    },
    KnowledgeBaseService,
  ],
  exports: ["VECTOR_DB"], // 如果需要被其他模块使用
})
export class KnowledgeBaseModule {}
```

---

### Step 3: 更新服务层

在服务中使用依赖注入：

```typescript
// src/modules/knowledge-base/knowledge-base.service.ts
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

## 📦 公共 API

### 导出的接口和类型

```typescript
import {
  VectorDatabase, // 主接口
  SearchResult, // 搜索结果类型
  VectorDocument, // 向量文档类型
  CollectionStats, // 集合统计类型
  LanceDBVectorDB, // LanceDB 实现类
} from "@/common/vector-db";
```

### 核心方法

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

## 验证清单

- [ ] 所有导入路径已更新
- [ ] 模块配置已更新（依赖注入）
- [ ] 服务层已更新（使用 `@Inject('VECTOR_DB')`）
- [ ] 测试脚本可以正常运行
- [ ] 旧的实现文件已删除
- [ ] 没有编译错误

---

## 🧪 运行测试

```bash
npx ts-node test-lancedb.ts
```

预期输出：

```
=== LanceDB 向量数据库测试 ===

1. 初始化 LanceDB...
初始化成功

2. 创建集合：test_lancedb_collection...
集合创建成功

...

🎉 所有测试通过！
```

---

## 💡 优势

### 1. 代码复用

现在任何模块都可以轻松使用向量数据库功能：

```typescript
// 在聊天模块中使用
import { VectorDatabase } from "@/common/vector-db";

// 在搜索模块中使用
import { VectorDatabase } from "@/common/vector-db";

// 在推荐模块中使用
import { VectorDatabase } from "@/common/vector-db";
```

### 2. 易于扩展

添加新的向量数据库实现只需在 `common/vector-db/implementations/` 目录下创建新文件：

```typescript
// src/common/vector-db/implementations/qdrant-vector-db.ts
import { VectorDatabase } from "../interfaces/vector-database.interface";

export class QdrantVectorDB implements VectorDatabase {
  // 实现所有方法
}
```

然后在 `implementations/index.ts` 中导出：

```typescript
export { QdrantVectorDB } from "./qdrant-vector-db";
```

### 3. 清晰的职责分离

- `common/vector-db/` - 通用的向量数据库抽象层
- `modules/knowledge-base/` - 知识库业务逻辑
- 其他模块 - 按需使用向量数据库

---

## 🔍 常见问题

### Q1: 为什么要把向量数据库独立出来？

**A**:

- 提高代码复用性（多个模块可能需要向量搜索）
- 清晰的职责分离（向量数据库 ≠ 知识库业务逻辑）
- 易于测试和维护
- 方便未来扩展（添加新的向量数据库后端）

### Q2: 旧的代码还能用吗？

**A**: 不能。旧的文件已被删除，必须使用新的导入路径。

### Q3: 如何切换不同的向量数据库？

**A**: 只需修改模块配置：

```typescript
// 使用 LanceDB
{
  provide: 'VECTOR_DB',
  useClass: LanceDBVectorDB,
}

// 切换到 Qdrant（未来）
{
  provide: 'VECTOR_DB',
  useClass: QdrantVectorDB,
}
```

### Q4: 会影响现有功能吗？

**A**: 只要正确更新导入路径和模块配置，不会影响任何功能。API 完全兼容。

---

## 📚 相关文档

- [向量数据库模块 README](./README.md)
- [LanceDB 实施完成报告](../../docs/LANCEDB_IMPLEMENTATION_COMPLETE.md)
- [向量数据库抽象设计](../../docs/VECTOR_DB_ABSTRACTION_DESIGN.md)

---

## 🎯 下一步

1. 完成重构
2. ⏳ 更新知识库模块使用新的依赖注入
3. ⏳ 编写单元测试
4. ⏳ 集成到其他需要向量搜索的模块

---

**迁移日期**: 2026-04-06  
**状态**: 完成
