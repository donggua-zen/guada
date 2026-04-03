# CreateSessionChatPanel 知识库选择持久化修复

## 📋 问题概述

在创建会话页面（CreateSessionChatPanel）中，知识库选择功能存在两个关键问题：

1. **问题 1：知识库选择状态未持久化** - 刷新页面后选中的知识库丢失
2. **问题 2：消息 payload 字段不完整** - 创建会话时没有传递 `knowledgeBaseIds` 到后端

---

## 🔍 问题分析

### 问题 1：知识库选择状态未持久化

#### 现象
- 用户在创建会话页面选择知识库后，点击"应用"确认
- 刷新浏览器，之前选中的知识库标签消失
- 但在已有会话页面（ChatPanel）中选择的知识库能够正确保存和恢复

#### 根本原因
```typescript
// ❌ 修复前（第 343-346 行）
const handleConfigChange = (config: any): void => {
  // ... 其他配置处理
  
  // 🔥 新增：保存知识库选择到会话设置
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { 
      ...(currentSession.value.settings || {}), 
      referenced_kbs: config.knowledgeBaseIds 
    };
    // ❌ 缺失：没有保存到 localStorage
  }
};
```

**对比 ChatPanel.vue 的实现**：
```typescript
// ChatPanel.vue 中已经实现了持久化
if (typeof config.knowledgeBaseIds !== 'undefined') {
  currentSession.value.settings.referenced_kbs = config.knowledgeBaseIds;
}
// ✅ ChatPanel 通过 emit("save-settings") 触发后端保存
```

**差异**：
- ChatPanel.vue：保存到**数据库**（通过 session.settings）
- CreateSessionChatPanel.vue：**只保存在内存中**，没有持久化

---

### 问题 2：消息 payload 字段不完整

#### 现象
- 在创建会话页面点击发送按钮，后端收不到消息内容
- 但在已有会话页面发送消息正常

#### 数据流分析

**ChatInput.vue 的 sendMessage 方法**：
```typescript
// ChatInput.vue:735-739
emit('send', {
    content: inputContent.value,      // ✅ 使用 content 字段
    files: uploadFiles.value,
    knowledgeBaseIds: props.config?.knowledgeBaseIds || []
});
```

**CreateSessionChatPanel.vue 的处理（修复前）**：
```typescript
// CreateSessionChatPanel.vue:380-385 (修复前)
const sendMessage = (): void => {
  // ...
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, { ...inputMessage.value });  // ❌ 问题所在
}
```

**inputMessage 的结构**：
```typescript
const inputMessage = ref({
  content: "",      // ✅ 有 content 字段
  files: []         // ✅ 有 files 字段
  // ❌ 没有 knowledgeBaseIds 字段
});
```

**问题**：
1. `{ ...inputMessage.value }` 只包含 `content` 和 `files`
2. **缺少 `knowledgeBaseIds`**，导致后端无法获取用户选择的知识库
3. 与 ChatPanel.vue 的实现不一致

**对比 ChatPanel.vue 的正确实现**：
```typescript
// ChatPanel.vue:885-903
async function handleSendMessage(payload?: { 
  content: string; 
  files: any[]; 
  knowledgeBaseIds?: string[] 
}) {
  const data = payload;
  const { content, files, knowledgeBaseIds } = data;  // ✅ 完整解构
  
  await sendNewMessage(
    sessionId, 
    content,      // ✅ 传递 content
    files,        // ✅ 传递 files
    null, 
    knowledgeBaseIds  // ✅ 传递 knowledgeBaseIds
  );
}
```

---

## ✅ 修复方案

### 修复 1：添加知识库持久化存储

#### Step 1: 声明 localStorage 变量

```typescript
// CreateSessionChatPanel.vue:137-138
// 用户手动选择的模型 ID（刷新页面后从 localStorage 恢复）
const userSelectedModelId = useStorage<string | null>('userSelectedModelId', null);

// 🔥 新增：用户选择的知识库 ID 列表（刷新页面后从 localStorage 恢复）
const userSelectedKnowledgeBaseIds = useStorage<string[]>('userSelectedKnowledgeBaseIds', []);
```

**说明**：
- 使用 `useStorage`（来自 @vueuse/core）自动同步 localStorage
- 键名：`userSelectedKnowledgeBaseIds`
- 默认值：`[]`（空数组）

---

#### Step 2: 初始化时从 localStorage 加载

```typescript
// CreateSessionChatPanel.vue:145-154
const currentSession = ref<any>({
  character_id: null,
  model_id: null,
  avatar_url: null,
  title: "新建对话",
  settings: {
    thinking_enabled: lastThinkingEnabled.value,
    referenced_kbs: userSelectedKnowledgeBaseIds.value, // 🔥 新增：从 localStorage 加载
    model_name: null,
  }
})
```

**效果**：
- 页面加载时，`currentSession.settings.referenced_kbs` 自动填充为 localStorage 中的值
- ChatInput 组件通过 `:config="{ knowledgeBaseIds: currentSession.settings.referenced_kbs }"` 读取
- 已选知识库标签正确显示

---

#### Step 3: 保存到 localStorage

```typescript
// CreateSessionChatPanel.vue:343-350
const handleConfigChange = (config: any): void => {
  // ... 其他配置处理
  
  // 🔥 新增：保存知识库选择到会话设置和本地存储
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { 
      ...(currentSession.value.settings || {}), 
      referenced_kbs: config.knowledgeBaseIds 
    };
    // 🔥 保存到 localStorage，实现持久化
    userSelectedKnowledgeBaseIds.value = config.knowledgeBaseIds;
    console.log('保存知识库选择到本地存储:', config.knowledgeBaseIds);
  }
};
```

**说明**：
- 同时更新 `currentSession.settings.referenced_kbs`（运行时状态）
- 同时更新 `userSelectedKnowledgeBaseIds.value`（localStorage 持久化）
- 刷新页面后，Step 2 会重新加载这个值

---

### 修复 2：补全消息 payload 字段

#### 修改 sendMessage 方法

```typescript
// CreateSessionChatPanel.vue:375-389 (修复后)
const sendMessage = (): void => {
  if (!currentSession.value.character_id) {
    notify.error("创建失败", '请先选择一个角色模板');
    return;
  }
  // 🔥 修复：传递完整的 payload，包含 knowledgeBaseIds
  emit("create-session", {
    character_id: currentSession.value.character_id,
    model_id: currentModelId.value,
    title: autoTitle(),
    settings: currentSession.value.settings
  }, { 
    content: inputMessage.value.content,      // ✅ 使用 content 字段
    files: inputMessage.value.files || [],    // ✅ 使用 files 字段
    knowledgeBaseIds: currentSession.value.settings?.referenced_kbs || []  // 🔥 新增：传递知识库 ID
  });
}
```

**关键改进**：
1. ✅ 明确指定 `content` 字段（而非展开整个 `inputMessage`）
2. ✅ 明确指定 `files` 字段，并提供默认值 `[]`
3. ✅ **新增 `knowledgeBaseIds` 字段**，从 `currentSession.settings.referenced_kbs` 获取

**数据流**：
```
sendMessage()
  ↓
emit("create-session", ..., {
  content: "...",
  files: [...],
  knowledgeBaseIds: [...]  // ✅ 新增
})
  ↓
父组件（如 ChatPage.vue）监听 create-session 事件
  ↓
调用 ApiService.createMessage()
  ↓
POST /sessions/{sessionId}/messages
  ↓
后端接收到完整的消息数据 ✅
```

---

## 🎯 完整数据流（修复后）

### 知识库选择与持久化流程

```
用户点击"知识库"按钮
  ↓
选择知识库 → 点击"应用"
  ↓
ChatInput emit('config-change', { knowledgeBaseIds: ['kb_1', 'kb_2'] })
  ↓
handleConfigChange(config)
  ↓
currentSession.settings.referenced_kbs = ['kb_1', 'kb_2']
userSelectedKnowledgeBaseIds.value = ['kb_1', 'kb_2']  ✅ 保存到 localStorage
  ↓
刷新页面
  ↓
onMounted() → currentSession 初始化
  ↓
settings.referenced_kbs = userSelectedKnowledgeBaseIds.value  ✅ 从 localStorage 加载
  ↓
ChatInput :config="{ knowledgeBaseIds: settings.referenced_kbs }"
  ↓
显示已选知识库标签 ✅
```

### 创建会话并发送消息流程

```
用户输入消息内容
  ↓
点击发送按钮（或按 Enter）
  ↓
ChatInput sendMessage()
  ↓
emit('send', {
  content: inputContent.value,
  files: uploadFiles.value,
  knowledgeBaseIds: props.config.knowledgeBaseIds
})
  ↓
CreateSessionChatPanel.sendMessage()
  ↓
emit("create-session", {
  character_id: ...,
  model_id: ...,
  title: ...,
  settings: { referenced_kbs: [...] }  ✅
}, {
  content: inputMessage.value.content,      ✅
  files: inputMessage.value.files,          ✅
  knowledgeBaseIds: settings.referenced_kbs  ✅
})
  ↓
父组件（ChatPage）监听 create-session
  ↓
apiService.createSession({ ... }, messageData)
  ↓
POST /sessions
POST /sessions/{sessionId}/messages
  ↓
后端接收到完整的消息和知识库信息 ✅
```

---

## 📊 修复对比

| 方面 | 修复前 | 修复后 |
|------|--------|--------|
| **知识库持久化** | ❌ 无 localStorage 存储 | ✅ 保存到 localStorage |
| **页面刷新恢复** | ❌ 知识库丢失 | ✅ 正确恢复 |
| **sendMessage payload** | ❌ 只有 content 和 files | ✅ 包含 content、files、knowledgeBaseIds |
| **后端接收** | ❌ 缺少知识库信息 | ✅ 完整接收所有字段 |
| **与 ChatPanel 一致性** | ❌ 不一致 | ✅ 保持一致 |

---

## 🧪 验证步骤

### 1. 知识库持久化验证

**测试步骤**：
1. 打开新建对话页面
2. 点击"知识库"按钮
3. 选择 2-3 个知识库
4. 点击"应用"确认
5. 观察控制台输出：`保存知识库选择到本地存储：['kb_xxx', ...]`
6. **刷新浏览器**

**预期结果**：
- ✅ 刷新后，已选知识库标签正确显示
- ✅ 标签数量和内容与刷新前一致
- ✅ 控制台无 JavaScript 错误

**开发者工具验证**：
```javascript
// 打开浏览器 Console
localStorage.getItem('userSelectedKnowledgeBaseIds')
// 应该看到：["kb_xxx", "kb_yyy"]
```

---

### 2. 创建会话消息验证

**测试步骤**：
1. 在新建对话页面选择 1-2 个知识库
2. 输入消息："你好，我想了解一下人工智能"
3. 点击发送按钮

**预期结果**：
- ✅ 消息成功发送到后端
- ✅ Network 面板能看到 POST 请求
- ✅ 请求体包含完整的消息内容

**Network 请求验证**：
```json
// POST /sessions
{
  "character_id": "char_xxx",
  "model_id": "model_xxx",
  "title": "你好，我想了解一下人工智",
  "settings": {
    "referenced_kbs": ["kb_1", "kb_2"]  ✅
  }
}

// POST /sessions/{sessionId}/messages
{
  "content": "你好，我想了解一下人工智能",  ✅
  "files": [],                            ✅
  "knowledge_base_ids": ["kb_1", "kb_2"]  ✅
}
```

---

### 3. 对比测试（ChatPanel vs CreateSessionChatPanel）

**测试步骤**：
1. 在 ChatPanel 中选择知识库 A，发送消息
2. 在 CreateSessionChatPanel 中选择知识库 B，发送消息
3. 比较两者的行为

**预期结果**：
- ✅ 两者都能正确保存知识库选择
- ✅ 两者都能正确传递 knowledgeBaseIds 到后端
- ✅ 两者的用户体验一致

---

## 🔑 关键技术点

### 1. localStorage 持久化模式

```typescript
// 使用 @vueuse/core 的 useStorage
import { useStorage } from '@vueuse/core'

const userSelectedKnowledgeBaseIds = useStorage<string[]>(
  'userSelectedKnowledgeBaseIds',  // localStorage 键名
  []                                // 默认值
)

// 自动同步：
// - 读取：userSelectedKnowledgeBaseIds.value → localStorage.getItem()
// - 写入：userSelectedKnowledgeBaseIds.value = [...] → localStorage.setItem()
```

**优势**：
- ✅ 响应式：修改 `.value` 自动触发组件重新渲染
- ✅ 自动序列化：数组自动转为 JSON 字符串存储
- ✅ 类型安全：TypeScript 泛型确保类型正确

---

### 2. Payload 字段统一

**统一使用 `content` 字段**：

```typescript
// ChatInput.vue → emit
emit('send', {
  content: inputContent.value,  // ✅ 统一使用 content
  files: [...],
  knowledgeBaseIds: [...]
})

// ChatPanel.vue → 接收
async function handleSendMessage(payload?: { 
  content: string;  // ✅ 统一使用 content
  files: any[]; 
  knowledgeBaseIds?: string[] 
})

// CreateSessionChatPanel.vue → 接收
const sendMessage = (): void => {
  emit("create-session", ..., { 
    content: inputMessage.value.content,  // ✅ 统一使用 content
    files: ...,
    knowledgeBaseIds: ...
  });
}
```

**命名规范**：
- ✅ `content`：消息文本内容
- ✅ `files`：附件列表
- ✅ `knowledgeBaseIds`：知识库 ID 列表

---

### 3. 初始化时机

```typescript
// ❌ 错误：在 onMounted 中初始化
const currentSession = ref<any>({})

onMounted(() => {
  currentSession.value = {
    settings: {
      referenced_kbs: userSelectedKnowledgeBaseIds.value  // ❌ 太晚了
    }
  }
})

// ✅ 正确：在声明时初始化
const currentSession = ref<any>({
  settings: {
    referenced_kbs: userSelectedKnowledgeBaseIds.value  // ✅ 组件创建时立即执行
  }
})
```

**原因**：
- ChatInput 组件在模板中立即需要 `:config.knowledgeBaseIds`
- 如果在 onMounted 中赋值，会导致首次渲染时值为空

---

## 💡 优化建议

### 1. 添加调试日志（开发环境）

```typescript
const handleConfigChange = (config: any): void => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[CreateSessionChatPanel] handleConfigChange:', config);
  }
  
  // ... 处理逻辑
  
  if (typeof config.knowledgeBaseIds !== 'undefined') {
    currentSession.value.settings = { 
      ...(currentSession.value.settings || {}), 
      referenced_kbs: config.knowledgeBaseIds 
    };
    userSelectedKnowledgeBaseIds.value = config.knowledgeBaseIds;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[CreateSessionChatPanel] 知识库选择已保存到 localStorage:', 
                  config.knowledgeBaseIds);
    }
  }
};
```

### 2. 添加错误处理

```typescript
const sendMessage = (): void => {
  try {
    if (!currentSession.value.character_id) {
      notify.error("创建失败", '请先选择一个角色模板');
      return;
    }
    
    // 验证 payload 完整性
    const payload = {
      content: inputMessage.value.content,
      files: inputMessage.value.files || [],
      knowledgeBaseIds: currentSession.value.settings?.referenced_kbs || []
    };
    
    if (!payload.content && payload.files.length === 0) {
      notify.warn("提示", "请输入消息内容或上传文件");
      return;
    }
    
    emit("create-session", {
      character_id: currentSession.value.character_id,
      model_id: currentModelId.value,
      title: autoTitle(),
      settings: currentSession.value.settings
    }, payload);
  } catch (error) {
    console.error('[CreateSessionChatPanel] sendMessage error:', error);
    notify.error("发送失败", error.message);
  }
};
```

### 3. 统一常量定义

```typescript
// constants/storage.ts
export const STORAGE_KEYS = {
  USER_SELECTED_MODEL_ID: 'userSelectedModelId',
  USER_SELECTED_KNOWLEDGE_BASE_IDS: 'userSelectedKnowledgeBaseIds',
  LAST_MODEL_CONFIG: 'lastModelConfig',
  LAST_THINKING_ENABLED: 'lastThinkingEnabled',
} as const;

// 使用
const userSelectedKnowledgeBaseIds = useStorage<string[]>(
  STORAGE_KEYS.USER_SELECTED_KNOWLEDGE_BASE_IDS,
  []
);
```

---

## 📝 经验总结

### 问题根源

1. **持久化意识不足**：
   - 只关注运行时状态（内存）
   - 忽略了刷新页面后的状态保持
   - 没有参考 ChatPanel 的已有实现

2. **Payload 字段不严谨**：
   - 使用展开运算符 `{ ...inputMessage.value }`
   - 没有明确检查字段完整性
   - 缺少 `knowledgeBaseIds` 导致数据丢失

### 解决方案

1. **统一持久化模式**：
   - 使用 `useStorage` 管理所有需要持久化的状态
   - 在组件初始化时立即从 localStorage 加载
   - 在状态变更时立即保存到 localStorage

2. **明确字段定义**：
   - 不使用展开运算符，而是明确列出每个字段
   - 提供默认值，防止 undefined 错误
   - 与 ChatPanel 保持一致的字段命名

3. **数据流完整性**：
   - 前端组件 → 父组件 → API 服务 → 后端接口
   - 每一层都明确传递完整的字段
   - 使用 TypeScript 类型约束确保字段完整

### 最佳实践

1. ✅ **持久化状态管理**：
   - 用户选择的状态应该持久化
   - 使用统一的存储键名规范
   - 在多个组件间保持一致的行为

2. ✅ **数据传递明确性**：
   - 明确列出 payload 的每个字段
   - 避免隐式的展开运算
   - 提供合理的默认值

3. ✅ **组件行为一致性**：
   - 相似功能的组件应该有相似的行为
   - ChatPanel 和 CreateSessionChatPanel 都是聊天场景
   - 应该保持相同的用户体验

---

## 🔗 相关文件

**修改的文件**：
- ✅ `frontend/src/components/CreateSessionChatPanel.vue`
  - 添加 `userSelectedKnowledgeBaseIds` (L140)
  - 修改 `currentSession` 初始化 (L153)
  - 修改 `handleConfigChange` (L343-350)
  - 修改 `sendMessage` (L375-389)

**无需修改的文件**：
- ✅ `frontend/src/components/ChatPanel.vue`（已有正确的持久化实现）
- ✅ `frontend/src/components/ui/ChatInput.vue`（payload 结构正确）

---

**修复日期**: 2026-04-02  
**版本**: v7.0 (CreateSessionChatPanel 知识库持久化修复版)  
**状态**: ✅ 已完成  
**关键修复点**: 
1. 添加 localStorage 持久化存储
2. 补全 sendMessage payload 中的 knowledgeBaseIds 字段
