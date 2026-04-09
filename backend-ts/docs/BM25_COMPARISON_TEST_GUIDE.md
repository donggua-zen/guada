# BM25 对比测试使用指南

## 测试结果（2026-04-08）

### 执行状态

✅ **所有测试成功执行**

| 步骤 | 状态 | 说明 |
|------|------|------|
| Python 端测试 | ✅ 成功 | 生成 bm25_python_results.json |
| TypeScript 端测试 | ✅ 成功 | 生成 bm25_ts_results.json |
| 对比分析 | ✅ 成功 | 生成 bm25_comparison_report.json |

### 关键指标

| 指标 | 数值 | 评级 |
|------|------|------|
| 排名正确率 | 100% (5/5) | ✅ 优秀 |
| 平均绝对误差 | 0.284813 | ⚠️ 中等 |
| 平均相对误差 | 23.81% | ❌ 偏高 |
| 排名一致性 | 60% (3/5) | ⚠️ 需优化 |

### 主要发现

1. **连字符词汇问题**: "DV430FBM" 和 "DV430" 得分为 0，需要自定义词典
2. **分数系统性偏差**: TS 端分数约为 Python 的 1.9-2.3 倍
3. **排名基本可靠**: 虽然分数有差异，但 Top-1 通常正确

详细分析报告请查看: [BM25_TEST_EXECUTION_REPORT.md](./BM25_TEST_EXECUTION_REPORT.md)

## 概述

本测试套件用于定量分析 Python 端（`rank-bm25`）与 TypeScript 端（自定义 Okapi BM25 实现）在相同数据下的 BM25 评分差异。

## 测试目标

1. **量化评分差异**：计算两端 BM25 分数的绝对误差和相对误差
2. **验证排名一致性**：检查 Top-K 结果的排序是否一致
3. **识别差异原因**：分析导致分数偏差的技术因素
4. **优化校准策略**：为混合搜索的权重调整提供数据支持

## 快速开始

### Windows 用户

```bash
cd backend-ts
run_bm25_comparison.bat
```

### Linux/Mac 用户

```bash
cd backend-ts
chmod +x run_bm25_comparison.sh
./run_bm25_comparison.sh
```

### 手动执行

#### 步骤 1: 运行 Python 端测试

```bash
cd backend
python tests/verification/test_bm25_diff.py
```

生成文件：`backend/tests/verification/bm25_python_results.json`

#### 步骤 2: 运行 TypeScript 端测试

```bash
cd backend-ts
npx ts-node scripts/compare-bm25.ts
```

生成文件：
- `backend-ts/bm25_ts_results.json`
- `backend-ts/bm25_comparison_report.json`（如果 Python 结果存在）

## 测试用例说明

### 1. 连字符词汇匹配

**查询词**: `"DV430FBM"`

**测试目的**: 验证含连字符的产品型号（如 "DV430FBM-N20"）能否被正确匹配

**预期结果**: 包含完整型号的文档应排名第一

### 2. 中英文混合搜索

**查询词**: `"冰箱 节能"`

**测试目的**: 验证中英文混合查询的分词准确性

**预期结果**: 同时包含"冰箱"和"节能"的中文文档应排名第一

### 3. 纯英文搜索

**查询词**: `"energy saving refrigerator"`

**测试目的**: 验证纯英文查询的处理能力

**预期结果**: 包含所有关键词的英文文档应排名第一

### 4. 短查询词

**查询词**: `"DV430"`

**测试目的**: 验证短查询词的召回能力

**预期结果**: 包含该前缀的文档应排名靠前

### 5. 长查询词

**查询词**: `"节能大容量冰箱推荐"`

**测试目的**: 验证长查询词的精确匹配能力

**预期结果**: 包含所有关键词的文档应排名第一

## 输出文件说明

### bm25_python_results.json

Python 端测试结果，结构如下：

```json
[
  {
    "test_name": "连字符词汇匹配",
    "query": "DV430FBM",
    "num_documents": 5,
    "results": [
      {
        "index": 0,
        "document": "这款 DV430FBM-N20 冰箱具有出色的节能性能...",
        "bm25_score": 3.1234,
        "rank": 1
      }
    ],
    "ranking_correct": true,
    "top_doc_rank": 1
  }
]
```

### bm25_ts_results.json

TypeScript 端测试结果，结构与 Python 端相同。

### bm25_comparison_report.json

对比分析报告，包含详细误差统计：

```json
[
  {
    "test_name": "连字符词汇匹配",
    "query": "DV430FBM",
    "python_scores": [3.1234, 0.0, 0.0, 2.8765, 0.0],
    "ts_scores": [3.0987, 0.0, 0.0, 2.8543, 0.0],
    "absolute_errors": [0.0247, 0.0, 0.0, 0.0222, 0.0],
    "relative_errors": [0.0079, 0.0, 0.0, 0.0077, 0.0],
    "avg_absolute_error": 0.00938,
    "avg_relative_error": 0.00311,
    "ranking_consistent": true,
    "python_top_indices": [0, 3, 1, 2, 4],
    "ts_top_indices": [0, 3, 1, 2, 4]
  }
]
```

## 关键指标解读

### 1. 绝对误差 (Absolute Error)

```
绝对误差 = |Score_Python - Score_TS|
```

- **理想值**: 0（完全一致）
- **可接受范围**: < 0.1
- **说明**: 反映两端的分数差异大小

### 2. 相对误差 (Relative Error)

```
相对误差 = |Score_Python - Score_TS| / |Score_Python|
```

- **理想值**: 0%（完全一致）
- **可接受范围**: < 5%
- **说明**: 反映误差相对于原始分数的比例

### 3. 排名一致性 (Ranking Consistency)

- **✅ 一致**: 两端的 Top-K 排序完全相同
- **❌ 不一致**: 存在排名差异

**重要性**: 即使分数有差异，只要排名一致，对搜索结果影响较小

## 差异原因分析

### 1. IDF 计算基数不同

**Python (rank-bm25)**:
```python
IDF = log((N - df + 0.5) / (df + 0.5) + 1)
```

**TypeScript (自定义实现)**:
```typescript
IDF = Math.log((N - df + 0.5) / (df + 0.5) + 1)
```

**结论**: 公式完全一致，理论上无差异

### 2. 分词粒度微小差异

**Python (jieba)**:
```python
list(jieba.cut("DV430FBM-N20"))
# 可能结果: ['DV430FBM', '-', 'N20'] 或 ['DV430FBM-N20']
```

**TypeScript (@node-rs/jieba)**:
```typescript
jieba.cut("DV430FBM-N20", true)
# 可能结果: ['DV430FBM', 'N20']（忽略标点）
```

**影响**: 分词差异会导致 TF 和 DF 计算不同

### 3. SQLite FTS5 内部实现简化

如果使用 SQLite FTS5 方案（当前已弃用）：
- FTS5 的 `bm25()` 函数使用简化的 BM25 变体
- 分数范围为负值，需要校准
- 已修复：改用自定义 Okapi BM25 实现

### 4. 浮点数精度差异

- Python: 双精度浮点数 (float64)
- TypeScript/JavaScript: 双精度浮点数 (IEEE 754)

**影响**: 极小，通常在 1e-10 级别

## 优化建议

### 如果误差 > 5%

1. **检查分词一致性**
   ```typescript
   // 确保两端使用相同的分词器版本
   // Python: jieba 0.42.1
   // TypeScript: @node-rs/jieba 2.0.1
   ```

2. **调整 BM25 参数**
   ```typescript
   // 尝试不同的 k1 和 b 值
   const scores = calculator.calculateBM25Scores(query, docs, 1.2, 0.75);
   ```

3. **统一预处理逻辑**
   - 去除标点符号
   - 统一大小写
   - 标准化空格

### 如果排名不一致

1. **扩大测试数据集**
   - 增加文档数量
   - 覆盖更多场景

2. **检查边界情况**
   - 空文档
   - 单字符查询
   - 特殊符号

3. **调试单个案例**
   ```typescript
   // 在 compare-bm25.ts 中添加详细日志
   console.log('Query tokens:', queryTokens);
   console.log('Corpus:', corpus);
   console.log('IDF map:', idfMap);
   ```

## 持续集成

### 添加到 CI/CD 流程

```yaml
# .github/workflows/bm25-test.yml
name: BM25 Comparison Test

on:
  push:
    paths:
      - 'backend/app/services/vector_service.py'
      - 'backend-ts/src/modules/knowledge-base/**'

jobs:
  bm25-test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd backend && pip install rank-bm25 jieba
          cd ../backend-ts && npm install
      
      - name: Run BM25 comparison
        run: |
          cd backend-ts
          chmod +x run_bm25_comparison.sh
          ./run_bm25_comparison.sh
      
      - name: Check results
        run: |
          node -e "
            const report = require('./backend-ts/bm25_comparison_report.json');
            const avgRelError = report.reduce((sum, r) => sum + r.avg_relative_error, 0) / report.length;
            if (avgRelError > 0.05) {
              console.error('❌ BM25 相对误差超过 5%');
              process.exit(1);
            }
            console.log('✅ BM25 测试通过');
          "
```

## 常见问题

### Q1: 为什么 Python 和 TS 的分数不完全一致？

**A**: 主要原因包括：
- 分词器版本差异
- 浮点数计算精度
- 库实现的细微差别

只要相对误差 < 5% 且排名一致，即可接受。

### Q2: 如何减小误差？

**A**: 
1. 确保使用相同版本的分词器
2. 统一文本预处理逻辑
3. 调整 BM25 参数 (k1, b)
4. 使用更大的测试数据集

### Q3: 排名不一致怎么办？

**A**: 
1. 检查是否有文档分数非常接近（误差范围内）
2. 分析具体案例的分词差异
3. 考虑引入稳定性排序（如按文档 ID）

### Q4: 测试失败如何调试？

**A**: 
1. 查看生成的 JSON 文件，定位具体测试用例
2. 手动运行单个测试用例，打印中间结果
3. 对比两端的分词结果和 IDF 值

## 参考资料

- [Okapi BM25 算法详解](https://en.wikipedia.org/wiki/Okapi_BM25)
- [rank-bm25 Python 库](https://github.com/dorianbrown/rank_bm25)
- [@node-rs/jieba 文档](https://github.com/napi-rs/node-jieba)
- [BM25 参数调优指南](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-similarity.html)

## 更新日志

### v1.0 (2026-04-08)
- ✅ 初始版本
- ✅ 5 个标准测试用例
- ✅ 完整的对比分析功能
- ✅ 自动化测试脚本
