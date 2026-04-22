# 文件夹上传功能测试指南

## 当前状态

✅ 已使用**原生 `<input type="file" webkitdirectory>`** 实现  
✅ 核心功能已完成,等待测试验证  
⏸️ UI美化暂缓,先确保功能跑通

---

## 测试步骤

### 1. 启动前后端服务

```bash
# 终端1: 启动后端
cd backend-ts
npm run start:dev

# 终端2: 启动前端
cd frontend
npm run dev
```

### 2. 访问知识库页面

1. 打开浏览器访问: `http://localhost:5173` (或前端实际端口)
2. 登录账号
3. 进入"知识库"页面
4. 选择一个已有的知识库或创建新的

### 3. 测试文件夹上传

#### 测试场景1: 简单文件夹结构

准备测试文件夹:
```
测试项目/
├─ readme.md
├─ docs/
│  └─ guide.md
└─ src/
   └─ main.py
```

操作步骤:
1. 点击"选择文件夹进行测试"按钮
2. 选择"测试项目"文件夹
3. 观察浏览器控制台输出
4. 查看上传任务列表

**预期结果:**
- ✅ 显示 "检测到 3 个文件，开始依次上传..."
- ✅ 每个文件的 `relativePath` 应为:
  - `readme.md`
  - `docs/guide.md`
  - `src/main.py`
- ✅ 上传成功后显示 "文件夹上传完成：成功 3 个，失败 0 个"

#### 测试场景2: 深层嵌套文件夹

```
A/
└─ B/
   └─ C/
      └─ D/
         └─ test.txt
```

**预期结果:**
- ✅ `relativePath` = `"A/B/C/D/test.txt"`
- ✅ 数据库应创建4个文件夹节点(A, B, C, D)
- ✅ 文件节点的 `parentFolderId` 指向 D 文件夹

#### 测试场景3: 同名文件夹

上传两次相同的文件夹结构:
```
项目/
└─ docs/
   └─ readme.md
```

**预期结果:**
- ✅ 第二次上传时不会重复创建"项目"和"docs"文件夹
- ✅ 只会创建新的 `readme.md` 文件记录
- ✅ 两个文件的 `parentFolderId` 都指向同一个"docs"文件夹

---

## 验证方法

### 方法1: 浏览器控制台

打开浏览器开发者工具(F12),查看 Console 输出:

```javascript
[DEBUG] 添加上传任务(带路径): docs/guide.md
[DEBUG] 上传完成: guide.md, 检查队列...
```

### 方法2: 数据库查询

使用 SQLite 客户端或 Prisma Studio 查询:

```bash
cd backend-ts
npx prisma studio
```

或在数据库中直接执行:

```sql
-- 查看所有文件和文件夹
SELECT 
  id,
  display_name,
  relative_path,
  is_directory,
  parent_folder_id,
  processing_status
FROM kb_file
WHERE knowledge_base_id = 'your_kb_id'
ORDER BY relative_path;

-- 查看特定文件夹的子项
SELECT * FROM kb_file 
WHERE parent_folder_id = 'folder_uuid_here';
```

**验证要点:**
- ✅ `is_directory` 字段正确区分文件和文件夹
- ✅ `relative_path` 不包含绝对路径(如 `C:/Users/...`)
- ✅ `parent_folder_id` 形成正确的树形关系

### 方法3: API测试

使用 Postman 或 curl 测试后端API:

```bash
# 获取文件列表
curl -X GET "http://localhost:3000/api/v1/knowledge-bases/{kb_id}/files" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 查看单个文件详情
curl -X GET "http://localhost:3000/api/v1/knowledge-bases/{kb_id}/files/{file_id}" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

检查响应中是否包含:
```json
{
  "id": "...",
  "displayName": "test.txt",
  "relativePath": "A/B/C/test.txt",  // ← 关键字段
  "parentFolderId": "...",            // ← 关键字段
  "isDirectory": false
}
```

---

## 常见问题排查

### 问题1: 无法选择文件夹

**症状:** 点击按钮后只能选择文件,不能选择文件夹

**原因:** 浏览器不支持 `webkitdirectory` 属性

**解决:**
- ✅ Chrome/Edge: 完全支持
- ⚠️ Firefox: 可能需要启用 `dom.input.dirpicker` 配置
- ❌ Safari: 不支持,需改用其他方式

### 问题2: relativePath 为空

**症状:** 上传后数据库中 `relative_path` 为 `NULL`

**排查步骤:**
1. 检查浏览器控制台是否有 `(file as any).webkitRelativePath` 的值
2. 确认使用的是原生 `<input>` 而非 `el-upload`
3. 检查前端代码是否正确传递了 `relativePath` 参数

**调试代码:**
```javascript
// 在 handleFileSelect 中添加
console.log('Files:', Array.from(input.files))
console.log('First file webkitRelativePath:', input.files[0].webkitRelativePath)
```

### 问题3: 文件夹节点未创建

**症状:** 只有文件记录,没有文件夹节点

**排查:**
1. 检查后端日志是否有 "创建文件夹节点: ..." 的输出
2. 确认 `ensureFolderStructure()` 方法被正确调用
3. 检查数据库中 `is_directory=true` 的记录是否存在

### 问题4: 上传失败

**症状:** 显示 "上传失败" 错误

**常见原因:**
- Token 过期 → 重新登录
- 文件大小超过50MB → 检查文件大小
- 后端服务未启动 → 检查后端日志
- 知识库ID错误 → 确认 `props.kbId` 正确

---

## 性能测试

### 测试大量文件

准备包含100+文件的文件夹,观察:
- [ ] 上传队列是否正常处理
- [ ] 并发控制是否生效(最多3个同时上传)
- [ ] 内存占用是否合理
- [ ] 浏览器是否卡顿

### 测试大文件

上传接近50MB的文件:
- [ ] 进度条是否正常显示
- [ ] 上传完成后是否正确触发处理
- [ ] 后台向量化是否正常进行

---

## 下一步计划

### 功能验证通过后

1. **UI美化**: 替换为更美观的拖拽上传组件
2. **树形视图**: 开发文件夹树形展示组件
3. **批量操作**: 实现文件夹级别的删除、移动等功能
4. **权限控制**: 添加文件夹级别的访问控制

### 如果测试发现问题

1. 记录具体错误信息和复现步骤
2. 检查浏览器控制台和后端日志
3. 根据问题调整实现方案
4. 必要时回退到更简单的实现

---

## 反馈模板

测试后请填写以下信息:

```markdown
## 测试结果

- [ ] 测试场景1: 简单文件夹 - 通过/失败
- [ ] 测试场景2: 深层嵌套 - 通过/失败
- [ ] 测试场景3: 同名文件夹 - 通过/失败

## 发现的问题

1. 问题描述:
2. 复现步骤:
3. 错误信息:
4. 浏览器版本:

## 建议改进

- ...
```

---

## 联系支持

如遇无法解决的问题,请提供:
1. 浏览器类型和版本
2. 完整的错误日志(前端控制台 + 后端日志)
3. 测试文件夹的结构截图
4. 数据库查询结果

祝测试顺利! 🎉
