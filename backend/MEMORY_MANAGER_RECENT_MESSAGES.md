# MemoryManagerService - 获取最近消息功能

## 新增方法

### `get_recent_messages_for_summary()`

获取最近的 3 条消息用于标题生成或其他总结任务。

#### 方法签名

```python
async def get_recent_messages_for_summary(
    self,
    session_id: str,                    # 会话 ID
    model_name: str,                    # 模型名称（用于 tokenizer）
    prompt_settings: dict = {},         # 提示词配置（可能包含系统消息）
    disabled_tool_results: bool = True, # 是否禁用工具调用结果
) -> list[dict]:
```

#### 返回值

- **类型**: `list[dict]`
- **内容**: 最多 3 条消息（不含系统消息）
- **顺序**: 按时间正序排列（从旧到新）
- **示例**:
  ```python
  [
      {
          "role": "user",
          "content": "如何使用 Python 读取 CSV 文件？"
      },
      {
          "role": "assistant",
          "content": "可以使用 csv 模块...",
          "reasoning_content": "思考过程..."
      }
  ]
  ```

## 核心特性

### ✅ 1. 严格限制 3 条消息
```python
messages = await memory_manager.get_recent_messages_for_summary(
    session_id="session_123",
    model_name="gpt-4o-mini",
    user_message_id="msg_456",
    max_messages=3,  # 内部固定为 3
)
# 返回：最多 3 条消息
```

### ✅ 2. 自动过滤系统消息
```python
messages = await memory_manager.get_recent_messages_for_summary(
    session_id="session_123",
    model_name="gpt-4o-mini",
    user_message_id="msg_456",
    prompt_settings={
        "system_prompt": "你是一个 AI 助手",  # 会被过滤
        "use_user_prompt": False,
    },
)
# 返回：不包含 system role 的消息
```

### ✅ 3. 正确的消息顺序
```python
# get_conversation_messages() 返回的是倒序（从新到旧）
all_messages = [..., msg_newest, msg_middle, msg_oldest]

# get_recent_messages_for_summary() 会反转成正序
result = [msg_oldest, msg_middle, msg_newest]
```

### ✅ 4. 默认禁用工具调用结果
```python
messages = await memory_manager.get_recent_messages_for_summary(
    session_id="session_123",
    model_name="gpt-4o-mini",
    user_message_id="msg_456",
    disabled_tool_results=True,  # 默认值，过滤 tool_calls
)
```

## 使用场景

### 场景 1: 自动生成会话标题

```python
# 在 session_service.py 中
async def generate_session_title(self, session_id: str, user: User) -> dict:
    # 获取第一条用户消息
    messages = await self.message_repo.get_messages_by_session_id(
        session_id=session_id,
        limit=1,
        order="asc"
    )
    first_user_message = messages[0] if messages else None
    
    if not first_user_message:
        return {"title": session.title, "skipped": True}
    
    # 获取最近的对话消息（用于生成标题）
    recent_messages = await self.memory_manager.get_recent_messages_for_summary(
        session_id=session_id,
        model_name=title_model_id,
        user_message_id=first_user_message.id,
        prompt_settings={},
        disabled_tool_results=True,
    )
    
    # 构建提示词
    title_prompt = "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题..."
    messages_text = "\n\n".join([
        f"{msg['role']}: {msg['content']}" 
        for msg in recent_messages
    ])
    
    prompt = f"{title_prompt}\n\n{messages_text}\n\n生成的标题："
    
    # 调用 LLM 生成标题
    response = await llm_service.completions(...)
    new_title = response.choices[0].message.content.strip()
    
    # 更新会话标题
    session.title = new_title
    await self.session_repo.session.flush()
    
    return {"title": new_title, "skipped": False}
```

### 场景 2: 对话总结

```python
# 定期总结对话历史，压缩 token 使用
async def summarize_conversation(session_id: str, current_message_id: str):
    recent_messages = await memory_manager.get_recent_messages_for_summary(
        session_id=session_id,
        model_name="gpt-4o-mini",
        user_message_id=current_message_id,
        disabled_tool_results=True,
    )
    
    # 构建总结提示词
    summary_prompt = "请总结以下对话的核心内容..."
    messages_text = "\n\n".join([
        f"{msg['role']}: {msg['content']}" 
        for msg in recent_messages
    ])
    
    # 调用 LLM 生成总结
    summary = await llm_generate_summary(summary_prompt + "\n\n" + messages_text)
    
    return summary
```

### 场景 3: 上下文窗口管理

```python
# 当对话过长时，使用最近的消息作为精简上下文
async def manage_context_window(session_id: str, current_message_id: str):
    # 获取最近 3 条消息作为即时上下文
    recent_context = await memory_manager.get_recent_messages_for_summary(
        session_id=session_id,
        model_name=model_name,
        user_message_id=current_message_id,
    )
    
    # 添加到系统提示中
    context_system_message = {
        "role": "system",
        "content": f"最近对话摘要：\n{format_messages(recent_context)}"
    }
    
    return context_system_message
```

## 与 get_conversation_messages 的对比

| 特性 | get_conversation_messages | get_recent_messages_for_summary |
|------|--------------------------|--------------------------------|
| **消息数量** | 可配置（默认 200） | 固定 3 条 |
| **返回顺序** | 倒序（从新到旧） | 正序（从旧到新） |
| **系统消息** | 包含在最后 | 自动过滤 |
| **主要用途** | 完整的对话历史 | 总结任务、标题生成 |
| **工具调用** | 可配置 | 默认禁用 |

## 数据流示意图

```
用户发送消息
    ↓
get_conversation_messages(max_messages=3)
    ↓
返回倒序消息：[最新，中间，最旧] (+ 系统消息)
    ↓
过滤系统消息
    ↓
[最新，中间，最旧]
    ↓
reverse() 反转
    ↓
[最旧，中间，最新]
    ↓
取前 3 条 [:3]
    ↓
返回给调用方
```

## 测试验证

### 运行测试脚本

```bash
cd backend
python test_memory_manager_recent_messages.py
```

### 测试覆盖场景

1. ✅ **正常流程**: 有 3 条以上消息
2. ✅ **边界情况 1**: 只有 1 条消息
3. ✅ **边界情况 2**: 系统消息 + 2 条普通消息
4. ✅ **边界情况 3**: 超过 3 条消息
5. ✅ **顺序验证**: 确保从旧到新
6. ✅ **过滤验证**: 系统消息被过滤
7. ✅ **工具调用验证**: disabled_tool_results 生效

## 注意事项

### ⚠️ 1. 消息顺序
```python
# ❌ 错误：假设返回的是倒序
messages = await get_recent_messages_for_summary(...)
newest_message = messages[0]  # 错误！这是最旧的消息

# ✅ 正确：
messages = await get_recent_messages_for_summary(...)
oldest_message = messages[0]    # 最旧的消息
newest_message = messages[-1]   # 最新的消息
```

### ⚠️ 2. 系统消息处理
```python
# ✅ 即使传入了 system_prompt，也会被过滤
messages = await get_recent_messages_for_summary(
    ...,
    prompt_settings={"system_prompt": "..."},  # 会被忽略
)
# result 中不包含 system role
```

### ⚠️ 3. 数量限制
```python
# ✅ 固定为 3 条，无法通过参数修改
messages = await get_recent_messages_for_summary(...)
assert len(messages) <= 3  # 始终成立
```

## 性能优化

### Token 计算
```python
# 如果需要计算 token 数
from app.tokenizer.auto_tokenizer import get_tokenizer

tokenizer = get_tokenizer(model_name)
tokens_total = sum(
    tokenizer.count_tokens(msg["content"]) 
    for msg in recent_messages
)
```

### 批量处理
```python
# 多个会话同时生成标题
tasks = [
    memory_manager.get_recent_messages_for_summary(
        session_id=session_id,
        model_name=model_name,
        user_message_id=message_id,
    )
    for session_id, message_id in sessions
]

results = await asyncio.gather(*tasks)
```

## 日志记录

```python
# 方法内部已包含日志记录
logger.debug(f"获取会话 {session_id} 的最近消息")
logger.info(f"成功获取 {len(messages)} 条消息用于总结")
```

## 相关文件

- **实现文件**: `backend/app/services/chat/memory_manager_service.py`
- **测试脚本**: `backend/test_memory_manager_recent_messages.py`
- **参考文档**: `backend/MEMORY_MANAGER_RECENT_MESSAGES.md` (本文件)
