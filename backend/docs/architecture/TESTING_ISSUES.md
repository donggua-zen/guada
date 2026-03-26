# 测试问题与待确认事项

**创建时间**: 2026-03-27  
**最后更新**: 2026-03-27

---

## 📋 失败的测试清单（需要修复）

### 1. Chat Route 相关测试

#### ❌ `test_end_to_end_chat_flow`
**文件**: `app/tests/integration/test_chat_route.py:42`  
**错误**: `assert 422 == 200`  
**状态**: 🔴 待修复

**失败原因**:
```python
response = await client.post("/api/v1/sessions", json=session_data)
assert response.status_code == 200  # 实际返回 422
```

**可能的问题**:
- Session 创建请求的参数验证失败
- 可能是 `model_id` 字段格式不正确
- 或者缺少必填字段

**建议解决方案**:
1. 检查 Session 创建的 API 文档
2. 打印响应内容查看详细错误信息
3. 调整测试数据格式

**修复优先级**: 🔴 高

---

#### ❌ `test_chat_session_with_character`
**文件**: `app/tests/integration/test_chat_route.py:144`  
**错误**: `AssertionError: assert 'Test Chat Session with Character' == 'Test Character'`  
**状态**: 🔴 待修复

**失败原因**:
```python
assert session_data_response["title"] == character_data_response["title"]
# 期望：会话标题自动继承角色标题
# 实际：使用自定义标题 "Test Chat Session with Character"
```

**待确认业务逻辑**:
- **问题**: 会话创建时是否应该自动继承角色标题？
- **当前行为**: 不继承，使用用户提供的标题
- **预期行为**: 需要产品确认

**建议解决方案**:
```python
# 方案 1: 修改测试断言（如果当前行为是正确的）
assert session_data_response["title"] == "Test Chat Session with Character"

# 方案 2: 修改业务逻辑（如果需要继承）
# 在 SessionService.create() 中添加继承逻辑

# 方案 3: 添加配置选项（推荐）
session_data = {
    "title": "Custom Title",  # 可选，不提供则继承
    "character_id": "xxx",
    "inherit_title": True  # 新增字段
}
```

**修复优先级**: 🔴 高  
**等待确认**: ✅ 是

---

### 2. Sessions Route 相关测试

#### ❌ `test_end_to_end_session_flow`
**文件**: `app/tests/integration/test_sessions_route.py:42`  
**错误**: `assert 422 == 200`  
**状态**: 🔴 待修复

**失败原因**: 同 `test_end_to_end_chat_flow`  
**建议解决方案**: 同上

---

#### ❌ `test_session_with_character`
**文件**: `app/tests/integration/test_sessions_route.py:168`  
**错误**: `AssertionError: assert 'Test Session with Character' == 'Test Character'`  
**状态**: 🔴 待修复

**失败原因**: 同 `test_chat_session_with_character`  
**建议解决方案**: 同上

---

### 3. Settings Route 相关测试

#### ❌ `test_settings_with_user_context`
**文件**: `app/tests/integration/test_settings_route.py:76`  
**错误**: `assert 422 == 200`  
**状态**: 🟡 中优先级

**失败原因**:
- 可能是请求参数格式问题
- 或者用户上下文获取方式变更

**建议解决方案**:
1. 检查 Settings API 的请求格式
2. 打印响应查看详细错误

---

### 4. Users Route 相关测试

#### ❌ `test_user_sessions_and_characters`
**文件**: `app/tests/integration/test_users_route.py:73`  
**错误**: `assert 422 == 200`  
**状态**: 🟡 中优先级

**失败原因**: 可能是级联查询的参数问题

---

## ⏳ 跳过的测试（需要条件）

### 1. AgentService 集成测试

---

## 🔍 待确认的业务逻辑问题

### ✅ 已确认问题（2026-03-27 更新）

#### 问题 1: 会话标题继承策略 ✅ 已确认
**状态**: ✅ **已解决** (2026-03-27)

**业务规则**:
```json
{
  "title": "可选参数，如果提供则优先使用",
  "character_id": "xxx"
}
```

**决策**:
- ✅ 如果参数提供 `title`，优先使用参数的
- ✅ 如果参数未提供 `title`，则继承角色的标题
- ✅ 当前问答轮次不能跳过（以免影响模型上下文）

**影响范围**:
- `SessionService.create()` 方法
- `Sessions Route` POST /api/v1/sessions
- 前端会话创建逻辑

**测试更新**:
- 修改 `test_chat_session_with_character` 的断言
- 修改 `test_session_with_character` 的断言

---

#### 问题 2: 工具调用结果显示策略 ✅ 已确认
**状态**: ✅ **已解决** (2026-03-27)

**业务规则**:
```python
# enable_tool_results 已由 skip_tool_calls 替代
if skip_tool_calls:
    # 跳过历史记录中所有含有工具调用的轮次（包含 call 和 response）
    # 节省 tokens
else:
    # 正常显示工具调用结果

# 注意：当前问答轮次不能跳过，以免影响模型上下文
```

**决策**:
- ✅ 使用 `skip_tool_calls` 参数替代 `enable_tool_results`
- ✅ 为 True 时跳过历史记录中含工具调用的轮次
- ✅ 节省 tokens 消耗
- ✅ 当前问答轮次不跳过

**影响范围**:
- AgentService.completions()
- 历史消息过滤逻辑
- Token 优化策略

---

#### 问题 3: MCP 工具错误处理策略 ✅ 已确认
**状态**: ✅ **已解决** (2026-03-27)

**业务规则**:
```python
# MCP 工具调用失败时的重试策略
# 决策：不重试，依赖大模型自身尝试重新调用即可
```

**决策**:
- ✅ **不自动重试**
- ✅ 依赖 LLM 自行决定是否重新调用工具
- ✅ 简化错误处理逻辑

**影响范围**:
- MCPToolProvider.execute()
- MCPClient.execute_tool()

---

#### 问题 4: 记忆策略切换逻辑 ✅ 已确认
**状态**: ✅ **已解决** (2026-03-27)

**业务规则**:
```python
# 长期短期记忆策略逻辑已经废弃
# 相关业务逻辑不在使用
```

**决策**:
- ✅ **废弃长期/短期记忆策略切换**
- ✅ 移除相关代码和配置
- ✅ 简化记忆管理逻辑

**影响范围**:
- MemoryManagerService
- 对话上下文管理
- 配置项清理

---

### ⏳ 历史遗留问题（已解决）

**描述**: 当使用角色创建会话时，会话标题是否应该自动继承角色标题？

**当前行为**:
- 会话使用用户提供的 `title` 字段
- 不提供 `title` 时使用默认值或空值
- **不会**从角色继承标题

**支持方观点**:
- ✅ 不继承：用户可能有不同的对话目的，不应强制继承
- ❌ 继承：减少用户输入，保持一致性

**建议方案**:
```json
// 方案 A: 添加显式控制字段
{
  "character_id": "xxx",
  "title": "可选标题",
  "inherit_title": true  // 明确是否继承
}

// 方案 B: title 为空时自动继承
{
  "character_id": "xxx",
  "title": null  // null 表示继承
}

// 方案 C: 保持现状（不继承）
{
  "character_id": "xxx",
  "title": "必须提供"
}
```

**影响范围**:
- `SessionService.create()` 方法
- `Sessions Route` POST /api/v1/sessions
- 前端会话创建逻辑
- 相关测试用例（6 个）

**决策者**: @产品经理 @技术负责人  
**截止日期**: 2026-04-03

---

### 问题 2: 工具调用结果显示策略

**描述**: `enable_tool_results` 开关的具体行为定义？

**当前实现**:
```python
# 在 AgentService.completions 中
if enable_tool_results:
    # 显示工具调用结果
else:
    # 不显示工具调用结果
```

**待确认点**:
1. 不显示时，是完全不调用工具？
2. 还是调用工具但不显示结果？
3. 还是显示但标记为"已隐藏"？

**建议方案**:
```python
# 方案 A: 完全不调用工具（节省资源）
if settings.enable_tool_results:
    tool_calls = await self._handle_all_tool_calls(...)
    # 添加到消息中
else:
    tool_calls = []  # 跳过工具调用

# 方案 B: 调用但不显示（保持上下文完整）
tool_calls = await self._handle_all_tool_calls(...)
if settings.enable_tool_results:
    # 添加到消息中
else:
    # 不添加到最终输出，但在内部保留

# 方案 C: 显示但模糊化
if settings.enable_tool_results:
    # 正常显示
else:
    # 显示 "[工具调用已隐藏]"
```

**影响范围**:
- AgentService.completions()
- 前端消息展示逻辑
- 用户体验

**决策者**: @产品经理  
**截止日期**: 2026-04-03

---

### 问题 3: MCP 工具错误处理策略

**描述**: MCP 工具调用失败时的重试机制？

**当前实现**:
```python
# MCPToolProvider.execute()
try:
    result = await mcp_client.execute_tool(...)
except Exception as e:
    return ToolCallResponse(
        content=f"Error: {str(e)}",
        is_error=True
    )
```

**待确认点**:
1. 是否自动重试？
2. 重试次数限制？
3. 重试间隔？
4. 哪些错误类型值得重试？

**建议方案**:
```python
# 方案 A: 不重试（简单直接）
- 立即返回错误
- 由 LLM 决定是否再次调用

# 方案 B: 智能重试（推荐）
RETRY_CONFIG = {
    "max_retries": 2,
    "retry_delay": 1.0,  # 秒
    "retryable_errors": [
        "timeout",
        "network error",
        "server unavailable"
    ]
}

# 方案 C: 可配置重试
settings.mcp_retry_policy = {
    "enabled": True,
    "max_retries": 3,
    "backoff_factor": 2.0
}
```

**影响范围**:
- MCPToolProvider.execute()
- MCPClient.execute_tool()
- 工具调用稳定性

**决策者**: @技术负责人  
**截止日期**: 2026-04-03

---

### 问题 4: 记忆策略切换逻辑

**描述**: 短期记忆 vs 长期记忆的切换时机？

**当前实现**:
```python
# MemoryManagerService
async def get_context_messages(self) -> List[Message]:
    if self.strategy == "short_term":
        return self.last_n_messages(10)
    elif self.strategy == "long_term":
        return self.summary_plus_recent()
```

**待确认点**:
1. 何时切换策略？
2. 基于什么指标？
3. 用户可否手动切换？

**建议方案**:
```python
# 方案 A: 基于 token 数量（推荐）
TOKEN_THRESHOLD = 3500  # 接近 4k 窗口

if current_tokens > TOKEN_THRESHOLD:
    strategy = "long_term"
else:
    strategy = "short_term"

# 方案 B: 基于对话轮数
if message_count > 20:
    strategy = "long_term"

# 方案 C: 用户可配置
settings.memory_strategy = "auto" | "short_term" | "long_term"
```

**影响范围**:
- MemoryManagerService
- 对话质量
- Token 消耗

**决策者**: @技术负责人  
**截止日期**: 2026-04-03

---

## 📝 新增测试建议

### P0 - 立即实施

#### 1. Session Service 单元测试
**文件**: `app/tests/test_session_service.py`  
**优先级**: 🔴 高  
**预计用例**: 10-12 个

**测试点**:
```python
- test_create_session_basic()
- test_create_session_with_character()
- test_update_session_title()
- test_delete_session_cascade()
- test_session_settings_inheritance()
```

---

#### 2. MCP Services 测试套件
**文件**: `app/tests/test_mcp_services.py`  
**优先级**: 🔴 高  
**预计用例**: 12-15 个

**测试点**:
```python
# MCPServerService
- test_create_server_valid()
- test_update_server_config()
- test_enable_disable_server()

# MCPToolManager  
- test_discover_tools_success()
- test_discover_tools_failure()
- test_execute_tool_timeout()

# MCPToolProvider
- test_provider_execute_success()
- test_provider_execute_network_error()
```

---

### P1 - 近期实施

#### 3. Chat Route 完整测试
**文件**: `app/tests/integration/test_chat_route_enhanced.py`  
**优先级**: 🟡 中  
**预计用例**: 10-12 个

**测试点**:
```python
- test_chat_completion_streaming()
- test_chat_completion_non_streaming()
- test_chat_with_tools_integration()
- test_chat_error_handling()
```

---

#### 4. Memory Manager 测试
**文件**: `app/tests/test_memory_manager.py`  
**优先级**: 🟡 中  
**预计用例**: 8-10 个

**测试点**:
```python
- test_short_term_memory_strategy()
- test_long_term_memory_strategy()
- test_memory_summary_generation()
- test_token_counting_accuracy()
```

---

### P2 - 中期实施

#### 5. 并发场景测试
**文件**: `app/tests/test_concurrent_scenarios.py`  
**优先级**: 🟢 低  
**预计用例**: 5-6 个

**测试点**:
```python
- test_concurrent_tool_executions()
- test_concurrent_session_creation()
- test_database_connection_pool_exhaustion()
```

---

## 🎯 下一步行动计划

### 本周（2026-03-27 ~ 2026-04-02）
- [ ] 修复 6 个失败的集成测试（P0）
- [ ] 完成 SessionService 测试（P0）
- [ ] 启动 MCP Services 测试（P0）

### 下周（2026-04-03 ~ 2026-04-09）
- [ ] 等待业务逻辑问题确认
- [ ] 根据确认结果修复跳过的测试
- [ ] 补充 Chat Route 完整测试（P1）

### 下个月（2026-04-10 ~ 2026-04-30）
- [ ] 完成所有 P1 优先级测试
- [ ] 启动 P2 优先级测试
- [ ] 目标覆盖率：70%+

---

## 📊 更新日志

### 2026-03-27
- ✅ 创建测试覆盖分析报告
- ✅ 新增 AgentService 单元测试（10 个用例）
- ✅ 新增 ToolOrchestrator 扩展测试（13 个用例）
- ✅ 记录 6 个失败测试的详细分析
- ✅ 整理 4 个待确认业务逻辑问题
- ⏳ 跳过 4 个需要特殊条件的测试

### 待更新
- ⏳ 修复失败的集成测试
- ⏳ 补充服务层测试
- ⏳ 根据业务确认更新测试

---

**文档维护者**: AI Assistant  
**联系方式**: 请在 Issue 中 @开发者团队
