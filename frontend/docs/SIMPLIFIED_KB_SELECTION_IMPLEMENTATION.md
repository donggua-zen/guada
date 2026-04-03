# 多知识库选择与引用功能 - 简化实现方案

## 📋 方案概述

采用**上下文注入 + AI 自主决策**的简化方案，不再通过强制限制知识库 ID，而是将知识库信息追加到用户消息中，让 AI 自行决定调用哪个知识库。

---

## ✅ 核心改进

### 1. **动态构建特殊消息**
在 `_get_conversation_messages()` 方法中检测到用户消息包含 `referenced_kbs` 时，动态构造知识库信息文本：

```python
# 构建知识库引用信息文本
kb_info_lines = ["【当前引用的知识库】"]
for kb in referenced_kbs:
    line = f"- 名称：{kb_name}, ID: {kb_id}"
    if kb_description:
        line += f", 简介：{kb_description}"
    kb_info_lines.append(line)

kb_reference_text = "\n".join(kb_info_lines)

# 追加到最后一条用户消息后面
conversation_messages[last_user_idx]["content"] += "\n\n" + kb_reference_text
```

### 2. **上下文优化策略**
- ✅ 仅在**最后一条用户消息**中添加知识库信息
- ✅ 避免重复占用上下文窗口
- ✅ 该信息仅在当前轮次生效，不污染后续对话

### 3. **Agent 层检测逻辑**
在 `completions()` 方法中检测知识库引用并启用工具：

```python
# 检测知识库引用
user_message = await self.message_repo.get_message(message_id)
if user_message.meta_data and user_message.meta_data.get("referenced_kbs"):
    has_kb_reference = True

# 启用 knowledge_base provider（不限制具体 ID）
tool_context.provider_configs["knowledge_base"] = ProviderConfig(
    enabled_tools=True if has_kb_reference else False,
)
```

### 4. **AI 自主决策**
LLM 看到用户消息中的知识库信息后，自行决定：
- 是否调用知识库工具
- 调用哪个知识库（通过 `knowledge_base_id` 参数传递）
- 调用哪些工具（search / list_files / get_chunks）

示例消息格式：
```
用户问题：Python 装饰器怎么用？

【当前引用的知识库】
- 名称：Python 技术文档，ID: kb_123, 简介：Python 编程相关技术文档
- 名称：最佳实践手册，ID: kb_456, 简介：软件开发最佳实践
```

---

## 🔧 修改的文件清单

### 前端文件（已完成）
1. ✅ `frontend/src/components/ui/ChatInput.vue`
   - 新增知识库选择按钮和对话框
   - 支持多选知识库并传递 `knowledgeBaseIds`

### 后端文件

#### 1. Schema 层
- ✅ `backend/app/schemas/message.py`
  - 扩展 `MessageCreate` 添加 `knowledge_base_ids` 字段

#### 2. Service 层
- ✅ `backend/app/services/message_service.py`
  - 扩展 `add_message()` 保存知识库引用到 `meta_data["referenced_kbs"]`

- ✅ `backend/app/services/agent_service.py`
  - 在 `_get_conversation_messages()` 中追加知识库信息到用户消息
  - 在 `completions()` 中检测知识库引用并启用工具

#### 3. Tool 层
- ✅ `backend/app/services/tools/providers/knowledge_base_tool_provider.py`
  - **移除**复杂的 ID 限制逻辑
  - **保留**基础权限验证（确保知识库属于该用户）

- ✅ `backend/app/services/tools/tool_orchestrator.py`
  - **移除**metadata 传递逻辑（不再需要）

---

## 🎯 使用场景示例

### 场景 1：单知识库问答
```
用户选择：["Python 技术文档"]
发送问题："装饰器怎么用？"

AI 看到的消息：
装饰器怎么用？

【当前引用的知识库】
- 名称：Python 技术文档，ID: kb_123, 简介：Python 编程相关技术文档

AI 决策：调用 knowledge_base__search(knowledge_base_id="kb_123", query="装饰器")
```

### 场景 2：多知识库问答
```
用户选择：["Python 技术文档", "最佳实践手册"]
发送问题："这个功能怎么实现？"

AI 看到的消息：
这个功能怎么实现？

【当前引用的知识库】
- 名称：Python 技术文档，ID: kb_123, 简介：Python 编程相关技术文档
- 名称：最佳实践手册，ID: kb_456, 简介：软件开发最佳实践

AI 决策：
1. 调用 knowledge_base__search(knowledge_base_id="kb_123", ...)
2. 调用 knowledge_base__search(knowledge_base_id="kb_456", ...)
3. 综合两个知识库的回答
```

### 场景 3：无知识库问答
```
用户未选择任何知识库
发送问题："今天天气怎么样？"

AI 看到的消息：
今天天气怎么样？
（没有知识库信息）

AI 决策：不调用知识库工具，基于训练数据回答
```

---

## ⚠️ 关键设计决策

### 为什么采用简化方案？

**原方案**（强制限制 ID）：
```python
# ❌ 复杂且不够灵活
provider_configs["knowledge_base"] = ProviderConfig(
    metadata={"referenced_kb_ids": [...]}  # 限制只能访问这些知识库
)

# 工具方法中验证
if params.knowledge_base_id not in allowed_kb_ids:
    return error
```

**简化方案**（AI 自主选择）：
```python
# ✅ 简洁且灵活
# 1. 在用户消息中追加知识库信息
conversation_messages[last_user_idx]["content"] += "\n\n" + kb_reference_text

# 2. 仅启用工具，不限制 ID
provider_configs["knowledge_base"] = ProviderConfig(
    enabled_tools=True
)

# 3. AI 自行决定调用哪个知识库
# LLM 看到知识库信息后，会调用：knowledge_base__search(knowledge_base_id="kb_123", ...)
```

### 简化方案的优势

1. **更符合 LLM 的工作方式**：让 AI 基于上下文信息做决策，而不是被强制限制
2. **代码更简洁**：移除了复杂的 metadata 传递和 ID 验证逻辑
3. **更灵活**：AI 可以根据问题内容选择最合适的知识库，甚至可以跨知识库搜索
4. **更易维护**：减少了多个组件之间的耦合
5. **向后兼容**：不影响现有功能

---

## 🧪 测试建议

### 功能测试点
- [ ] 选择一个知识库，AI 能看到知识库信息并正确调用
- [ ] 选择多个知识库，AI 能在多个库中搜索
- [ ] 不选择知识库，AI 不使用知识库工具
- [ ] 知识库信息仅出现在最后一条用户消息中
- [ ] 后续对话不会重复出现知识库信息

### 性能测试点
- [ ] 知识库基本信息从 `meta_data` 读取，无额外数据库查询
- [ ] 追加知识库信息不显著增加 token 消耗
- [ ] 工具调用响应时间正常

### 边界测试点
- [ ] 用户选择了知识库但 AI 认为不需要调用（基于问题判断）
- [ ] 用户选择的知识库不存在或无权限（基础验证拦截）
- [ ] 知识库描述为空时的展示效果

---

## 📊 数据流对比

### 原方案（强制限制）
```
AgentService → 提取 kb_ids → 设置 metadata → ToolOrchestrator → 
传递 metadata → KnowledgeBaseProvider → 验证 ID → 执行/拒绝
```

### 简化方案（AI 自主）
```
AgentService → 读取 referenced_kbs → 构建文本 → 追加到用户消息 → 
LLM 看到信息 → 自主决定调用哪个 kb → ToolOrchestrator → 
路由到 KnowledgeBaseProvider → 基础权限验证 → 执行
```

---

## 🚀 下一步工作

1. **前端集成**：在 ChatPanel.vue 中使用新的 `knowledgeBaseIds` prop
2. **样式微调**：优化知识库标签和对话框的视觉效果
3. **错误提示**：完善网络错误、权限错误的用户提示
4. **单元测试**：为新增的关键方法编写测试用例
5. **性能监控**：观察知识库工具调用的准确率和性能表现

---

## 📝 技术亮点总结

1. **上下文注入**：巧妙利用 LLM 的上下文理解能力，让 AI 自然感知知识库信息
2. **最小侵入性**：仅在必要时追加信息，不改变现有消息结构
3. **AI 自主决策**：充分发挥 LLM 的智能，让其根据问题选择最佳知识库
4. **简洁优雅**：移除了复杂的限制逻辑，代码更易理解和维护
5. **渐进增强**：完全向后兼容，不影响现有功能

---

**实现日期**: 2026-04-02  
**实现者**: AI Assistant  
**版本**: v2.0 (简化方案)
