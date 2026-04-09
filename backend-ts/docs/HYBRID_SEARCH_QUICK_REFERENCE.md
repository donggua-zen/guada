# 混合搜索优化 - 快速参考

## 🎯 核心改进

### 1. 扩大召回
- **之前**: `topK * 2`
- **现在**: `topK * 4`（与 Python 后端一致）

### 2. 移除 BM25 校准
- **之前**: 使用固定因子 1000000
- **现在**: 直接使用原始分数（Min-Max 归一化会自动处理量级差异）

### 3. 默认权重调整
- **之前**: 语义 60%，关键词 40%
- **现在**: 语义 30%，关键词 70%（基于测试结果优化）

---

## 📊 测试结果

| 方案 | MRR | 提升幅度 |
|------|-----|----------|
| **纯关键词搜索** | 0.6875 | +68.4% |
| **加权融合（0.7:0.3）** | **0.6458** | **+58.2%** |
| **RRF 融合** | 0.4375 | +7.1% |
| **TS 改进前** | 0.4083 | - |

---

## 🔧 使用方法

### 基本用法（默认权重）

```typescript
const results = await vectorDbService.searchChunksHybrid(
  'kb_xxx',
  queryEmbedding,
  '查询文本',
  5,  // topK
);
// 默认：语义 30%，关键词 70%
```

### 自定义权重

```typescript
// 技术术语查询
const results = await vectorDbService.searchChunksHybrid(
  'kb_xxx',
  queryEmbedding,
  'DV430FBM-N20',
  5,
  0.2,  // 语义权重 20%
  0.8,  // 关键词权重 80%
);

// 概念性查询
const results = await vectorDbService.searchChunksHybrid(
  'kb_xxx',
  queryEmbedding,
  '如何优化性能',
  5,
  0.5,  // 语义权重 50%
  0.5,  // 关键词权重 50%
);
```

---

## 📁 修改文件清单

1. ✅ `src/common/vector-db/implementations/sqlite-vector-db.ts`
   - 优化 `hybridSearch` 方法
   - 优化 `fuseAndRerank` 方法

2. ✅ `src/modules/knowledge-base/kb-search.controller.ts`
   - 更新默认权重配置

3. ✅ `src/common/vector-db/interfaces/vector-database.interface.ts`
   - 更新接口文档

4. ✅ `docs/HYBRID_SEARCH_IMPLEMENTATION_REPORT.md`
   - 完整实施报告

---

## 🎓 融合算法步骤

```
Step 1: 构建文档 ID 映射（去重）
  ↓
Step 2: Min-Max 归一化（缩放到 [0, 1]）
  ↓
Step 3: 加权融合（final_score = α × semantic + β × keyword）
  ↓
Step 4: 排序并返回 Top-K
```

---

## 💡 推荐场景

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| **技术文档搜索** | 加权融合（0.7:0.3） | 平衡准确性和语义理解 |
| **代码/型号搜索** | 纯关键词搜索 | 精确匹配更重要 |
| **概念性查询** | 加权融合（0.5:0.5） | 语义理解更重要 |
| **高性能要求** | 纯关键词搜索 | 无 API 成本，速度快 |

---

## ⚠️ 注意事项

1. **API 成本**: 混合搜索需要调用嵌入 API
2. **延迟**: 比纯关键词搜索慢（需要生成查询嵌入）
3. **权重调整**: 可根据实际业务需求调整权重比例

---

**最后更新**: 2026-04-08  
**详细文档**: [`HYBRID_SEARCH_IMPLEMENTATION_REPORT.md`](./HYBRID_SEARCH_IMPLEMENTATION_REPORT.md)
