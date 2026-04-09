# 真实文档 BM25 对比测试报告

**测试时间**: 2026-04-08  
**测试数据**: backend/docs 目录下的 30 个 Markdown 文件  
**测试查询**: 6 个典型搜索场景

## 📊 测试概览

### 数据集统计

| 指标 | 数值 |
|------|------|
| 文档总数 | 30 |
| 平均文档长度 | ~5000 字符 |
| 测试查询数 | 6 |
| 总对比点 | 30 (6 queries × Top-5) |

### 测试查询

1. **知识库相关**: "知识库 向量搜索"
2. **BM25 算法**: "BM25 评分 关键词"
3. **数据库迁移**: "数据库 迁移 Alembic"
4. **API 认证**: "JWT 认证 权限"
5. **性能优化**: "性能优化 缓存"
6. **混合搜索**: "混合搜索 hybrid search"

## 🎯 核心结论

### 总体统计

| 指标 | 数值 | 评级 |
|------|------|------|
| **Top-5 一致性** | **3.3%** (1/30) | ❌ 需优化 |
| **平均分数比例** | **0.64x** (TS/Python) | ✅ 基本一致 |
| **召回率** | **100%** (30/30) | ✅ 优秀 |

### 关键发现

#### ✅ 好消息

1. **召回率完美**: 所有查询在两端都能找到匹配的文档
2. **分数比例稳定**: TS 端分数约为 Python 的 0.64 倍，偏差可预测
3. **部分场景一致**: "性能优化"查询 Top-1 完全一致

#### ❌ 主要问题

1. **排名一致性极低**: 30 个对比点中只有 1 个一致 (3.3%)
2. **Top-1 差异大**: 6 个查询中只有 1 个 Top-1 相同
3. **分数绝对值差异**: 某些查询 TS 分数仅为 Python 的 8%

## 📈 详细对比结果

### 查询 1: 知识库相关

**查询词**: "知识库 向量搜索"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | QDRANT_VERIFICATION_REPORT.md | 3.6611 | MEMORY_PROMPT_REFACTOR_REPORT.md | 7.5397 | ❌ |
| 2 | QDRANT_USAGE_GUIDE.md | 3.6416 | FILE_NAMING_NORMALIZATION.md | 3.7910 | ❌ |
| 3 | VECTOR_SEARCH_PARAMS_FIX.md | 3.4903 | IMPROVEMENT_2_SESSION_INJECTION.md | 1.0103 | ❌ |
| 4 | HYBRID_SEARCH_TEST_REPORT.md | 3.3836 | BUSINESS_LOGIC_TESTS_FIXED.md | 0.0356 | ❌ |
| 5 | QDRANT_MIGRATION_SUMMARY.md | 3.3128 | AGENT_SERVICE_CONTEXT_CACHING.md | 0.0356 | ❌ |

**一致性**: 0/5 (0%)  
**分数比例**: 0.68x

**分析**: 
- Python 端倾向于 Qdrant 相关文档
- TS 端倾向于 architecture 子目录的文档
- 可能原因：分词差异导致 IDF 计算不同

### 查询 2: BM25 算法

**查询词**: "BM25 评分 关键词"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | QDRANT_VERIFICATION_REPORT.md | 7.5928 | MEMORY_PROMPT_REFACTOR_REPORT.md | 5.9087 | ❌ |
| 2 | MIXED_SEARCH_SUMMARY.md | 7.4734 | LONG_TERM_MEMORY_METADATA.md | 3.5284 | ❌ |
| 3 | QDRANT_USAGE_GUIDE.md | 7.3263 | LONG_TERM_MEMORY_SIMPLE_DESIGN.md | 3.2951 | ❌ |
| 4 | HYBRID_SEARCH_TEST_REPORT.md | 7.1984 | FAMILIES_DIRECTORY_CLEANUP.md | 2.6941 | ❌ |
| 5 | QDRANT_MIGRATION_SUMMARY.md | 6.1202 | GET_PROMPT_INJECT_PARAMS.md | 0.6391 | ❌ |

**一致性**: 0/5 (0%)  
**分数比例**: 0.44x

**分析**:
- Python 端分数显著更高（约 2.3 倍）
- 排名完全不同，说明 TF-IDF 计算存在系统性差异

### 查询 3: 数据库迁移

**查询词**: "数据库 迁移 Alembic"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | 废弃业务清理总结.md | 3.9365 | AGENT_SERVICE_CONTEXT_CACHING.md | 4.8481 | ❌ |
| 2 | QDRANT_VERIFICATION_REPORT.md | 3.8965 | EXECUTE_CACHE_OPTIMIZATION.md | 3.7167 | ❌ |
| 3 | QDRANT_MIGRATION_SUMMARY.md | 3.8765 | MCP_RESOLVE_ENABLED_FEATURES.md | 3.5999 | ❌ |
| 4 | AGENT_SERVICE_CONTEXT_CACHING.md | 3.8174 | GET_TOOLS_NAMESPACED.md | 3.5975 | ❌ |
| 5 | FAMILIES_DIRECTORY_CLEANUP.md | 3.8135 | MCP_TOOL_MANAGER_MERGE.md | 1.9983 | ❌ |

**一致性**: 0/5 (0%)  
**分数比例**: 0.92x

**分析**:
- 这是分数比例最接近的查询 (0.92x)
- 但排名仍然完全不同
- 说明即使分数接近，排序也可能不同

### 查询 4: API 认证

**查询词**: "JWT 认证 权限"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | BM25_CHINESE_SUPPORT_REPORT.md | 9.8597 | LOCAL_TOOLS_ENABLED_CONFIG.md | 3.2038 | ❌ |
| 2 | EXECUTE_WITH_NAMESPACE.md | 4.9257 | BUSINESS_LOGIC_TESTS_FIXED.md | 0.0712 | ❌ |
| 3 | QDRANT_VERIFICATION_REPORT.md | 2.6995 | IMPROVEMENT_2_SESSION_INJECTION.md | 0.0712 | ❌ |
| 4 | BUSINESS_LOGIC_TESTS_FIXED.md | 2.6980 | FILE_NAMING_NORMALIZATION.md | 0.0712 | ❌ |
| 5 | MIXED_SEARCH_SUMMARY.md | 2.6977 | AGENT_SERVICE_CONTEXT_CACHING.md | 0.0712 | ❌ |

**一致性**: 0/5 (0%)  
**分数比例**: 0.08x ⚠️

**分析**:
- **最差的案例**: TS 分数仅为 Python 的 8%
- TS 端第 2-5 名分数都是 0.0712（可能是最小值）
- 说明某些关键词在 TS 端完全无法匹配

### 查询 5: 性能优化

**查询词**: "性能优化 缓存"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | **EXECUTE_CACHE_OPTIMIZATION.md** | 3.6180 | **EXECUTE_CACHE_OPTIMIZATION.md** | 4.8379 | ✅ |
| 2 | BM25_CHINESE_SUPPORT_REPORT.md | 3.4101 | AGENT_SERVICE_CONTEXT_CACHING.md | 4.4493 | ❌ |
| 3 | QDRANT_MIGRATION_SUMMARY.md | 3.3658 | IMPROVEMENTS_VERIFICATION_COMPLETE.md | 3.3714 | ❌ |
| 4 | MIXED_SEARCH_SUMMARY.md | 3.3268 | MCP_TOOLS_SCHEMA_UNIFIED.md | 3.2675 | ❌ |
| 5 | AGENT_SERVICE_CONTEXT_CACHING.md | 3.3207 | MEMORY_PROMPT_REFACTOR_REPORT.md | 2.9297 | ❌ |

**一致性**: 1/5 (20%) ✅  
**分数比例**: 1.10x

**分析**:
- **唯一 Top-1 一致的查询**！
- 分数比例也最接近 (1.10x)
- 说明当关键词明确时，两端表现良好

### 查询 6: 混合搜索

**查询词**: "混合搜索 hybrid search"

| 排名 | Python 文档 | 分数 | TS 文档 | 分数 | 一致 |
|------|------------|------|---------|------|------|
| 1 | 废弃业务清理总结.md | 6.8939 | MEMORY_PROMPT_REFACTOR_REPORT.md | 5.5484 | ❌ |
| 2 | MIXED_SEARCH_SUMMARY.md | 6.4920 | FILE_NAMING_NORMALIZATION.md | 3.8266 | ❌ |
| 3 | QDRANT_MIGRATION_SUMMARY.md | 5.9616 | LONG_TERM_MEMORY_METADATA.md | 3.1044 | ❌ |
| 4 | QDRANT_VERIFICATION_REPORT.md | 4.3578 | FUNCTION_AUTO_PARSING.md | 2.6773 | ❌ |
| 5 | BM25_CHINESE_SUPPORT_REPORT.md | 4.2582 | FAMILIES_DIRECTORY_CLEANUP.md | 2.3172 | ❌ |

**一致性**: 0/5 (0%)  
**分数比例**: 0.61x

**分析**:
- Python 端分数更高（约 1.6 倍）
- 排名完全不同

## 🔍 根本原因分析

### 1. 分词差异（主要原因）

虽然我们已经修复了大小写问题，但仍可能存在：

#### jieba 版本差异
- **Python**: jieba 0.42.1
- **TypeScript**: @node-rs/jieba 2.0.1

不同版本的 jieba 可能有：
- 不同的默认词典
- 不同的分词算法优化
- 不同的未登录词处理策略

#### 示例对比

```python
# Python jieba
list(jieba.cut("知识库向量搜索"))
# 可能: ['知识库', '向量', '搜索']
```

```typescript
// TypeScript @node-rs/jieba
jieba.cut("知识库向量搜索", true)
// 可能: ['知识', '库', '向量', '搜索'] 或 ['知识库', '向量搜索']
```

**影响**: 
- Token 数量不同 → DF 不同 → IDF 不同
- 最终导致分数和排名差异

### 2. IDF 计算基数

虽然公式相同：
```
IDF = log((N - df + 0.5) / (df + 0.5) + 1)
```

但如果 `df`（文档频率）不同，IDF 就会不同。

**可能原因**:
- 分词粒度不同导致 token 匹配不同
- 某些 token 在一端出现，另一端不出现

### 3. 文档长度归一化

```
denominator = tf + k1 * (1 - b + b * |d|/avgdl)
```

如果两端的 `|d|`（文档长度）计算方式不同：
- Python: 按 token 数
- TypeScript: 按 token 数

理论上应该相同，但实际可能有细微差异。

### 4. 特殊字符处理

Markdown 文件中包含：
- 代码块
- 链接
- 图片
- 表情符号

两端的文本提取逻辑可能不同，导致：
- 某些关键词被移除
- 空格处理不同
- 特殊字符保留与否

## 💡 优化建议

### P0（立即执行）

#### 1. 调试分词差异

添加详细日志，对比两端的分词结果：

```python
# Python
query_tokens = smart_tokenize("知识库 向量搜索")
print(f"Query tokens: {query_tokens}")

for doc in documents[:3]:
    doc_tokens = smart_tokenize(doc['content'][:200])
    print(f"Doc tokens: {doc_tokens[:10]}")
```

```typescript
// TypeScript
const queryTokens = tokenizer.tokenize("知识库 向量搜索");
console.log('Query tokens:', queryTokens);

documents.slice(0, 3).forEach(doc => {
  const docTokens = tokenizer.tokenize(doc.content.substring(0, 200));
  console.log('Doc tokens:', docTokens.slice(0, 10));
});
```

**目标**: 找出具体的分词差异

#### 2. 统一文本预处理

确保两端的 Markdown 提取逻辑完全一致：

```python
# Python
def extract_text(markdown):
    # 统一的预处理步骤
    text = remove_code_blocks(markdown)
    text = remove_links(text)
    text = normalize_whitespace(text)
    return text
```

```typescript
// TypeScript
function extractText(markdown: string): string {
  // 完全相同的预处理步骤
  let text = removeCodeBlocks(markdown);
  text = removeLinks(text);
  text = normalizeWhitespace(text);
  return text;
}
```

### P1（本周）

#### 3. 校准分数

基于测试结果，应用校准因子：

```typescript
// 不同查询的校准因子不同
const calibrationFactors = {
  "知识库相关": 1.47,  // 1/0.68
  "BM25 算法": 2.27,   // 1/0.44
  "数据库迁移": 1.09,  // 1/0.92
  "API 认证": 12.5,    // 1/0.08 (异常值)
  "性能优化": 0.91,    // 1/1.10
  "混合搜索": 1.64,    // 1/0.61
};

// 平均校准因子（排除异常值）
const avgCalibrationFactor = 1.56;  // 1/0.64

const calibratedScore = rawScore * avgCalibrationFactor;
```

**预期效果**: 分数绝对值对齐，但排名可能仍不一致

#### 4. 使用相同版本的 jieba

尝试锁定版本：

```bash
# Python
pip install jieba==0.42.1

# TypeScript
npm install @node-rs/jieba@2.0.1
```

### P2（长期）

#### 5. 替换为专业搜索引擎

对于生产环境，考虑：
- **Elasticsearch**: 成熟的全文搜索引擎
- **Meilisearch**: 轻量级，易部署
- **Typesense**: 快速，支持中文

**优势**:
- 统一的分词和评分逻辑
- 更好的性能
- 更稳定的结果

#### 6. 自定义分词器

针对技术文档，创建自定义词典：

```python
# 添加技术术语
jieba.add_word("Alembic")
jieba.add_word("Qdrant")
jieba.add_word("ChromaDB")
jieba.add_word("BM25")
jieba.add_word("JWT")
```

## 📋 测试质量评估

### 优点

✅ **真实数据**: 使用实际的 Markdown 文档  
✅ **多样化查询**: 覆盖 6 个不同场景  
✅ **完整对比**: 两端都运行，生成详细报告  
✅ **自动化**: 脚本可重复执行  

### 不足

❌ **排名一致性低**: 仅 3.3%，需要深入调试  
❌ **缺少人工验证**: 无法判断哪个结果更"正确"  
❌ **样本量有限**: 仅 30 个文档，6 个查询  

### 改进建议

1. **增加人工标注**: 对每个查询标注"期望的 Top-3"
2. **扩大数据集**: 增加到 100+ 文档
3. **更多查询**: 覆盖 20+ 典型搜索场景
4. **A/B 测试**: 让用户评价两端的搜索结果

## 🎯 最终结论

### 当前状态

| 维度 | 评分 | 说明 |
|------|------|------|
| **功能完整性** | ✅ 优秀 | 两端都能正常工作 |
| **召回率** | ✅ 优秀 | 100% 召回 |
| **排名一致性** | ❌ 差 | 仅 3.3% |
| **分数一致性** | ⚠️ 中等 | 0.64x 比例，但有波动 |
| **实用性** | ⚠️ 中等 | Top-1 有时一致，有时不一致 |

### 是否可用？

**取决于使用场景**:

#### ✅ 可以使用的场景

1. **单后端部署**: 只使用 Python 或只使用 TS
2. **粗略搜索**: 只需要找到相关文档，不关心精确排序
3. **内部工具**: 用户可以接受一定的排序差异

#### ❌ 需要优化的场景

1. **双后端切换**: 需要在 Python 和 TS 之间无缝切换
2. **精确搜索**: 用户期望一致的排序结果
3. **生产环境**: 需要稳定和可预测的行为

### 下一步行动

1. **立即**: 调试分词差异，找出根本原因
2. **本周**: 应用分数校准，统一文本预处理
3. **本月**: 扩大测试集，添加人工标注
4. **季度**: 评估是否需要替换为专业搜索引擎

---

**报告生成时间**: 2026-04-08 11:00  
**下次更新计划**: 实施 P0 优化后重新测试
