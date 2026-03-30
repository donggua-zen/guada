# 测试重构待确认事项

**创建时间**: 2026-03-29  
**状态**: 待确认  
**优先级**: P0

---

## 📋 待确认问题清单

### 1. 会话标题边界情况

**问题描述**: 如果角色没有 `title` 字段（为 null），会话标题应该如何处理？

**当前实现**:
```python
# session_service.py line 59
"title": data.get("title", character.title),
```

如果 `character.title` 为 null，会话标题也会是 null。

**建议方案**:
- **方案 A**: 使用默认标题 "新会话" + 时间戳
- **方案 B**: 使用角色 description 的前 20 个字符
- **方案 C**: 抛出验证错误，强制要求角色必须有 title

**影响测试**: 
- `test_create_session_when_character_no_title_should_use_default` (已标记为 skip)

**决策者**: @产品经理  
**截止日期**: 2026-04-03  
**状态**: ⏳ 待确认

---

### 2. MCP 工具错误处理策略

**问题描述**: MCP 工具调用失败时的重试机制？

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

**已确认决策**: 不自动重试，依赖 LLM 自行决定重新调用

**待确认点**:
1. 是否需要在 AgentService 层面实现重试机制？
2. 哪些错误类型值得重试（网络超时 vs 永久性错误）？
3. 重试次数限制和间隔？

**影响测试**:
- `test_handle_all_tool_calls_when_mcp_tool_fails_should_not_retry` (已标记为 skip)

**决策者**: @架构师  
**截止日期**: 2026-04-03  
**状态**: ⏳ 待确认

---

### 3. skip_tool_calls 边界情况

**问题描述**: 如果历史消息全部被过滤，是否会导致模型上下文为空？

**业务规则**:
- `skip_tool_calls=True`: 跳过历史记录中所有含有工具调用的轮次
- 当前问答轮次不能跳过（以免影响模型上下文）

**潜在问题**:
- 如果用户连续进行了 10 轮工具调用，然后设置 `skip_tool_calls=True`
- 过滤后可能导致历史消息为空
- 这会影响 LLM 的上下文理解

**建议方案**:
- **方案 A**: 至少保留最近一轮对话（无论是否包含工具调用）
- **方案 B**: 至少保留 N 条消息（如 5 条）
- **方案 C**: 完全按规则过滤，允许上下文为空

**影响测试**:
- `test_build_context_when_skip_tool_calls_true_should_filter_history` (已标记为 skip)
- `test_build_context_when_skip_tool_calls_true_should_preserve_current_turn` (已标记为 skip)
- `test_skip_tool_calls_when_all_history_filtered_should_preserve_context` (已标记为 skip)

**决策者**: @技术负责人  
**截止日期**: 2026-04-03  
**状态**: ⏳ 待确认

---

### 4. 工具调用结果显示策略

**问题描述**: `skip_tool_calls` 的具体显示逻辑？

**当前命名**: `skip_tool_calls` (布尔值)

**语义**:
- `True`: 跳过工具调用结果显示
- `False`: 正常显示工具调用结果

**待确认点**:
1. 是否需要区分"跳过显示"和"跳过执行"？
   - 当前实现：只跳过显示，仍然执行工具
   - 替代方案：完全不调用工具（节省 tokens）

2. 如果跳过显示，工具调用的中间结果是否应该保存到数据库？
   - 当前实现：保存
   - 替代方案：不保存（节省存储）

**影响测试**: 需要补充相关集成测试

**决策者**: @产品经理  
**截止日期**: 2026-04-03  
**状态**: ⏳ 待确认

---

### 5. 测试数据工厂范围

**问题描述**: 测试工厂应该覆盖哪些实体？

**当前实现**:
- UserFactory ✅
- CharacterFactory ✅
- SessionFactory ✅
- ToolProviderFactory ✅

**建议扩展**:
- ModelFactory (简化模型创建流程)
- MessageFactory (简化消息创建流程)
- MCPServerFactory (用于 MCP 工具测试)

**决策**: 根据后续测试需求逐步添加

**负责人**: @开发团队  
**状态**: 🔄 进行中

---

## 📊 统计信息

| 状态 | 数量 | 百分比 |
|------|------|--------|
| 待确认 | 4 | 80% |
| 已确认 | 0 | 0% |
| 进行中 | 1 | 20% |
| **总计** | **5** | **100%** |

---

## 🎯 下一步行动

1. **优先确认 P0 问题** (问题 1-3):
   - 影响核心测试用例的完整性
   - 截止日期：2026-04-03

2. **补充跳过测试的实现**:
   - 一旦问题确认，立即实现跳过的测试
   - 移除 `@pytest.mark.skip` 装饰器

3. **更新本文档**:
   - 记录每个问题的决策结果
   - 更新相关测试用例

---

## 📝 更新日志

### 2026-03-29
- ✅ 创建文档
- ✅ 记录 4 个待确认问题
- ✅ 标记相关跳过测试
- ⏳ 等待产品和技术负责人确认
