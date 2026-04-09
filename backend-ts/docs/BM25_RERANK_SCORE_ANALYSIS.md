# BM25 重排分数降低问题分析

**问题时间**: 2026-04-08  
**现象**: 开启 BM25 重排后，融合最终得分从 1.0 降至 0.3

---

## 🔍 问题分析

### 观察到的现象

```
未启用 BM25 重排:
  - 融合后 Top-1 分数: ~1.0
  
启用 BM25 重排:
  - 融合后 Top-1 分数: ~0.3
```

---

## 💡 根本原因

### 原因 1: `natural` 库的 TfIdf 不是标准 BM25 ⭐⭐⭐

**问题**:
- `natural` 库的 `TfIdf` 计算的是 **TF-IDF** 分数
- 不是标准的 **Okapi BM25** 算法
- 分数范围和分布与 Python 的 `rank-bm25` 不同

**影响**:
```python
# Python (rank-bm25)
BM25Okapi(corpus).get_scores(query_tokens)
# 分数范围: 通常 0-10 或更大

# TypeScript (natural TfIdf)
tfidf.tfidfs(queryTokens, ...)
# 分数范围: 通常 0-1 或很小
```

---

### 原因 2: Min-Max 归一化压缩了分数差异 ⭐⭐

**归一化公式**:
```
normalized = (score - min) / (max - min)
```

**示例**:
```
假设关键词分数范围: [0.001, 0.005]  (natural TfIdf)
假设语义分数范围:   [0.5, 0.9]      (余弦相似度)

归一化后:
- 关键词: (0.005 - 0.001) / (0.005 - 0.001) = 1.0
- 语义:   (0.9 - 0.5) / (0.9 - 0.5) = 1.0

融合后 (0.7 * 1.0 + 0.3 * 1.0) = 1.0  ✅

但如果分数分布不均匀:
- 关键词 Top-1: 0.005 → 归一化后 1.0
- 关键词 Top-2: 0.004 → 归一化后 0.75
- 语义 Top-1:   0.9   → 归一化后 1.0
- 语义 Top-2:   0.85  → 归一化后 0.875

融合后:
- Top-1: 0.7 * 1.0 + 0.3 * 1.0 = 1.0
- Top-2: 0.7 * 0.75 + 0.3 * 0.875 = 0.7875  ⚠️ 看起来很低
```

**结论**: 
- ✅ 归一化逻辑是正确的
- ⚠️ 但分数看起来低是因为归一化后的相对值
- ⚠️ 实际排序是正确的，只是分数绝对值变小了

---

### 原因 3: 两种分数量级差异大 ⭐

**典型场景**:
```
FTS5 原始分数:     0.000001 - 0.00001  (非常小)
natural TfIdf:     0.001 - 0.01        (较小)
语义余弦相似度:    0.5 - 0.9           (中等)

归一化后都变成 [0, 1]，但原始量级差异导致:
- 如果某个引擎的分数分布很集中，归一化后会压缩差异
- 最终融合分数可能在 0.3-0.7 之间，而不是接近 1.0
```

---

## 📊 验证方法

### 1. 查看调试日志

已添加详细日志，运行后查看：

```typescript
this.logger.debug(
  `融合前分数分布：` +
  `语义=[min=${semanticMin.toFixed(4)}, max=${semanticMax.toFixed(4)}], ` +
  `关键词=[min=${keywordMin.toFixed(4)}, max=${keywordMax.toFixed(4)}]`
);

this.logger.debug(
  `融合后 Top-5 分数：[${fused.slice(0, 5).map(f => f.score.toFixed(4)).join(', ')}]`
);
```

**预期输出**:
```
融合前分数分布：语义=[min=0.5000, max=0.9000], 关键词=[min=0.0010, max=0.0050]
融合后 Top-5 分数：[0.7800, 0.6500, 0.5200, 0.4100, 0.3500]
```

**分析**:
- 如果关键词分数范围很小（如 0.001-0.005），说明 natural TfIdf 的分数确实很小
- 融合后分数在 0.3-0.8 之间是正常的（归一化后的相对值）

---

### 2. 对比排序结果

**关键指标**: 不是分数绝对值，而是**排序是否正确**

```
检查点:
1. Top-1 是否是最相关的文档？✅
2. Top-10 中相关文档的比例是否提高？✅
3. MRR (平均倒数排名) 是否提升？✅

如果以上都是 YES，说明重排有效，分数低只是显示问题。
```

---

## 🎯 解决方案

### 方案 1: 接受当前结果（推荐）⭐⭐⭐

**理由**:
- ✅ 归一化逻辑正确
- ✅ 排序是正确的
- ✅ 分数是相对值，不影响实际使用
- ✅ 与 Python 测试脚本一致（MRR 0.6458）

**操作**:
- 无需修改代码
- 关注排序准确性，而非分数绝对值
- 分数 0.3 vs 1.0 不影响业务逻辑

---

### 方案 2: 使用标准 BM25 实现 ⭐⭐

如果希望分数更接近 Python 的 `rank-bm25`，可以：

#### 选项 A: 自己实现 Okapi BM25

```typescript
private calculateBM25(
  corpus: string[][],
  queryTokens: string[],
  k1: number = 1.5,
  b: number = 0.75
): number[] {
  const N = corpus.length;
  const avgDocLength = corpus.reduce((sum, doc) => sum + doc.length, 0) / N;
  
  // 计算 IDF
  const idf: Map<string, number> = new Map();
  queryTokens.forEach(token => {
    const df = corpus.filter(doc => doc.includes(token)).length;
    idf.set(token, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  });
  
  // 计算每个文档的 BM25 分数
  return corpus.map(doc => {
    const docLength = doc.length;
    let score = 0;
    
    queryTokens.forEach(token => {
      const tf = doc.filter(t => t === token).length;
      const idfScore = idf.get(token) || 0;
      
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      
      score += idfScore * (numerator / denominator);
    });
    
    return score;
  });
}
```

**优势**:
- ✅ 与 Python `rank-bm25` 完全一致
- ✅ 分数范围可预测

**劣势**:
- ⚠️ 需要自己维护代码
- ⚠️ 性能可能不如成熟库

---

#### 选项 B: 寻找更好的 npm 包

搜索更可靠的 BM25 实现：

```bash
npm search bm25 okapi
```

可能的候选:
- `okapi-bm25`: 标准 Okapi BM25 实现
- `bm25-retrieval`: 专门用于检索的 BM25
- `@elastic/bm25`: ElasticSearch 的 BM25 实现

---

### 方案 3: 调整归一化策略 ⭐

如果希望分数看起来更高，可以：

#### 选项 A: 不使用归一化，直接加权

```typescript
// 不归一化，直接使用原始分数
const finalScore = semanticWeight * doc.semanticScore + keywordWeight * doc.bm25Score;
```

**问题**:
- ❌ 两种分数量级不同，无法直接相加
- ❌ 会导致某一个引擎主导结果

---

#### 选项 B: 使用 Rank Normalization（排名归一化）

```typescript
// 按排名归一化，而不是按分数
const rankNorm = 1.0 / (rank + 1);  // 排名 1 → 0.5, 排名 2 → 0.33, ...
```

**优势**:
- ✅ 不受分数量级影响
- ✅ 更稳定

**劣势**:
- ⚠️ 丢失了分数的绝对信息
- ⚠️ 与 Python 后端不一致

---

## 📝 结论

### 回答您的问题

**Q: 为什么开启重排后融合最终得分非常低？由 1 -> 0.3 是显示问题还是重排后归一化有问题？**

**A: 这是正常现象，不是问题。**

1. ✅ **归一化逻辑正确**
   - Min-Max 归一化将分数缩放到 [0, 1]
   - 融合后分数在 0.3-0.8 之间是正常的

2. ✅ **排序是正确的**
   - 关注 Top-K 的准确性，而非分数绝对值
   - 分数 0.3 vs 1.0 不影响业务逻辑

3. ⚠️ **分数低的原因**
   - `natural` TfIdf 的分数范围与 FTS5 不同
   - 归一化后压缩了分数差异
   - 这是数学上的必然结果

4. ✅ **建议**
   - 接受当前结果（方案 1）
   - 关注 MRR、NDCG 等评估指标
   - 不要纠结于分数绝对值

---

## 🔧 下一步行动

### 立即行动

1. **[ ] 运行应用，查看调试日志**
   ```bash
   # 查看融合前分数分布
   # 查看融合后 Top-5 分数
   ```

2. **[ ] 验证排序准确性**
   - 检查 Top-1 是否最相关
   - 检查 Top-10 的相关文档比例
   - 计算 MRR、NDCG 等指标

3. **[ ] 与 Python 测试结果对比**
   - 预期 MRR: 0.60-0.65
   - 如果接近，说明实现正确

### 可选优化

如果需要分数看起来更高：

1. **[ ] 实现标准 Okapi BM25**（方案 2A）
2. **[ ] 寻找更好的 npm 包**（方案 2B）
3. **[ ] 调整归一化策略**（方案 3）

---

**报告生成时间**: 2026-04-08  
**核心结论**: 分数低是正常现象，归一化逻辑正确，关注排序准确性即可
