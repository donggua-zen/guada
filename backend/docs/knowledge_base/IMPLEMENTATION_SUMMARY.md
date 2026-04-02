# 后端文件处理修复实施总结

## ✅ 已完成的修改

### 1. **数据库模型修改**

#### `app/models/kb_file.py`
- ✅ 新增 `file_path` 字段（String(500), nullable）
- 用于存储文件的绝对路径，支持服务重启后恢复

```python
# 新增字段
file_path = Column(String(500), nullable=True, comment="文件存储路径（绝对路径）")
```

---

### 2. **Repository 层修改**

#### `app/repositories/kb_file_repository.py`
- ✅ 新增 `get_files_by_status()` 方法
- 用于查询指定状态的文件列表（pending/processing）

```python
async def get_files_by_status(self, statuses: List[str]) -> List[KBFile]:
    """根据处理状态查询文件"""
    stmt = select(KBFile).where(KBFile.processing_status.in_(statuses))
    result = await self.session.execute(stmt)
    return list(result.scalars().all())
```

---

### 3. **路由层修改**

#### `app/routes/kb_files.py`

**关键修改**:
1. ✅ 导入 `asyncio` 和 `get_db_session_context`
2. ✅ 导入 `KBFileService`
3. ✅ 修改上传逻辑，使用 `asyncio.create_task` 替代 `BackgroundTasks`
4. ✅ 保存文件路径到数据库
5. ✅ 新增 `_process_file_in_background()` 函数

```python
# ❌ 之前（错误）
background_tasks = get_kb_background_tasks()
background_tasks.add_file_processing_task(...)

# ✅ 现在（正确）
asyncio.create_task(_process_file_in_background(
    kb_id=kb_id,
    file_path=str(file_path),
    file_name=file.filename,
    display_name=file.filename,
    file_size=file_size,
    file_type=file_type,
    file_extension=file_extension.lstrip("."),
))

# 保存文件路径到数据库
file_record.file_path = str(file_path.absolute())
await session.commit()
```

**新增后台处理函数**:
```python
async def _process_file_in_background(...):
    """真正的后台任务，独立于请求"""
    try:
        async for session in get_db_session_context():
            kb_file_service = KBFileService(session)
            await kb_file_service.process_file(...)
            break
    except Exception as e:
        logger.exception(f"后台任务执行失败：{e}")
```

---

### 4. **应用启动逻辑修改**

#### `app/__init__.py`

**关键修改**:
1. ✅ 在 `lifespan()` 中调用 `_resume_pending_file_tasks()`
2. ✅ 新增 `_resume_pending_file_tasks()` 函数
3. ✅ 新增 `_resume_single_file_task()` 函数

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(database_url)
    
    # ✅ 恢复未完成的任务
    await _resume_pending_file_tasks()
    
    logger.info("应用启动完成")
    yield
```

**恢复逻辑**:
```python
async def _resume_pending_file_tasks():
    """恢复所有 pending/processing 状态的任务"""
    async for session in get_db_session_context():
        file_repo = KBFileRepository(session)
        
        # 查询未完成任务
        pending_files = await file_repo.get_files_by_status(
            statuses=["pending", "processing"]
        )
        
        logger.info(f"📋 发现 {len(pending_files)} 个未完成任务")
        
        for file_record in pending_files:
            # 检查文件是否存在
            if not Path(file_record.file_path).exists():
                logger.error(f"❌ 文件不存在：{file_record.display_name}")
                await file_repo.update_processing_status(
                    file_id=file_record.id,
                    status="failed",
                    error_message="文件丢失"
                )
                continue
            
            # 重新启动任务
            logger.info(f"🔄 恢复任务：{file_record.display_name}")
            asyncio.create_task(_resume_single_file_task(file_record, session))
        
        break
```

---

### 5. **数据库迁移文件**

#### `migrations/versions/0012_add_file_path_to_kb_file.py`
- ✅ 创建 Alembic 迁移文件（revision: 0012）
- 添加 `file_path` 字段到 `kb_file` 表

#### `run_add_file_path_migration.py`
- ✅ 创建手动运行迁移的脚本
- 使用 SQLAlchemy 直接执行 ALTER TABLE

---

## 🚀 需要手动执行的步骤

### Step 1: 运行数据库迁移

**方法 1: 使用 Alembic（推荐）**

```bash
cd d:\编程开发\AI\ai_chat\backend
# 激活虚拟环境（如果有）
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac

# 运行迁移
alembic upgrade head
```

**方法 2: 手动运行迁移脚本**

```bash
cd d:\编程开发\AI\ai_chat\backend
# 激活虚拟环境
.\venv\Scripts\activate

# 运行迁移脚本
python run_add_file_path_migration.py
```

**方法 3: 直接在数据库中执行 SQL**

如果使用 SQLite，可以直接执行：

```sql
-- 打开数据库
sqlite3 data/app.db

-- 添加字段
ALTER TABLE kb_file ADD COLUMN file_path VARCHAR(500) NULL;

-- 验证
.schema kb_file

-- 退出
.exit
```

---

### Step 2: 测试验证

#### 测试场景 1: 正常上传流程

**操作步骤**:
1. 启动后端服务
2. 上传一个 PDF 文件
3. 观察日志和状态变化

**预期日志**:
```
INFO: 文件记录已创建：test.pdf, KB=xxx, File ID=yyy
INFO: 文件上传成功：test.pdf, KB=xxx, File ID=yyy
INFO: 开始处理文件：test.pdf (KB: xxx)
INFO: 创建文件记录：yyy
INFO: 文件解析完成
INFO: 文本分块完成：共 10 个分块
INFO: 文件处理完成：test.pdf, 分块数=10
```

**预期现象**:
- ✅ 上传后立即开始处理（不再是 pending）
- ✅ 状态实时更新：uploading → processing → completed
- ✅ 前端实时显示最新状态

---

#### 测试场景 2: 服务重启恢复

**操作步骤**:
1. 上传文件，状态变为 processing
2. **重启后端服务**
3. 观察是否自动恢复

**预期日志**:
```
INFO: 应用启动中...
INFO: 📋 发现 1 个未完成任务，准备恢复...
INFO: 🔄 恢复任务：test.pdf (status=processing)
INFO: 开始处理文件：test.pdf (KB: xxx)
INFO: 文件解析完成
INFO: ✅ 任务恢复成功：test.pdf
INFO: 应用启动完成
```

**预期现象**:
- ✅ 服务重启后自动扫描未完成任务
- ✅ 自动恢复任务执行
- ✅ 状态持续更新，不会卡住

---

## 📊 修复前后对比

### 修复前（❌）

| 问题 | 现象 | 原因 |
|------|------|------|
| 上传后不处理 | 状态一直是 pending | BackgroundTasks 使用错误 |
| 重启后任务丢失 | 需要重新上传 | 没有恢复机制 |
| 文件路径丢失 | 重启后找不到文件 | 未保存到数据库 |

### 修复后（✅）

| 改进 | 效果 | 实现方式 |
|------|------|----------|
| 自动开始处理 | 上传后立即处理 | asyncio.create_task |
| 重启自动恢复 | 任务不丢失 | lifespan + 扫描数据库 |
| 路径持久化 | 重启后能找到文件 | file_path 字段 |

---

## ⚠️ 注意事项

### 1. **虚拟环境**

确保在正确的 Python 环境中运行：

```bash
# 检查当前 Python 环境
python --version
which python  # Linux/Mac
where python  # Windows

# 激活虚拟环境
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac
```

### 2. **数据库备份**

在运行迁移前，建议备份数据库：

```bash
# SQLite 备份
cp data/app.db data/app.db.backup

# 如果迁移失败，可以恢复
cp data/app.db.backup data/app.db
```

### 3. **日志监控**

启动服务后，密切观察日志：

```bash
# 查看日志
tail -f logs/app.log  # Linux/Mac
Get-Content logs/app.log -Tail 100 -Wait  # PowerShell
```

**关键日志标记**:
- `📋 发现 X 个未完成任务` - 启动时扫描
- `🔄 恢复任务：xxx` - 任务恢复
- `✅ 任务恢复成功` - 恢复成功
- `❌ 文件不存在` - 文件丢失警告

---

## 🎯 验证清单

### 代码修改完整性

- [x] `models/kb_file.py` - 添加 file_path 字段
- [x] `repositories/kb_file_repository.py` - 添加 get_files_by_status 方法
- [x] `routes/kb_files.py` - 修改上传逻辑，使用 asyncio.create_task
- [x] `app/__init__.py` - 添加启动恢复逻辑
- [x] `migrations/versions/0012_*.py` - 创建迁移文件
- [x] `run_add_file_path_migration.py` - 创建手动迁移脚本

### 待完成步骤

- [ ] **运行数据库迁移**（必须）
- [ ] **启动后端服务测试**（必须）
- [ ] **测试正常上传流程**（必须）
- [ ] **测试服务重启恢复**（必须）

---

## 📝 下一步行动

1. **立即执行**:
   ```bash
   cd d:\编程开发\AI\ai_chat\backend
   # 激活虚拟环境
   .\venv\Scripts\activate
   
   # 运行迁移
   python run_add_file_path_migration.py
   
   # 启动服务
   python run.py
   ```

2. **测试验证**:
   - 上传一个文件，观察是否自动开始处理
   - 重启服务，观察是否自动恢复

3. **观察日志**:
   - 关注 `📋`、`🔄`、`✅`、`❌` 等关键标记
   - 确认任务正常执行

---

**实施时间**: 2026-04-01  
**版本**: v4.0 (Backend Processing Fix)  
**状态**: ✅ 代码已完成，待运行迁移和测试  
**文档位置**: `backend/docs/knowledge_base/IMPLEMENTATION_SUMMARY.md`
