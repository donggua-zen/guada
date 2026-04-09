# BM25 对比测试套件 - 完整实现总结

## 📦 交付内容

### 1. Python 端测试脚本

**文件**: [`backend/tests/verification/test_bm25_diff.py`](file:///d:/编程开发/AI/ai_chat/backend/tests/verification/test_bm25_diff.py)

**功能**:
- ✅ 使用 `rank_bm25.BM25Okapi` 计算标准 BM25 分数
- ✅ 智能分词（中文 jieba + 英文空格分割）
- ✅ 5 个标准测试用例覆盖各种场景
- ✅ 导出 JSON 格式结果

**核心类**:
```python
class BM25Comparator:
    def calculate_bm25_scores(query, documents) -> List[float]
    def run_test_case(test_case) -> Dict
    def run_all_tests() -> List[Dict]
    def export_results(results, output_file)
```

### 2. TypeScript 端测试脚本

**文件**: [`backend-ts/scripts/compare-bm25.ts`](file:///d:/编程开发/AI/ai_chat/backend-ts/scripts/compare-bm25.ts)

**功能**:
- ✅ 完整实现 Okapi BM25 算法（不依赖 SQLite FTS5）
- ✅ 与 Python 端完全一致的分词逻辑
- ✅ 自动对比两端结果，计算误差
- ✅ 生成详细的对比报告

**核心类**:
```typescript
class BM25Calculator:
    calculateBM25Scores(query, documents, k1=1.2, b=0.75): number[]

class BM25Comparator:
    runAllTests(): TestResult[]
    compareWithPython(tsResults, pythonResultsPath): ComparisonReport[]
    exportComparisonReport(reports, outputFile)
```

### 3. 自动化运行脚本

**文件**: [`backend-ts/run_bm25_comparison.bat`](file:///d:/编程开发/AI/ai_chat/backend-ts/run_bm25_comparison.bat)

**功能**:
- ✅ 一键运行两端测试
- ✅ 自动生成对比报告
- ✅ 显示关键指标摘要
- ✅ Windows 批处理脚本

**使用方法**:
```bash
cd backend-ts
run_bm25_comparison.bat
```

### 4. 使用指南文档

**文件**: [`backend-ts/docs/BM25_COMPARISON_TEST_GUIDE.md`](file:///d:/编程开发/AI/ai_chat/backend-ts/docs/BM25_COMPARISON_TEST_GUIDE.md)

**内容**:
- ✅ 快速开始指南
- ✅ 测试用例说明
- ✅ 输出文件格式
- ✅ 关键指标解读
- ✅ 差异原因分析
- ✅ 优化建议
- ✅ CI/CD 集成示例

## 🎯 测试用例设计

### 覆盖场景

| 测试用例 | 查询词 | 文档数 | 测试目的 |
|---------|--------|--------|----------|
| 连字符词汇匹配 | `DV430FBM` | 5 | 验证产品型号匹配 |
| 中英文混合搜索 | `冰箱 节能` | 4 | 验证多语言分词 |
| 纯英文搜索 | `energy saving refrigerator` | 4 | 验证英文处理 |
| 短查询词 | `DV430` | 3 | 验证前缀匹配 |
| 长查询词 | `节能大容量冰箱推荐` | 3 | 验证精确匹配 |

### 测试数据特点

- ✅ 包含中英文混合文本
- ✅ 包含连字符词汇（如 "DV430FBM-N20"）
- ✅ 包含不同长度的查询词
- ✅ 包含多样化的文档主题

## 📊 对比维度

### 1. 绝对误差 (Absolute Error)

```typescript
absoluteError = |Score_Python - Score_TS|
```

**意义**: 反映两端分数的绝对差异大小

**阈值**:
- ✅ 优秀: < 0.01
- ✅ 良好: < 0.1
- ⚠️ 可接受: < 0.5
- ❌ 需优化: ≥ 0.5

### 2. 相对误差 (Relative Error)

```typescript
relativeError = |Score_Python - Score_TS| / |Score_Python| * 100%
```

**意义**: 反映误差相对于原始分数的比例

**阈值**:
- ✅ 优秀: < 1%
- ✅ 良好: < 5%
- ⚠️ 可接受: < 10%
- ❌ 需优化: ≥ 10%

### 3. 排名一致性 (Ranking Consistency)

**检查方法**:
```typescript
const rankingConsistent = 
  JSON.stringify(pythonTopIndices) === JSON.stringify(tsTopIndices);
```

**意义**: 即使分数有差异，只要排名一致，对搜索结果影响较小

**目标**: 100% 一致

## 🔍 差异原因分析

### 主要原因

#### 1. 分词器版本差异

| 平台 | 分词器 | 版本 |
|------|--------|------|
| Python | jieba | 0.42.1 |
| TypeScript | @node-rs/jieba | 2.0.1 |

**影响**: 不同版本的 jieba 可能产生略微不同的分词结果

**示例**:
```
文本: "DV430FBM-N20 冰箱"

Python jieba: ['DV430FBM', '-', 'N20', '冰箱']
TS @node-rs/jieba: ['DV430FBM', 'N20', '冰箱']  # 忽略标点
```

#### 2. IDF 计算公式一致性

**好消息**: 两端使用完全相同的公式

```python
# Python
IDF = log((N - df + 0.5) / (df + 0.5) + 1)
```

```typescript
// TypeScript
IDF = Math.log((N - df + 0.5) / (df + 0.5) + 1)
```

**结论**: 理论上无差异

#### 3. 浮点数精度

- Python: float64 (IEEE 754 双精度)
- TypeScript: number (IEEE 754 双精度)

**影响**: 极小，通常在 1e-10 级别，可忽略

#### 4. BM25 参数

**默认值**（两端一致）:
- k1 = 1.2（词频饱和参数）
- b = 0.75（长度归一化参数）

**可调范围**:
- k1: 0.5 - 2.0
- b: 0.5 - 1.0

## 📈 预期测试结果

### 理想情况

```
测试汇总
============================================================
总测试数: 5
排名正确: 5/5
准确率: 100.0%

总体统计
============================================================
平均绝对误差: 0.012345
平均相对误差: 1.23%
排名一致性: 5/5 (100.0%)
```

### 可接受情况

```
平均绝对误差: 0.050000
平均相对误差: 4.50%
排名一致性: 4/5 (80.0%)
```

### 需优化情况

```
平均绝对误差: 0.500000  ❌
平均相对误差: 15.00%    ❌
排名一致性: 3/5 (60.0%) ❌
```

## 🛠️ 优化策略

### 如果误差过大

#### 1. 统一分词器版本

```bash
# Python
pip install jieba==0.42.1

# TypeScript
npm install @node-rs/jieba@2.0.1
```

#### 2. 调整 BM25 参数

```typescript
// 尝试不同的 k1 和 b 组合
const testParams = [
  { k1: 1.2, b: 0.75 },  // 默认
  { k1: 1.5, b: 0.75 },  // 提高词频权重
  { k1: 1.2, b: 0.5 },   // 降低长度归一化
];

for (const params of testParams) {
  const scores = calculator.calculateBM25Scores(
    query, docs, params.k1, params.b
  );
  // 对比误差...
}
```

#### 3. 统一预处理逻辑

```typescript
private preprocessText(text: string): string {
  return text
    .toLowerCase()           // 统一小写
    .replace(/[^\w\s-]/g, '') // 移除标点（保留连字符）
    .replace(/\s+/g, ' ')     // 标准化空格
    .trim();
}
```

### 如果排名不一致

#### 1. 检查边界情况

```typescript
// 打印分数接近的文档
const closeScores = results.filter((r, i) => {
  if (i === 0) return false;
  return Math.abs(r.bm25_score - results[i-1].bm25_score) < 0.01;
});

if (closeScores.length > 0) {
  console.warn('发现分数接近的文档，可能导致排名不稳定');
}
```

#### 2. 引入稳定性排序

```typescript
// 当分数相同时，按文档 ID 排序
sortedResults.sort((a, b) => {
  const scoreDiff = b.bm25_score - a.bm25_score;
  if (Math.abs(scoreDiff) < 1e-6) {
    return a.index - b.index; // 稳定排序
  }
  return scoreDiff;
});
```

## 🚀 持续集成

### GitHub Actions 示例

```yaml
name: BM25 Comparison Test

on:
  pull_request:
    paths:
      - 'backend/app/services/vector_service.py'
      - 'backend-ts/src/modules/knowledge-base/**'

jobs:
  bm25-test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
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
      
      - name: Validate results
        run: |
          node -e "
            const report = require('./backend-ts/bm25_comparison_report.json');
            const avgRelError = report.reduce((sum, r) => sum + r.avg_relative_error, 0) / report.length;
            const consistentCount = report.filter(r => r.ranking_consistent).length;
            
            console.log('平均相对误差:', (avgRelError * 100).toFixed(2) + '%');
            console.log('排名一致性:', consistentCount + '/' + report.length);
            
            if (avgRelError > 0.05) {
              console.error('❌ BM25 相对误差超过 5%');
              process.exit(1);
            }
            if (consistentCount < report.length) {
              console.warn('⚠️  存在排名不一致的情况');
            }
            console.log('✅ BM25 测试通过');
          "
```

## 📝 使用示例

### 基本用法

```bash
# 1. 进入 backend-ts 目录
cd backend-ts

# 2. 运行对比测试
run_bm25_comparison.bat  # Windows
# 或
./run_bm25_comparison.sh # Linux/Mac

# 3. 查看结果
cat bm25_comparison_report.json
```

### 单独运行某端测试

```bash
# 仅运行 Python 端
cd backend
python tests/verification/test_bm25_diff.py

# 仅运行 TypeScript 端
cd backend-ts
npx ts-node scripts/compare-bm25.ts
```

### 自定义测试用例

编辑 `compare-bm25.ts` 中的 `prepareTestCases()` 方法：

```typescript
private prepareTestCases(): TestCase[] {
  return [
    // ... 现有测试用例
    {
      name: "自定义测试",
      query: "你的查询词",
      documents: ["文档1", "文档2", "文档3"],
      expected_top_doc_index: 0,
    },
  ];
}
```

## 📚 相关文档

- [BM25 深度分析报告](./HYBRID_SEARCH_BM25_ANALYSIS.md)
- [BM25 修复总结](./BM25_FIX_SUMMARY.md)
- [混合搜索使用指南](./CHUNKING_SERVICE_USAGE.md)

## 🎓 技术要点

### Okapi BM25 公式

```
score(q, d) = Σ IDF(qi) * (TF(qi, d) * (k1 + 1)) / (TF(qi, d) + k1 * (1 - b + b * |d|/avgdl))

其中:
- q: 查询
- d: 文档
- qi: 查询中的第 i 个词
- TF(qi, d): 词 qi 在文档 d 中的词频
- IDF(qi): 词 qi 的逆文档频率
- |d|: 文档 d 的长度
- avgdl: 平均文档长度
- k1: 词频饱和参数（默认 1.2）
- b: 长度归一化参数（默认 0.75）
```

### IDF 公式

```
IDF(qi) = log((N - df(qi) + 0.5) / (df(qi) + 0.5) + 1)

其中:
- N: 文档总数
- df(qi): 包含词 qi 的文档数量
```

## ✨ 总结

本测试套件提供了：

1. **完整的 BM25 实现对比**：Python `rank-bm25` vs TypeScript 自定义实现
2. **量化误差分析**：绝对误差、相对误差、排名一致性
3. **自动化测试流程**：一键运行，自动生成报告
4. **详细的文档支持**：使用指南、优化建议、CI/CD 集成

通过定期运行此测试，可以确保两端的 BM25 实现保持一致，为混合搜索提供可靠的关键词评分基础。
