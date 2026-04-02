# 知识库模型 ID 重构 - 部署与测试指南

## 📋 前置检查清单

### 1. 依赖安装
确保已安装所有必要的 Python 包：

```bash
cd backend
pip install -r requirements.txt
```

**需要的关键包**：
- `alembic` >= 1.0.0 (数据库迁移工具)
- `sqlalchemy` >= 2.0.0 (ORM 框架)
- `chromadb` (向量数据库)

如果 `requirements.txt` 中没有 alembic，请手动安装：
```bash
pip install alembic
```

### 2. 数据备份 ⚠️
**在执行任何迁移之前，务必备份数据库！**

```bash
# Windows PowerShell
Copy-Item data\app.db data\app.db.backup_$(Get-Date -Format "yyyyMMdd_HHmmss")

# 或者手动复制
cp data/app.db data/app.db.backup
```

---

## 🚀 部署步骤

### Step 1: 验证当前数据库状态

```bash
cd backend
python -m alembic current
```

**预期输出**：
```
Current revision(s) for database:
kb_001
```

如果显示错误，说明 alembic 未正确安装或配置。

### Step 2: 执行数据库迁移

```bash
python -m alembic upgrade head
```

**预期输出**：
```
INFO  [alembic.runtime.migration] Context impl SQLiteImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade kb_001 -> kb_002, replace_embedding_model_fields_with_id
Data migration completed: X updated, 0 failed
```

### Step 3: 验证迁移结果

运行以下 SQL 查询验证表结构变更：

```bash
python -c "
import sqlite3
conn = sqlite3.connect('data/app.db')
cursor = conn.execute('PRAGMA table_info(knowledge_base)')
print('knowledge_base 表结构:')
for row in cursor.fetchall():
    print(row)
conn.close()
"
```

**应该看到的字段**：
- ✅ `embedding_model_id` (VARCHAR(26))
- ❌ ~~`embedding_model_provider`~~ (已删除)
- ❌ ~~`embedding_model_name`~~ (已删除)

### Step 4: 检查外键约束

```bash
python -c "
import sqlite3
conn = sqlite3.connect('data/app.db')
cursor = conn.execute('PRAGMA foreign_key_list(knowledge_base)')
print('外键约束:')
for row in cursor.fetchall():
    print(row)
conn.close()
"
```

**应该看到**：
```
(0, 0, 'model', 'embedding_model_id', 'id', 'NO ACTION', 'RESTRICT', 'NONE')
```

### Step 5: 重启后端服务

```bash
# 停止现有服务（如果有）
# Ctrl+C 终止进程

# 启动服务
python run.py
```

### Step 6: 清理前端缓存

由于前端类型定义已变更，需要清理浏览器缓存：

1. **开发环境**：
   - 打开浏览器开发者工具 (F12)
   - Network 标签 → 勾选 "Disable cache"
   - Application 标签 → Clear site data

2. **或者强制刷新**：
   - Windows/Linux: `Ctrl + Shift + R`
   - macOS: `Cmd + Shift + R`

---

## 🧪 功能测试

### 测试 1: 创建知识库

1. 打开前端应用
2. 导航到知识库页面
3. 点击 "创建知识库"
4. 填写信息：
   - 名称：测试知识库
   - 描述：用于验证 model_id 重构
   - **向量模型**：从下拉框选择一个 embedding 模型
   - 分块配置：保持默认
5. 点击 "创建"

**验证点**：
- ✅ 创建成功，显示在列表中
- ✅ 后端日志无错误
- ✅ 数据库中 `embedding_model_id` 字段有值

### 测试 2: 上传文件并验证向量化

1. 选择刚创建的知识库
2. 点击 "上传文件"
3. 选择一个小型文本文件（如 .txt 或 .md）
4. 观察处理进度

**验证点**：
- ✅ 文件依次经历：上传中 → 处理中 → 已完成
- ✅ 向量化阶段日志显示正确的 provider 和 model 名称
- ✅ 分块成功存储到 ChromaDB

**查看后端日志**：
```
INFO: 使用向量模型：provider=xxx, model=yyy
INFO: 获取嵌入成功：provider=xxx, model=yyy, dims=768
```

### 测试 3: 搜索功能

1. 在知识库页面顶部搜索框输入关键词
2. 执行搜索

**验证点**：
- ✅ 返回相关的分块结果
- ✅ 相似度分数合理（0-1 之间）
- ✅ 无数据库错误

### 测试 4: 编辑知识库

1. 点击知识库的 "更多" → "编辑"
2. 修改名称或描述
3. **不要修改向量模型**（当前 UI 不支持编辑时更改模型）
4. 保存

**验证点**：
- ✅ 保存成功
- ✅ `embedding_model_id` 保持不变

---

## 🐛 故障排查

### 问题 1: 迁移失败 - "No matching model found"

**原因**：现有知识库使用的 provider+name 组合在 model 表中不存在

**解决方案**：
```sql
-- 1. 查询不匹配的记录
SELECT id, embedding_model_provider, embedding_model_name 
FROM knowledge_base;

-- 2. 检查 model 表是否有对应记录
SELECT id, model_name, provider_id 
FROM model 
WHERE model_type = 'embedding';

-- 3. 手动修复或添加缺失的 model 记录
```

### 问题 2: 前端提示 "向量模型不存在"

**原因**：选择的 model_id 无效或 model 记录已被删除

**解决方案**：
1. 检查 model 表是否有该 ID 的记录
2. 确保 ModelProvider 关系正确配置
3. 重新选择有效的 embedding 模型

### 问题 3: 向量化失败 - "Provider not found"

**原因**：model 表中的 provider_id 关联的 provider 不存在

**解决方案**：
```sql
-- 检查 provider 配置
SELECT m.id, m.model_name, p.name as provider_name, p.api_url
FROM model m
LEFT JOIN model_provider p ON m.provider_id = p.id
WHERE m.model_type = 'embedding';
```

### 问题 4: 外键约束冲突

**症状**：无法删除或更新 model 记录

**原因**：`ondelete='RESTRICT'` 阻止删除有关联的 model

**解决方案**：
- 方案 A：先删除关联的知识库，再删除 model
- 方案 B：修改为 `ondelete='CASCADE'`（需要新迁移脚本）

---

## 📊 性能监控

### 数据库查询性能

迁移后应监控以下查询的性能：

```sql
-- 1. 通过 model_id 查询知识库
EXPLAIN QUERY PLAN
SELECT * FROM knowledge_base WHERE embedding_model_id = 'xxx';

-- 2. 关联查询
EXPLAIN QUERY PLAN
SELECT kb.*, m.model_name, p.name as provider_name
FROM knowledge_base kb
JOIN model m ON kb.embedding_model_id = m.id
JOIN model_provider p ON m.provider_id = p.id;
```

**预期**：应该使用索引 `idx_kb_embedding_model`

### 向量化耗时

记录文件处理的各个阶段耗时：

```python
# 后端日志中应该看到
INFO: 使用向量模型：provider=xxx, model=yyy
INFO: 第 N 个分块向量化成功
INFO: 文件处理完成：文件名，分块数=N
```

典型耗时参考：
- 小文件（<1MB）：5-15 秒
- 中等文件（1-5MB）：15-60 秒
- 大文件（>5MB）：1-5 分钟

---

## 🔙 回滚方案

如果生产环境出现问题，需要回滚：

### Step 1: 降级数据库

```bash
python -m alembic downgrade kb_001
```

### Step 2: 恢复代码

```bash
git checkout <重构前的 commit hash>
```

### Step 3: 恢复数据库备份

```bash
# 删除当前数据库
rm data/app.db

# 恢复备份
cp data/app.db.backup data/app.db
```

### Step 4: 重启服务

```bash
# 重启后端
python run.py
```

---

## ✅ 验收标准

所有以下条件必须满足才能视为重构成功：

- [ ] 数据库迁移无错误执行
- [ ] 旧数据成功迁移到新的 model_id 字段
- [ ] 创建新知识库功能正常
- [ ] 文件上传和向量化流程正常
- [ ] 搜索功能返回正确结果
- [ ] 无 SQLAlchemy 外键错误
- [ ] 前端无 TypeScript 类型错误
- [ ] 单元测试全部通过
- [ ] 性能无明显下降

---

## 📞 支持

如遇到文档未覆盖的问题：

1. 检查后端日志：`logs/app.log`
2. 查看数据库状态：使用 SQLite 客户端工具
3. 前端控制台：检查 JavaScript 错误
4. 网络请求：查看 API 响应状态码

**常见问题优先级**：
1. 🔴 高：数据丢失或损坏 → 立即回滚
2. 🟡 中：功能异常但不影响数据 → 排查日志
3. 🟢 低：UI/UX 问题 → 收集反馈后优化

---

**部署日期**: _______________  
**执行人**: _______________  
**验证人**: _______________  
**状态**: □ 成功 / □ 失败 / □ 部分成功
