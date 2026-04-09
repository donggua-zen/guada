# LanceDB FTS 中文分词与 BM25 参数配置深度分析

## 📊 调查结论

### ✅ 核心发现

**版本**: `@lancedb/lancedb@0.27.2`

根据对 TypeScript 类型定义文件 (`indices.d.ts`) 和源码的深入分析，得出以下结论：

---

## 1️⃣ API 支持性分析

### FTS 索引配置选项

LanceDB 的 `Index.fts()` **确实支持**丰富的配置项：

```typescript
interface FtsOptions {
  withPosition?: boolean;           // 是否存储位置信息（默认 true）
  baseTokenizer?: "simple" | "whitespace" | "raw" | "ngram";  // ⭐ 分词器类型
  language?: string;                // ⭐ 语言设置（用于词干提取和停用词）
  maxTokenLength?: number;          // 最大 token 长度
  lowercase?: boolean;              // 是否小写化
  stem?: boolean;                   // 是否启用词干提取
  removeStopWords?: boolean;        // 是否移除停用词
  asciiFolding?: boolean;           // 是否移除标点符号
  ngramMinLength?: number;          // ngram 最小长度
  ngramMaxLength?: number;          // ngram 最大长度
  prefixOnly?: boolean;             // 是否仅索引前缀
}
```

### 使用示例

```typescript
// 当前实现（无配置）
await table.createIndex('content', {
  config: lancedb.Index.fts()
});

// ✅ 可以传入配置
await table.createIndex('content', {
  config: lancedb.Index.fts({
    baseTokenizer: 'simple',  // 或 'whitespace', 'raw', 'ngram'
    language: 'en',            // 或 'zh' (如果支持)
    lowercase: true,
    stem: false,
  })
});
```

---

## 2️⃣ 现有实现对比

### 当前实现的问题

在 `vector.service.ts` 中：

```typescript
// ❌ 当前实现 - 使用默认配置
await table.createIndex('content', {
  config: lancedb.Index.fts()
});
```

**默认行为**：
- `baseTokenizer`: `"simple"` （基于空格和标点符号分词）
- **不支持中文分词**：Tantivy 的 simple tokenizer 无法正确处理连续的中文字符

### 测试结果验证

| 查询类型 | 示例 | FTS 结果 | 原因 |
|---------|------|---------|------|
| 纯英文 | "apple banana" | ✅ 工作正常 | simple tokenizer 按空格分割 |
| 中英混合 | "LanceDB 数据库" | ✅ 部分工作 | 能匹配到 "LanceDB" |
| 纯中文 | "向量数据库" | ❌ 返回空结果 | 连续中文被视为单个 token |

---

## 3️⃣ 关键限制

### ❌ 不支持自定义分词器

**重要发现**：

1. **`baseTokenizer` 仅支持预定义类型**：
   - `"simple"` - 空格 + 标点分词
   - `"whitespace"` - 仅空格分词
   - `"raw"` - 不分词
   - `"ngram"` - ngram 分词

2. **无法注入自定义分词逻辑**：
   - ❌ 不能直接传入 `jieba` 分词函数
   - ❌ 没有 `customTokenizer` 或 `tokenizerFn` 参数
   - ❌ 没有插件机制挂钩到索引构建过程

3. **BM25 参数不可配置**：
   - ❌ 没有 `k1`, `b` 等 BM25 参数暴露
   - ✅ BM25 算法内置于 Tantivy，使用默认参数

---

## 4️⃣ 替代方案评估

### 方案 A：应用层分词 + 空格连接 ⭐⭐⭐⭐⭐ **推荐**

#### 实现思路

在写入 LanceDB **之前**，先使用 `@node-rs/jieba` 对文本进行分词，将分词结果用空格连接后存入 `content` 字段。

#### 代码实现

```typescript
import { Jieba } from '@node-rs/jieba';

const jieba = new Jieba();

// ✅ 写入时分词
async addChunksToCollection(chunks: Chunk[], embeddings: number[][], kbId: string) {
  const data = chunks.map((chunk, index) => ({
    id: `chunk_${index}`,
    vector: embeddings[index],
    // 🔑 关键：分词后用空格连接
    content: this.hasChinese(chunk.content) 
      ? jieba.cut(chunk.content, true).join(' ')
      : chunk.content,
    metadata: JSON.stringify(chunk.metadata || {}),
  }));
  
  await table.add(data);
}

// ✅ 搜索时分词
async keywordSearch(queryText: string) {
  const searchQuery = this.hasChinese(queryText)
    ? jieba.cut(queryText, true).join(' ')
    : queryText;
    
  const results = await table.search(searchQuery).limit(topK).toArray();
  return results;
}
```

#### 优点
- ✅ **完全兼容** LanceDB FTS
- ✅ **零侵入**：不需要修改 LanceDB 内部逻辑
- ✅ **灵活可控**：可以自由选择分词器（jieba、pkuseg 等）
- ✅ **性能优秀**：分词只在写入/查询时执行一次

#### 缺点
- ⚠️ **数据冗余**：`content` 字段存储的是分词后的文本，不是原文
- ⚠️ **需要额外字段**：如果需要保留原文，需新增 `original_content` 字段

#### 改进方案

```typescript
// 同时存储原文和分词结果
const data = chunks.map((chunk, index) => ({
  id: `chunk_${index}`,
  vector: embeddings[index],
  content: chunk.content,                              // 原文（用于展示）
  content_tokens: jieba.cut(chunk.content, true).join(' '),  // 分词结果（用于搜索）
  metadata: JSON.stringify(chunk.metadata || {}),
}));

// 对分词字段创建 FTS 索引
await table.createIndex('content_tokens', {
  config: lancedb.Index.fts({
    baseTokenizer: 'whitespace'  // 因为已经是空格分隔
  })
});

// 搜索时使用分词字段
const results = await table.search(searchQuery).limit(topK).toArray();
```

---

### 方案 B：使用 ngram 分词器 ⭐⭐⭐

#### 实现思路

利用 LanceDB 内置的 `ngram` 分词器，对中文字符进行 ngram 切分。

#### 代码实现

```typescript
await table.createIndex('content', {
  config: lancedb.Index.fts({
    baseTokenizer: 'ngram',
    ngramMinLength: 2,  // 二元分词
    ngramMaxLength: 3,  // 三元分词
  })
});
```

#### 优点
- ✅ **无需外部依赖**
- ✅ **简单快速**

#### 缺点
- ❌ **效果差**：ngram 无法理解语义，会产生大量无效 token
- ❌ **索引膨胀**：ngram 会生成大量 token，占用更多存储空间
- ❌ **精度低**：不如 jieba 等专门的分词器准确

---

### 方案 C：集成 Elasticsearch/Meilisearch ⭐⭐⭐⭐

#### 实现思路

对于需要完美中文支持的场景，引入专门的搜索引擎。

#### 优点
- ✅ **完美的中文支持**
- ✅ **成熟的生态系统**
- ✅ **可配置 BM25 参数**

#### 缺点
- ❌ **增加系统复杂度**
- ❌ **需要独立部署服务**
- ❌ **维护成本高**

---

## 5️⃣ 最佳实践建议

### 🎯 推荐方案：应用层分词 + 双字段存储

```typescript
// Prisma Schema
model KBChunk {
  id              String   @id @default(cuid())
  content         String   // 原文（用于展示）
  contentTokens   String   @map("content_tokens")  // 分词结果（用于搜索）
  // ... 其他字段
}

// VectorService 实现
@Injectable()
export class VectorService {
  private jieba: Jieba;
  
  constructor() {
    this.jieba = new Jieba();
  }
  
  /**
   * 添加分块到集合
   */
  async addChunksToCollection(
    chunks: Array<{ content: string; metadata?: any }>,
    embeddings: number[][],
    knowledgeBaseId: string,
  ): Promise<void> {
    const db = await this.getDb();
    const tableName = `kb_${knowledgeBaseId}`;
    
    // 确保表存在
    await this.ensureTableExists(db, tableName, embeddings[0].length);
    
    const table = await db.openTable(tableName);
    
    // ✅ 准备数据：同时存储原文和分词结果
    const data = chunks.map((chunk, index) => ({
      id: `chunk_${Date.now()}_${index}`,
      vector: embeddings[index],
      content: chunk.content,  // 原文
      content_tokens: this.tokenizeForSearch(chunk.content),  // 分词结果
      metadata: JSON.stringify(chunk.metadata || {}),
    }));
    
    await table.add(data);
    this.logger.log(`成功添加 ${data.length} 个分块`);
  }
  
  /**
   * 为搜索准备文本（分词）
   */
  private tokenizeForSearch(text: string): string {
    if (!this.hasChinese(text)) {
      return text;  // 非中文直接返回
    }
    
    // 中文分词并用空格连接
    const tokens = this.jieba.cut(text, true);
    return tokens.join(' ');
  }
  
  /**
   * 关键词搜索
   */
  private async keywordSearch(
    knowledgeBaseId: string,
    queryText: string,
    topK: number = 20,
  ): Promise<Array<Record<string, any>>> {
    const db = await this.getDb();
    const tableName = `kb_${knowledgeBaseId}`;
    const table = await db.openTable(tableName);
    
    // ✅ 对查询文本分词
    const searchQuery = this.tokenizeForSearch(queryText);
    
    // ✅ 在分词字段上搜索
    const results = await table
      .search(searchQuery)
      .limit(topK)
      .toArray();
    
    return results.map((row: any) => ({
      content: row.content,  // 返回原文
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      bm25_score: row._score || 0,
    }));
  }
}
```

### 配置优化

```typescript
// 创建 FTS 索引时使用 whitespace tokenizer
await table.createIndex('content_tokens', {
  config: lancedb.Index.fts({
    baseTokenizer: 'whitespace',  // 因为我们已经用空格分隔了
    lowercase: false,              // 中文不需要小写化
    stem: false,                   // 中文不需要词干提取
  })
});
```

---

## 6️⃣ 总结

| 特性 | 原生 FTS | 应用层分词 | ngram | Elasticsearch |
|------|---------|-----------|-------|---------------|
| 中文支持 | ❌ 差 | ✅ 优秀 | ⚠️ 一般 | ✅ 完美 |
| 实现复杂度 | 简单 | 中等 | 简单 | 复杂 |
| 性能 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 灵活性 | 低 | 高 | 低 | 高 |
| 依赖 | 无 | jieba | 无 | 独立服务 |
| 推荐度 | ❌ | ✅✅✅ | ⚠️ | ⚠️ |

### 🏆 最终建议

**对于当前项目**：
1. ✅ 采用 **应用层分词 + 双字段存储** 方案
2. ✅ 使用 `@node-rs/jieba` 进行中文分词
3. ✅ 在 `content_tokens` 字段上创建 FTS 索引
4. ✅ 搜索时对查询文本分词，然后在 `content_tokens` 字段上搜索
5. ✅ 返回结果时使用 `content` 字段（原文）

**未来优化方向**：
- 如果数据量超过 100,000 条，考虑迁移到 Meilisearch
- 如果需要更精细的 BM25 调优，考虑 Elasticsearch

---

## 📝 参考资料

- [LanceDB FTS Documentation](https://lancedb.github.io/lancedb/concepts/full_text_search/)
- [Tantivy Tokenizers](https://docs.rs/tantivy/latest/tantivy/tokenizer/)
- [@node-rs/jieba](https://github.com/napi-rs/node-jieba)
