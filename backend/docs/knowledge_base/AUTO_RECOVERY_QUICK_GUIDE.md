# 知识库文件处理自动恢复功能 - 快速指南

## 🎯 功能目标

确保后端服务重启后，能够自动恢复未完成的文件处理任务。

---

## 📁 修改的文件

### 1. `app/__init__.py`

**修改内容**:
- ✅ 完善 `_resume_pending_file_tasks()` 函数
- ✅ 新增 `_resume_single_file_task()` 函数
- ✅ 在 `lifespan()` 中调用恢复逻辑

**核心代码**:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(database_url)
    
    # ✅ 恢复未完成的任务
    await _resume_pending_file_tasks()
    
    logger.info("应用启动完成")
    yield
    await close_db()
```

---

## 🔑 关键特性

### 1. **智能恢复策略**

```
扫描数据库 → 检查文件 → 恢复任务
    ↓           ↓          ↓
pending/   存在？    asyncio.create_task
processing         ↓
              不存在 → 标记 failed
```

### 2. **并发控制保护**

- ✅ 使用类级别信号量 `Semaphore(1)`
- ✅ 所有恢复任务共享同一个信号量
- ✅ 确保只有一个文件在处理

### 3. **数据库会话隔离**

```python
# 恢复时使用独立会话
async for session in get_db_session():
    # 每个任务都有自己的会话
    await _resume_single_file_task(...)
    break
```

---

## 🧪 测试方法

### 快速测试

1. **上传文件**:
   ```bash
   curl -X POST http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/upload \
     -F "file=@test.pdf"
   ```

2. **观察状态** (等待变为 processing):
   ```bash
   curl http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/{file_id}/status
   ```

3. **重启服务**:
   ```bash
   # 停止当前服务
   Ctrl+C
   
   # 重新启动
   python run.py
   ```

4. **查看日志**:
   ```bash
   tail -f logs/app.log
   ```

**预期输出**:
```
INFO - 🔄 开始扫描未完成的知识库文件任务...
INFO - 📋 发现 1 个未完成任务
INFO - 🔄 准备恢复任务：test.pdf
INFO - ▶️ 开始恢复任务：test.pdf
INFO - 开始处理文件：test.pdf
INFO - ✅ 任务恢复成功：test.pdf
```

---

## 📊 状态流转

```
上传 → pending → (重启) → processing → completed
                ↓
            (文件丢失) → failed
```

---

## 🔍 验证 SQL

```sql
-- 查看未完成任务
SELECT id, display_name, processing_status, progress_percentage, current_step
FROM kb_file
WHERE processing_status IN ('pending', 'processing')
ORDER BY uploaded_at DESC;

-- 查看恢复成功的任务
SELECT id, display_name, processing_status, processed_at
FROM kb_file
WHERE processing_status = 'completed'
ORDER BY processed_at DESC
LIMIT 10;
```

---

## ⚠️ 注意事项

1. **不要删除物理文件**
   - 文件路径保存在 `file_path` 字段
   - 删除后无法恢复

2. **监控日志**
   - 关注 `🔄` emoji 开头的日志
   - 这些是恢复任务的关键日志

3. **并发限制**
   - 默认同时只处理 1 个文件
   - 如需调整，修改 `KBFileService._processing_semaphore`

---

## 🚨 故障排查

### 没有自动恢复？

**检查点**:
1. 数据库中是否有 `pending/processing` 状态的记录？
2. 日志级别是否为 `INFO`？
3. `_resume_pending_file_tasks()` 是否被调用？

**SQL 检查**:
```sql
SELECT COUNT(*) FROM kb_file 
WHERE processing_status IN ('pending', 'processing');
```

### 恢复后卡住？

**可能原因**:
- 信号量被占用
- ChromaDB 连接问题
- Embedding API 超时

**解决方案**:
```bash
# 查看详细日志
tail -f logs/app.log | grep -E "(开始处理 | 向量化 | 完成)"
```

---

## 📝 技术细节

### 为什么不使用 BackgroundTasks？

**原因**:
- `BackgroundTasks` 是请求级别的
- 服务重启后不会执行
- 使用 `asyncio.create_task` 才是真正的异步任务

### 为什么需要独立会话？

**原因**:
- lifespan 中的会话与请求会话不同
- 避免会话关闭导致的问题
- 确保恢复任务的数据库操作独立性

### 信号量如何工作？

```python
# 类级别变量（全局唯一）
_processing_semaphore = asyncio.Semaphore(1)

# 所有实例共享
service1 = KBFileService(session1)
service2 = KBFileService(session2)
# service1._processing_semaphore is service2._processing_semaphore ✓
```

---

## 📋 核心函数说明

### `_resume_pending_file_tasks()`

**作用**: 主入口函数，扫描并恢复所有未完成任务

**执行流程**:
1. 创建独立数据库会话
2. 查询所有 `pending/processing` 状态的文件
3. 检查每个文件的物理存在性
4. 对存在的文件使用 `asyncio.create_task` 恢复
5. 对丢失的文件标记为 `failed`
6. 输出统计信息

**日志输出**:
- `🔄 开始扫描...` - 扫描开始
- `📋 发现 X 个未完成任务` - 扫描结果
- `✅ 任务恢复完成：成功 X 个，失败 Y 个` - 统计结果

### `_resume_single_file_task(...)`

**作用**: 恢复单个文件处理任务

**参数**:
- `file_id` - 文件 ID
- `knowledge_base_id` - 知识库 ID
- `file_path` - 文件绝对路径
- `file_name` - 原始文件名
- `display_name` - 显示名称
- `file_size` - 文件大小
- `file_type` - 文件类型
- `file_extension` - 文件扩展名

**执行流程**:
1. 创建独立数据库会话
2. 实例化 `KBFileService`
3. 调用 `process_file()` 方法
4. 等待信号量（并发控制）
5. 执行完整的文件处理流程

**日志输出**:
- `▶️ 开始恢复任务：xxx` - 恢复开始
- `✅ 任务恢复成功：xxx` - 恢复成功
- `❌ 任务恢复失败：xxx` - 恢复失败（带详细错误信息）

---

## 🎯 核心优势

| 特性 | 传统方案 | 本实现 |
|------|----------|--------|
| **任务持久化** | ❌ 重启后丢失 | ✅ 永久保存，随时恢复 |
| **并发控制** | ❌ 可能失控 | ✅ 严格 Semaphore(1) |
| **会话管理** | ❌ 可能冲突 | ✅ 完全隔离 |
| **错误处理** | ❌ 静默失败 | ✅ 详细日志 + 状态持久化 |
| **文件检查** | ❌ 无检查 | ✅ 物理文件验证 |

---

**更新日期**: 2026-04-01  
**版本**: v5.0  
**状态**: ✅ 已完成  
**详细文档**: `AUTO_RECOVERY_FEATURE.md`
