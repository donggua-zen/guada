# 原始分数 vs 校准分数对比分析

**分析时间**: 2026-04-08  
**核心问题**: 为什么 bm25 精排后不使用原始分数而是使用 `_calibrate_bm25_score` 重新计算？

## 📊 实测对比

### Top-1 结果对比

| 查询 | Top-1 (原始分数) | 原始分数 | Top-1 (校准分数) | 校准分数 | 是否相同 |
|------|-----------------|---------|-----------------|---------|---------|
| 知识库相关 | backend-ts/FULL_METADATA_FILTERING.md | 6.2167 | backend/knowledge_base\README.md | 1085.7280 | ❌ **不同** |
| BM25 算法 | backend-ts/BM25_FIX_SUMMARY.md | 9.3466 | backend-ts/BM25_FIX_SUMMARY.md | 1699.1002 | ✅ 相同 |
| 数据库迁移 | backend/knowledge_base\CLEAR_TEMP_TASK_AFTER_UPLOAD.md | 3.9010 | backend/knowledge_base\FRONTEND_FILE_LIST_REFACTOR.md | 789.2228 | ❌ **不同** |
| JWT 认证 | backend-ts/MESSAGES_MODULE_IMPLEMENTATION.md | 8.2083 | backend-ts/BUSINESS_LOGIC_AUDIT_REPORT_V2.md | 721.5771 | ❌ **不同** |
| 性能优化 | backend-ts/OPTIMIZED_LARGE_SCALE_TEST_RESULTS.md | 3.8859 | backend/architecture\MCP_TOOLS_SCHEMA_UNIFICATION.md | 852.2552 | ❌ **不同** |
| 混合搜索 | backend/architecture\TOOL_FAMILIES_ARCHITECTURE.md | 7.2576 | backend-ts/HYBRID_SEARCH_BM25_ANALYSIS.md | 1208.6663 | ❌ **不同** |
| 消息分页 | backend-ts/OPTIMIZED_LARGE_SCALE_TEST_RESULTS.md | 6.9338 | backend-ts/MESSAGE_QUERY_OPTIMIZATION_REPORT.md | 692.9783 | ❌ **不同** |
| SSE 流式响应 | backend-ts/MESSAGES_STREAM_ENDPOINT_ADDED.md | 9.6997 | backend-ts/AGENT_STREAMING_CREATE_EVENT_FIX.md | 803.2260 | ❌ **不同** |

### 关键发现

❌ **8 个查询中，只有 1 个查询的 Top-1 相同（12.5%）**  
✅ **7 个查询的 Top-1 不同（87.5%）**

**说明**: 校准显著影响了排序结果！

---

## 🔍 为什么排序会不同？

### 原因 1: 长度归一化的影响 ⭐⭐⭐

**rank-bm25 原始分数的特点**:
```python
# rank-bm25 内部已经做了长度归一化
score = IDF * (TF * (k1 + 1)) / (TF + k1 * (1 - b + b * |d|/avgdl))

# 其中:
# - |d| = 文档长度
# - avgdl = 语料库平均长度
# - b = 0.75 (默认)
```

**我们的额外校准**:
```python
def _calibrate_bm25_score(self, raw_score: float, content_length: int, avg_length: float) -> float:
    # 1. 基础校准
    calibrated = abs(raw_score) * 100
    
    # 2. 额外的长度归一化
    length_factor = (avg_length / content_length) ** 0.5
    length_factor = max(0.3, min(3.0, length_factor))
    
    calibrated *= length_factor
    
    return calibrated
```

**影响**:
- rank-bm25 已经做了长度归一化（b=0.75）
- 我们又做了一次长度归一化（指数 0.5）
- **双重归一化导致排序变化**

**示例**:
```
文档 A: 长度 500 tokens, raw_score = 5.0
文档 B: 长度 1000 tokens, raw_score = 6.0

rank-bm25 原始排序: B > A (6.0 > 5.0)

校准后:
文档 A: calibrated = 5.0 * 100 * (720/500)^0.5 = 500 * 1.2 = 600
文档 B: calibrated = 6.0 * 100 * (720/1000)^0.5 = 600 * 0.85 = 510

校准后排序: A > B (600 > 510) ❌ 排序反转！
```

---

### 原因 2: 放大倍数的影响 ⭐

**当前实现**:
```python
calibrated = abs(raw_score) * 100
```

**影响**:
- 所有分数都放大 100 倍
- **不会改变相对顺序**（因为都是线性放大）
- 但会影响与 FTS5 分数的融合

---

### 原因 3: 上下限的影响 ⭐⭐

**当前实现**:
```python
length_factor = max(0.3, min(3.0, length_factor))
```

**影响**:
- 极短文档：length_factor 被限制为最大 3.0
- 极长文档：length_factor 被限制为最小 0.3
- **可能改变极端情况下的排序**

**示例**:
```
文档 C: 长度 100 tokens, raw_score = 2.0
文档 D: 长度 5000 tokens, raw_score = 3.0

无上下限时:
文档 C: length_factor = (720/100)^0.5 = 2.68
文档 D: length_factor = (720/5000)^0.5 = 0.38

有上下限时:
文档 C: length_factor = min(3.0, 2.68) = 2.68 (不变)
文档 D: length_factor = max(0.3, 0.38) = 0.38 (不变)

但如果文档更极端:
文档 E: 长度 50 tokens, raw_score = 1.5
文档 F: 长度 10000 tokens, raw_score = 2.0

无上下限时:
文档 E: length_factor = (720/50)^0.5 = 3.79
文档 F: length_factor = (720/10000)^0.5 = 0.27

有上下限时:
文档 E: length_factor = min(3.0, 3.79) = 3.0 ⚠️ 被限制
文档 F: length_factor = max(0.3, 0.27) = 0.3 ⚠️ 被限制
```

---

## 💡 是否需要校准？

### 方案对比

#### 方案 A: 直接使用原始分数

```python
# 直接使用 rank-bm25 原始分数
refined_results = []
for i, (chunk, raw_score) in enumerate(zip(candidate_chunks, scores)):
    if raw_score > 0:
        refined_results.append({
            'chunk_id': chunk['chunk_id'],
            'doc_path': chunk['doc_path'],
            'score': float(raw_score),  # ✅ 原始分数
        })

refined_results.sort(key=lambda x: x['score'], reverse=True)
return refined_results[:top_k]
```

**优点**:
- ✅ 简单直接，无额外计算
- ✅ 保持 rank-bm25 的标准性
- ✅ 无双重归一化问题

**缺点**:
- ❌ 分数范围小（0.1-10），不利于展示
- ❌ 无法与 FTS5 分数融合（FTS5 是负数）
- ❌ 不同查询的分数范围差异大

**适用场景**:
- 仅使用 rank-bm25，不融合其他分数
- 不需要展示分数给用户
- 追求简单和标准性

---

#### 方案 B: 使用校准后的分数（当前方案）

```python
# 使用校准后的分数
refined_results = []
for i, (chunk, raw_score) in enumerate(zip(candidate_chunks, scores)):
    if raw_score > 0:
        calibrated_score = self._calibrate_bm25_score(raw_score, len(chunk['content']), avg_length)
        
        refined_results.append({
            'chunk_id': chunk['chunk_id'],
            'doc_path': chunk['doc_path'],
            'score': float(calibrated_score),  # ✅ 校准分数
        })

refined_results.sort(key=lambda x: x['score'], reverse=True)
return refined_results[:top_k]
```

**优点**:
- ✅ 分数范围统一（正数，范围合理）
- ✅ 便于与 FTS5 分数融合
- ✅ 可以根据实际需求调整归一化强度
- ✅ 易于调试和监控

**缺点**:
- ❌ 多了一层计算
- ❌ 可能存在双重归一化问题
- ❌ 需要维护校准逻辑

**适用场景**:
- 需要融合 FTS5 和 rank-bm25 分数
- 需要展示分数给用户
- 需要根据业务需求调整归一化

---

## 🎯 推荐方案

### 短期建议：移除额外的长度归一化 ⭐⭐⭐

**问题**: 当前的校准函数做了额外的长度归一化，与 rank-bm25 内部的归一化重复

**解决方案**: 只保留放大倍数，移除长度归一化

```python
def _calibrate_bm25_score_v2(self, raw_score: float, content_length: int, avg_length: float = None) -> float:
    """
    简化的分数校准
    
    - 只放大分数，不做额外的长度归一化
    - rank-bm25 内部已经做了长度归一化
    """
    # 只放大分数（使分数在合理范围）
    calibrated = abs(raw_score) * 100
    
    return calibrated
```

**优势**:
- ✅ 避免双重归一化
- ✅ 保持 rank-bm25 的原始排序
- ✅ 分数范围统一（便于融合和展示）
- ✅ 简单明了

**预期效果**: 
- Top-1 结果应该与原始分数一致
- 分数范围从 0.1-10 变为 10-1000

---

### 中期建议：根据实际需求决定是否需要校准 ⭐⭐

**如果只需要 rank-bm25**:
- 直接使用原始分数
- 无需校准

**如果需要融合 FTS5 和 rank-bm25**:
- 使用简化的校准（只放大，不归一化）
- 然后进行分数融合

**如果需要展示分数给用户**:
- 使用简化的校准
- 使分数在合理范围（10-1000）

---

### 长期建议：实施分数融合策略 ⭐⭐⭐

**思路**: 结合 FTS5 的全局视角和 rank-bm25 的精确计算

```python
# 1. FTS5 原始分数
fts5_scores = [row[-1] for row in rows]

# 2. rank-bm25 重新计算（使用原始分数）
bm25_scores = bm25.get_scores(query_tokens)

# 3. 归一化到 [0, 1]
def normalize(scores):
    min_s, max_s = min(scores), max(scores)
    if max_s == min_s:
        return [0.5] * len(scores)
    return [(s - min_s) / (max_s - min_s) for s in scores]

fts5_normalized = normalize([abs(s) for s in fts5_scores])  # FTS5 是负数，取绝对值
bm25_normalized = normalize(bm25_scores)

# 4. 加权融合
alpha = 0.3  # FTS5 权重
beta = 0.7   # rank-bm25 权重
final_scores = [alpha * f + beta * b for f, b in zip(fts5_normalized, bm25_normalized)]
```

**优势**:
- ✅ 结合两种算法的优势
- ✅ 更鲁棒的排序
- ✅ 预期 MRR 提升至 0.55-0.65

---

## 📝 最终结论

### 回答您的问题

**Q: 为什么 bm25 精排后不使用原始分数而是使用 `_calibrate_bm25_score` 重新计算呢？**

**A: 主要有三个原因：**

1. **统一分数范围**（最重要）
   - rank-bm25 返回 0.1-10，FTS5 返回 -0.000001 到 -0.00001
   - 校准后都是正数，范围合理（10-1000）
   - 便于融合和展示

2. **历史遗留问题**
   - 最初是为了修复分数异常（百万级别）而引入的
   - 现在已经优化，但仍然保留

3. **灵活性**
   - 可以根据实际需求调整归一化强度
   - 可以添加业务逻辑（如热门文档加权）

### 但是...

⚠️ **当前的实现有问题**：
- 做了额外的长度归一化，与 rank-bm25 内部的归一化重复
- 导致 87.5% 的查询 Top-1 结果与原始分数不同
- 可能不是最优的排序

### 推荐改进

✅ **短期**：移除额外的长度归一化，只保留放大倍数
```python
def _calibrate_bm25_score_v2(self, raw_score: float, ...) -> float:
    return abs(raw_score) * 100  # 只放大，不归一化
```

✅ **中期**：根据实际需求决定是否需要校准
- 如果只需 rank-bm25：直接使用原始分数
- 如果需要融合：使用简化的校准

✅ **长期**：实施分数融合策略
- 结合 FTS5 和 rank-bm25 的优势
- 预期 MRR 提升至 0.55-0.65

---

**报告生成时间**: 2026-04-08 12:30  
**核心价值**: 明确了校准的目的和问题，提供了改进方向
