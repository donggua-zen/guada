# 数据库重置工具 - 快速参考

## 快速开始

```bash
# 强制重置数据库（推荐用于开发/测试环境）
cd d:\编程开发\AI\ai_chat\backend
.\.venv\Scripts\python.exe reset_database.py --force

# 交互式重置（生产环境建议使用）
.\.venv\Scripts\python.exe reset_database.py
```

## 作为 Python 模块调用

```python
import asyncio
from reset_database import reset_database

# 在异步代码中使用
async def setup_test_environment():
    await reset_database(force=True)
    # 继续其他设置...

# 运行
asyncio.run(setup_test_environment())
```

## 主要功能

| 功能 | 描述 |
|------|------|
| 清空数据 | 删除所有表中的数据，处理外键约束 |
| 重建表结构 | 删除旧表并重新创建 |
| 导入默认数据 | 管理员用户、模型、角色、知识库等 |
| 详细日志 | 控制台 + 文件 (`logs/reset_database.log`) |
| 安全确认 | 交互式模式需要用户确认 |

## 默认凭据

```
邮箱：admin@example.com
密码：admin123
角色：admin
```

## 常见问题

**Q: 执行失败怎么办？**  
A: 检查日志文件 `logs/reset_database.log` 获取详细错误信息

**Q: 可以只清空数据不重建表吗？**  
A: 当前不支持，如需此功能可修改脚本

**Q: 如何自定义默认数据？**  
A: 编辑 `reset_database.py` 中的 `import_default_data()` 函数
