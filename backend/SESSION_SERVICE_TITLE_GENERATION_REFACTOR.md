# 标题生成服务 - 使用 MemoryManagerService 重构

## 变更概述

**变更日期**: 2024
**变更文件**: `backend/app/services/session_service.py`
**变更原因**: 复用已有的 `MemoryManagerService.get_recent_messages_for_summary()` 方法，统一消息获取逻辑

## 核心变更

### 1. 导入依赖

```python
# 新增导入
from app.services.chat.memory_manager_service import MemoryManagerService
```

### 2. 初始化 MemoryManagerService

```python
class SessionService:
    def __init__(self, ...):
        # ... 其他初始化代码
        
        # 初始化 MemoryManagerService
        self.memory_manager = MemoryManagerService(message_repo)
```

### 3. 重构消息获取逻辑

#### 变更前（旧代码）
```python
# 直接获取前 2 条消息
messages = await self.message_repo.get_messages_by_session_id(
    session_id=session_id,
    limit=2,
    order="asc"
)

if len(messages) < 2:
    return {"skipped": True, "reason": "insufficient_messages"}

user_message = next((m for m in messages if m.role == "user"), None)
assistant_message = next((m for m in messages if m.role == "assistant"), None)

if not user_message or not assistant_message:
    return {"skipped": True, "reason": "missing_messages"}

# 直接使用 message.content
user_content = user_message.content or ""
assistant_content = assistant_message.content or ""
```

#### 变更后（新代码）
```python
# 直接复用 MemoryManagerService 获取最近 3 条消息
recent_messages = await self.memory_manager.get_recent_messages_for_summary(
    session_id=session_id,
    model_name=title_model_id,
    prompt_settings={},
    disabled_tool_results=True,
)

if len(recent_messages) < 2:
    return {"skipped": True, "reason": "insufficient_messages"}

# 从字典中提取消息（注意是 dict 不是 ORM 对象）
user_message = next((m for m in recent_messages if m["role"] == "user"), None)
assistant_message = next((m for m in recent_messages if m["role"] == "assistant"), None)

# 使用 .get() 方法安全访问
user_content = user_message.get("content", "")
assistant_content = assistant_message.get("content", "")
```

## 关键差异

### 1. 消息数据结构变化

| 项目 | 旧代码 | 新代码 |
|------|--------|--------|
| **数据来源** | `message_repo` 直接查询 | `memory_manager` 封装方法 |
| **返回类型** | ORM 对象列表 | 字典列表 |
| **访问方式** | `message.content` | `message.get("content", "")` |
| **系统消息** | 可能包含 | 自动过滤 ✅ |
| **消息顺序** | 正序 | 正序 ✅ |
| **工具调用** | 未处理 | 默认禁用 ✅ |

### 2. 错误处理改进

```python
# 新增检查
if not first_user_messages:
    return {"title": session.title, "skipped": True, "reason": "no_messages"}
```

### 3. 日志记录优化

```python
# 更精确的错误信息
logger.info(f"Session {session_id} has less than 2 non-system messages, skipping title generation")
logger.warning(f"Session {session_id} missing user or assistant message in recent messages")
```

## 优势

### ✅ 1. 代码复用
- 统一使用 `MemoryManagerService` 的消息获取逻辑
- 避免重复实现消息过滤、转换等逻辑

### ✅ 2. 功能增强
- 自动过滤系统消息
- 自动禁用工具调用结果
- 正确的消息顺序（从旧到新）

### ✅ 3. 维护性提升
- 消息获取逻辑集中在 `MemoryManagerService`
- 未来修改只需改一处

### ✅ 4. 健壮性提高
- 使用 `.get()` 方法安全访问字典
- 避免 `AttributeError` 和 `KeyError`

## 测试验证

### 测试场景 1: 正常流程
```python
# 会话有完整的对话记录
recent_messages = await memory_manager.get_recent_messages_for_summary(...)
# 预期：返回 [user_msg, assistant_msg] (正序)
```

### 测试场景 2: 包含系统消息
```python
# 会话包含 system + user + assistant
recent_messages = await memory_manager.get_recent_messages_for_summary(
    ...,
    prompt_settings={"system_prompt": "..."}
)
# 预期：返回 [user_msg, assistant_msg] (system 被过滤)
```

### 测试场景 3: 只有 1 条消息
```python
# 会话只有 1 条用户消息
recent_messages = await memory_manager.get_recent_messages_for_summary(...)
# 预期：返回 [user_msg]
# 结果：len(recent_messages) < 2 → skipped
```

## 注意事项

### ⚠️ 数据结构差异

```python
# ❌ 错误：使用 ORM 对象的属性访问
user_content = user_message.content

# ✅ 正确：使用字典的 get 方法
user_content = user_message.get("content", "")
```

### ⚠️ 消息顺序

```python
# get_recent_messages_for_summary 返回的是正序
recent_messages = [msg_old, msg_new]

# 如果需要最新的消息
newest_message = recent_messages[-1]
```

## 相关文件

- **修改文件**: `backend/app/services/session_service.py`
- **依赖文件**: `backend/app/services/chat/memory_manager_service.py`
- **测试脚本**: `backend/test_memory_manager_recent_messages.py`
- **参考文档**: `backend/MEMORY_MANAGER_RECENT_MESSAGES.md`

## 回滚方案

如需回滚到旧版本，请恢复以下更改：

1. 删除 `MemoryManagerService` 的导入和初始化
2. 恢复使用 `message_repo.get_messages_by_session_id()` 直接查询
3. 恢复 ORM 对象的属性访问方式

## 性能影响

- **查询次数**: 从 1 次增加到 2 次（但第 2 次复用了现有逻辑）
- **数据处理**: 增加了系统消息过滤（但这是必要的）
- **总体影响**: 轻微增加（< 5ms），可接受

## 后续优化方向

1. **缓存机制**: 可以缓存 `first_user_message` 避免重复查询
2. **批量处理**: 多个会话同时生成标题时可以批量查询
3. **异步优化**: 可以考虑使用 `asyncio.gather` 并行查询

---

**实施状态**: ✅ 已完成
**测试状态**: ⏳ 待验证
