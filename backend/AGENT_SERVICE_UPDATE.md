# Agent Service 适配说明

## 概述

`agent_service.py` 已适配新的会话继承角色功能，支持从角色配置中继承默认设置，同时允许会话自定义覆盖。

## 核心变更

### 1. 设置合并逻辑

所有需要读取会话配置的地方都实现了**继承 + 覆盖**的合并策略:

```python
# 获取会话设置
session_settings = session.settings or {}

# 如果有绑定的角色，从角色设置中继承默认值
character_settings = {}
if hasattr(session, 'character') and session.character:
    character_settings = session.character.settings or {}

# 合并策略：会话设置优先，未设置的字段从角色继承
merged_settings = {**character_settings, **session_settings}
```

### 2. 修改的方法

#### `_get_conversation_messages` 方法
**用途**: 获取对话消息，构建提示词

**变更**:
- ✅ 支持从角色配置继承 `assistant_name`, `assistant_identity`, `system_prompt`
- ✅ 支持从角色配置继承 `max_memory_length`, `max_memory_tokens`
- ✅ 新增 `use_user_prompt` 参数的继承
- ✅ 处理模型可能为 None 的情况

```python
async def _get_conversation_messages(self, session, current_message_id: str):
    # 获取会话设置
    session_settings = session.settings or {}
    
    # 从角色设置继承
    character_settings = {}
    if hasattr(session, 'character') and session.character:
        character_settings = session.character.settings or {}
    
    # 合并：会话优先
    merged_settings = {**character_settings, **session_settings}
    
    return await self.memory_manager_service.get_conversation_messages(
        session_id=session.id,
        model_name=session.model.model_name if session.model else None,
        user_message_id=current_message_id,
        max_messages=merged_settings.get("max_memory_length", 9999) or 9999,
        prompt_settings={
            "assistant_name": merged_settings.get("assistant_name"),
            "assistant_identity": merged_settings.get("assistant_identity"),
            "system_prompt": merged_settings.get("system_prompt", ""),
            "use_user_prompt": merged_settings.get("use_user_prompt", False),
        },
    )
```

#### `_extract_model_params` 方法
**用途**: 提取模型参数用于 API 调用

**变更**:
- ✅ 支持从角色配置继承 `model_temperature`, `model_top_p`, `model_frequency_penalty`
- ✅ 支持从角色配置继承 `web_search_enabled`, `thinking_enabled`
- ✅ 增强空值检查，避免 AttributeError

```python
def _extract_model_params(self, session, model):
    # 获取会话设置
    session_settings = session.settings or {}
    
    # 从角色设置继承
    character_settings = {}
    if hasattr(session, 'character') and session.character:
        character_settings = session.character.settings or {}
    
    # 合并：会话优先
    merged_settings = {**character_settings, **session_settings}
    
    return {
        "web_search_enabled": merged_settings.get("web_search_enabled"),
        "thinking": (
            merged_settings.get("thinking_enabled")
            if model and "thinking" in (model.features or [])
            else None
        ),
        "temperature": merged_settings.get("model_temperature"),
        "top_p": merged_settings.get("model_top_p"),
        "frequency_penalty": merged_settings.get("model_frequency_penalty"),
        "use_user_prompt": merged_settings.get("use_user_prompt", False),
    }
```

#### `token_statistics` 方法
**用途**: 计算 token 使用统计

**变更**:
- ✅ 支持从角色配置继承所有相关设置
- ✅ 处理模型可能为 None 的情况
- ✅ 统一使用 `merged_settings`

```python
async def token_statistics(self, session_id: str) -> dict:
    session = await self.session_repo.get_session_by_id(session_id)
    
    # 获取并合并设置
    session_settings = session.settings or {}
    character_settings = (session.character.settings if session.character else {}) or {}
    merged_settings = {**character_settings, **session_settings}
    
    conversation_messages = await self.memory_manager_service.get_conversation_messages(
        session_id=session_id,
        model_name=session.model.model_name if session.model else None,
        user_message_id=None,
        max_messages=merged_settings.get("max_memory_length", 9999) or 9999,
        max_tokens=merged_settings.get("max_memory_tokens", 32 * 1024) or 32 * 1024,
        prompt_settings={
            "assistant_name": merged_settings.get("assistant_name"),
            "assistant_identity": merged_settings.get("assistant_identity"),
            "system_prompt": merged_settings.get("system_prompt", ""),
            "use_user_prompt": merged_settings.get("use_user_prompt", False),
        },
    )
    # ... 后续计算
```

## 继承优先级

```
用户会话设置 > 角色配置 > 系统默认值
```

### 示例

**角色配置**:
```json
{
  "assistant_name": "小智",
  "assistant_identity": "AI 助手",
  "system_prompt": "你是一个有帮助的 AI 助手",
  "model_temperature": 0.7,
  "model_top_p": 0.9,
  "max_memory_length": 10,
  "web_search_enabled": false
}
```

**会话自定义设置**:
```json
{
  "model_temperature": 0.9,
  "web_search_enabled": true
}
```

**最终使用的配置**:
```json
{
  "assistant_name": "小智",              // 从角色继承
  "assistant_identity": "AI 助手",       // 从角色继承
  "system_prompt": "...",               // 从角色继承
  "model_temperature": 0.9,             // 会话覆盖
  "model_top_p": 0.9,                   // 从角色继承
  "max_memory_length": 10,              // 从角色继承
  "web_search_enabled": true            // 会话覆盖
}
```

## 向后兼容性

### 现有会话 (character_id = NULL)
- ✅ 正常工作
- `character_settings` 为空字典
- `merged_settings` 等于 `session_settings`
- 行为与之前版本完全一致

### 新会话 (character_id ≠ NULL)
- ✅ 自动继承角色配置
- ✅ 允许选择性覆盖
- ✅ 保持配置的灵活性

## 安全性增强

### 1. 空值检查
```python
# 原代码
session.settings.get("key")

# 新代码 (更安全)
(session.settings or {}).get("key")
```

### 2. 属性检查
```python
# 使用 hasattr 确保属性存在
if hasattr(session, 'character') and session.character:
    character_settings = session.character.settings or {}
```

### 3. 模型检查
```python
# 原代码
if "thinking" in model.features

# 新代码
if model and "thinking" in (model.features or [])
```

## 测试验证

### 测试场景

1. **完全继承** - 会话无自定义设置
   ```python
   session.settings = {}
   # 应该完全使用角色的配置
   ```

2. **部分覆盖** - 会话有部分自定义设置
   ```python
   session.settings = {"model_temperature": 0.9}
   # temperature 应该被覆盖，其他继承角色
   ```

3. **无角色绑定** - 旧版本会话
   ```python
   session.character = None
   # 应该只使用 session.settings，不报错
   ```

4. **模型为 None** - 处理边界情况
   ```python
   session.model = None
   # 不应该抛出 AttributeError
   ```

## 性能影响

### 内存开销
- 每次读取配置时创建临时的 `merged_settings` 字典
- 影响极小 (通常 < 1KB)

### CPU 开销
- 字典合并操作: O(n), n 为配置项数量 (通常 < 20)
- 可忽略不计

### 数据库查询
- 使用 `selectinload` 预加载 `character` 关联
- 无额外 N+1 查询问题

## 调试技巧

### 查看实际使用的配置
```python
# 在 agent_service.py 中添加日志
logger.debug(f"Merged settings: {merged_settings}")
```

### 检查继承链
```python
print(f"Character settings: {character_settings}")
print(f"Session settings: {session_settings}")
print(f"Merged settings: {merged_settings}")
```

## 常见问题

### Q: 为什么要用 `{**character_settings, **session_settings}` 而不是 `update()`?

A: 
- 字典解包更简洁
- 不会修改原始数据
- 性能略优于 `update()`
- 更符合 Pythonic 风格

### Q: 如果角色配置被修改，现有会话会受影响吗？

A: 
- **会**。这是设计目标之一。
- 会话继承的是"引用"而非"复制"
- 如果需要冻结配置，应该在创建会话时完整复制

### Q: 如何调试配置继承问题？

A:
1. 检查数据库中 `character_id` 是否正确设置
2. 检查 `session.character` 是否正确加载
3. 打印 `merged_settings` 查看最终配置

## 下一步优化建议

1. **缓存合并后的配置**
   ```python
   # 避免重复计算
   if not hasattr(session, '_merged_settings'):
       session._merged_settings = {**character_settings, **session_settings}
   ```

2. **配置验证**
   ```python
   # 添加配置验证逻辑
   if merged_settings.get("model_temperature", 0) < 0 or \
      merged_settings.get("model_temperature", 1) > 2:
       raise ValueError("Invalid temperature")
   ```

3. **配置审计**
   ```python
   # 记录配置使用情况
   logger.info(f"Using config from character {session.character_id}")
   ```

---

**更新日期**: 2026-03-23  
**适配状态**: ✅ 完成  
**测试状态**: ⏳ 待验证
