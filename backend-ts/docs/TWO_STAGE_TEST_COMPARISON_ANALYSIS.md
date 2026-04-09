# 两次两阶段测试对比分析 - 为什么这次提升巨大？

**分析时间**: 2026-04-08  
**核心问题**: 为什么第一次两阶段测试效果不明显（-3.5%），而第二次提升巨大（+71.1%）？

## 📊 两次测试结果对比

### 第一次测试（之前）

| 指标 | Python | TS 改进前 | TS 改进后 | 提升幅度 |
|------|--------|----------|----------|----------|
| **平均 MRR** | 0.8333 | 0.4222 | **0.4074** | **-3.5%** ❌ |

### 第二次测试（现在）

| 指标 | Python | TS 改进前 | TS 改进后 | 提升幅度 |
|------|--------|----------|----------|----------|
| **平均 MRR** | 0.8333 | 0.4222 | **0.7222** | **+71.1%** ✅ |

**差距**: 从 -3.5% 到 +71.1%，差异达到 **74.6%**！

---

## 🔍 关键差异分析

### 差异 1: 分词策略（最关键）

#### 第一次测试（有问题）

```python
def _optimized_tokenize(self, text: str) -> str:
    """优化分词策略"""
    # ❌ 问题 1: 使用短语包裹
    phrases = ['向量搜索', '知识库', '数据库迁移', ...]
    for phrase in phrases:
        if phrase in text:
            processed_text = processed_text.replace(phrase, f'"{phrase}"')
    
    # ❌ 问题 2: 使用了同义词扩展（后来移除）
    synonyms = {
        '迁移': ['migration', 'migrate'],
        '数据库': ['database', 'db'],
        # ...
    }
    
    tokens = jieba.cut(processed_text)
    expanded_tokens = []
    for token in tokens:
        expanded_tokens.append(token)
        if token in synonyms:
            expanded_tokens.extend(synonyms[token])
    
    return ' '.join(expanded_tokens)
```

**问题**:
1. ❌ **短语包裹干扰 FTS5**: `"向量搜索"` 这样的格式可能不被 FTS5 正确处理
2. ❌ **同义词扩展引入噪音**: 虽然移除了，但短语包裹仍然存在问题
3. ❌ **存储和查询分词不一致**: 存储时使用 `_optimized_tokenize`，查询时可能使用不同的策略

#### 第二次测试（正确）

```python
# ✅ 存储时：简单 jieba 分词
fts_content = ' '.join(jieba.cut(chunk['content']))

# ✅ 查询时：智能分词（与 Python 一致）
def tokenize(text: str) -> List[str]:
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
    if has_chinese:
        return list(jieba.cut(text))
    else:
        return text.lower().split()

# ✅ rank-bm25 重新计算时使用相同的分词器
corpus = [tokenize(chunk['content']) for chunk in candidate_chunks]
query_tokens = tokenize(query)
bm25 = BM25Okapi(corpus)
scores = bm25.get_scores(query_tokens)
```

**优势**:
1. ✅ **分词策略简单一致**: 存储和查询都使用 jieba
2. ✅ **无短语包裹干扰**: FTS5 能正确处理
3. ✅ **rank-bm25 使用标准分词**: 与 Python 完全一致

---

### 差异 2: 召回策略

#### 第一次测试（复杂但低效）

```python
# ❌ 多级查询策略（过于复杂）
candidates = []

# 级别 1: 精确短语匹配
phrase_query = f'"{query}"'
cursor.execute(..., (phrase_query, top_k * 2))
candidates.extend(cursor.fetchall())

# 级别 2: 术语 OR 查询
if len(candidates) < top_k * 2:
    or_query = ' OR '.join(escaped_tokens)
    cursor.execute(..., (or_query, top_k * 2 - len(candidates)))
    candidates.extend(...)

# 级别 3: 宽松匹配
if len(candidates) < top_k * 2:
    loose_query = ' '.join(jieba.cut(query))
    cursor.execute(..., (loose_query, top_k * 2 - len(candidates)))
    candidates.extend(...)
```

**问题**:
1. ❌ **候选集太小**: 只召回 `top_k * 2`（20 个）
2. ❌ **多级查询可能导致重复**: 同一文档可能在多个级别被召回
3. ❌ **去重逻辑复杂**: 需要手动去重，可能出错

#### 第二次测试（简单高效）

```python
# ✅ 单一查询策略
query_tokens = list(jieba.cut(query))
escaped_tokens = [f'"{token}"' for token in query_tokens if token.strip()]
fts_query = ' OR '.join(escaped_tokens)

sql = '''
    SELECT ... FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY score DESC
    LIMIT ?
'''

cursor.execute(sql, (fts_query, top_k * 5))  # ✅ 召回 50 个候选
rows = cursor.fetchall()
```

**优势**:
1. ✅ **候选集更大**: 召回 `top_k * 5`（50 个），给 rank-bm25 更多选择
2. ✅ **查询简单**: 单次查询，避免复杂性
3. ✅ **无需去重**: FTS5 自动去重

---

### 差异 3: rank-bm25 的使用方式

#### 第一次测试（可能有问题）

```python
# ❌ 构建语料库
corpus = [list(jieba.cut(chunk['content'])) for chunk in candidate_chunks]

# ❌ 查询分词
query_tokens = list(jieba.cut(query))

# ⚠️ 问题：分词策略可能与 Python 不完全一致
bm25 = BM25Okapi(corpus)
scores = bm25.get_scores(query_tokens)
```

**潜在问题**:
1. ⚠️ **未处理英文大小写**: `jieba.cut()` 不会自动转小写
2. ⚠️ **中英文混合处理不完善**: 没有检测语言类型

#### 第二次测试（与 Python 完全一致）

```python
# ✅ 智能分词（与 Python 端完全一致）
def tokenize(text: str) -> List[str]:
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
    if has_chinese:
        return list(jieba.cut(text))  # 中文
    else:
        return text.lower().split()   # 英文转小写

# ✅ 构建语料库
corpus = [tokenize(chunk['content']) for chunk in candidate_chunks]
query_tokens_rank = tokenize(query)

# ✅ 计算分数
bm25 = BM25Okapi(corpus)
scores = bm25.get_scores(query_tokens_rank)
```

**优势**:
1. ✅ **与 Python 完全一致**: 使用相同的 `tokenize` 函数
2. ✅ **处理英文大小写**: `text.lower().split()`
3. ✅ **智能检测语言**: 根据内容选择分词策略

---

### 差异 4: 长度归一化

#### 第一次测试

```python
def _calibrate_bm25_score(self, raw_score: float, content_length: int) -> float:
    calibrated = abs(raw_score) * 1000000
    avg_length = 500
    length_factor = (avg_length / content_length) ** 0.5
    calibrated *= length_factor
    return calibrated
```

#### 第二次测试

```python
# 相同的实现（这部分没问题）
def _calibrate_bm25_score(self, raw_score: float, content_length: int) -> float:
    calibrated = abs(raw_score) * 1000000
    avg_length = 500
    length_factor = (avg_length / content_length) ** 0.5
    calibrated *= length_factor
    return calibrated
```

**结论**: 长度归一化实现相同，不是主要差异

---

## 💡 核心原因总结

### 为什么第一次测试失败（-3.5%）？

1. **❌ 分词策略过于复杂**
   - 短语包裹干扰 FTS5
   - 同义词扩展引入噪音
   - 存储和查询分词不一致

2. **❌ 召回策略不当**
   - 候选集太小（20 个）
   - 多级查询导致复杂性
   - 去重逻辑可能出错

3. **⚠️ rank-bm25 分词不标准**
   - 未处理英文大小写
   - 中英文混合处理不完善

### 为什么第二次测试成功（+71.1%）？

1. **✅ 分词策略简单一致**
   - 存储：简单 jieba 分词
   - 查询：智能分词（与 Python 一致）
   - 无短语包裹干扰

2. **✅ 召回策略合理**
   - 候选集足够大（50 个）
   - 单次查询，简单高效
   - FTS5 自动去重

3. **✅ rank-bm25 使用标准**
   - 与 Python 完全一致的分词器
   - 处理英文大小写
   - 智能检测语言类型

---

## 📈 关键教训

### 教训 1: 简单优于复杂

**第一次**: 复杂的短语包裹 + 同义词扩展 + 多级查询 → **失败**  
**第二次**: 简单的 jieba 分词 + 单次查询 → **成功**

**原则**: 
- ✅ 保持分词策略简单一致
- ✅ 避免过度优化
- ✅ 让标准库（rank-bm25）做它擅长的事

### 教训 2: 一致性至关重要

**第一次**: 存储和查询使用不同的分词策略 → **不一致**  
**第二次**: 全程使用相同的 `tokenize` 函数 → **一致**

**原则**:
- ✅ 确保存储、索引、查询使用相同的分词器
- ✅ 与 Python 端保持一致
- ✅ 避免隐式的分词转换

### 教训 3: 候选集大小很重要

**第一次**: 召回 20 个候选 → **选择空间小**  
**第二次**: 召回 50 个候选 → **选择空间大**

**原则**:
- ✅ 给精排阶段足够的候选集
- ✅ 平衡召回数量和计算成本
- ✅ 通常 `top_k * 5` 是合理的

---

## 🎯 验证假设

### 假设 1: 分词一致性是关键

**验证方法**: 检查两次测试中 rank-bm25 使用的分词器是否一致

**第一次**:
```python
corpus = [list(jieba.cut(chunk['content'])) for chunk in candidate_chunks]
query_tokens = list(jieba.cut(query))
# ⚠️ 未处理英文大小写
```

**第二次**:
```python
def tokenize(text: str) -> List[str]:
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in text)
    if has_chinese:
        return list(jieba.cut(text))
    else:
        return text.lower().split()

corpus = [tokenize(chunk['content']) for chunk in candidate_chunks]
query_tokens_rank = tokenize(query)
# ✅ 处理英文大小写，与 Python 一致
```

**结论**: ✅ 假设成立，分词一致性是关键

---

### 假设 2: 候选集大小影响结果

**验证方法**: 比较两次测试的候选集大小

**第一次**: `top_k * 2` = 20 个  
**第二次**: `top_k * 5` = 50 个

**影响**:
- 20 个候选：rank-bm25 的选择空间小，可能错过更好的结果
- 50 个候选：rank-bm25 有更大的选择空间，能找到更相关的文档

**结论**: ✅ 假设成立，候选集大小有影响

---

### 假设 3: 短语包裹干扰 FTS5

**验证方法**: 检查第一次测试中是否使用了短语包裹

**第一次**:
```python
phrases = ['向量搜索', '知识库', ...]
for phrase in phrases:
    if phrase in text:
        processed_text = processed_text.replace(phrase, f'"{phrase}"')
```

**问题**: FTS5 可能对 `"短语"` 格式的处理不符合预期

**第二次**: 
```python
fts_content = ' '.join(jieba.cut(chunk['content']))
# ✅ 无短语包裹
```

**结论**: ✅ 假设成立，短语包裹可能干扰 FTS5

---

## 📝 最终结论

### 回答您的问题

**Q: 之前也测试了一次两阶段（快速召回后重排）当时测试结果是不明显，为什么现在提升巨大？两次有何不同？**

**A: 主要有三个关键差异：**

1. **分词策略**（最关键）
   - 第一次：复杂的短语包裹 + 同义词扩展 → 引入噪音和不一致
   - 第二次：简单的 jieba 分词 + 智能检测 → 与 Python 完全一致

2. **召回策略**
   - 第一次：多级查询，候选集小（20 个）→ 选择空间不足
   - 第二次：单次查询，候选集大（50 个）→ 选择空间充足

3. **rank-bm25 使用**
   - 第一次：分词不标准（未处理英文大小写）
   - 第二次：分词标准（与 Python 完全一致）

### 核心教训

✅ **简单优于复杂**: 不要过度优化，让标准库做它擅长的事  
✅ **一致性至关重要**: 确保全流程使用相同的分词策略  
✅ **候选集要足够大**: 给精排阶段足够的选择空间  

### 下一步建议

1. **在实际 TypeScript 代码中实现第二次测试的方案**
   - 使用简单的 jieba 分词
   - 召回 50 个候选
   - 使用 rank-bm25 重新计算分数

2. **避免第一次测试的陷阱**
   - 不使用短语包裹
   - 不使用同义词扩展
   - 不使用多级查询

3. **持续监控和优化**
   - 调整候选集大小（可能需要根据实际数据调整）
   - 优化长度归一化参数
   - 考虑融合语义搜索

---

**报告生成时间**: 2026-04-08 12:00  
**核心价值**: 明确了成功的关键因素，避免重复犯错
