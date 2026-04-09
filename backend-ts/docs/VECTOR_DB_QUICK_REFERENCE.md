# 向量数据库快速参考

## 🚀 快速开始

```typescript
import { VectorDbService } from '@/common/vector-db';

@Injectable()
export class MyService {
  constructor(private readonly vectorDb: VectorDbService) {}

  // 1. 添加数据
  async addData() {
    const chunks = [
      {
        id: 'chunk_1',
        content: '内容',
        metadata: { document_id: 'file_001' },
      },
    ];
    const embeddings = [Array(1536).fill(0.1)];
    
    await this.vectorDb.addChunks('my_table', chunks, embeddings);
  }

  // 2. 搜索数据
  async searchData(embedding: number[], query: string) {
    const results = await this.vectorDb.searchChunksHybrid(
      'my_table',
      embedding,
      query,
      5,           // topK
      0.6,         // 语义权重
      0.4,         // 关键词权重
      { document_id: 'file_001' }, // 过滤
    );
  }

  // 3. 删除数据
  async deleteData() {
    // 按 IDs
    await this.vectorDb.deleteChunks('my_table', {
      ids: ['chunk_1'],
    });

    // 按 metadata
    await this.vectorDb.deleteChunks('my_table', {
      filterMetadata: { document_id: 'file_001' },
    });
  }
}
```

---

## 📋 API 速查

### 添加数据

```typescript
addChunks(tableId: string, chunks: VectorChunk[], embeddings: number[][]): Promise<string[]>
```

**参数：**
- `tableId`: 表名
- `chunks`: Chunk 数组 `{id, content, metadata?}`
- `embeddings`: 向量数组

**返回：** 添加的 IDs

---

### 删除数据

```typescript
deleteChunks(tableId: string, options?: {ids?: string[], filterMetadata?: Record}): Promise<number>
```

**参数：**
- `tableId`: 表名
- `options.ids`: 要删除的 IDs（可选）
- `options.filterMetadata`: 过滤条件（可选）
- ⚠️ **至少提供一个参数**

**返回：** 删除的数量

---

### 删除表

```typescript
deleteTable(tableId: string): Promise<boolean>
```

---

### 混合搜索

```typescript
searchChunksHybrid(
  tableId: string,
  queryEmbedding: number[],
  queryText: string,
  topK: number = 5,
  semanticWeight: number = 0.6,
  keywordWeight: number = 0.4,
  filterMetadata?: Record
): Promise<SearchResult[]>
```

**返回：**
```typescript
{
  id: string,
  content: string,
  metadata: Record<string, any>,
  score: number,
  semantic_score?: number,
  bm25_score?: number,
}[]
```

---

### 语义搜索

```typescript
searchChunksSemantic(
  tableId: string,
  queryEmbedding: number[],
  topK: number = 5,
  filterMetadata?: Record
): Promise<SearchResult[]>
```

---

### 关键词搜索

```typescript
searchChunksKeyword(
  tableId: string,
  queryText: string,
  topK: number = 5,
  filterMetadata?: Record
): Promise<SearchResult[]>
```

---

### 其他工具方法

```typescript
// 检查表是否存在
tableExists(tableId: string): Promise<boolean>

// 获取统计信息
getTableStats(tableId: string): Promise<Record<string, any>>
```

---

## 🔍 Metadata 过滤

### 标准字段

```typescript
{ document_id: 'file_001' }
```

### 自定义字段（未来支持）

```typescript
{ __metadata_page: 1 }
```

---

## 💡 常用场景

### RAG 检索

```typescript
const results = await vectorDb.searchChunksHybrid(
  `kb_${kbId}`,
  queryEmbedding,
  queryText,
  5,    // 返回 5 个最相关的
  0.6,  // 语义为主
  0.4,
  fileId ? { document_id: fileId } : undefined, // 可选过滤
);
```

### 文件删除

```typescript
// 删除文件的所有分块
await vectorDb.deleteChunks(`kb_${kbId}`, {
  filterMetadata: { document_id: fileId },
});
```

### 批量更新

```typescript
// 先删除旧的
await vectorDb.deleteChunks(tableId, {
  ids: oldChunkIds,
});

// 再添加新的
await vectorDb.addChunks(tableId, newChunks, newEmbeddings);
```

---

## ⚠️ 注意事项

1. **chunks 和 embeddings 数量必须匹配**
   ```typescript
   if (chunks.length !== embeddings.length) {
     throw new Error('数量不匹配');
   }
   ```

2. **删除时至少提供一个参数**
   ```typescript
   // ❌ 错误
   await vectorDb.deleteChunks(tableId, {});

   // ✅ 正确
   await vectorDb.deleteChunks(tableId, { ids: ['id1'] });
   await vectorDb.deleteChunks(tableId, { filterMetadata: {...} });
   ```

3. **document_id 是推荐的过滤字段**
   ```typescript
   // ✅ 推荐
   metadata: { document_id: 'file_001' }
   
   // ⚠️ 其他字段可能不支持高效过滤
   metadata: { custom_field: 'value' }
   ```

---

## 📦 导入方式

```typescript
// 服务层
import { VectorDbService } from '@/common/vector-db';

// 接口和类型
import { VectorDatabase, VectorChunk, SearchResult } from '@/common/vector-db';

// 具体实现
import { LanceDBVectorDB } from '@/common/vector-db';

// 模块
import { VectorDbModule } from '@/common/vector-db';
```

---

## 🔗 相关链接

- [完整使用指南](./VECTOR_DB_USAGE_GUIDE.md)
- [重构总结](./VECTOR_DB_REFACTORING_SUMMARY.md)
- [Metadata 过滤说明](./LANCEDB_METADATA_FILTERING.md)
