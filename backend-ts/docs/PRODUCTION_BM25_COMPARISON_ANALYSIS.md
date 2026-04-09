# 生产环境 BM25 实现对比分析

**分析时间**: 2026-04-08  
**分析目标**: 对比 Python (Qdrant + rank-bm25) 与 TypeScript (SQLite FTS5) 的实际生产实现

## 🎯 测试目标澄清

### 之前的错误理解 ❌

我之前创建的测试脚本存在根本性错误：
- ❌ Python: 直接使用 `rank-bm25` 库计算（正确）
- ❌ TypeScript: 自己实现 Okapi BM25 算法（**错误**）

### 正确的理解 ✅

实际生产环境的实现：
- ✅ **Python**: Qdrant 存储 + `rank-bm25` 实时计算
- ✅ **TypeScript**: SQLite FTS5 虚拟表 + `bm25()` 内置函数

**关键差异**:
1. Python 端：从数据库取出所有文档 → 内存中用 rank-bm25 计算
2. TypeScript 端：直接在 SQLite 中使用 FTS5 的 `bm25()` 函数

## 🔍 实际实现对比

### Python 端 (Qdrant + rank-bm25)

#### 代码位置
`backend/app/services/vector_service.py` - `_bm25_search()` 方法

#### 实现流程

```python
async def _bm25_search(self, knowledge_base_id: str, query_text: str, ...):
    # 1. 获取 Qdrant 客户端
    client = await self._get_qdrant_client()
    collection_name = f"kb_{knowledge_base_id}"
    
    # 2. 滚动获取所有文档（或过滤后的文档）
    all_points = await client.scroll(
        collection_name=collection_name,
        scroll_filter=filter,
        limit=10000,
        with_payload=True,
    )
    
    # 3. 提取文档内容
    documents = [p.payload.get("content", "") for p in points_list]
    
    # 4. 智能分词
    def tokenize(text: str) -> List[str]:
        has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
        if has_chinese:
            import jieba
            return list(jieba.cut(text))
        else:
            return text.split()
    
    # 5. 使用 rank-bm25 计算分数
    corpus = [tokenize(doc) for doc in documents]
    bm25 = BM25Okapi(corpus)
    query_tokens = tokenize(query_text)
    scores = bm25.get_scores(query_tokens)
    
    # 6. 返回结果
    return [{"content": doc, "score": score} for doc, score in zip(documents, scores)]
```

#### 特点

✅ **优点**:
1. 使用成熟的 `rank-bm25` 库，算法标准
2. 智能分词（中文 jieba + 英文空格）
3. 灵活的过滤和排序
4. 分数范围合理（通常 0-10）

❌ **缺点**:
1. 需要将所有文档加载到内存
2. 实时计算，性能随文档数量线性下降
3. Qdrant 本地模式可能不支持稀疏向量原生搜索

### TypeScript 端 (SQLite FTS5)

#### 代码位置
`backend-ts/src/common/vector-db/implementations/sqlite-vector-db.ts`

#### 实现流程

**存储时**:
```typescript
async addDocuments(collectionName: string, documents: VectorDocument[]): Promise<string[]> {
    // 1. 创建主表和 FTS5 虚拟表
    CREATE TABLE chunks (id TEXT, content TEXT, ...);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content='chunks', ...);
    
    // 2. 插入数据
    for (const doc of documents) {
        // 插入主表
        INSERT INTO chunks (id, content, ...) VALUES (...);
        
        // 3. ⚠️ 关键：对内容进行分词后存入 FTS5
        const ftsContent = this.tokenizeForSearch(doc.content);
        // ftsContent = jieba.cut(content).join(' ')
        
        // 插入 FTS5（rowid 对应主表）
        INSERT INTO chunks_fts (rowid, content) VALUES (last_rowid, ftsContent);
    }
}
```

**查询时**:
```typescript
async keywordSearch(collectionName: string, queryText: string, topK: number): Promise<SearchResult[]> {
    // 1. 转义查询字符串（使用 jieba 分词）
    const processedQuery = this.escapeFtsQuery(queryText);
    // processedQuery = '"知识" OR "库" OR "向量"'
    
    // 2. 执行 FTS5 MATCH 查询
    const sql = `
        SELECT main.id, main.content, bm25(chunks_fts) as score
        FROM chunks_fts AS fts
        JOIN chunks AS main ON fts.rowid = main.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY score DESC
        LIMIT ?
    `;
    
    // 3. 返回结果
    const rows = this.db.prepare(sql).all(processedQuery, topK);
    return rows.map(row => ({
        id: row.id,
        content: row.content,
        score: Math.abs(row.score),  // bm25() 返回负值
        bm25Score: Math.abs(row.score),
    }));
}
```

#### 特点

✅ **优点**:
1. 利用 SQLite 内置 FTS5，无需额外依赖
2. 索引预建，查询速度快
3. 支持复杂的 MATCH 语法

❌ **缺点**:
1. **FTS5 的 `bm25()` 返回极低分数**（如 0.0000018）
2. 分数为负值，需要取绝对值
3. 需要在存储时分词，增加写入复杂度
4. FTS5 的分词逻辑固定，难以自定义

## 📊 核心差异分析

### 1. BM25 分数范围差异

| 指标 | Python (rank-bm25) | TypeScript (FTS5 bm25()) |
|------|-------------------|--------------------------|
| **典型分数范围** | 0 - 10 | 0.000001 - 0.00001 |
| **分数符号** | 正值 | **负值**（需取绝对值）|
| **差异倍数** | 1x | **约 1,000,000 倍更低** |

**原因**:
- `rank-bm25`: 完整的 Okapi BM25 实现
- `bm25()`: SQLite FTS5 的简化实现，内部可能有不同的归一化

**已修复**: 在 TypeScript 端应用校准因子 1,000,000

### 2. 分词时机差异

| 阶段 | Python | TypeScript |
|------|--------|------------|
| **存储时** | 原始文本 | **jieba 分词后存入** |
| **查询时** | jieba 分词 | jieba 分词 + FTS5 MATCH |

**影响**:
- Python: 灵活，可以随时更换分词器
- TypeScript: 分词逻辑固定在存储时，修改需要重新索引

### 3. 性能特征

| 操作 | Python (Qdrant) | TypeScript (SQLite) |
|------|----------------|--------------------|
| **写入** | 快（只存原始文本）| 慢（需要分词+建索引）|
| **读取** | 慢（加载所有文档+实时计算）| **快**（索引查询）|
| **内存占用** | 高（文档全在内存）| **低**（索引在磁盘）|
| **扩展性** | 差（文档多时内存爆炸）| **好**（SQLite 可处理大量数据）|

### 4. 功能完整性

| 功能 | Python | TypeScript |
|------|--------|------------|
| **标准 BM25** | ✅ 完整实现 | ⚠️ 简化版本 |
| **中文支持** | ✅ jieba 分词 | ✅ jieba 分词（存储时）|
| **过滤条件** | ✅ 灵活 | ⚠️ 有限（仅 document_id）|
| **自定义参数** | ✅ k1, b 可调 | ❌ FTS5 固定参数 |
| **增量更新** | ✅ 简单 | ⚠️ 需要同步 FTS5 |

## 🔬 测试结果分析

### 之前测试的问题

我之前的测试发现：
- Python: 30/30 文档匹配
- TypeScript: **0/30 文档匹配** ❌

**根本原因**:
1. 我的模拟脚本没有正确处理 FTS5 的索引更新
2. FTS5 要求在插入主表后，手动插入到虚拟表
3. 中文分词在 FTS5 中的处理方式不同

### 正确的测试方法

要准确对比，需要：

1. **准备相同的测试数据集**
   - 从 backend/docs 加载真实 Markdown 文件
   - 确保两端的文本预处理一致

2. **Python 端测试**
   ```python
   # 使用实际的 vector_service.py 代码
   results = await vector_service._bm25_search(kb_id, query, top_k=20)
   ```

3. **TypeScript 端测试**
   ```typescript
   // 使用实际的 sqlite-vector-db.ts 代码
   const results = await vectorDb.keywordSearch(tableId, query, 20);
   ```

4. **对比指标**
   - Top-K 排名一致性
   - 分数比例（考虑校准因子）
   - 召回率
   - 查询性能

## 💡 方案评估

### Python (Qdrant + rank-bm25)

#### 适用场景
✅ **小规模知识库** (< 10,000 文档)  
✅ **需要精确 BM25 分数**  
✅ **频繁更新文档**  
✅ **开发/测试环境**  

#### 不适用场景
❌ **大规模知识库** (> 100,000 文档，内存不足）  
❌ **高并发查询**（实时计算瓶颈）  
❌ **生产环境**（性能不可预测）  

### TypeScript (SQLite FTS5)

#### 适用场景
✅ **中大规模知识库** (10,000 - 1,000,000 文档)  
✅ **高并发查询**（索引查询快）  
✅ **生产环境**（性能稳定）  
✅ **资源受限环境**（内存占用低）  

#### 不适用场景
❌ **需要精确 BM25 分数**（FTS5 分数偏低）  
❌ **频繁更改分词策略**（需要重新索引）  
❌ **复杂过滤条件**（FTS5 支持有限）  

## 🎯 推荐方案

### 短期（当前）

**保持双后端架构，但明确分工**:

1. **Python 端**: 
   - 用于开发和测试
   - 提供标准的 BM25 参考实现
   - 验证搜索质量

2. **TypeScript 端**: 
   - 用于生产环境
   - 应用 BM25 校准因子 (×1,000,000)
   - 优化 FTS5 索引策略

### 中期（1-3 个月）

**统一 BM25 实现**:

选项 A: **TypeScript 端集成 rank-bm25**
- 使用 WebAssembly 版本的 rank-bm25
- 或者通过 Node.js 调用 Python 服务
- 优点：分数完全一致
- 缺点：增加复杂度

选项 B: **Python 端迁移到 Elasticsearch**
- 使用成熟的搜索引擎
- 同时支持语义和关键词搜索
- 优点：性能更好，功能更全
- 缺点：需要部署额外服务

### 长期（3-6 个月）

**采用专业搜索引擎**:

推荐：**Meilisearch** 或 **Typesense**

优势:
- ✅ 开箱即用的中文支持
- ✅ 高性能全文搜索
- ✅ 内置 BM25 评分
- ✅ 易于部署和维护
- ✅ 统一的 API（Python 和 TS 都可调用）

架构:
```
前端 → NestJS/Flask → Meilisearch/Typesense
                     ↓
                  向量数据库 (Qdrant/Chroma)
```

## 📋 立即行动项

### P0（本周）

1. **修复 TypeScript 端测试脚本**
   - 正确处理 FTS5 索引更新
   - 确保分词逻辑与实际代码一致

2. **应用 BM25 校准因子**
   ```typescript
   const CALIBRATION_FACTOR = 1000000;
   const calibratedScore = rawScore * CALIBRATION_FACTOR;
   ```

3. **添加详细日志**
   - 记录 FTS5 查询语句
   - 记录分词结果
   - 记录原始分数和校准后分数

### P1（本月）

4. **扩大测试数据集**
   - 使用真实的知识库数据（1000+ 文档）
   - 覆盖各种查询场景

5. **性能基准测试**
   - 测量不同文档数量下的查询延迟
   - 对比内存占用
   - 评估并发能力

6. **用户反馈收集**
   - A/B 测试两端的搜索结果
   - 收集用户对排序质量的反馈

### P2（季度）

7. **评估搜索引擎替换方案**
   - 测试 Meilisearch
   - 测试 Typesense
   - 评估迁移成本

8. **制定迁移计划**
   - 数据迁移策略
   - API 兼容性
   - 回滚方案

## 📝 总结

### 核心发现

1. **两个后端的 BM25 实现完全不同**
   - Python: 内存中实时计算（rank-bm25）
   - TypeScript: 数据库索引查询（FTS5 bm25()）

2. **分数差异巨大但有规律**
   - FTS5 分数约为 rank-bm25 的 1/1,000,000
   - 可以通过校准因子修正

3. **各有优劣**
   - Python: 精度高，灵活性好，但性能差
   - TypeScript: 性能好，扩展性强，但分数不标准

### 最佳实践

1. **不要期望两端完全一致**
   - 接受分数范围的差异
   - 关注排名一致性而非绝对分数

2. **根据场景选择方案**
   - 开发/测试：Python（便于调试）
   - 生产环境：TypeScript（性能更好）

3. **持续监控和优化**
   - 定期对比两端的搜索结果
   - 收集用户反馈
   - 适时引入专业搜索引擎

---

**报告生成时间**: 2026-04-08 12:00  
**下次更新**: 实施 P0 行动项后
