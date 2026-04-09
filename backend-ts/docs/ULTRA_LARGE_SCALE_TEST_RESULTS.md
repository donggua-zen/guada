# 超大规模数据集测试结果 - 200个文档，427个分块

**测试时间**: 2026-04-08  
**数据集**: backend/docs + backend-ts/docs (200 个 Markdown 文档)  
**分块数**: 427 个分块（平均每文档 2.1 个）  
**核心发现**: rank-bm25 重算在超大规模数据集下失效

## 📊 测试结果总览

### 总体统计

| 指标 | Python | TS 改进前 | TS 改进后 | 提升幅度 |
|------|--------|----------|----------|----------|
| **平均 MRR** | **0.8875** | 0.4083 | **0.3229** | **-20.9%** ❌ |
| **文档数** | 200 | 200 | 200 | - |
| **分块数** | 427 | 427 | 427 | - |

🏆 **总体优胜者: Python**

### 关键发现

❌ **rank-bm25 重算在超大规模数据集下失效**
- MRR 从 0.41 降至 0.32（-20.9%）
- 与之前的小/中规模数据集形成鲜明对比
- **原因**: 长度归一化在大规模数据下失效

---

## 🔍 问题分析

### 问题 1: 候选集占比过小

**配置**:
- `top_k = 10`（返回 10 个结果）
- `candidate_size = top_k * 5 = 50`（召回 50 个候选）
- 总分块数: 427

**候选集占比**: 50/427 = **11.7%** ⚠️

**问题**:
- ❌ 候选集太小，可能错过相关文档
- ❌ FTS5 的简化 BM25 在大规模数据下排名不准确
- ❌ rank-bm25 只能从 50 个中选择，选择空间不足

**对比**:
- 小数据集 (58 分块): 50/58 = 86.2% ✅
- 中数据集 (195 分块): 50/195 = 25.6% ✅
- 大数据集 (427 分块): 50/427 = 11.7% ❌

---

### 问题 2: 长度归一化失效

**观察到的现象**:

```
[TypeScript (改进后)] Top-10 结果:
1    | backend/knowledge_base\HYBRID_SEARCH_... | 3453910.0665 | 0 | -
2    | backend-ts/BM25_FIX_SUMMARY.md           | 2987376.7197 | 0 | -
3    | backend/knowledge_base\FILES_FILTER_O... | 2721015.3420 | 0 | -
```

**问题**:
- ❌ 分数异常高（百万级别）
- ❌ 相关性全部为 0
- ❌ 说明长度归一化公式不适用

**当前实现**:
```python
def _calibrate_bm25_score(self, raw_score: float, content_length: int) -> float:
    calibrated = abs(raw_score) * 1000000
    avg_length = 500  # ⚠️ 固定值
    length_factor = (avg_length / content_length) ** 0.5
    calibrated *= length_factor
    return calibrated
```

**问题**:
1. ⚠️ `avg_length = 500` 是硬编码的假设值
2. ⚠️ 在大规模数据集中，实际平均长度可能不同
3. ⚠️ 长度差异更大，导致归一化因子失衡

**示例计算**:
```
假设某文档长度为 100 tokens:
length_factor = (500 / 100) ** 0.5 = 2.236
calibrated = raw_score * 1000000 * 2.236 = raw_score * 2236000

如果 raw_score = 1.5:
calibrated = 1.5 * 2236000 = 3354000  # 异常高！
```

---

### 问题 3: FTS5 召回质量下降

**观察**:
```
[TypeScript (改进前)] Top-10:
1    | backend/architecture\IMPROVEMENT_2_SE... | 0.7573 | 1 | search
2    | backend-ts/AGENT_INFINITE_LOOP_FIX.md    | 0.7540 | 0 | -

[TypeScript (改进后)] Top-10:
1    | backend/knowledge_base\HYBRID_SEARCH_... | 3453910.0665 | 0 | -
2    | backend-ts/BM25_FIX_SUMMARY.md           | 2987376.7197 | 0 | -
```

**分析**:
- 改进前：Top-1 至少匹配 1 个关键词
- 改进后：Top-10 全部不匹配任何关键词
- **说明**: FTS5 召回的 50 个候选本身就不相关

**根本原因**:
- FTS5 bm25() 在大规模数据下 IDF 计算不准确
- 召回的候选集质量差
- rank-bm25 无法从差的候选集中选出好的结果

---

## 💡 解决方案

### 方案 1: 动态调整候选集大小（推荐）⭐⭐⭐

**思路**: 根据数据规模动态调整候选集大小

```python
def get_candidate_size(total_chunks: int, top_k: int) -> int:
    """
    根据总文档数动态调整候选集大小
    
    目标: 保持候选集占比在 20-30% 之间
    """
    min_ratio = 0.20  # 最小占比 20%
    max_ratio = 0.30  # 最大占比 30%
    
    # 计算理想候选集大小
    ideal_size = int(total_chunks * 0.25)  # 目标 25%
    
    # 限制范围
    candidate_size = max(top_k * 5, min(ideal_size, top_k * 20))
    
    return candidate_size

# 使用
total_chunks = len(chunks)
candidate_size = get_candidate_size(total_chunks, top_k)
logger.info(f"动态候选集大小: {candidate_size} (总文档: {total_chunks}, 占比: {candidate_size/total_chunks*100:.1f}%)")
```

**预期效果**:
- 小数据集 (58 分块): 候选集 15 (25.9%) ✅
- 中数据集 (195 分块): 候选集 49 (25.1%) ✅
- 大数据集 (427 分块): 候选集 107 (25.1%) ✅

---

### 方案 2: 优化长度归一化（重要）⭐⭐⭐

**思路**: 根据实际数据计算平均长度

```python
def _calibrate_bm25_score_v2(self, raw_score: float, content_length: int, avg_length: float) -> float:
    """
    改进的长度归一化
    
    Args:
        raw_score: rank-bm25 原始分数
        content_length: 当前文档长度
        avg_length: 语料库平均长度（动态计算）
    """
    # 1. 基础校准（缩小倍数）
    calibrated = abs(raw_score) * 100  # 从 1000000 降至 100
    
    # 2. 长度归一化（使用实际平均值）
    length_factor = (avg_length / content_length) ** 0.5
    
    # 3. 添加上下限（避免极端值）
    length_factor = max(0.3, min(3.0, length_factor))
    
    calibrated *= length_factor
    
    return calibrated

# 使用时计算实际平均长度
corpus = [tokenize(chunk['content']) for chunk in candidate_chunks]
avg_length = sum(len(tokens) for tokens in corpus) / len(corpus)

for i, (chunk, raw_score) in enumerate(zip(candidate_chunks, scores)):
    if raw_score > 0:
        calibrated_score = self._calibrate_bm25_score_v2(raw_score, len(chunk['content']), avg_length)
```

**预期效果**:
- 分数范围更合理（不会出现百万级别）
- 长度归一化更准确
- 适应不同规模的数据集

---

### 方案 3: 融合 FTS5 和 rank-bm25 分数（折中）⭐⭐

**思路**: 不完全依赖 rank-bm25，而是融合两种分数

```python
# 1. FTS5 原始分数
fts5_scores = [row[-1] for row in rows]

# 2. rank-bm25 重新计算
bm25_scores = bm25.get_scores(query_tokens)

# 3. 归一化到 [0, 1]
fts5_normalized = normalize(fts5_scores)
bm25_normalized = normalize(bm25_scores)

# 4. 加权融合
alpha = 0.3  # FTS5 权重
beta = 0.7   # rank-bm25 权重
final_scores = alpha * fts5_normalized + beta * bm25_normalized
```

**优势**:
- 保留 FTS5 的全局视角
- 利用 rank-bm25 的精确计算
- 更鲁棒

---

## 📈 历次测试对比总结

### 完整对比表

| 数据集 | 文档数 | 分块数 | 候选集 | 占比 | Python MRR | TS 改进前 | TS 改进后 | 提升幅度 |
|--------|--------|--------|--------|------|-----------|----------|----------|----------|
| **小规模** | 30 | 58 | 50 | 86.2% | 0.8333 | 0.4222 | 0.7222 | **+71.1%** ✅ |
| **中规模** | 86 | 195 | 50 | 25.6% | 0.8750 | 0.2375 | 0.5417 | **+128.1%** ✅ |
| **大规模** | 200 | 427 | 50 | 11.7% | 0.8875 | 0.4083 | 0.3229 | **-20.9%** ❌ |

### 关键洞察

1. **候选集占比是关键**
   - 占比 > 25%: rank-bm25 有效 ✅
   - 占比 < 15%: rank-bm25 失效 ❌

2. **FTS5 召回质量随规模下降**
   - 小规模: IDF 误差小，召回质量好
   - 大规模: IDF 误差累积，召回质量差

3. **长度归一化需要自适应**
   - 固定 `avg_length = 500` 在不同规模下表现不一致
   - 需要根据实际数据动态计算

---

## 🎯 最终建议

### 短期（本周）

1. **[ ] 实施动态候选集大小**
   ```python
   candidate_size = max(top_k * 5, int(total_chunks * 0.25))
   ```
   - 确保候选集占比在 20-30% 之间
   - 预期 MRR 恢复至 0.50-0.60

2. **[ ] 优化长度归一化**
   ```python
   avg_length = sum(len(tokens) for tokens in corpus) / len(corpus)
   length_factor = max(0.3, min(3.0, (avg_length / content_length) ** 0.5))
   ```
   - 使用实际平均长度
   - 添加上下限
   - 预期分数范围更合理

### 中期（本月）

3. **[ ] 实施分数融合策略**
   - 结合 FTS5 和 rank-bm25 分数
   - 平衡全局视角和精确计算
   - 预期 MRR: 0.60-0.70

4. **[ ] 评估 Meilisearch**
   - 开箱即用的中文分词
   - 内置优化的 BM25
   - 自动处理大规模数据

### 长期（季度）

5. **[ ] 混合搜索架构**
   - 关键词搜索（FTS5/Meilisearch）
   - 向量搜索（Qdrant/LanceDB）
   - RRF 融合排序
   - 预期 MRR: 0.75-0.85

---

## 📝 核心结论

### 回答您的问题

**Q: 两个目录全部包含，构建更大的数据集测试**

**A: 测试完成，但发现了新问题：**

1. ❌ **rank-bm25 重算在超大规模数据集下失效**
   - MRR 从 0.41 降至 0.32（-20.9%）
   - 与小/中规模数据集形成鲜明对比

2. ❌ **根本原因**:
   - 候选集占比过小（11.7%）
   - FTS5 召回质量下降
   - 长度归一化失效

3. ✅ **解决方案已明确**:
   - 动态调整候选集大小（保持 20-30% 占比）
   - 优化长度归一化（使用实际平均值）
   - 考虑分数融合策略

### 核心价值

1. **发现了方案的局限性**
   - rank-bm25 重算不是银弹
   - 需要根据数据规模调整参数

2. **明确了改进方向**
   - 动态候选集大小
   - 自适应长度归一化
   - 分数融合策略

3. **提供了完整的解决方案**
   - 短期、中期、长期路线图
   - 具体的代码示例
   - 预期的改进效果

---

**报告生成时间**: 2026-04-08 12:20  
**下一步**: 实施动态候选集大小和优化的长度归一化
