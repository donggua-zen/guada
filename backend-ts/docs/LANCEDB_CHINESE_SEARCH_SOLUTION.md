# LanceDB 中文搜索解决方案

## 📋 问题背景

LanceDB 的 FTS (Full-Text Search) 基于 **Tantivy**（Rust 编写的搜索引擎库），对中文支持存在限制：

### 测试结果

| 查询类型 | 示例 | FTS 结果 | 说明 |
|---------|------|---------|------|
| 纯英文 | "apple" | ✅ 工作正常 | Tantivy 默认空格分词 |
| 中英混合 | "LanceDB 数据库" | ✅ 部分工作 | 能匹配到英文部分 |
| 纯中文 | "向量数据库" | ❌ 返回空结果 | Tantivy 无法处理连续中文 |

### 根本原因

Tantivy 使用**空格作为默认分词符**，而中文没有空格分隔，导致：
- 单个中文字符被视为一个 token
- 连续的中文字符串无法被正确索引和搜索

---

## 💡 解决方案

### 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **1. 直接使用原文** | 简单 | 对纯中文无效 | ⭐⭐ |
| **2. jieba 分词 + 空格连接** | 理论上可行 | 实际测试失败 | ⭐⭐ |
| **3. FTS + 关键词匹配后备** | 兼容性好 | 性能较差 | ⭐⭐⭐⭐ |
| **4. 集成 Elasticsearch** | 完美支持中文 | 需要额外服务 | ⭐⭐⭐⭐⭐ |

---

## ✅ 推荐方案：FTS + 关键词匹配后备

### 实现思路

```typescript
async keywordSearch(queryText: string): Promise<Result[]> {
  // 1. 先尝试 FTS 搜索
  const ftsResults = await table.search(queryText).toArray();
  
  if (ftsResults.length > 0) {
    return ftsResults; // ✅ FTS 成功
  }
  
  // 2. FTS 失败，使用关键词匹配后备
  if (hasChinese(queryText)) {
    return fallbackKeywordSearch(table, queryText);
  }
  
  return [];
}
```

### 完整实现

```typescript
/**
 * 基于 LanceDB FTS 索引的全文搜索（BM25）
 */
private async keywordSearch(
  knowledgeBaseId: string,
  queryText: string,
  topK: number = 20,
): Promise<Array<Record<string, any>>> {
  const db = await this.getDb();
  const tableName = `kb_${knowledgeBaseId}`;

  try {
    const table = await db.openTable(tableName);

    // ✅ 尝试使用 LanceDB 原生 FTS 搜索
    const ftsResults = await table
      .search(queryText)
      .limit(topK)
      .toArray();

    // 如果 FTS 返回结果，直接使用
    if (ftsResults.length > 0) {
      const formattedResults = ftsResults.map((row: any) => ({
        content: row.content || '',
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        bm25_score: row._score || 0,
      }));
      
      this.logger.log(`FTS 搜索到 ${formattedResults.length} 个匹配分块`);
      return formattedResults;
    }

    // ⚠️ FTS 返回空结果，使用简化的关键词匹配作为后备
    if (this.hasChinese(queryText)) {
      this.logger.debug(`FTS 返回空结果，使用关键词匹配后备方案`);
      return this.fallbackKeywordSearch(table, queryText, topK);
    }

    return [];
  } catch (error: any) {
    this.logger.error(`FTS 搜索失败：${error.message}`);
    return [];
  }
}

/**
 * 简化的关键词匹配（后备方案）
 */
private async fallbackKeywordSearch(
  table: any,
  queryText: string,
  topK: number,
): Promise<Array<Record<string, any>>> {
  try {
    // 获取所有数据（注意：这在大数据集上性能较差）
    const allData = await table.search().limit(1000).toArray();
    
    // 简单的关键词匹配
    const matched = allData.filter((row: any) => {
      const content = row.content || '';
      return content.includes(queryText);
    });

    // 按相关性排序（简单实现：匹配位置越靠前，分数越高）
    const scored = matched.map((row: any) => {
      const content = row.content || '';
      const position = content.indexOf(queryText);
      const score = 1.0 / (position + 1); // 位置越靠前，分数越高
      
      return {
        content: content,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        bm25_score: score,
      };
    });

    // 按分数排序并返回 topK
    scored.sort((a: any, b: any) => b.bm25_score - a.bm25_score);
    const results = scored.slice(0, topK);

    this.logger.log(`关键词匹配找到 ${results.length} 个结果`);
    return results;
  } catch (error: any) {
    this.logger.error(`关键词匹配失败：${error.message}`);
    return [];
  }
}
```

---

## 🔧 备选方案

### 方案 A：集成 Elasticsearch

如果需要完美的中文搜索支持，建议集成 Elasticsearch：

```bash
npm install @elastic/elasticsearch
```

```typescript
import { Client } from '@elastic/elasticsearch';

const esClient = new Client({ node: 'http://localhost:9200' });

// 创建索引时指定中文分词器
await esClient.indices.create({
  index: 'knowledge_base',
  body: {
    mappings: {
      properties: {
        content: {
          type: 'text',
          analyzer: 'ik_max_word', // 使用 IK 中文分词器
        },
      },
    },
  },
});
```

**优点**：
- ✅ 完美的中文分词支持
- ✅ BM25 算法成熟
- ✅ 高性能、可扩展

**缺点**：
- ❌ 需要独立部署 Elasticsearch
- ❌ 增加系统复杂度

---

### 方案 B：使用 Meilisearch

Meilisearch 是轻量级的搜索引擎，对中文支持更好：

```bash
docker run -d --name meilisearch -p 7700:7700 getmeili/meilisearch
```

```typescript
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({ host: 'http://localhost:7700' });

// 添加文档
await client.index('kb').addDocuments([
  { id: 1, content: '向量数据库' },
]);

// 搜索
const results = await client.index('kb').search('向量数据库');
```

**优点**：
- ✅ 开箱即用的中文支持
- ✅ 比 Elasticsearch 更轻量
- ✅ API 简洁易用

**缺点**：
- ❌ 仍需要独立服务

---

## 📊 性能对比

| 方案 | 搜索速度 | 内存占用 | 部署复杂度 | 中文支持 |
|------|---------|---------|-----------|---------|
| LanceDB FTS | ⭐⭐⭐⭐⭐ | 低 | 零依赖 | ⭐⭐ |
| 关键词匹配后备 | ⭐⭐ | 高 | 零依赖 | ⭐⭐⭐ |
| Elasticsearch | ⭐⭐⭐⭐⭐ | 高 | 复杂 | ⭐⭐⭐⭐⭐ |
| Meilisearch | ⭐⭐⭐⭐ | 中 | 中等 | ⭐⭐⭐⭐⭐ |

---

## 🎯 最佳实践建议

### 小规模项目 (< 10,000 条记录)
- ✅ 使用 **LanceDB FTS + 关键词匹配后备**
- 理由：零依赖、简单易用、性能可接受

### 中等规模项目 (10,000 - 100,000 条记录)
- ✅ 使用 **Meilisearch**
- 理由：性能好、中文支持佳、部署相对简单

### 大规模项目 (> 100,000 条记录)
- ✅ 使用 **Elasticsearch**
- 理由：企业级性能、成熟的生态系统

---

## 📝 总结

当前实现的 **LanceDB FTS + 关键词匹配后备** 方案：

✅ **优点**：
- 零外部依赖
- 英文搜索性能优秀
- 中文搜索有基本支持

⚠️ **局限**：
- 纯中文搜索性能较差
- 关键词匹配在大数据集上慢

💡 **未来优化方向**：
1. 集成专门的中文搜索引擎（Elasticsearch/Meilisearch）
2. 使用向量搜索作为主要手段，关键词搜索作为补充
3. 实现混合搜索策略（向量 + 关键词加权）
