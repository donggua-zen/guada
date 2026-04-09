# 混合搜索（关键词 + 语义）测试结果 - 初步尝试

**测试时间**: 2026-04-08  
**数据集**: backend/docs + backend-ts/docs (200 个 Markdown 文档)  
**分块数**: 427 个分块  
**核心改进**: 添加语义搜索（Qwen3-Embedding-8B）+ RRF 融合

## 📊 测试结果总览

### 总体统计

| 指标 | Python | TS 改进前 | TS 混合搜索 | 提升幅度 |
|------|--------|----------|------------|----------|
| **平均 MRR** | **0.8875** | 0.4083 | **0.4583** | **+12.2%** ⚠️ |
| **文档数** | 200 | 200 | 200 | - |
| **分块数** | 427 | 427 | 427 | - |

🏆 **总体优胜者: Python**

### 关键发现

⚠️ **混合搜索效果不如纯关键词搜索**
- 纯关键词搜索（原始分数）: MRR 0.6875（+68.4%）✅
- 混合搜索（关键词 + 语义）: MRR 0.4583（+12.2%）⚠️
- **下降**: -56.2%

---

## 🔍 问题分析

### 问题 1: 语义搜索未真正实施 ⭐⭐⭐

**当前实现**:
```python
# 为每个候选文档计算语义分数
semantic_scores = []
for chunk in candidate_chunks:
    # ❌ 这里简化处理，实际应该预先计算文档嵌入
    # 为了测试，我们使用 BM25 分数作为代理
    semantic_scores.append(0.5)  # ❌ 占位符，所有文档分数相同
```

**问题**:
- ❌ 所有文档的语义分数都是 0.5（相同）
- ❌ RRF 融合时，语义搜索没有提供任何区分度
- ❌ 实际上只使用了关键词搜索的排序

---

### 问题 2: RRF 融合实现不完整 ⭐⭐⭐

**当前实现**:
```python
def reciprocal_rank_fusion(keyword_results, semantic_results, k=60):
    fused_scores = {}
    
    # 关键词搜索分数
    for rank, result in enumerate(keyword_results):
        chunk_id = result['chunk_id']
        if chunk_id not in fused_scores:
            fused_scores[chunk_id] = 0.0
        fused_scores[chunk_id] += 1.0 / (k + rank + 1)
    
    # ❌ 语义搜索分数（这里简化，实际应该使用真实的语义排序）
    # 由于我们没有预先计算文档嵌入，暂时跳过
    
    return fused_scores

# 执行 RRF 融合
keyword_results = refined_results[:top_k * 2]  # 取前 20 个用于融合
fused_scores = reciprocal_rank_fusion(keyword_results, [])  # ❌ 语义结果为空
```

**问题**:
- ❌ `semantic_results` 参数为空列表
- ❌ RRF 融合实际上只使用了关键词搜索结果
- ❌ 但 RRF 的排名转换改变了原始分数的相对关系

---

### 问题 3: RRF 改变了分数分布 ⭐⭐

**RRF 公式**:
```
RRF(score) = Σ 1 / (k + rank_i)

其中:
- k = 60 (默认)
- rank_i = 第 i 个搜索引擎中的排名
```

**影响**:
```
原始分数（rank-bm25）:
Top-1: 9.5
Top-2: 8.2
Top-3: 7.1
...

RRF 分数:
Top-1: 1/(60+1) = 0.0164
Top-2: 1/(60+2) = 0.0161
Top-3: 1/(60+3) = 0.0159
...
```

**问题**:
- ❌ RRF 压缩了分数差异
- ❌ Top-1 和 Top-10 的分数差异很小
- ❌ 可能导致排序不稳定

---

## 💡 正确的混合搜索实施方案

### 方案 1: 完整的语义搜索 + RRF 融合 ⭐⭐⭐

**步骤**:

1. **预先计算文档嵌入**
   ```python
   # 在加载文档时计算并存储嵌入
   document_embeddings = {}
   for chunk in chunks:
       response = client.embeddings.create(
           model="Qwen/Qwen3-Embedding-8B",
           input=chunk['content'][:500]  # 限制长度
       )
       document_embeddings[chunk['chunk_id']] = response.data[0].embedding
   ```

2. **查询时计算语义相似度**
   ```python
   # 获取查询嵌入
   query_embedding = get_query_embedding(query)
   
   # 计算所有候选文档的余弦相似度
   semantic_scores = []
   for chunk in candidate_chunks:
       doc_embedding = document_embeddings[chunk['chunk_id']]
       similarity = cosine_similarity(query_embedding, doc_embedding)
       semantic_scores.append(similarity)
   
   # 按语义分数排序
   semantic_results = sorted(
       zip(candidate_chunks, semantic_scores),
       key=lambda x: x[1],
       reverse=True
   )
   ```

3. **RRF 融合**
   ```python
   def reciprocal_rank_fusion(keyword_results, semantic_results, k=60):
       fused_scores = {}
       
       # 关键词搜索分数
       for rank, (result, _) in enumerate(keyword_results):
           chunk_id = result['chunk_id']
           if chunk_id not in fused_scores:
               fused_scores[chunk_id] = 0.0
           fused_scores[chunk_id] += 1.0 / (k + rank + 1)
       
       # 语义搜索分数
       for rank, (result, _) in enumerate(semantic_results):
           chunk_id = result['chunk_id']
           if chunk_id not in fused_scores:
               fused_scores[chunk_id] = 0.0
           fused_scores[chunk_id] += 1.0 / (k + rank + 1)
       
       return fused_scores
   
   # 执行融合
   fused_scores = reciprocal_rank_fusion(keyword_results, semantic_results)
   ```

**预期效果**: MRR 从 0.69 提升至 **0.75-0.80**

---

### 方案 2: 加权融合（更简单）⭐⭐

**思路**: 直接加权融合关键词分数和语义分数

```python
# 1. 关键词分数（rank-bm25 原始分数）
keyword_scores = bm25.get_scores(query_tokens)

# 2. 语义分数（余弦相似度）
semantic_scores = [
    cosine_similarity(query_embedding, doc_embeddings[c['chunk_id']])
    for c in candidate_chunks
]

# 3. 归一化到 [0, 1]
keyword_normalized = normalize(keyword_scores)
semantic_normalized = normalize(semantic_scores)

# 4. 加权融合
alpha = 0.6  # 关键词权重
beta = 0.4   # 语义权重
final_scores = [
    alpha * k + beta * s
    for k, s in zip(keyword_normalized, semantic_normalized)
]
```

**优势**:
- ✅ 实现简单
- ✅ 可调整权重
- ✅ 不需要复杂的 RRF 算法

**预期效果**: MRR 从 0.69 提升至 **0.72-0.77**

---

### 方案 3: 级联过滤（性能最优）⭐⭐⭐

**思路**: 先用关键词搜索快速召回，再用语义搜索精排

```python
# 1. 关键词搜索召回 Top-50
keyword_results = keyword_search(query, top_k=50)

# 2. 语义搜索精排 Top-10
semantic_scores = []
for result in keyword_results:
    doc_embedding = document_embeddings[result['chunk_id']]
    similarity = cosine_similarity(query_embedding, doc_embedding)
    semantic_scores.append(similarity)

# 3. 按语义分数排序
refined_results = sorted(
    zip(keyword_results, semantic_scores),
    key=lambda x: x[1],
    reverse=True
)[:top_k]
```

**优势**:
- ✅ 性能好（只对 50 个文档计算语义相似度）
- ✅ 准确性高（语义搜索精排）
- ✅ 实现简单

**预期效果**: MRR 从 0.69 提升至 **0.75-0.80**

---

## 🎯 为什么当前的实现失败了？

### 原因 1: 语义搜索未真正实施

**当前**:
```python
semantic_scores.append(0.5)  # ❌ 所有文档分数相同
```

**应该**:
```python
similarity = cosine_similarity(query_embedding, doc_embedding)
semantic_scores.append(similarity)  # ✅ 真实的语义分数
```

---

### 原因 2: RRF 融合不完整

**当前**:
```python
fused_scores = reciprocal_rank_fusion(keyword_results, [])  # ❌ 语义结果为空
```

**应该**:
```python
fused_scores = reciprocal_rank_fusion(keyword_results, semantic_results)  # ✅ 两者都有
```

---

### 原因 3: RRF 改变了分数分布

**当前**:
```python
# RRF 将原始分数转换为排名倒数
fused_scores[chunk_id] += 1.0 / (k + rank + 1)
```

**问题**:
- 原始分数的差异被压缩
- 可能导致排序不稳定

**解决方案**:
- 使用加权融合代替 RRF
- 或调整 RRF 的 k 参数

---

## 📝 最终结论

### 回答您的问题

**Q: 现在增加语义搜索，并进行融合，查看排序结果**

**A: 当前实现有问题，效果不如纯关键词搜索。**

1. ❌ **语义搜索未真正实施**
   - 所有文档的语义分数都是 0.5（占位符）
   - RRF 融合时，语义搜索没有提供任何区分度

2. ❌ **RRF 融合实现不完整**
   - `semantic_results` 参数为空列表
   - 实际上只使用了关键词搜索的排序
   - 但 RRF 的排名转换改变了原始分数的相对关系

3. ❌ **效果下降**
   - 纯关键词搜索: MRR 0.6875（+68.4%）
   - 混合搜索: MRR 0.4583（+12.2%）
   - **下降**: -56.2%

### 正确的实施方案

**短期（本周）**:
1. **[ ] 预先计算文档嵌入**
   - 使用 Qwen3-Embedding-8B
   - 存储到数据库或缓存

2. **[ ] 实施完整的语义搜索**
   - 计算查询嵌入
   - 计算余弦相似度
   - 按语义分数排序

3. **[ ] 实施 RRF 融合或加权融合**
   - RRF: 更鲁棒，但实现复杂
   - 加权融合: 更简单，易于调整

**中期（本月）**:
4. **[ ] 评估不同融合策略的效果**
   - RRF vs 加权融合
   - 不同的权重配置
   - 不同的 k 参数

5. **[ ] 优化性能**
   - 缓存文档嵌入
   - 批量计算嵌入
   - 使用向量数据库

**长期（季度）**:
6. **[ ] 考虑专业的向量数据库**
   - Qdrant
   - LanceDB
   - Meilisearch（内置向量搜索）

---

## 💡 建议

### 立即行动

1. **回退到纯关键词搜索**
   - 当前 MRR 0.6875 已经很好
   - 与 Python 差距仅 -0.20

2. **正确实施语义搜索**
   - 预先计算文档嵌入
   - 实施完整的 RRF 或加权融合
   - 重新测试

3. **评估 ROI**
   - 语义搜索的计算成本高
   - 需要权衡准确性和性能
   - 可能不值得（如果 MRR 提升不大）

### 投资回报分析

| 方案 | 开发成本 | MRR 提升 | API 成本 | ROI |
|------|----------|----------|----------|-----|
| **纯关键词搜索** | 低 | +68.4% | 无 | ⭐⭐⭐⭐⭐ |
| **混合搜索（正确实施）** | 中 | +5-10% | 高 | ⭐⭐⭐ |
| **专业向量数据库** | 高 | +10-15% | 中 | ⭐⭐⭐⭐ |

**结论**: **纯关键词搜索的 ROI 最高** ⭐⭐⭐⭐⭐

---

**报告生成时间**: 2026-04-08 13:00  
**下一步**: 回退到纯关键词搜索，或正确实施语义搜索
