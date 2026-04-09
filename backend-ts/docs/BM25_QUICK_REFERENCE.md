# BM25 对比测试 - 快速参考

## 🚀 一键运行

```bash
cd backend-ts
run_bm25_comparison.bat
```

## 📁 文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| Python 测试 | `backend/tests/verification/test_bm25_diff.py` | Python 端 BM25 计算 |
| TS 测试脚本 | `backend-ts/scripts/compare-bm25.ts` | TypeScript 端实现 + 对比 |
| 自动化脚本 | `backend-ts/run_bm25_comparison.bat` | 一键运行工具 |
| 使用指南 | `backend-ts/docs/BM25_COMPARISON_TEST_GUIDE.md` | 详细文档 |
| 实现总结 | `backend-ts/docs/BM25_COMPARISON_TEST_SUMMARY.md` | 技术要点 |

## 📊 输出文件

| 文件 | 内容 |
|------|------|
| `bm25_python_results.json` | Python 端测试结果 |
| `bm25_ts_results.json` | TypeScript 端测试结果 |
| `bm25_comparison_report.json` | 对比分析报告 |

## 🎯 关键指标

| 指标 | 优秀 | 良好 | 需优化 |
|------|------|------|--------|
| 绝对误差 | < 0.01 | < 0.1 | ≥ 0.5 |
| 相对误差 | < 1% | < 5% | ≥ 10% |
| 排名一致性 | 100% | ≥ 80% | < 60% |

## 🔧 常用命令

```bash
# 仅运行 Python 端
cd backend
python tests/verification/test_bm25_diff.py

# 仅运行 TypeScript 端
cd backend-ts
npx ts-node scripts/compare-bm25.ts

# 查看对比报告
node -e "console.log(JSON.stringify(require('./bm25_comparison_report.json'), null, 2))"
```

## ⚠️ 常见问题

### Q: 误差过大怎么办？
A: 检查分词器版本是否一致，调整 BM25 参数 (k1, b)

### Q: 排名不一致怎么办？
A: 检查是否有分数接近的文档，引入稳定性排序

### Q: 如何添加新测试用例？
A: 编辑 `compare-bm25.ts` 中的 `prepareTestCases()` 方法

## 📖 更多信息

- 详细文档: [BM25_COMPARISON_TEST_GUIDE.md](./BM25_COMPARISON_TEST_GUIDE.md)
- 技术分析: [HYBRID_SEARCH_BM25_ANALYSIS.md](./HYBRID_SEARCH_BM25_ANALYSIS.md)
- 修复总结: [BM25_FIX_SUMMARY.md](./BM25_FIX_SUMMARY.md)
