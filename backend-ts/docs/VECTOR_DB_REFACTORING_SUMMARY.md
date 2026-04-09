# 向量数据库模块规范化总结

## 📋 完成内容

### 1. 接口规范化 ✅

创建了统一的 `VectorDatabase` 接口，定义标准化的 API：

#### 核心接口方法

| 方法 | 参数 | 说明 |
|------|------|------|
| `addDocuments(tableId, documents)` | tableId, VectorDocument[] | 添加文档 |
| `deleteDocuments(tableId, options)` | tableId, {ids?, filterMetadata?} | 删除文档（支持 IDs 或 metadata 过滤） |
| `semanticSearch(tableId, embedding, topK, filterMetadata?)` | - | 语义搜索 |
| `keywordSearch(tableId, queryText, topK, filterMetadata?)` | - | 关键词搜索 |
| `hybridSearch(tableId, embedding, queryText, ...)` | - | 混合搜索 |
| `deleteCollection(tableId)` | tableId | 删除表 |

---

### 2. 服务层封装 ✅

创建了 `VectorDbService` 提供简化的 API：

```typescript
// 高层 API
- addChunks(tableId, chunks, embeddings)
- deleteChunks(tableId, { ids?, filterMetadata? })
- deleteTable(tableId)
- searchChunksHybrid(tableId, embedding, queryText, ...)
- searchChunksSemantic(tableId, embedding, ...)
- searchChunksKeyword(tableId, queryText, ...)
```

**优势：**
- ✅ 参数验证（chunks 和 embeddings 数量匹配）
- ✅ 自动组合 chunks 和 embeddings
- ✅ 统一的错误处理
- ✅ 日志记录

---

### 3. Metadata 过滤规范 ✅

#### 标准字段
- **`document_id`**: 源文档 ID，用于高效过滤

#### 扩展字段
- 不支持的 metadata 可以使用 `__metadata_xxxx` 形式作为独立列
- 返回时自动重组为 metadata 对象

#### 实现细节（LanceDB）
- `document_id` 存储为独立列
- 使用 SQL WHERE 子句进行过滤：`document_id = 'file_001'`
- metadata 保持为 JSON 字符串
- 性能优秀，无需应用层过滤

---

### 4. 模块化设计 ✅

```
src/common/vector-db/
├── interfaces/
│   └── vector-database.interface.ts  # 统一接口定义
├── implementations/
│   ├── lancedb-vector-db.ts          # LanceDB 实现
│   └── index.ts                       # 导出所有实现
├── vector-db.service.ts               # 服务层封装
├── vector-db.module.ts                # NestJS 模块
├── USAGE_EXAMPLE.ts                   # 使用示例
└── index.ts                           # 模块入口
```

**特点：**
- ✅ 接口与实现分离
- ✅ 易于扩展新后端（Qdrant、ChromaDB 等）
- ✅ 全局模块，任何地方都可以注入
- ✅ 完整的 TypeScript 类型支持

---

### 5. 文档完善 ✅

创建了完整的使用文档：
- 📖 [VECTOR_DB_USAGE_GUIDE.md](./VECTOR_DB_USAGE_GUIDE.md) - 详细的使用指南
- 📝 [USAGE_EXAMPLE.ts](./USAGE_EXAMPLE.ts) - 代码示例
- 🔧 [LANCEDB_METADATA_FILTERING.md](./LANCEDB_METADATA_FILTERING.md) - Metadata 过滤说明

---

## 🎯 核心特性

### ✅ 统一的 API 设计

```typescript
// 无论使用哪种后端，API 都相同
const results = await vectorDb.searchChunksHybrid(
  'my_table',
  embedding,
  'query',
  5,
  0.6,
  0.4,
  { document_id: 'file_001' },
);
```

### ✅ 灵活的删除操作

```typescript
// 按 IDs 删除
await vectorDb.deleteChunks('table', { ids: ['id1', 'id2'] });

// 按 metadata 过滤删除
await vectorDb.deleteChunks('table', { 
  filterMetadata: { document_id: 'file_001' } 
});

// 组合使用
await vectorDb.deleteChunks('table', {
  ids: ['id1'],
  filterMetadata: { document_id: 'file_001' },
});
```

### ✅ 高效的 Metadata 过滤

```typescript
// 底层使用 SQL WHERE 子句，性能优秀
WHERE document_id = 'file_001'

// 而不是应用层过滤
results.filter(r => r.metadata.document_id === 'file_001')
```

### ✅ 易于扩展

添加新后端只需：
1. 实现 `VectorDatabase` 接口
2. 在 `implementations/` 目录创建文件
3. 导出新实现

```typescript
export class QdrantVectorDB implements VectorDatabase {
  // 实现所有方法
}
```

---

## 📊 对比旧实现

| 特性 | 旧实现 | 新实现 |
|------|--------|--------|
| API 一致性 | ❌ 每个后端不同 | ✅ 统一接口 |
| Metadata 过滤 | ❌ 不支持或低效 | ✅ 高效 SQL WHERE |
| 删除操作 | ❌ 只支持 IDs | ✅ IDs + metadata |
| 服务层封装 | ❌ 无 | ✅ VectorDbService |
| 模块化 | ⚠️ 耦合在 knowledge-base | ✅ 独立的 common 模块 |
| 扩展性 | ❌ 困难 | ✅ 简单 |
| 文档 | ❌ 不完整 | ✅ 完整 |

---

## 🚀 迁移路径

### 步骤 1：更新导入

```typescript
// 之前
import { VectorService } from './modules/knowledge-base/vector.service';

// 现在
import { VectorDbService } from '@/common/vector-db';
```

### 步骤 2：更新方法调用

```typescript
// 之前
await vectorService.addChunksToCollection(chunks, embeddings, kbId);

// 现在
await vectorDb.addChunks(`kb_${kbId}`, chunks, embeddings);
```

### 步骤 3：利用新特性

```typescript
// 新增：带过滤的删除
await vectorDb.deleteChunks(`kb_${kbId}`, {
  filterMetadata: { document_id: fileId },
});

// 新增：简化的搜索 API
const results = await vectorDb.searchChunksHybrid(
  `kb_${kbId}`,
  embedding,
  query,
  5,
  0.6,
  0.4,
  { document_id: fileId },
);
```

---

## 🧪 测试验证

运行测试脚本验证功能：

```bash
npx ts-node test-metadata-filtering.ts
```

**测试结果：**
- ✅ 语义搜索 + 过滤
- ✅ 关键词搜索 + 过滤
- ✅ 混合搜索 + 过滤
- ✅ 删除操作（IDs + metadata）
- ✅ 所有 document_id 过滤正确

---

## 📈 未来扩展

### 计划支持的后端

1. **Qdrant** - 分布式向量数据库
2. **ChromaDB** - AI 原生向量数据库
3. **Milvus** - 云原生向量数据库
4. **Weaviate** - 向量搜索引擎

### 增强功能

1. **批量操作优化** - 支持更大的批量插入
2. **索引管理** - 自定义索引策略
3. **监控指标** - 性能监控和统计
4. **缓存层** - 减少重复查询
5. **重试机制** - 提高容错性

---

## 💡 最佳实践

### 1. 使用 document_id 过滤

```typescript
// ✅ 推荐：在添加时设置 document_id
const chunks = [{
  id: 'chunk_1',
  content: '...',
  metadata: { document_id: 'file_001' },
}];

// ✅ 推荐：搜索时使用过滤
await vectorDb.searchChunksHybrid(
  tableId,
  embedding,
  query,
  5,
  0.6,
  0.4,
  { document_id: 'file_001' },
);
```

### 2. 合理的 topK 值

```typescript
// RAG 场景：5-10 个结果
const results = await vectorDb.searchChunksHybrid(..., 5, ...);

// 探索场景：20-50 个结果
const results = await vectorDb.searchChunksHybrid(..., 20, ...);
```

### 3. 权重调整

```typescript
// 语义为主：0.7/0.3
await vectorDb.searchChunksHybrid(..., 0.7, 0.3, ...);

// 平衡：0.5/0.5
await vectorDb.searchChunksHybrid(..., 0.5, 0.5, ...);

// 关键词为主：0.3/0.7
await vectorDb.searchChunksHybrid(..., 0.3, 0.7, ...);
```

### 4. 错误处理

```typescript
try {
  await vectorDb.addChunks(tableId, chunks, embeddings);
} catch (error) {
  logger.error(`添加 chunks 失败: ${error.message}`);
  // 处理错误
}
```

---

## 📚 相关资源

- [LanceDB 官方文档](https://lancedb.github.io/lancedb/)
- [NestJS 依赖注入](https://docs.nestjs.com/providers)
- [TypeScript 接口设计](https://www.typescriptlang.org/docs/handbook/interfaces.html)

---

## ✨ 总结

本次规范化工作完成了：

1. ✅ **统一接口** - 所有后端遵循相同规范
2. ✅ **服务封装** - 简化 API，降低使用门槛
3. ✅ **Metadata 过滤** - 高效且灵活
4. ✅ **模块化设计** - 易于维护和扩展
5. ✅ **完整文档** - 降低学习成本

现在的向量数据库模块：
- 🎯 **更易用** - 简化的 API
- 🔧 **更灵活** - 支持多种后端
- 🚀 **更高效** - 优化的过滤机制
- 📦 **更规范** - 统一的接口设计
