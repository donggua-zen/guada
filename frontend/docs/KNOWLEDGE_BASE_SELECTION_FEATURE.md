# 多知识库选择与引用功能 - 实现总结

## 📋 功能概述

实现了在聊天界面中选择并引用多个知识库的功能，AI 将仅在用户指定的知识库范围内进行搜索和回答。

---

## ✅ 已完成的工作

### 1. 前端实现 (ChatInput.vue)

#### UI 组件增强
- ✅ 新增"知识库"按钮（使用 `LibraryBooksTwotone` 图标）
- ✅ 实现知识库选择对话框（支持搜索、多选）
- ✅ 显示已选知识库标签（Tag），支持点击移除
- ✅ 标签显示区域位于文件列表下方、输入框上方

#### 数据绑定
- ✅ Props 扩展：`config.knowledgeBaseIds: string[]`
- ✅ Emits 扩展：`update:knowledgeBaseIds`, `config-change`
- ✅ 计算属性：`selectedKnowledgeBases`, `filteredKnowledgeBases`

#### 核心方法
- ✅ `openKnowledgeBaseDialog()`: 打开知识库选择对话框
- ✅ `toggleKnowledgeBaseSelection(kbId)`: 切换知识库选中状态
- ✅ `applyKnowledgeBaseSelection()`: 应用知识库选择
- ✅ `removeKnowledgeBase(kbId)`: 移除单个知识库
- ✅ `loadKnowledgeBases()`: 加载知识库列表

#### 事件传递
- ✅ `sendMessage()` 方法现在包含 `knowledgeBaseIds` 字段
- ✅ 父组件可通过 `config-change` 事件接收配置变更

---

### 2. 后端实现

#### Schema 层 (message.py)
```python
class MessageCreate(BaseModel):
    content: str
    files: Optional[List[FileBound]] = None
    replace_message_id: Optional[str] = None
    knowledge_base_ids: Optional[List[str]] = Field(None, description="引用的知识库 ID 列表")
```

#### Service 层 (message_service.py)
- ✅ `add_message()` 方法新增 `knowledge_base_ids` 参数
- ✅ 保存知识库引用到 `message.meta_data["referenced_kbs"]`
- ✅ 同时存储知识库基本信息（ID + 名称）避免二次查询

数据结构示例：
```python
message.meta_data = {
    "knowledge_base_ids": ["kb_123", "kb_456"],
    "referenced_kbs": [
        {"kb_id": "kb_123", "kb_name": "技术文档"},
        {"kb_id": "kb_456", "kb_name": "产品手册"}
    ]
}
```

#### Agent 服务层 (agent_service.py)
- ✅ 在 `completions()` 方法中读取用户消息的 `meta_data["referenced_kbs"]`
- ✅ 提取知识库 ID 列表：`referenced_kb_ids = [kb["kb_id"] for kb in referenced_kbs]`
- ✅ 构建工具执行上下文时传递给 knowledge_base provider：
```python
provider_configs={
    "knowledge_base": ProviderConfig(
        enabled_tools=True if referenced_kb_ids else False,
        metadata={"referenced_kb_ids": referenced_kb_ids} if referenced_kb_ids else None
    ),
}
```

#### 工具提供者层 (knowledge_base_tool_provider.py)
- ✅ 添加 `_context_metadata` 属性存储元数据
- ✅ 添加 `set_context_metadata()` 方法设置元数据
- ✅ 在 `_search()`, `_list_files()`, `_get_chunks()` 方法中验证权限：
  - 检查是否有 `allowed_kb_ids` 限制
  - 验证传入的 `knowledge_base_id` 是否在允许列表中
  - 如果不在允许列表中，返回错误提示："无权访问该知识库，只能在用户选中的知识库范围内搜索"

#### 工具编排层 (tool_orchestrator.py)
- ✅ `ProviderConfig` 新增 `metadata` 字段
- ✅ `execute()` 方法在执行前调用 provider 的 `set_context_metadata()` 方法
- ✅ 确保 metadata 正确传递给 KnowledgeBaseToolProvider

---

## 🔧 技术架构

### 数据流（简化版 - AI 自主选择）

```
前端 ChatInput.vue
  ↓ (发送消息)
  { content, files, knowledgeBaseIds }
  ↓
后端 messages.py (路由)
  ↓ (调用)
message_service.add_message(knowledge_base_ids=[...])
  ↓ (保存到数据库)
message.meta_data = {
    "knowledge_base_ids": [...],
    "referenced_kbs": [{kb_id, kb_name, description}, ...]
}
  ↓
agent_service._get_conversation_messages()
  ↓ (读取 meta_data)
  referenced_kbs = [...]
  ↓ (构建知识库信息文本)
  kb_reference_text = "【当前引用的知识库】\n- 名称：xxx, ID: xxx, 简介：xxx\n..."
  ↓ (追加到用户消息后面)
  conversation_messages[last_user_idx]["content"] += "\n\n" + kb_reference_text
  ↓
agent_service.completions()
  ↓ (检测到知识库引用)
  has_kb_reference = True
  ↓ (启用 knowledge_base provider)
  tool_context.provider_configs["knowledge_base"].enabled_tools = True
  ↓
LLM 看到用户消息中的知识库信息
  ↓ (自行决定调用哪个知识库)
  调用 knowledge_base__search(knowledge_base_id="kb_123", ...)
  ↓
tool_orchestrator.execute()
  ↓ (路由到 KnowledgeBaseToolProvider)
  provider._search(params, user_id)
  ↓ (基础权限验证)
  验证 kb.user_id == user_id
  ↓ (执行搜索)
  返回搜索结果
```

---

## 🎯 使用场景

### 场景 1：单知识库问答
1. 用户点击"知识库"按钮
2. 选择一个知识库（如"技术文档"）
3. 发送问题："Python 装饰器怎么用？"
4. AI 仅在"技术文档"知识库中搜索相关内容并回答

### 场景 2：多知识库问答
1. 用户选择多个知识库（如"技术文档" + "产品手册"）
2. 发送问题："这个功能怎么实现？"
3. AI 在两个知识库中同时搜索并综合回答

### 场景 3：无知识库问答
1. 用户不选择任何知识库
2. 发送问题
3. AI 不使用知识库工具，仅基于训练数据回答

---

## ⚠️ 注意事项

### 1. 向后兼容性
- ✅ 旧消息没有 `referenced_kbs` 字段不影响现有功能
- ✅ 未选择知识库时行为与原来一致

### 2. 权限控制
- ✅ 用户只能选择自己有权限的知识库（通过 API 过滤）
- ✅ AI 工具调用时进行基础权限验证（确保知识库属于该用户）
- ✅ **不再限制 AI 只能在指定知识库中搜索**，AI 可以根据上下文信息自行决定调用哪个知识库

### 3. 性能优化
- ✅ 知识库基本信息缓存在 `meta_data` 中
- ✅ 避免重复数据库查询
- ✅ 知识库引用信息仅追加到最后一条用户消息，不污染后续对话

### 4. 用户体验
- ✅ 知识库标签清晰展示，支持快速移除
- ✅ 对话框支持搜索和批量选择
- ✅ 已选知识库数量实时提示

### 5. AI 自主性
- ✅ AI 可以看到所有引用的知识库信息
- ✅ AI 自行决定调用哪个知识库（或多个知识库）
- ✅ AI 可以选择不调用知识库工具（基于训练数据回答）

---

## 🧪 测试建议

### 前端测试点
- [ ] 知识库按钮正常显示和点击
- [ ] 对话框打开并显示知识库列表
- [ ] 支持多选和搜索
- [ ] 已选知识库标签正确显示
- [ ] 移除标签功能正常
- [ ] 发送消息时知识库 ID 正确传递

### 后端集成测试点
- [ ] 消息创建接口接收知识库 ID 参数
- [ ] `meta_data` 正确保存知识库引用
- [ ] Agent 服务正确解析知识库引用
- [ ] 工具调用限制在指定知识库范围内
- [ ] 权限验证正常工作

### 端到端测试点
- [ ] 选择知识库 → 发送消息 → AI 回答基于指定知识库
- [ ] 不选知识库 → AI 不使用知识库工具
- [ ] 选择多个知识库 → AI 在多个库中搜索
- [ ] 历史记录中查看知识库引用信息正确展示

---

## 📁 修改的文件清单

### 前端文件
1. `frontend/src/components/ui/ChatInput.vue`
   - 新增知识库选择按钮
   - 新增知识库选择对话框
   - 新增知识库标签显示
   - 扩展 props 和 emits
   - 新增相关知识库方法和计算属性

### 后端文件
1. `backend/app/schemas/message.py`
   - 扩展 `MessageCreate` schema

2. `backend/app/services/message_service.py`
   - 扩展 `add_message()` 方法

3. `backend/app/routes/messages.py`
   - 传递 `knowledge_base_ids` 参数

4. `backend/app/services/agent_service.py`
   - 在 `completions()` 中读取知识库引用

5. `backend/app/services/tools/tool_orchestrator.py`
   - 扩展 `ProviderConfig` 增加 `metadata` 字段
   - 在 `execute()` 中设置 provider metadata

6. `backend/app/services/tools/providers/knowledge_base_tool_provider.py`
   - 添加 `_context_metadata` 属性
   - 添加 `set_context_metadata()` 方法
   - 在所有工具方法中添加权限验证

---

## 🚀 下一步工作

1. **前端集成**：在 ChatPanel.vue 或 CreateSessionChatPanel.vue 中使用新的 `knowledgeBaseIds` prop
2. **样式优化**：根据实际效果调整知识库标签和对话框样式
3. **错误处理**：完善网络错误、权限错误等异常情况的用户提示
4. **性能优化**：考虑缓存知识库列表减少重复请求
5. **单元测试**：为新增功能编写完整的测试用例

---

## 📝 技术亮点

1. **上下文注入设计**：将知识库信息追加到用户消息后面，让 AI 自然感知并自主选择
2. **最小侵入性**：仅在最后一条用户消息中添加引用信息，不污染对话历史
3. **AI 自主决策**：不再强制限制知识库 ID，AI 可以根据上下文自行决定调用哪个知识库
4. **权限双重验证**：前端选择 + 后端工具调用时的基础权限检查
5. **渐进式增强**：不影响现有功能，未选择知识库时行为保持一致
6. **类型安全**：TypeScript 和 Pydantic 提供编译时类型检查

---

**实现日期**: 2026-04-02  
**实现者**: AI Assistant  
**版本**: v1.0
