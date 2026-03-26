# 业务逻辑确认更新

**确认时间**: 2026-03-27  
**确认者**: 用户  
**状态**: ✅ 全部已确认

---

## 📋 确认的业务逻辑清单

### 1. ✅ 工具调用结果显示策略

**变更**: `enable_tool_results` → `skip_tool_calls`

**业务规则**:
```python
if skip_tool_calls:
    # 跳过历史记录中所有含有工具调用的轮次（包含 call 和 response）
    # 节省 tokens
else:
    # 正常显示工具调用结果

# 重要：当前问答轮次不能跳过，以免影响模型上下文
```

**影响范围**:
- AgentService.completions() - 历史消息过滤逻辑
- 前端展示逻辑
- Token 优化策略

**实现要点**:
1. 过滤历史记录中含工具调用的轮次
2. 当前问答轮次必须保留（即使有工具调用）
3. 同时过滤 tool_call 和 tool_response

---

### 2. ✅ 会话标题继承策略

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
- SessionService.create() 方法
- Sessions Route POST /api/v1/sessions
- 前端会话创建逻辑

**测试修复**:
- 修改 `test_chat_session_with_character` 的断言
- 修改 `test_session_with_character` 的断言

---

### 3. ✅ MCP 工具错误处理策略

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
- 工具调用稳定性

---

### 4. ✅ 记忆策略切换逻辑

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

## 🎯 测试更新计划

### P0 - 立即更新（今天）

#### 1. 更新失败的集成测试断言

**文件**: `app/tests/integration/test_chat_route.py`

```python
# test_chat_session_with_character
# 修改前
assert session_data_response["title"] == character_data_response["title"]

# 修改后（验证提供了 title 的情况）
assert session_data_response["title"] == "Test Chat Session with Character"

# 新增测试（验证不提供 title 时的继承）
async def test_session_title_inheritance_when_not_provided():
    """测试会话标题继承逻辑"""
    # 不提供 title 参数
    session_data = {
        "character_id": character_id,
        "model_id": model_id,
        # 不提供 title
    }
    
    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    
    # 应该继承角色标题
    assert session_data_response["title"] == character_data_response["title"]
```

---

#### 2. 更新 Sessions Route 测试

**文件**: `app/tests/integration/test_sessions_route.py`

同样的修改模式：
- 修改现有断言（验证提供 title 的情况）
- 新增测试（验证继承逻辑）

---

### P1 - 本周内

#### 3. 补充 skip_tool_calls 相关测试

**文件**: `app/tests/test_agent_service.py`

```python
class TestAgentServiceSkipToolCalls:
    """测试 skip_tool_calls 功能"""
    
    @pytest.mark.asyncio
    async def test_skip_historical_tool_calls(self):
        """测试跳过历史记录中的工具调用"""
        # 创建含工具调用的历史消息
        # 设置 skip_tool_calls=True
        # 验证历史消息被过滤
        # 验证当前轮次不被过滤
        pass
    
    @pytest.mark.asyncio
    async def test_preserve_current_turn(self):
        """测试当前问答轮次不被跳过"""
        # 即使当前轮次有工具调用
        # 也不能跳过（影响模型上下文）
        pass
```

---

#### 4. 清理记忆策略相关代码

**文件**: 
- `app/services/chat/memory_manager_service.py`
- 相关配置文件

**行动项**:
1. 标记废弃方法（@deprecated）
2. 移除配置项
3. 简化相关逻辑
4. 更新文档

---

## 📊 影响分析

### 代码变更范围

| 模块 | 变更类型 | 预计行数 | 优先级 |
|------|---------|---------|--------|
| **AgentService** | 修改 | ~50 行 | 🔴 高 |
| **SessionService** | 修改 | ~20 行 | 🔴 高 |
| **MCPToolProvider** | 简化 | ~10 行删除 | 🟡 中 |
| **MemoryManager** | 清理 | ~100 行删除 | 🟢 低 |
| **测试文件** | 更新 | ~100 行新增 | 🔴 高 |

---

### 风险评估

#### 低风险变更
- ✅ 测试断言更新（不影响业务逻辑）
- ✅ 添加新测试用例（增量改进）
- ✅ 文档更新

#### 中风险变更
- ⚠️ skip_tool_calls 实现（需要验证过滤逻辑）
- ⚠️ 标题继承逻辑（需要前后端联调）

#### 高风险变更
- ❌ 无（所有变更风险可控）

---

## 🎯 验收标准

### 功能验收

#### 1. skip_tool_calls 功能
- [ ] 历史记录中含工具调用的轮次被正确过滤
- [ ] 当前问答轮次始终保留
- [ ] Token 消耗明显减少（需要数据验证）

#### 2. 标题继承逻辑
- [ ] 提供 title 时使用提供的值
- [ ] 不提供 title 时继承角色标题
- [ ] 前端 UI 正确显示

#### 3. MCP 不重试
- [ ] 工具调用失败直接返回错误
- [ ] LLM 可以自行重新调用
- [ ] 错误信息清晰有用

#### 4. 记忆策略清理
- [ ] 移除相关配置项
- [ ] 移除相关代码
- [ ] 不影响现有功能

---

### 测试验收

- [ ] 所有新增测试通过
- [ ] 所有失败测试修复
- [ ] 覆盖率不下降
- [ ] CI/CD 通过

---

## 📝 实施检查清单

### Phase 1: 测试更新（立即）
- [x] ✅ 更新测试文档中的业务逻辑说明
- [ ] ⏳ 修改 `test_chat_session_with_character` 断言
- [ ] ⏳ 修改 `test_session_with_character` 断言
- [ ] ⏳ 添加标题继承逻辑的新测试
- [ ] ⏳ 添加 skip_tool_calls 相关测试

---

### Phase 2: 代码实现（本周）
- [ ] ⏳ 实现 skip_tool_calls 过滤逻辑
- [ ] ⏳ 实现标题继承逻辑
- [ ] ⏳ 简化 MCP 错误处理
- [ ] ⏳ 清理记忆策略代码

---

### Phase 3: 验证和文档（下周）
- [ ] ⏳ 运行所有测试
- [ ] ⏳ 验证 Token 节省效果
- [ ] ⏳ 更新 API 文档
- [ ] ⏳ 通知前端团队变更

---

## 🎊 预期收益

### 用户体验
- ✅ 更快的响应速度（跳过不必要的工具调用）
- ✅ 更灵活的标题控制
- ✅ 更简洁的错误提示

### 系统性能
- ✅ 减少 Token 消耗（跳过历史工具调用）
- ✅ 简化代码逻辑（移除记忆策略）
- ✅ 降低复杂度（MCP 不重试）

### 开发效率
- ✅ 更清晰的代码结构
- ✅ 更完善的测试覆盖
- ✅ 更准确的文档

---

## 📚 相关文档更新

### 需要更新的文档
1. ✅ `TESTING_ISSUES.md` - 已更新业务逻辑确认
2. ⏳ `API_DOCUMENTATION.md` - 更新参数说明
3. ⏳ `CHANGELOG.md` - 记录变更
4. ⏳ `README.md` - 更新功能说明

---

**文档创建时间**: 2026-03-27  
**下次更新**: 实施完成后  
**维护者**: AI Assistant

🎉 **所有业务逻辑已确认，可以开始实施了！**
