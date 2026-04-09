# LanceDB 快速入门指南

## 🚀 快速开始

### 1. 安装依赖（已完成）

```bash
npm install @lancedb/lancedb
```

### 2. 数据自动初始化

LanceDB 会在首次使用时自动创建数据目录：

```
./data/lancedb/
```

**无需任何配置！**

---

## 📖 基本用法

### 添加向量

```typescript
import { VectorService } from './modules/knowledge-base/vector.service';

// 准备数据
const chunks = [
  {
    content: '这是第一个文档',
    metadata: { source: 'doc1' },
  },
  {
    content: '这是第二个文档',
    metadata: { source: 'doc2' },
  },
];

// 生成向量嵌入（需要使用 Embedding API）
const embeddings = [
  [0.1, 0.2, ..., 0.9], // 1536 维向量
  [0.2, 0.3, ..., 0.8],
];

// 添加到知识库
const ids = await vectorService.addChunksToCollection(
  chunks,
  embeddings,
  'kb_123' // 知识库 ID
);
```

### 语义搜索

```typescript
const results = await vectorService.searchSimilarChunks(
  'kb_123',           // 知识库 ID
  '查询文本',          // 查询内容
  baseUrl,            // Embedding API 地址
  apiKey,             // API 密钥
  modelName,          // 模型名称
  5,                  // 返回数量
);

// 结果格式
[
  {
    content: '匹配的文档内容',
    metadata: { source: 'doc1' },
    similarity: 0.95, // 相似度分数
  },
  ...
]
```

### 混合搜索

```typescript
const results = await vectorService.searchSimilarChunksHybrid(
  'kb_123',
  '查询文本',
  baseUrl,
  apiKey,
  modelName,
  5,
  undefined,          // 过滤条件
  true,               // 使用混合搜索
  0.6,                // 语义权重
  0.4,                // 关键词权重
);
```

### 删除集合

```typescript
await vectorService.deleteCollection('kb_123');
```

### 按条件删除

```typescript
await vectorService.deleteVectorsByWhere('kb_123', {
  file_id: 'file_001',
});
```

### 获取统计信息

```typescript
const stats = await vectorService.getCollectionStats('kb_123');
console.log(stats);
// { total_count: 100, collection_name: 'kb_123' }
```

---

## 🧪 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npx jest vector.service.spec.ts

# 监听模式（开发时使用）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

---

## 📊 数据存储

### 存储位置

```
backend-ts/
└── data/
    └── lancedb/
        ├── kb_xxx.lance/
        │   ├── data.lance
        │   └── _versions/
        └── kb_yyy.lance/
```

### 数据结构

每个知识库对应一个 LanceDB 表：

```
Table: kb_{knowledge_base_id}
Columns:
  - id: string (UUID)
  - vector: float[1536] (向量)
  - content: string (文本内容)
  - metadata: string (JSON 字符串)
```

---

## ⚠️ 注意事项

### 1. 向量维度

确保所有向量的维度一致（通常是 1536 或 768）。

```typescript
// ✅ 正确
const embeddings = [
  new Array(1536).fill(0).map(() => Math.random()),
  new Array(1536).fill(0).map(() => Math.random()),
];

// ❌ 错误：维度不一致
const embeddings = [
  new Array(1536).fill(0),
  new Array(768).fill(0), // 维度不匹配！
];
```

### 2. Metadata 格式

Metadata 必须是可序列化为 JSON 的对象。

```typescript
// ✅ 正确
{
  content: '文本',
  metadata: {
    file_id: 'file_001',
    page: 1,
    tags: ['tag1', 'tag2'],
  }
}

// ❌ 错误：包含不可序列化的对象
{
  content: '文本',
  metadata: {
    date: new Date(), // 需要转换为字符串
    func: () => {},   // 函数不能序列化
  }
}
```

### 3. 并发访问

LanceDB 支持并发读取，但写入时需要小心。

```typescript
// ✅ 安全：顺序执行
await service.addChunksToCollection(...);
await service.addChunksToCollection(...);

// ⚠️ 注意：并行写入可能导致冲突
Promise.all([
  service.addChunksToCollection(...),
  service.addChunksToCollection(...),
]);
```

---

## 🔍 常见问题

### Q1: 如何查看数据库中有哪些表？

```typescript
const db = await service.getDb();
const tables = await db.tableNames();
console.log(tables); // ['kb_123', 'kb_456', ...]
```

### Q2: 如何备份数据？

直接复制 `data/lancedb` 目录即可：

```bash
# Windows
xcopy /E /I data\lancedb backup\lancedb

# Linux/Mac
cp -r data/lancedb backup/lancedb
```

### Q3: 如何恢复数据？

将备份目录复制回原位：

```bash
# Windows
xcopy /E /I backup\lancedb data\lancedb

# Linux/Mac
cp -r backup/lancedb data/lancedb
```

### Q4: 如何清理不再使用的知识库？

```typescript
await service.deleteCollection('kb_old_id');
```

这会删除对应的表和磁盘文件。

### Q5: 性能如何优化？

1. **批量插入**：一次插入多个分块
2. **减少查询范围**：使用 metadata 过滤
3. **缓存 embedding**：避免重复计算
4. **定期清理**：删除不需要的知识库

---

## 📚 相关文档

- **[LANCEDB_MIGRATION_REPORT.md](./LANCEDB_MIGRATION_REPORT.md)** - 完整迁移报告
- **[QDRANT_LOCAL_MODE_ANALYSIS.md](./QDRANT_LOCAL_MODE_ANALYSIS.md)** - Qdrant 对比分析
- **[vector.service.spec.ts](../src/modules/knowledge-base/vector.service.spec.ts)** - 测试用例

---

## 🆘 获取帮助

遇到问题？

1. 检查测试用例是否通过：`npm test`
2. 查看日志输出
3. 查阅 LanceDB 官方文档
4. 提交 Issue

---

**最后更新**: 2026-04-05  
**版本**: LanceDB 0.27.2
