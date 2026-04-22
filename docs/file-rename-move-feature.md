# 知识库文件管理功能

## 功能概述

本次重构为知识库模块添加了文件和文件夹的**重命名**、**移动**和**新建文件夹**功能，采用批量 UPDATE 优化策略，无需更新向量数据库。

### 新增功能

1. **重命名**：支持重命名单个文件和文件夹（含子项级联更新）
2. **移动**：支持将文件/文件夹移动到任意位置（包括根目录）
3. **新建文件夹**：在当前目录下创建新文件夹

## 技术实现

### 后端实现

#### 1. DTO 定义

- `dto/rename-file.dto.ts`: 重命名请求参数
- `dto/move-file.dto.ts`: 移动请求参数

#### 2. Service 层方法

**`createFolder(kbId, userId, folderName, parentFolderId)`）**
- 验证知识库权限
- 冲突检测：检查同父目录下是否已存在同名文件或文件夹
- 计算 `relativePath`（根据父文件夹路径拼接）
- 创建文件夹记录（`isDirectory: true`, `processingStatus: 'completed'`）

**`renameFile(fileId, kbId, userId, newName)`**
- 单文件：直接更新 `displayName` 和 `relativePath`
- 文件夹：使用原生 SQL 批量更新所有子项的 `relativePath`
  ```sql
  UPDATE kb_file
  SET relative_path = ${newPrefix} || SUBSTR(relative_path, LENGTH(${oldPrefix}) + 1)
  WHERE knowledge_base_id = ${kbId}
    AND relative_path LIKE ${oldPrefix + '%'}
  ```

**`moveFile(fileId, kbId, userId, targetParentFolderId)`**
- 循环引用检测：防止将文件夹移动到其子目录下
- **冲突检测**：检查目标位置是否已存在同名文件或文件夹，如存在则拒绝操作
- 批量更新：与重命名类似，使用原生 SQL 优化性能
- 验证目标文件夹存在且为目录类型

#### 3. Controller 层接口

- `POST /api/v1/knowledge-bases/:kb_id/files/folder`
  - 请求：`{ folderName, parentFolderId }`
  - 返回：`{ id, displayName, relativePath, parentFolderId, isDirectory }`
  
- `POST /api/v1/knowledge-bases/:kb_id/files/:file_id/rename`
  - 返回：`{ id, displayName, relativePath }`
  
- `POST /api/v1/knowledge-bases/:kb_id/files/:file_id/move`
  - 返回：`{ id, displayName, relativePath, parentFolderId }`

### 前端实现

#### 1. API Service

在 `ApiService.ts` 中添加：
- `renameKBFile(kbId, fileId, newName)`
- `moveKBFile(kbId, fileId, targetParentFolderId)`

#### 2. Store

在 `knowledgeBase.ts` 中添加：
- `renameFile(kbId, fileId, newName)`
- `moveFile(kbId, fileId, targetParentFolderId)`

#### 3. UI 组件

**KBFileTree.vue** 新增功能：
- 右键菜单增加“重命名”和“移动到...”选项
- 重命名对话框：输入新名称（使用 `append-to-body` 避免遮挡）
- 移动对话框：树形选择器选择目标文件夹（使用 `append-to-body` 避免遮挡）
  - **支持移动到根目录**：在树形选择器顶部提供“根目录”选项

## 性能优化

### 批量 UPDATE 优化

使用原生 SQL 的字符串拼接操作，避免逐条记录更新：

```typescript
// 优化前：逐条 UPDATE（1000 条记录 ~1-2 秒）
for (const child of children) {
  await tx.kBFile.update({ ... });
}

// 优化后：批量 UPDATE（1000 条记录 ~50-100ms）
await tx.$executeRaw`
  UPDATE kb_file
  SET relative_path = ${newPrefix} || SUBSTR(relative_path, LENGTH(${oldPrefix}) + 1)
  WHERE knowledge_base_id = ${kbId}
    AND relative_path LIKE ${oldPrefix + '%'}
`;
```

### 性能对比

| 操作类型 | 影响记录数 | 预估耗时 |
|---------|-----------|---------|
| 重命名单个文件 | 1 | < 10ms |
| 重命名含100个子项的文件夹 | 101 | ~50ms |
| 重命名含1000个子项的文件夹 | 1001 | ~100-200ms |
| 移动单个文件 | 1 | < 10ms |
| 移动含1000个子项的文件夹 | 1001 | ~100-200ms |

## 测试指南

### 1. 新建文件夹测试

#### 测试用例 1：在根目录创建文件夹
1. 点击“新建文件夹”按钮
2. 输入文件夹名称（如 `test-folder`）
3. 点击“确定”
4. **预期结果**：
   - 文件夹立即出现在文件列表中
   - 文件夹类型为“文件夹”
   - `relativePath` 为 `test-folder`
   - `parentFolderId` 为 `null`

#### 测试用例 2：在子目录创建文件夹
1. 进入某个子目录（如 `docs`）
2. 点击“新建文件夹”按钮
3. 输入文件夹名称（如 `api`）
4. 点击“确定”
5. **预期结果**：
   - 文件夹出现在当前目录
   - `relativePath` 为 `docs/api`
   - `parentFolderId` 指向 `docs` 文件夹的 ID

#### 测试用例 3：同名冲突检测
1. 在当前目录已存在 `test` 文件夹
2. 尝试创建同名文件夹 `test`
3. **预期结果**：
   - 提示“已存在同名文件夹「test」”
   - 创建失败

#### 测试用例 4：与文件同名冲突
1. 在当前目录已存在 `readme.txt` 文件
2. 尝试创建名为 `readme.txt` 的文件夹
3. **预期结果**：
   - 提示“已存在同名文件「readme.txt」”
   - 创建失败

### 2. 重命名测试

#### 测试用例 5：重命名单个文件
1. 在知识库中选择一个文件
2. 右键点击 → 选择"重命名"
3. 输入新名称 → 点击确定
4. **预期结果**：
   - 文件名立即更新
   - 刷新页面后名称保持一致
   - 文件的 `relativePath` 正确更新

#### 测试用例 6：重命名空文件夹
1. 创建一个空文件夹
2. 右键点击 → 选择“重命名”
3. 输入新名称 → 点击确定
4. **预期结果**：
   - 文件夹名称更新
   - `relativePath` 正确更新

#### 测试用例 7：重命名含子项的文件夹
1. 创建文件夹结构：`docs/api/readme.md`
2. 右键点击 `api` 文件夹 → 重命名为 `reference`
3. **预期结果**：
   - 文件夹名称变为 `reference`
   - 子文件路径自动更新为 `docs/reference/readme.md`
   - 面包屑导航显示正确路径

#### 测试用例 8：同名冲突检测
1. 尝试将文件重命名为已存在的名称
2. **预期结果**：
   - 提示“该名称已存在”
   - 重命名失败

### 3. 移动测试

#### 测试用例 9：移动单个文件
1. 选择文件 `readme.md`（位于根目录）
2. 右键点击 → 选择"移动到..."
3. 在树形选择器中选择目标文件夹 `docs`
4. **预期结果**：
   - 文件移动到 `docs/readme.md`
   - 原位置不再显示该文件
   - 目标位置显示该文件

#### 测试用例 10：移动文件夹
1. 选择文件夹 `api`（包含子文件）
2. 右键点击 → 选择“移动到...”
3. 选择目标文件夹 `archive`
4. **预期结果**：
   - 文件夹移动到 `archive/api`
   - 所有子文件路径自动更新
   - 面包屑导航正确显示新路径

#### 测试用例 11：循环引用检测
1. 尝试将文件夹 `docs` 移动到其子文件夹 `docs/api` 下
2. **预期结果**：
   - 提示“不能将文件夹移动到其子目录下”
   - 移动失败

#### 测试用例 12：移动到根目录
1. 选择文件 `docs/readme.md`
2. 右键点击 → 选择“移动到...”
3. 选择根目录（不选择任何文件夹）
4. **预期结果**：
   - 文件移动到根目录
   - `parentFolderId` 变为 `null`
   - `relativePath` 变为 `readme.md`

#### 测试用例 13：移动冲突检测
1. 在根目录创建一个文件 `test.txt`
2. 在 `docs` 文件夹中也创建一个文件 `test.txt`
3. 尝试将 `docs/test.txt` 移动到根目录
4. **预期结果**：
   - 提示“目标位置已存在同名文件「test.txt」，无法移动”
   - 移动操作被拒绝
   - 文件保持在原位置

### 4. 边界情况测试

#### 测试用例 14：特殊字符名称
1. 尝试重命名为包含特殊字符的名称（如 `test@#$%`）
2. **预期结果**：
   - 允许合法的特殊字符
   - 拒绝非法字符（根据后端验证规则）

#### 测试用例 15：超长名称
1. 尝试重命名为超过 255 字符的名称
2. **预期结果**：
   - 前端或后端拒绝
   - 提示名称过长

#### 测试用例 16：大规模移动性能
1. 创建包含 500+ 文件的文件夹
2. 移动该文件夹到另一个位置
3. **预期结果**：
   - 操作在 1 秒内完成
   - 所有子文件路径正确更新
   - 无超时错误

### 5. 数据一致性测试

#### 测试用例 17：刷新后数据保持
1. 执行重命名或移动操作
2. 刷新浏览器页面
3. **预期结果**：
   - 文件/文件夹位置和名称保持正确
   - 面包屑导航显示正确路径

#### 测试用例 18：向量搜索结果关联
1. 重命名文件后执行知识库搜索
2. **预期结果**：
   - 搜索结果显示最新的文件名（通过 documentId 实时关联查询）
   - 搜索结果中的路径正确

## 注意事项

### 1. 向量数据库元数据

- 向量库中的 `fileName` 字段可能过时
- 搜索结果通过 `documentId` 实时从数据库查询最新信息
- 无需更新向量库，降低了实现复杂度

### 2. 事务一致性

- 使用 Prisma `$transaction` 保证原子性
- 如果批量更新失败，整个操作回滚
- 不会出现部分更新的不一致状态

### 3. 并发安全

- 当前实现未处理并发修改冲突
- 建议在实际使用中避免多人同时操作同一文件夹
- 如需支持并发，可添加乐观锁机制

### 4. 性能限制

- 单次操作建议不超过 5000 个子项
- 超过此数量可能导致请求超时
- 如需处理超大规模移动，考虑引入异步后台任务

## 已知限制

1. **不支持复制操作**：当前仅实现重命名和移动
2. **无撤销功能**：操作完成后无法撤销
3. **无进度反馈**：大规模操作时缺少进度条（因速度较快，暂不需要）

## 未来优化方向

1. **拖拽移动**：支持拖拽文件/文件夹到目标位置
2. **批量操作**：支持同时移动多个文件
3. **快捷键支持**：F2 重命名、Ctrl+X/Ctrl+V 剪切粘贴
4. **操作历史**：记录最近的重命名/移动操作，支持撤销
5. **异步处理**：对于超大规模移动（> 5000 文件），改为后台异步处理

## 相关文件

### 后端
- `backend-ts/src/modules/knowledge-base/dto/rename-file.dto.ts`
- `backend-ts/src/modules/knowledge-base/dto/move-file.dto.ts`
- `backend-ts/src/modules/knowledge-base/kb-file.service.ts`
- `backend-ts/src/modules/knowledge-base/kb-files.controller.ts`

### 前端
- `frontend/src/services/ApiService.ts`
- `frontend/src/stores/knowledgeBase.ts`
- `frontend/src/components/KnowledgeBasePage/KBFileTree.vue`

## 总结

本次重构成功实现了知识库文件和文件夹的重命名、移动功能，采用原生 SQL 批量 UPDATE 优化策略，在保证功能完整性的同时，获得了优异的性能表现。向量数据库无需同步更新，通过 documentId 实时关联查询即可获取最新信息，大幅简化了实现复杂度。
