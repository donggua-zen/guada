# LanceDB Metadata 过滤功能说明

## ⚠️ 当前状态

LanceDB 的 metadata 过滤功能**尚未完全实现**。

---

## 🔍 问题分析

### 问题描述

当我们尝试使用 `json_extract()` 函数过滤 metadata 字段时，遇到以下错误：

```
Failed to coerce arguments to satisfy a call to 'json_extract' function: 
coercion from Utf8, Utf8 to the signature Exact([LargeBinary, Utf8]) failed
```

### 根本原因

1. **metadata 存储格式**：当前实现将 metadata 存储为 **JSON 字符串**（Utf8 类型）
2. **json_extract 要求**：LanceDB 的 `json_extract()` 函数要求第一个参数是 **LargeBinary** 类型
3. **类型不匹配**：Utf8 ≠ LargeBinary，导致查询失败

---

## 💡 解决方案

### 方案 A：将 metadata 拆分为独立列（推荐）

**优点**：
- ✅ 性能最佳
- ✅ 支持所有过滤操作
- ✅ LanceDB 原生支持

**缺点**：
- ❌ 需要修改数据结构
- ❌ 需要迁移现有数据

**实施步骤**：

1. **修改数据存储结构**
   ```typescript
   // 之前
   {
     id: 'doc_1',
     content: '...',
     metadata: JSON.stringify({ file_id: 'file_001' })  // JSON 字符串
   }
   
   // 之后
   {
     id: 'doc_1',
     content: '...',
     file_id: 'file_001',  // 独立列
     source: 'test',       // 独立列
   }
   ```

2. **更新 addDocuments 方法**
   ```typescript
   const data = documents.map((doc) => ({
     id: doc.id,
     vector: doc.embedding,
     content: doc.content,
     content_tokens: this.tokenizeForSearch(doc.content),
     ...doc.metadata,  // 展开 metadata 为独立列
   }));
   ```

3. **简化过滤逻辑**
   ```typescript
   // 直接使用列名过滤
   const whereClause = Object.entries(filterMetadata)
     .map(([key, value]) => `${key} = '${value}'`)
     .join(' AND ');
   ```

---

### 方案 B：应用层过滤（临时方案）

**优点**：
- ✅ 无需修改数据结构
- ✅ 快速实现

**缺点**：
- ❌ 性能较差（需要先获取所有结果再过滤）
- ❌ 不适用于大数据集

**实施步骤**：

1. **先执行搜索（不带过滤）**
   ```typescript
   const results = await table.search(queryEmbedding).limit(topK * 10).toArray();
   ```

2. **在应用层过滤**
   ```typescript
   const filtered = results.filter((row: any) => {
     const metadata = row.metadata ? JSON.parse(row.metadata) : {};
     return metadata.file_id === filterMetadata.file_id;
   });
   ```

3. **返回 Top-K 结果**
   ```typescript
   return filtered.slice(0, topK);
   ```

---

### 方案 C：使用 LanceDB 的预过滤功能

LanceDB 支持在向量搜索前进行预过滤（pre-filtering），但这需要 metadata 是独立列。

参考：https://lancedb.github.io/lancedb/concepts/pre_filtering/

---

## 🎯 推荐实施方案

**短期**：方案 B（应用层过滤）
- 快速解决当前需求
- 不影响现有数据结构

**长期**：方案 A（独立列）
- 性能最优
- 符合最佳实践
- 需要数据迁移

---

## 📝 当前代码状态

### 已完成的修改

1. ✅ 添加了 `buildWhereClause()` 方法
2. ✅ 在 `semanticSearch()` 中应用过滤
3. ✅ 在 `keywordSearch()` 中应用过滤
4. ✅ 在 `hybridSearch()` 中应用过滤

### 存在的问题

❌ `json_extract()` 函数类型不匹配，导致过滤失败

### 临时解决方案

目前过滤功能**无法正常工作**，需要选择上述方案之一进行修复。

---

## 🔧 下一步行动

### 选项 1：实施应用层过滤（快速）

我可以立即修改代码，使用应用层过滤作为临时解决方案。

**预计时间**：15-30 分钟

### 选项 2：重构为独立列（推荐）

重新设计数据结构，将 metadata 字段展开为独立列。

**预计时间**：1-2 小时
**需要**：
- 修改 `addDocuments()` 方法
- 创建数据迁移脚本
- 更新所有相关代码

### 选项 3：等待 LanceDB 更新

等待 LanceDB 修复 `json_extract()` 的类型问题或提供更好的 JSON 过滤支持。

**风险**：不确定何时修复

---

## 💬 请告诉我您的选择

您希望我实施哪个方案？

1. **方案 B** - 应用层过滤（快速，临时）
2. **方案 A** - 独立列重构（推荐，长期）
3. **其他想法**
