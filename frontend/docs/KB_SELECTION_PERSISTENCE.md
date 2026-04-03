# 知识库选择持久化功能实现

## 📋 问题描述

用户在前端选择知识库后，刷新页面时选中的知识库状态会丢失。原因是知识库选择仅保存在前端组件的临时状态中，没有持久化到数据库。

---

## ✅ 解决方案

通过将会话设置（`session.settings.referenced_kbs`）保存到数据库，实现知识库选择的持久化。完整的数据流包括：

1. **前端保存**：用户选择知识库 → 触发 `config-change` → 保存到会话设置
2. **后端存储**：SessionSettings Schema 支持 `referenced_kbs` 字段 → 保存到数据库
3. **状态恢复**：页面加载 → 读取会话设置 → 恢复知识库选择状态

---

## 🔧 实现细节

### 1. 后端 Schema 扩展

**文件**: `backend/app/schemas/session_settings.py`

```python
from typing import Optional, List
from pydantic import BaseModel, field_validator


class SessionSettings(BaseModel):
    max_memory_length: Optional[int] = None
    thinking_enabled: Optional[bool] = False
    skip_tool_calls: Optional[bool] = False
    referenced_kbs: Optional[List[str]] = None  # 🔥 新增：选中的知识库 ID 列表
```

**说明**:
- 添加 `referenced_kbs` 字段，类型为 `Optional[List[str]]`
- 存储在 `session.settings` JSON 字段中
- 与现有的 `max_memory_length` 等配置一起管理

---

### 2. 前端 ChatPanel.vue - 处理配置变更

**文件**: `frontend/src/components/ChatPanel.vue`

```typescript
const handleConfigChange = (config: any) => {
  if (!currentSession.value) return;
  
  if (typeof config.modelId !== 'undefined')
    currentSession.value.model_id = config.modelId;
    
  if (typeof config.maxMemoryLength !== 'undefined')
    currentSession.value.settings.max_memory_length = config.maxMemoryLength;
  
  // 🔥 新增：保存知识库选择到会话设置
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings.referenced_kbs = config.knowledgeBaseIds;
  }
  
  emit("save-settings");
};
```

**说明**:
- 监听 ChatInput 的 `config-change` 事件
- 提取 `knowledgeBaseIds` 并保存到 `session.settings.referenced_kbs`
- 触发 `save-settings` 事件，最终调用后端 API 保存

---

### 3. 前端 CreateSessionChatPanel.vue - 新建会话支持

**文件**: `frontend/src/components/CreateSessionChatPanel.vue`

```typescript
const handleConfigChange = (config: any): void => {
  if (typeof config.modelId !== 'undefined') {
    currentSession.value.model_id = config.modelId;
    userSelectedModelId.value = config.modelId;
  }
  if (typeof config.maxMemoryLength !== 'undefined') {
    currentSession.value.settings = { 
      ...(currentSession.value.settings || {}), 
      max_memory_length: config.maxMemoryLength 
    };
    lastModelConfig.value = { ...lastModelConfig.value, maxMemoryLength: config.maxMemoryLength };
  }
  // 🔥 新增：保存知识库选择到会话设置
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { 
      ...(currentSession.value.settings || {}), 
      referenced_kbs: config.knowledgeBaseIds 
    };
  }
};
```

**说明**:
- 新建会话场景下的配置处理
- 使用对象展开运算符保持不可变性

---

### 4. 前端 ChatPanel.vue - 状态恢复

**文件**: `frontend/src/components/ChatPanel.vue`

```typescript
async function handleSessionChange(newSessionId: string | null, oldSessionId: string | null) {
  if (newSessionId === oldSessionId) return;
  isLoading.value = true;
  currentSessionId.value = newSessionId;
  
  if (newSessionId) {
    try {
      // 获取会话配置
      const sessionData = await apiService.fetchSession(newSessionId);
      currentSession.value = sessionData;

      // 🔥 新增：恢复知识库选择状态（从 session.settings.referenced_kbs）
      if (sessionData.settings?.referenced_kbs && Array.isArray(sessionData.settings.referenced_kbs)) {
        // 通过触发 config-change 事件来恢复知识库选择
        handleConfigChange({ knowledgeBaseIds: sessionData.settings.referenced_kbs });
        console.log('恢复知识库选择:', sessionData.settings.referenced_kbs);
      }

      // 加载消息
      await loadMessages(newSessionId);
      // ...
    } catch (error) {
      console.error('加载会话失败:', error);
      notify.error('加载会话失败', error.message);
    } finally {
      isLoading.value = false;
    }
  } else {
    isLoading.value = false;
  }
}
```

**说明**:
- 在会话切换时（包括页面刷新）自动恢复知识库选择
- 从 `sessionData.settings.referenced_kbs` 读取之前保存的知识库 ID 列表
- 调用 `handleConfigChange()` 触发配置更新，使 ChatInput 组件重新渲染

---

## 🎯 完整数据流

### 保存流程

```
用户在 ChatInput 中选择知识库
  ↓
点击"应用"按钮
  ↓
emit('config-change', { knowledgeBaseIds: ['kb_1', 'kb_2'] })
  ↓
ChatPanel.handleConfigChange(config)
  ↓
currentSession.value.settings.referenced_kbs = config.knowledgeBaseIds
  ↓
emit('save-settings')
  ↓
ChatPage.handleSaveSessionSettings()
  ↓
apiService.updateSession(sessionId, { 
  model_id: ..., 
  settings: { referenced_kbs: ['kb_1', 'kb_2'], ... } 
})
  ↓
后端 PUT /sessions/{sessionId}
  ↓
SessionSettings schema 验证
  ↓
保存到数据库 session 表的 settings 字段（JSON 格式）
```

### 恢复流程

```
页面加载/刷新
  ↓
路由变化触发 watch(() => props.session?.id)
  ↓
handleSessionChange(newSessionId, oldSessionId)
  ↓
apiService.fetchSession(newSessionId)
  ↓
获取 sessionData.settings.referenced_kbs = ['kb_1', 'kb_2']
  ↓
handleConfigChange({ knowledgeBaseIds: ['kb_1', 'kb_2'] })
  ↓
更新 currentSession.value.settings.referenced_kbs
  ↓
ChatInput 组件通过 props.config 接收 knowledgeBaseIds
  ↓
selectedKnowledgeBases computed 属性重新计算
  ↓
显示已选知识库标签（Tag）
```

---

## 📊 修改文件清单

| 文件 | 修改内容 | 行数变化 |
|------|---------|---------|
| `backend/app/schemas/session_settings.py` | 添加 `referenced_kbs` 字段 | +2, -1 |
| `frontend/src/components/ChatPanel.vue` | 修改 `handleConfigChange()` | +4 |
| `frontend/src/components/ChatPanel.vue` | 修改 `handleSessionChange()` | +7, -2 |
| `frontend/src/components/CreateSessionChatPanel.vue` | 修改 `handleConfigChange()` | +4 |

**总计**: +17 行，-3 行

---

## ✅ 验证要点

### 功能验证

- [ ] **保存测试**：
  1. 打开一个会话
  2. 点击"知识库"按钮，选择 2-3 个知识库
  3. 点击"应用"确认
  4. 检查浏览器控制台是否输出"恢复知识库选择"日志
  5. 查看数据库 `session.settings` 字段是否包含 `referenced_kbs`

- [ ] **恢复测试**：
  1. 选择知识库后刷新页面
  2. 检查已选知识库标签是否正确显示
  3. 检查控制台日志是否显示"恢复知识库选择"
  4. 切换到其他会话再切回来，验证状态保持

- [ ] **兼容性测试**：
  1. 发送消息时检查是否携带 `knowledgeBaseIds`
  2. 验证知识库工具调用是否正常
  3. 测试不选择知识库的场景（向后兼容）

### 数据库验证

```sql
-- 查看 session 表的 settings 字段
SELECT id, title, settings 
FROM session 
WHERE settings->>'referenced_kbs' IS NOT NULL;

-- 示例输出：
-- settings = {
--   "max_memory_length": 50,
--   "referenced_kbs": ["kb_123", "kb_456"]
-- }
```

---

## 🔑 关键技术点

### 1. 双向绑定设计

```typescript
// ChatInput.vue 中通过 v-model 和 props.config 实现双向绑定
const selectedKnowledgeBases = computed(() => {
    const kbIds = props.config?.knowledgeBaseIds || [];
    return knowledgeBases.value.filter(kb => kbIds.includes(kb.id));
});

// get: 从 props 读取
// set: 通过 emit('update:knowledgeBaseIds') 或 emit('config-change') 通知父组件
```

### 2. 配置合并策略

```typescript
// CreateSessionChatPanel.vue 中使用对象展开保持不可变性
currentSession.value.settings = { 
  ...(currentSession.value.settings || {}), 
  referenced_kbs: config.knowledgeBaseIds 
};

// 避免直接修改原对象，确保 Vue 的响应式系统能正确追踪
```

### 3. 状态恢复时机

```typescript
// 在 handleSessionChange 中，获取会话数据后立即恢复
const sessionData = await apiService.fetchSession(newSessionId);
currentSession.value = sessionData;

// 🔥 关键：在加载消息之前恢复配置
if (sessionData.settings?.referenced_kbs) {
  handleConfigChange({ knowledgeBaseIds: sessionData.settings.referenced_kbs });
}

await loadMessages(newSessionId);
```

### 4. 向后兼容

- ✅ `referenced_kbs` 是可选字段，不影响旧会话
- ✅ 未选择知识库时行为与原来一致
- ✅ 发送消息时仍携带 `knowledgeBaseIds`，与持久化无关

---

## 🚀 优化建议

### 1. 类型安全增强

```typescript
// 定义明确的接口
interface InputMessageState {
  content: string;
  files: any[];
  isWaiting?: boolean;
  config?: {
    modelId?: string;
    maxMemoryLength?: number;
    knowledgeBaseIds?: string[];
  };
}

// 在 computed 中使用泛型
const inputMessage = computed<InputMessageState>({
  get: () => { /* ... */ },
  set: (value: InputMessageState) => { /* ... */ }
});
```

### 2. 错误处理增强

```typescript
try {
  if (sessionData.settings?.referenced_kbs) {
    // 验证知识库 ID 是否有效
    const validKbIds = sessionData.settings.referenced_kbs.filter(
      id => typeof id === 'string' && id.length > 0
    );
    
    if (validKbIds.length > 0) {
      handleConfigChange({ knowledgeBaseIds: validKbIds });
    }
  }
} catch (error) {
  console.warn('恢复知识库选择失败:', error);
  // 不阻断后续逻辑，继续加载消息
}
```

### 3. 性能优化

```typescript
// 使用防抖减少保存频率
const debouncedSaveSession = useDebounceFn(async () => {
  await apiService.updateSession(currentSession.value.id, {
    model_id: currentSession.value.model_id,
    settings: currentSession.value.settings
  });
}, 500);

// 在 handleConfigChange 中使用
if (typeof config.knowledgeBaseIds !== 'undefined') {
  currentSession.value.settings.referenced_kbs = config.knowledgeBaseIds;
  debouncedSaveSession(); // 🔥 防抖保存
}
```

---

## 📝 经验总结

### 问题根源
- **状态管理分散**：知识库选择状态仅保存在组件临时状态中
- **缺少持久化机制**：没有与会话设置关联
- **刷新后状态丢失**：前端状态重置为初始值

### 解决方案
- **统一状态管理**：将知识库选择纳入会话设置管理
- **前后端协同**：前端保存 → 后端存储 → 前端恢复
- **配置驱动 UI**：通过 `props.config` 控制组件状态

### 最佳实践
1. ✅ 重要状态应该持久化到数据库
2. ✅ 配置变更应该通过事件明确传递
3. ✅ 状态恢复应该在合适的生命周期进行
4. ✅ 保持向后兼容性，新增字段应该是可选的

---

**实现日期**: 2026-04-02  
**版本**: v1.0  
**状态**: ✅ 已完成
