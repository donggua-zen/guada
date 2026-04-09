# FTS5 bm25() 返回值符号验证报告

**测试时间**: 2026-04-08  
**测试文件**: `backend/tests/verification/test_fts5_bm25_sign.py`  
**结论**: ✅ **确认存在隐蔽 Bug**

---

## 🔍 测试结论

### 核心发现

```
✅ FTS5 bm25() 返回负数（越小越相关）
✅ ORDER BY bm25() ASC 是正确的（从小到大，即从最相关到最不相关）
❌ ORDER BY bm25() DESC 是错误的（从大到小，即从最不相关到最相关）
```

---

## 📊 测试结果详情

### 测试数据

```python
查询: 'Python 编程语言'
分词: ['Python', ' ', '编程语言']
FTS5 MATCH: "Python" OR "编程语言"
```

### 测试 1: ORDER BY bm25() ASC（升序）

```
ID    标题                   原始分数          说明
1     Python 教程            -1.485276         负数  ← 最相关
4     Java 基础              -0.000001         负数
2     JavaScript 入门        -0.000001         负数  ← 最不相关
```

**分析**: 
- ✅ Python 教程（包含 "Python"）分数最低（-1.485276），排在最前面
- ✅ 符合预期：bm25() 返回负数，ASC 是从最相关到最不相关

---

### 测试 2: ORDER BY bm25() DESC（降序）

```
ID    标题                   原始分数          说明
2     JavaScript 入门        -0.000001         负数  ← 最不相关
4     Java 基础              -0.000001         负数
1     Python 教程            -1.485276         负数  ← 最相关
```

**分析**: 
- ❌ JavaScript 入门（不包含 "Python"）分数最高（-0.000001），排在最前面
- ❌ Python 教程（包含 "Python"）分数最低（-1.485276），排在最后面
- ❌ **排序完全反了！**

---

### 测试 3: ORDER BY ABS(bm25()) DESC（绝对值降序）

```
ID    标题                   绝对值分数        说明
1     Python 教程            1.485276          ← 最相关
4     Java 基础              0.000001
2     JavaScript 入门        0.000001          ← 最不相关
```

**分析**: 
- ✅ Python 教程绝对值最大（1.485276），排在最前面
- ✅ 符合预期：取绝对值后 DESC 是从最相关到最不相关

---

### 排序顺序对比

```
ASC  顺序: Python 教程 -> Java 基础 -> JavaScript 入门
DESC 顺序: JavaScript 入门 -> Java 基础 -> Python 教程  ❌ 完全相反
ABS  顺序: Python 教程 -> Java 基础 -> JavaScript 入门

✅ ORDER BY bm25() ASC 与 ORDER BY ABS(bm25()) DESC 顺序一致
   → 说明 bm25() 返回负数，ASC 是正确的排序方式
```

---

## 🐛 TypeScript 实现中的 Bug

### 当前代码（sqlite-vector-db.ts）

```typescript
// 第 317 行: SQL 查询
const sql = `
    SELECT ..., bm25(${tableName}_fts) as score
    FROM ${tableName}_fts AS fts
    JOIN ${tableName} AS main ON fts.rowid = main.rowid
    WHERE ${tableName}_fts MATCH ?
    ORDER BY score DESC  ⚠️  BUG: 应该是 ASC 或 ABS(score) DESC
    LIMIT ?
`;

// 第 330 行: 处理分数
score: Math.abs(row.score || 0),  // ✅ 取了绝对值，但排序已经错了
```

---

### Bug 分析

#### 问题流程

```
1. FTS5 bm25() 返回负数:
   - Python 教程: -1.485276 (最相关)
   - Java 基础:   -0.000001
   - JavaScript:  -0.000001 (最不相关)

2. ORDER BY score DESC 排序:
   - 按从大到小: -0.000001, -0.000001, -1.485276
   - 结果: JavaScript, Java, Python  ❌ 完全反了

3. Math.abs() 取绝对值:
   - |-0.000001| = 0.000001
   - |-1.485276| = 1.485276
   - 但排序已经是错的，绝对值无法纠正  ❌

最终结果:
- Top-1: JavaScript (最不相关)  ❌
- Top-2: Java
- Top-3: Python (最相关)  ❌
```

---

### 影响范围

这个 Bug 会影响所有使用关键词搜索的功能：

1. ❌ **知识库搜索**: 返回的结果按相关性倒序排列
2. ❌ **工具调用**: 知识库检索工具返回错误的结果
3. ❌ **混合搜索**: 关键词部分的结果是错误的，影响融合效果

---

## 💡 修复方案

### 方案 A: 改为 ORDER BY score ASC（推荐）⭐⭐⭐

```typescript
const sql = `
    SELECT ..., bm25(${tableName}_fts) as score
    FROM ${tableName}_fts AS fts
    JOIN ${tableName} AS main ON fts.rowid = main.rowid
    WHERE ${tableName}_fts MATCH ?
    ORDER BY score ASC  -- ✅ 改为 ASC，bm25() 返回负数，ASC 是从最相关到最不相关
    LIMIT ?
`;

// 保持 Math.abs() 不变，用于显示正数分数
score: Math.abs(row.score || 0),
```

**优势**:
- ✅ 最小改动，只改一个关键字（DESC → ASC）
- ✅ 逻辑清晰：bm25() 返回负数，ASC 是从小到大（即从最相关到最不相关）
- ✅ 与 SQLite FTS5 官方文档一致

---

### 方案 B: 在 SQL 中取绝对值

```typescript
const sql = `
    SELECT ..., ABS(bm25(${tableName}_fts)) as score
    FROM ${tableName}_fts AS fts
    JOIN ${tableName} AS main ON fts.rowid = main.rowid
    WHERE ${tableName}_fts MATCH ?
    ORDER BY score DESC  -- ✅ 现在可以正确地从大到小排序
    LIMIT ?
`;

// 不需要再取绝对值
score: row.score || 0,
```

**优势**:
- ✅ DESC 更符合直觉（分数越大越相关）
- ✅ 不需要在应用层取绝对值

**劣势**:
- ⚠️ 需要修改两处（SQL 和应用层）

---

### 方案 C: 同时修改 SQL 和应用层（最清晰）

```typescript
const sql = `
    SELECT ..., bm25(${tableName}_fts) as raw_score
    FROM ${tableName}_fts AS fts
    JOIN ${tableName} AS main ON fts.rowid = main.rowid
    WHERE ${tableName}_fts MATCH ?
    ORDER BY raw_score ASC  -- ✅ ASC 排序
    LIMIT ?
`;

// 转换为正数分数用于显示和后续计算
score: Math.abs(row.raw_score || 0),
```

**优势**:
- ✅ 变量名清晰（raw_score vs score）
- ✅ 注释明确说明为什么要取绝对值

---

## 📝 与 Python 测试脚本的对比

### Python 测试脚本（正确实现）

```python
# test_business_scenario_bm25.py 第 454 行
sql = '''
    SELECT main.chunk_id, main.doc_id, main.doc_path, main.chunk_index, 
           bm25(chunks_fts) as score
    FROM chunks_fts AS fts
    JOIN chunks AS main ON fts.rowid = main.rowid
    WHERE chunks_fts MATCH ?
    ORDER BY score DESC  ⚠️  这里也有同样的问题！
    LIMIT ?
'''

# 第 464 行
score = abs(row[4]) if row[4] else 0  # ✅ 取了绝对值
```

**问题**: Python 测试脚本也有同样的 Bug！

但是，Python 测试脚本在**阶段 2** 使用了 `rank-bm25` 重新计算分数：

```python
# 第 600-618 行
bm25 = BM25Okapi(corpus)
scores = bm25.get_scores(query_tokens_rank)

refined_results = []
for i, (chunk, raw_score) in enumerate(zip(candidate_chunks, scores)):
    if raw_score > 0:
        refined_results.append({
            'chunk_id': chunk['chunk_id'],
            'score': float(raw_score),  # ✅ 使用 rank-bm25 的正数分数
        })

refined_results.sort(key=lambda x: x['score'], reverse=True)  # ✅ DESC 是正确的
```

**结论**: 
- Python 测试脚本的 FTS5 阶段有 Bug，但被阶段 2 的 rank-bm25 重排掩盖了
- TypeScript 后端没有重排步骤（之前），所以 Bug 更明显
- 现在添加了 BM25 重排，但重排前的 FTS5 召回仍然是错的

---

## 🎯 建议行动

### 立即修复（P0）

1. **[ ] 修复 TypeScript 后端**
   - 文件: `src/common/vector-db/implementations/sqlite-vector-db.ts`
   - 方法: `keywordSearch`
   - 修改: `ORDER BY score DESC` → `ORDER BY score ASC`

2. **[ ] 修复 Python 测试脚本**
   - 文件: `tests/verification/test_business_scenario_bm25.py`
   - 方法: `simulate_ts_sqlite_search`, `simulate_ts_sqlite_search_improved`
   - 修改: `ORDER BY score DESC` → `ORDER BY score ASC`

---

### 验证修复

运行测试脚本验证修复效果：

```bash
# 1. 运行 FTS5 符号验证测试
python tests/verification/test_fts5_bm25_sign.py

# 2. 运行业务场景测试
python tests/verification/test_business_scenario_bm25.py

# 3. 检查 MRR 是否提升
# 预期: MRR 应该从 0.6458 提升到更高
```

---

## 📚 参考资料

### SQLite FTS5 官方文档

> The bm25() function returns a negative value that is smaller for more relevant documents.
> 
> （bm25() 函数返回一个负数，对于更相关的文档，该值更小。）

**来源**: https://www.sqlite.org/fts5.html#the_bm25_function

---

### 相关 Issue

- [SQLite FTS5 bm25() returns negative values](https://stackoverflow.com/questions/59080006/sqlite-fts5-bm25-returns-negative-values)
- [Understanding BM25 scoring in FTS5](https://www.sqlite.org/fts5.html#auxiliary_functions)

---

## ✅ 总结

| 项目 | 状态 | 说明 |
|------|------|------|
| **FTS5 bm25() 返回值** | ✅ 负数 | 越小越相关 |
| **ORDER BY ASC** | ✅ 正确 | 从最相关到最不相关 |
| **ORDER BY DESC** | ❌ 错误 | 从最不相关到最相关 |
| **TypeScript 实现** | ❌ 有 Bug | 使用了 DESC |
| **Python 测试脚本** | ❌ 有 Bug | 使用了 DESC（但被重排掩盖） |
| **影响范围** | ⚠️ 严重 | 所有关键词搜索结果倒序 |
| **修复难度** | ✅ 简单 | 改一个关键字 |

---

**报告生成时间**: 2026-04-08  
**下一步**: 立即修复 TypeScript 后端和 Python 测试脚本
