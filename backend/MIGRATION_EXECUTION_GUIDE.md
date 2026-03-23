# 数据库迁移执行指南

## 🚀 快速执行 (推荐)

### 一键执行命令

```bash
cd backend
alembic upgrade head
```

如果成功，你会看到类似输出:
```
INFO  [alembic.runtime.migration] Context impl SQLiteImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade d8dc8ea173ed -> add_character_id_to_session
```

### ✅ 验证迁移成功

```bash
python -c "
from app.database import AsyncSessionLocal
from sqlalchemy import select, inspect
from app.models.session import Session
import asyncio

async def check():
    async with AsyncSessionLocal() as session:
        # 检查列是否存在
        inspector = inspect(session.bind.sync_engine)
        columns = inspector.get_columns('session')
        column_names = [col['name'] for col in columns]
        
        if 'character_id' in column_names:
            print('✅ character_id 列已成功添加')
        else:
            print('❌ character_id 列不存在')
            
        # 检查索引
        indexes = inspector.get_indexes('session')
        index_names = [idx['name'] for idx in indexes]
        
        if 'ix_session_character_id' in index_names:
            print('✅ character_id 索引已成功创建')
        else:
            print('⚠️  索引未创建 (不影响功能)')

asyncio.run(check())
"
```

## 🔧 故障排除

### 情况 1: 之前的迁移失败

**症状**: 提示表已存在或其他错误

**解决方案**:
```bash
# 1. 回滚到上一个版本
alembic downgrade -1

# 2. 重新升级
alembic upgrade head
```

### 情况 2: 完全重置 (测试环境)

**警告**: 这会删除所有数据!

```bash
# 1. 删除数据库文件
rm data/app.db

# 2. 清除迁移记录
alembic stamp base

# 3. 重新应用所有迁移
alembic upgrade head
```

### 情况 3: 检查当前迁移状态

```bash
# 查看当前版本
alembic current

# 查看所有迁移历史
alembic history

# 查看待应用的迁移
alembic heads
```

## 📋 详细步骤说明

### 步骤 1: 准备工作

```bash
# 确保在正确的目录
cd backend

# 确认虚拟环境已激活
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# 或者看到命令行前缀有 (.venv)
```

### 步骤 2: 备份数据库 (重要!)

```bash
# 备份现有数据库
cp data/app.db data/app.db.backup.$(date +%Y%m%d_%H%M%S)

# 确认备份成功
ls -lh data/app.db.backup.*
```

### 步骤 3: 执行迁移

```bash
# 应用所有待执行的迁移
alembic upgrade head
```

### 步骤 4: 验证结果

```bash
# 方法 1: 使用 SQLite 命令行
sqlite3 data/app.db ".schema session"

# 方法 2: 使用 Python 脚本 (见上方"验证迁移成功")

# 方法 3: 查看 Alembic 版本表
sqlite3 data/app.db "SELECT * FROM alembic_version;"
```

预期应该看到 `character_id` 相关的列和索引。

## 🧪 运行功能测试

迁移成功后，运行测试验证功能:

```bash
# 运行继承功能测试
python test_session_character_inheritance.py

# 或者运行所有集成测试
pytest app/tests/integration/ -v
```

## ⚠️ 常见问题解决

### 问题 1: "No such table: session"

**原因**: 数据库文件或路径错误

**解决**:
```bash
# 检查数据库文件是否存在
ls -lh data/app.db

# 如果不存在，检查配置
cat app/config.py | grep DATABASE_URL
```

### 问题 2: "Table 'session' already exists"

**原因**: 尝试重复应用迁移

**解决**:
```bash
# 标记迁移为已应用 (不实际执行)
alembic stamp add_character_id_to_session

# 或者直接升级到最新版本
alembic upgrade head
```

### 问题 3: "Foreign key constraint failed"

**原因**: 数据不一致 (罕见)

**解决**:
```bash
# 如果是测试环境，直接重置
rm data/app.db
alembic stamp base
alembic upgrade head

# 如果是生产环境，需要手动修复数据
# 联系技术支持
```

### 问题 4: 外键约束报错 (SQLite)

**原因**: 使用了 `op.create_foreign_key()` 

**解决**: 已经修复！使用更新后的迁移文件即可。

## 📊 迁移前后对比

### 迁移前
```sql
CREATE TABLE session (
    id VARCHAR(26) PRIMARY KEY,
    title VARCHAR(255),
    user_id VARCHAR(26),
    avatar_url VARCHAR(255),
    description VARCHAR(512),
    model_id VARCHAR(26),
    settings JSON,
    created_at DATETIME,
    updated_at DATETIME
);
```

### 迁移后
```sql
CREATE TABLE session (
    id VARCHAR(26) PRIMARY KEY,
    title VARCHAR(255),
    user_id VARCHAR(26),
    avatar_url VARCHAR(255),
    description VARCHAR(512),
    model_id VARCHAR(26),
    character_id VARCHAR(26),  -- ✨ 新增
    settings JSON,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE INDEX ix_session_character_id ON session (character_id);  -- ✨ 新增
```

## 🎯 下一步

迁移成功后:

1. ✅ **重启后端服务**
   ```bash
   # 停止当前运行的服务 (Ctrl+C)
   python run.py
   ```

2. ✅ **更新前端代码**
   ```bash
   cd ../frontend
   npm run dev
   ```

3. ✅ **测试完整功能**
   - 访问角色页面
   - 选择角色创建会话
   - 验证配置继承

## 📞 需要帮助？

如果遇到问题:

1. 查看详细文档：[SQLITE_MIGRATION_FIX.md](./SQLITE_MIGRATION_FIX.md)
2. 检查日志文件：`logs/app.log`
3. 运行诊断脚本：
   ```bash
   python -c "
   from app.database import engine
   from sqlalchemy import text
   
   with engine.connect() as conn:
       result = conn.execute(text('PRAGMA table_info(session)'))
       for row in result:
           print(row)
   "
   ```

---

**最后更新**: 2026-03-23  
**适用版本**: SQLite 3.x, Alembic 1.x  
**预计耗时**: 2-5 分钟
