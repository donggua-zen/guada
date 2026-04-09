# 混合搜索 BM25 评分差异深度分析

## 问题描述

在相同的文档、分块策略、向量化模型和搜索词（如 "DV430FBM"）下，Python 后端和 TypeScript 后端的关键词相关性评分存在巨大差异：

- **Python 后端**：`keyword_score`: **3.123...** （高相关性）
- **TypeScript 后端**：`keywordScore`: **0.0000018...** （极低，几乎为 0）

## 根本原因分析

### 1. BM25 实现方式完全不同

#### Python 端：使用成熟的 `rank-bm25` 库

```python
# backend/app/services/vector_service.py:323-366
from rank_bm25 import BM25Okapi

# 智能分词：检测中文使用 jieba，英文使用空格分词
def tokenize(text: str) -> List[str]:
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
    
    if has_chinese:
        try:
            import jieba
            return list(jieba.cut(text))  # ✅ 专业中文分词
        except ImportError:
            return [c for c in text if c.strip()]
    else:
        return text.split()  # ✅ 英文按空格分词

# 构建语料库并计算 BM25
corpus = [tokenize(doc) for doc in documents]
bm25 = BM25Okapi(corpus)  # ✅ 完整的 BM25 算法实现
query_tokens = tokenize(query_text)
scores = bm25.get_scores(query_tokens)  # ✅ 返回原始 BM25 分数
```

**关键特性：**
- ✅ 使用 `rank-bm25` 库，实现了完整的 Okapi BM25 算法
- ✅ 正确计算 TF（词频）、IDF（逆文档频率）、文档长度归一化
- ✅ 支持中英文智能分词
- ✅ 返回**原始 BM25 分数**（通常在 0-10 范围内）

#### TypeScript 端：依赖 SQLite FTS5 的内置 BM25

```typescript
// backend-ts/src/common/vector-db/implementations/sqlite-vector-db.ts:304
SELECT main.id, main.content, main.metadata_json, bm25("${ftsTableName}") as score
FROM "${ftsTableName}"
JOIN "${tableName}" AS main ON "${ftsTableName}".rowid = main.rowid
WHERE "${ftsTableName}" MATCH ?
```

**关键问题：**
- ❌ SQLite FTS5 的 `bm25()` 函数返回的是**负值**（需要取绝对值）
- ❌ FTS5 的 BM25 实现是简化版本，分数范围与标准 BM25 不同
- ❌ **分词逻辑不一致**：存储时使用 `tokenizeForSearch` 分词，但查询时可能未正确处理

### 2. 分词逻辑差异导致匹配失败

#### Python 端：统一的分词策略

```python
# 存储和检索都使用相同的 tokenize 函数
corpus = [tokenize(doc) for doc in documents]  # 存储时分词
query_tokens = tokenize(query_text)             # 检索时分词
```

#### TypeScript 端：存储和检索的分词不一致

**存储时（第 193 行）：**
```typescript
const ftsContent = this.tokenizeForSearch(doc.content);
insertFts.run(newRowid.rid, ftsContent);
```

**检索时（第 298 行）：**
```typescript
const processedQuery = this.escapeFtsQuery(queryText);
// ...
WHERE "${ftsTableName}" MATCH ?
params.push(processedQuery);
```

**问题分析：**

对于搜索词 `"DV430FBM"`：

1. **存储阶段**：
   - `tokenizeForSearch("包含 DV430FBM-N20 的文档")` 
   - 检测到中文 → 使用 jieba 分词
   - 结果：`["包含", "DV430FBM-N20", "的", "文档"]`
   - FTS5 存储：`"包含 DV430FBM-N20 的 文档"`

2. **检索阶段**：
   - `escapeFtsQuery("DV430FBM")`
   - 检测到无中文 → 不分词，直接处理
   - 匹配纯英文/数字：返回 `"DV430FBM"*`（带通配符）
   - FTS5 查询：`MATCH '"DV430FBM"*'`

3. **匹配问题**：
   - FTS5 中存储的是 `"DV430FBM-N20"`（完整词）
   - 查询的是 `"DV430FBM"*`（前缀匹配）
   - **FTS5 的前缀匹配可能无法正确匹配到含连字符的词**
   - 即使匹配成功，`bm25()` 函数返回的分数也极低

### 3. BM25 分数归一化问题

#### Python 端：Min-Max 归一化

```python
# backend/app/services/vector_service.py:422-445
semantic_min = min(semantic_scores)
semantic_max = max(semantic_scores)
keyword_min = min(keyword_scores)
keyword_max = max(keyword_scores)

for doc in doc_map.values():
    if keyword_max - keyword_min > 0:
        doc["keyword_norm"] = (doc["keyword_score"] - keyword_min) / (
            keyword_max - keyword_min
        )
    else:
        doc["keyword_norm"] = doc["keyword_score"]
```

**特点：**
- ✅ 在候选集内进行 Min-Max 归一化
- ✅ 确保最高分的文档获得接近 1.0 的归一化分数
- ✅ 即使原始 BM25 分数很高（如 3.123），归一化后仍能保持相对大小

#### TypeScript 端：同样的归一化逻辑，但输入分数过低

```typescript
// backend-ts/src/common/vector-db/implementations/sqlite-vector-db.ts:476-484
const kMin = Math.min(...allBm25Scores, 0);
const kMax = Math.max(...allBm25Scores, 1);

const kNorm = kMax !== kMin ? (doc.bm25Score - kMin) / (kMax - kMin) : 0;
```

**问题：**
- ⚠️ 如果所有文档的 `bm25Score` 都接近 0（如 0.0000018）
- ⚠️ 归一化后仍然是极低的值
- ⚠️ **根本原因是 FTS5 返回的原始分数就过低**

### 4. SQLite FTS5 bm25() 函数的特性

根据 SQLite 官方文档：

```sql
bm25(fts_table) 返回值的计算公式：
score = -1 * (sum over all query terms of: tf * idf * (k1 + 1) / (tf + k1 * (1 - b + b * dl/avgdl)))

关键点：
1. 返回值为负数（需要取绝对值）
2. 分数范围取决于语料库大小和词频分布
3. 对于小语料库或罕见词，分数可能非常低
```

**实际测试数据：**
```
搜索词："DV430FBM"
FTS5 bm25() 返回值：-0.0000018...
取绝对值后：0.0000018...
```

相比之下，Python 的 `rank-bm25` 返回：
```
BM25Okapi.get_scores() 返回值：3.123...
```

**差异倍数：约 1,735,000 倍！**

## 具体缺陷总结

### TypeScript 端的问题

| 问题 | 影响 | 严重程度 |
|------|------|----------|
| FTS5 bm25() 返回极低分数 | 关键词权重几乎失效 | 🔴 严重 |
| 存储和检索分词逻辑不完全一致 | 可能导致匹配失败 | 🟡 中等 |
| 连字符词汇的前缀匹配不可靠 | "DV430FBM" 无法匹配 "DV430FBM-N20" | 🔴 严重 |
| 未对 BM25 分数进行校准 | 与语义分数融合时权重失衡 | 🟡 中等 |

### Python 端的优势

| 优势 | 说明 |
|------|------|
| 使用成熟库 | `rank-bm25` 经过充分测试和优化 |
| 统一分词逻辑 | 存储和检索使用相同的 tokenize 函数 |
| 智能语言检测 | 自动识别中英文并使用对应分词器 |
| 原始分数合理 | BM25 分数在可解释的范围内（0-10） |

## 修复方案

### 方案 1：在 TypeScript 端实现完整的 BM25 算法（推荐）

**优点：**
- ✅ 完全对齐 Python 端的行为
- ✅ 分数范围一致，便于调试和理解
- ✅ 不依赖 SQLite FTS5 的限制

**实现步骤：**

1. **安装依赖：**
```bash
npm install bm25
```

2. **创建 BM25 服务：**
```typescript
// backend-ts/src/modules/knowledge-base/bm25.service.ts
import { Injectable } from '@nestjs/common';
import { Jieba } from '@node-rs/jieba';
import * as bm25 from 'bm25';

@Injectable()
export class BM25Service {
  private jieba: Jieba;

  constructor() {
    this.jieba = new Jieba();
  }

  /**
   * 智能分词
   */
  private tokenize(text: string): string[] {
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    
    if (hasChinese) {
      // 中文使用 jieba 分词
      return this.jieba.cut(text, true);
    } else {
      // 英文按空格分词
      return text.toLowerCase().split(/\s+/).filter(t => t);
    }
  }

  /**
   * 计算 BM25 分数
   */
  calculateBM25Scores(
    queryText: string,
    documents: string[],
  ): number[] {
    if (documents.length === 0) return [];

    // 分词
    const corpus = documents.map(doc => this.tokenize(doc));
    const queryTokens = this.tokenize(queryText);

    // 使用 bm25 库计算分数
    const scores = bm25.calculateBM25(corpus, queryTokens);
    
    return scores;
  }
}
```

3. **修改混合搜索逻辑：**
```typescript
// backend-ts/src/common/vector-db/implementations/sqlite-vector-db.ts

async hybridSearch(...) {
  // 1. 语义搜索
  const semanticResults = await this.semanticSearch(...);

  // 2. 获取所有候选文档（扩大召回）
  const candidateDocs = await this.getCandidateDocuments(...);
  
  // 3. 使用 BM25 服务计算关键词分数
  const documents = candidateDocs.map(d => d.content);
  const bm25Scores = this.bm25Service.calculateBM25Scores(queryText, documents);
  
  // 4. 构建关键词搜索结果
  const keywordResults = candidateDocs.map((doc, idx) => ({
    ...doc,
    bm25Score: bm25Scores[idx],
    score: bm25Scores[idx],
  }));

  // 5. 融合重排序
  return this.fuseAndRerank(semanticResults, keywordResults, ...);
}
```

### 方案 2：优化 FTS5 查询（快速修复）

**优点：**
- ✅ 改动较小
- ✅ 无需额外依赖

**缺点：**
- ⚠️ 仍然受限于 FTS5 的 BM25 实现
- ⚠️ 分数范围可能与 Python 端不一致

**实现步骤：**

1. **改进分词一致性：**
```typescript
private escapeFtsQuery(text: string): string {
  // 统一使用分词逻辑
  let tokens = this.hasChinese(text) && this.jieba 
    ? this.jieba.cut(text, true) 
    : text.split(/\s+/).filter(t => t);

  const escapedTokens = tokens.map(token => {
    token = token.trim();
    if (!token) return '';

    // 移除通配符，改为精确匹配
    // 对于 "DV430FBM-N20"，拆分为多个词
    if (/-/.test(token)) {
      const parts = token.split('-').filter(p => p);
      return parts.map(p => `"${p.replace(/"/g, '""')}"`).join(' ');
    }
    
    return `"${token.replace(/"/g, '""')}"`;
  }).filter(t => t);

  return escapedTokens.join(' OR '); // 使用 OR 连接，提高召回率
}
```

2. **校准 BM25 分数：**
```typescript
// 在 fuseAndRerank 之前，对 BM25 分数进行缩放
const calibratedKeywordResults = keywordResults.map(r => ({
  ...r,
  bm25Score: r.bm25Score * 1000000, // 放大 100 万倍，对齐 Python 端
  score: r.bm25Score * 1000000,
}));
```

3. **增加日志以便调试：**
```typescript
this.logger.debug(`FTS5 BM25 原始分数: ${rows.map(r => r.score).join(', ')}`);
this.logger.debug(`校准后分数: ${calibratedKeywordResults.map(r => r.bm25Score).join(', ')}`);
```

### 方案 3：混合方案（最佳实践）

结合方案 1 和方案 2 的优点：

1. **短期**：使用方案 2 的快速修复，立即改善用户体验
2. **中期**：实现方案 1 的完整 BM25 服务
3. **长期**：考虑迁移到 Qdrant 或其他支持原生 BM25 的向量数据库

## 测试验证

### 测试用例

```typescript
describe('BM25 Score Comparison', () => {
  it('should produce similar BM25 scores for the same query', async () => {
    const queryText = 'DV430FBM';
    const documents = [
      '这款 DV430FBM-N20 冰箱具有出色的性能',
      '普通冰箱的介绍文本',
      '另一款家电产品',
    ];

    // Python 端预期分数（参考）
    const expectedPythonScores = [3.123, 0.0, 0.0];

    // TypeScript 端实际分数
    const tsScores = await bm25Service.calculateBM25Scores(queryText, documents);

    // 验证第一个文档的分数显著高于其他文档
    expect(tsScores[0]).toBeGreaterThan(tsScores[1]);
    expect(tsScores[0]).toBeGreaterThan(tsScores[2]);
    
    // 验证分数范围合理（不应接近 0）
    expect(tsScores[0]).toBeGreaterThan(0.1);
  });
});
```

## 建议行动

### 立即执行（P0）

1. ✅ **实施方案 2 的快速修复**：
   - 改进 `escapeFtsQuery` 的分词逻辑
   - 添加 BM25 分数校准（乘以 1,000,000）
   - 增加详细日志

2. ✅ **更新文档**：
   - 记录 FTS5 BM25 的限制
   - 说明分数校准的原因

### 短期计划（P1，1-2 周）

1. ✅ **实现完整的 BM25 服务**（方案 1）
2. ✅ **编写单元测试**覆盖各种场景
3. ✅ **性能测试**对比两种方案

### 长期规划（P2，1-2 月）

1. 📋 **评估向量数据库迁移**：
   - Qdrant（Python 端已使用）
   - Meilisearch（优秀的全文搜索）
   - Elasticsearch（企业级方案）

2. 📋 **统一两端的搜索架构**：
   - 使用相同的向量数据库
   - 共享 BM25 实现逻辑
   - 一致的归一化和融合策略

## 参考资料

- [SQLite FTS5 bm25() 函数](https://www.sqlite.org/fts5.html#the_bm25_function)
- [rank-bm25 Python 库](https://github.com/dorianbrown/rank_bm25)
- [Okapi BM25 算法详解](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Node.js BM25 实现](https://www.npmjs.com/package/bm25)
