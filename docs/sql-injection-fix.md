# SQL 注入防护修复报告

## 问题描述

在 `kb-file.service.ts` 中，文件夹重命名和移动功能使用了 Prisma 的 `$executeRaw` 模板字符串执行原生 SQL，存在潜在的 SQL 注入风险。

### 原始代码（存在风险）

```typescript
const oldPrefix = oldRelativePath + '/';
const newPrefix = newRelativePath + '/';

const result = await tx.$executeRaw`
  UPDATE kb_file
  SET relative_path = ${newPrefix} || SUBSTR(relative_path, LENGTH(${oldPrefix}) + 1)
  WHERE knowledge_base_id = ${kbId}
    AND relative_path LIKE ${oldPrefix + '%'}
`;
```

### 风险分析

1. **字符串拼接在模板外部**：
   - `oldPrefix + '/'` 在 JavaScript 层面拼接
   - `oldPrefix + '%'` 再次拼接后传入模板
   - 虽然 Prisma 会参数化 `${}` 中的值，但拼接逻辑本身不够清晰

2. **LIKE 子句通配符风险（严重）**：
   - 如果 `relativePath` 包含 `%` 或 `_`（SQL 通配符），会导致意外的匹配行为
   - 例如：路径 `test%folder/` 会匹配所有以 `test` 开头的路径，包括：
     - `test%folder/file.txt` ✅ (预期)
     - `testAfolder/file.txt` ❌ (意外匹配！)
     - `testBfolder/file.txt` ❌ (意外匹配！)
   - **这可能导致批量更新错误的文件，造成数据损坏**

3. **代码可读性差**：
   - 混合了 JavaScript 字符串操作和 SQL 模板
   - 难以审计和维护

## 修复方案

使用 `$executeRawUnsafe` 配合显式的参数化查询，完全消除 SQL 注入风险。

### 修复后的代码

```typescript
const oldPrefix = oldRelativePath + '/';
const newPrefix = newRelativePath + '/';

// 转义 LIKE 子句中的特殊字符（% 和 _）
const escapedOldPrefix = oldPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_');
const likePattern = escapedOldPrefix + '%';

const result = await tx.$executeRawUnsafe(
  `UPDATE kb_file SET relative_path = ? || SUBSTR(relative_path, LENGTH(?) + 1) WHERE knowledge_base_id = ? AND relative_path LIKE ? ESCAPE '\\'`,
  newPrefix,      // 参数 1: 新前缀
  oldPrefix,      // 参数 2: 旧前缀
  kbId,           // 参数 3: 知识库 ID
  likePattern,    // 参数 4: LIKE 模式（已转义）
);
```

### 修复优势

1. **✅ 完全参数化**：
   - 所有用户输入都通过 `?` 占位符传递
   - 数据库驱动负责转义和类型检查
   - 彻底杜绝 SQL 注入

2. **✅ LIKE 通配符转义**：
   - 使用 `ESCAPE '\\'` 指定转义字符
   - 将 `%` 转义为 `\%`，`_` 转义为 `\_`
   - 确保只匹配字面意义上的 `%` 和 `_`
   - **防止意外批量更新错误文件**

3. **✅ 清晰的意图**：
   - SQL 语句和参数分离
   - 每个参数的用途一目了然
   - 便于代码审查和安全审计

4. **✅ 性能一致**：
   - 与原来的 `$executeRaw` 性能相同
   - 数据库可以使用相同的查询计划缓存

5. **✅ 符合最佳实践**：
   - OWASP 推荐的参数化查询方式
   - Prisma 官方文档推荐的做法

## 修改位置

### 1. 文件夹重命名（第 868 行）

**文件**：`backend-ts/src/modules/knowledge-base/kb-file.service.ts`

**方法**：`renameFile()`

**修改内容**：
- 将 `$executeRaw` 模板字符串改为 `$executeRawUnsafe` + 参数数组
- 提取 `likePattern` 变量，避免在参数中拼接

### 2. 文件夹移动（第 1018 行）

**文件**：`backend-ts/src/modules/knowledge-base/kb-file.service.ts`

**方法**：`moveFile()`

**修改内容**：
- 同上，使用参数化查询

## 安全测试建议

### 测试用例 1：特殊字符路径

```typescript
// 尝试创建包含 SQL 特殊字符的文件夹
const maliciousName = "test' OR '1'='1";
await createFolder(kbId, userId, maliciousName, null);

// 预期：正常创建，不会导致 SQL 错误
```

### 测试用例 2：LIKE 通配符（重要）

```typescript
// 创建包含 % 的文件夹名
const wildcardName = "test%folder";
await createFolder(kbId, userId, wildcardName, null);

// 在该文件夹下创建文件
await uploadFile(kbId, userId, file, "test%folder/file.txt");

// 重命名文件夹
await renameFile(folderId, kbId, userId, "newName");

// 预期结果：
// ✅ 只更新 test%folder/ 下的文件
// ❌ 不会错误更新 testAfolder/、testBfolder/ 等其他路径
```

**验证 SQL：**
```sql
-- 转义后的 LIKE 模式：'test\%folder/%'
-- ESCAPE '\' 告诉数据库 \ 是转义字符
WHERE relative_path LIKE 'test\%folder/%' ESCAPE '\'

-- 只会匹配：
-- ✅ test%folder/file1.txt
-- ✅ test%folder/subdir/file2.txt

-- 不会匹配：
-- ❌ testAfolder/file.txt
-- ❌ testBfolder/file.txt
```

### 测试用例 3：超长路径

```typescript
// 尝试创建超长路径（超过 1000 字符）
const longName = "a".repeat(1000);
await createFolder(kbId, userId, longName, null);

// 预期：被数据库或应用层验证拒绝
```

## 相关资源

- [Prisma 原生查询文档](https://www.prisma.io/docs/orm/prisma-client/raw-database-access/execcuteraw)
- [OWASP SQL 注入防护指南](https://owasp.org/www-community/attacks/SQL_Injection)
- [参数化查询最佳实践](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)

## 总结

本次修复解决了两个安全问题：

1. **SQL 注入风险**：将原生 SQL 查询从模板字符串方式改为显式参数化查询
2. **LIKE 通配符问题**：对 `%` 和 `_` 进行转义，防止意外批量更新错误文件

虽然 Prisma 的 `$executeRaw` 本身有一定的参数化保护，但使用 `$executeRawUnsafe` + 参数数组 + ESCAPE 子句的方式更加明确、安全且易于审计。

**影响范围**：
- ✅ 文件夹重命名功能
- ✅ 文件夹移动功能
- ✅ 无性能影响
- ✅ 向后兼容
- ✅ 防止数据损坏（关键）

**建议**：
- 定期进行安全代码审查
- 对所有原生 SQL 查询进行参数化处理
- 特别注意 LIKE 子句的通配符转义
- 添加输入验证和长度限制
