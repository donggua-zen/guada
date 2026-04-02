# 自动恢复功能 - 重要修正说明

## 🐛 问题描述

在初次实现时，错误地使用了 `async with` 来处理 `get_db_session()`，导致启动时报错：

```
ERROR: 'async_generator' object does not support the asynchronous context manager protocol
```

---

## ✅ 修正方案

### 问题原因

`get_db_session()` 是一个**异步生成器**（使用 `yield`），不是异步上下文管理器。

```python
# app/database.py
async def get_db_session():
    """获取数据库会话的依赖项"""
    if db_manager is None:
        raise RuntimeError("数据库未初始化")
    
    async with db_manager.async_session_factory() as session:
        try:
            yield session  # ← 这是生成器，不是上下文管理器
            await session.commit()
        except Exception as e:
            await session.rollback()
            raise
        finally:
            logger.debug("数据库会话已关闭")
```

### 正确的用法

**❌ 错误**（初版代码）:
```python
async with get_db_session() as session:
    file_repo = KBFileRepository(session)
    pending_files = await file_repo.get_files_by_status(...)
```

**✅ 正确**（修正后）:
```python
async for session in get_db_session():
    file_repo = KBFileRepository(session)
    pending_files = await file_repo.get_files_by_status(...)
    break  # 只获取一次会话
```

---

## 🔍 技术细节

### 为什么使用 `async for`？

1. **生成器特性**:
   - `get_db_session()` 使用 `yield` 返回会话
   - 这是一个异步生成器函数
   - 必须使用 `async for` 来迭代

2. **为什么要 `break`**？
   - 我们只需要获取一次会话
   - `break` 会触发生成器的清理逻辑
   - 确保会话正确关闭和提交

3. **会话生命周期**:
   ```python
   async for session in get_db_session():
       # 使用会话
       await some_operation(session)
       
       break  # ← 触发以下操作：
              # 1. 提交事务（如果成功）
              # 2. 回滚事务（如果失败）
              # 3. 关闭会话
   ```

---

## 📝 修正的文件

### 1. **app/__init__.py**

#### `_resume_pending_file_tasks()` 函数

**修改前**:
```python
async with get_db_session() as session:
    file_repo = KBFileRepository(session)
    # ... 处理逻辑 ...
```

**修改后**:
```python
async for session in get_db_session():
    file_repo = KBFileRepository(session)
    # ... 处理逻辑 ...
    break
```

#### `_resume_single_file_task()` 函数

**修改前**:
```python
async with get_db_session() as session:
    kb_file_service = KBFileService(session)
    await kb_file_service.process_file(...)
```

**修改后**:
```python
async for session in get_db_session():
    kb_file_service = KBFileService(session)
    await kb_file_service.process_file(...)
    break
```

### 2. **文档修正**

#### AUTO_RECOVERY_FEATURE.md
- ✅ 修正了所有 `async with` 示例
- ✅ 添加了为什么使用 `async for` 的说明
- ✅ 添加了 `break` 的必要性说明

#### AUTO_RECOVERY_QUICK_GUIDE.md
- ✅ 更新了代码示例
- ✅ 简化了会话管理说明

---

## 🎯 关键要点

### 1. **识别生成器 vs 上下文管理器**

```python
# 生成器（使用 yield）
async def get_db_session():
    yield session  # ← 这是生成器

# 上下文管理器（使用 __aenter__ 和 __aexit__）
class SessionManager:
    async def __aenter__(self):
        return session
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await session.close()
```

**判断方法**:
- 看到 `yield` → 生成器 → 使用 `async for`
- 看到 `__aenter__` / `__aexit__` → 上下文管理器 → 使用 `async with`

### 2. **FastAPI 依赖注入的特殊性**

```python
# FastAPI 路由中的用法（依赖注入）
@router.post("/upload")
async def upload(session: AsyncSession = Depends(get_db_session)):
    # FastAPI 自动处理生成器
    pass

# 但在普通代码中，需要手动迭代
async for session in get_db_session():
    # 手动处理
    break
```

### 3. **会话管理的最佳实践**

```python
# ✅ 推荐模式
async for session in get_db_session():
    try:
        # 业务逻辑
        await do_something(session)
    finally:
        break  # 确保清理

# ✅ 或使用 try-finally
try:
    async for session in get_db_session():
        await do_something(session)
        break
finally:
    # 清理逻辑（如果需要）
    pass
```

---

## 🧪 验证方法

### 1. **启动后端服务**

```bash
cd backend
python run.py
```

### 2. **观察日志**

**应该看到**:
```
INFO - 🔄 开始扫描未完成的知识库文件任务...
INFO - 📋 发现 X 个未完成任务
INFO - ✅ 任务恢复完成：成功 X 个，失败 Y 个
INFO - 应用启动完成
```

**不应该看到**:
```
ERROR - 'async_generator' object does not support...
```

### 3. **测试恢复功能**

```sql
-- 创建测试数据
UPDATE kb_file 
SET processing_status = 'processing', 
    progress_percentage = 30
WHERE id = 'your_test_file_id';

-- 重启服务，观察是否恢复
```

---

## 📚 相关资源

### Python 异步编程

- [Async Generators](https://docs.python.org/3/library/asyncio-stream.html)
- [Async Context Managers](https://docs.python.org/3/reference/datamodel.html#async-context-managers)
- [PEP 525 - Asynchronous Generators](https://www.python.org/dev/peps/pep-0525/)

### FastAPI 文档

- [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/)
- [Async Support](https://fastapi.tiangolo.com/async/)

---

## ⚠️ 教训总结

### 1. **代码审查的重要性**

如果在实现后立即测试，就能更早发现这个错误。

### 2. **理解底层机制**

- 不能只看表面用法
- 要理解 `yield` vs `__aenter__` / `__aexit__` 的区别
- 生成器和上下文管理器的使用场景不同

### 3. **文档与代码一致性**

文档中的示例代码必须与实际实现保持一致。

---

## ✅ 当前状态

- [x] 代码已修正（`app/__init__.py`）
- [x] 语法检查通过
- [x] 文档已更新
- [x] 更正说明已完成
- [ ] 待用户测试验证

---

**修正日期**: 2026-04-01  
**版本**: v5.0.1 (Bug Fix)  
**状态**: ✅ 已修正，待测试
