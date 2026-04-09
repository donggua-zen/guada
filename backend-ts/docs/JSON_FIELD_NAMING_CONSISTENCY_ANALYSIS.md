# JSON 字段命名一致性分析与修复报告

## 📋 分析概述

本报告分析了 TypeScript 后端和前端在 JSON 字段（特别是 `settings` 字段）中的命名规范一致性问题。

---

## 🔍 当前状态分析

### 1. **前端组件使用的字段命名** ✅ camelCase

#### CharacterSettingPanel.vue
```typescript
// 表单数据（camelCase）
characterForm: {
  systemPrompt: '',           // ✅ camelCase
  modelTemperature: null,     // ✅ camelCase
  modelTopP: null,            // ✅ camelCase
  maxMemoryLength: null,      // ✅ camelCase
  memoryType: '',             // ✅ camelCase
  assistantName: '',          // ✅ camelCase
  assistantIdentity: '',      // ✅ camelCase
}

// 保存时的 settings 对象（camelCase）
settings: {
  systemPrompt: characterForm.systemPrompt,
  modelTemperature: characterForm.modelTemperature,
  modelTopP: characterForm.modelTopP,
  maxMemoryLength: characterForm.maxMemoryLength,
  memoryType: characterForm.memoryType,
  // ...
}
```

#### ChatPanel.vue
```vue
<!-- 读取 settings -->
{{ currentSession?.settings.system_prompt }}  <!-- ❌ snake_case -->
```

#### CreateSessionChatPanel.vue
```typescript
// 混合使用
max_memory_length: newCharacter.settings?.max_memory_length  // ❌ snake_case
maxMemoryLength: newCharacter.settings?.max_memory_length    // ❌ 赋值给 camelCase
```

---

### 2. **TypeScript 后端使用的字段命名** ⚠️ 混合

#### agent.service.ts (mergeSettings 方法)
```typescript
private mergeSettings(session: any) {
  const sessionSettings = session.settings ? JSON.parse(session.settings) : {};
  const characterSettings = session.character?.settings ? JSON.parse(session.character.settings) : {};
  
  return {
    ...characterSettings,
    ...sessionSettings,
    maxMemoryLength: sessionSettings.max_memory_length ?? characterSettings.max_memory_length ?? 20,  // ❌ 读取 snake_case
    systemPrompt: sessionSettings.system_prompt ?? characterSettings.system_prompt,                    // ❌ 读取 snake_case
    modelTemperature: sessionSettings.model_temperature ?? characterSettings.model_temperature,        // ❌ 读取 snake_case
    modelTopP: sessionSettings.model_top_p ?? characterSettings.model_top_p,                           // ❌ 读取 snake_case
  };
}
```

**问题分析**：
- ✅ 返回的键名是 **camelCase**（`maxMemoryLength`, `systemPrompt`）
- ❌ 但读取的是数据库中的 **snake_case** 键名（`max_memory_length`, `system_prompt`）

#### seed.ts (种子脚本)
```typescript
settings: JSON.stringify({
  system_prompt: '你是一个友好、专业的 AI 助手...',  // ❌ snake_case
  temperature: 0.7,                                  // ⚠️ 不一致
  max_tokens: 2048,                                  // ⚠️ 不一致
})
```

---

### 3. **Python 后端使用的字段命名** ✅ snake_case

#### app/schemas/session_settings.py
```python
class SessionSettings(BaseModel):
    max_memory_length: Optional[int] = None  # ✅ snake_case
    thinking_enabled: Optional[bool] = False
    skip_tool_calls: Optional[bool] = False
    referenced_kbs: Optional[List[str]] = None
```

#### app/schemas/character.py
```python
class CharacterBase(BaseModel):
    settings: Optional[dict] = None  # dict 类型，未定义具体字段
```

---

### 4. **数据库存储格式** ⚠️ 不一致

根据种子脚本和前端保存逻辑：

| 来源 | 字段命名 | 示例 |
|------|---------|------|
| **种子脚本** | snake_case | `system_prompt`, `max_tokens` |
| **前端保存** | camelCase | `systemPrompt`, `maxMemoryLength` |
| **Agent Service 读取** | snake_case | 期望 `system_prompt` |
| **Agent Service 返回** | camelCase | 返回 `systemPrompt` |

---

## ⚠️ 发现的问题

### 问题 1：字段命名不一致导致的数据读取失败

**场景**：
1. 前端保存角色时使用 **camelCase**：`{ systemPrompt: "..." }`
2. 数据库中存储为：`"{\"systemPrompt\":\"...\"}"`
3. Agent Service 尝试读取 **snake_case**：`sessionSettings.system_prompt`
4. **结果**：`undefined`（因为实际键名是 `systemPrompt`）

**影响**：
- ❌ 会话设置无法正确继承角色的配置
- ❌ `mergeSettings` 方法返回的值都是 `undefined`
- ❌ 聊天功能可能使用默认值而非用户配置

---

### 问题 2：种子脚本与前端格式不一致

**种子脚本**：
```typescript
settings: JSON.stringify({
  system_prompt: '...',  // snake_case
  temperature: 0.7,
  max_tokens: 2048,
})
```

**前端保存**：
```typescript
settings: {
  systemPrompt: '...',   // camelCase
  modelTemperature: 0.7,
  maxMemoryLength: 20,
}
```

**影响**：
- ❌ 种子数据创建的记录无法被 Agent Service 正确读取
- ❌ 前端创建的角色与种子数据的格式不兼容

---

### 问题 3：ChatPanel.vue 直接访问 snake_case

```vue
{{ currentSession?.settings.system_prompt }}  <!-- ❌ 期望 snake_case -->
```

但前端保存时使用的是 `systemPrompt`（camelCase），导致显示为空。

---

## 🎯 解决方案

### 方案 A：统一使用 camelCase（推荐）✅

**理由**：
1. ✅ 符合 JavaScript/TypeScript 生态规范
2. ✅ 前端已经大部分使用 camelCase
3. ✅ Prisma 自动将数据库的 snake_case 映射为 camelCase
4. ✅ 与项目已有的 API 响应格式一致

**需要修改的地方**：

#### 1. 更新种子脚本

**文件**: [`src/scripts/seed.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\scripts\seed.ts#L168-L172)

```typescript
// 修改前
settings: JSON.stringify({
  system_prompt: '你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。',
  temperature: 0.7,
  max_tokens: 2048,
}),

// 修改后
settings: JSON.stringify({
  systemPrompt: '你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。',
  modelTemperature: 0.7,
  maxMemoryLength: 20,
}),
```

#### 2. 更新 Agent Service 的 mergeSettings 方法

**文件**: [`src/modules/chat/agent.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\chat\agent.service.ts#L171-L183)

```typescript
// 修改前
private mergeSettings(session: any) {
  const sessionSettings = session.settings ? JSON.parse(session.settings) : {};
  const characterSettings = session.character?.settings ? JSON.parse(session.character.settings) : {};
  
  return {
    ...characterSettings,
    ...sessionSettings,
    maxMemoryLength: sessionSettings.max_memory_length ?? characterSettings.max_memory_length ?? 20,
    systemPrompt: sessionSettings.system_prompt ?? characterSettings.system_prompt,
    modelTemperature: sessionSettings.model_temperature ?? characterSettings.model_temperature,
    modelTopP: sessionSettings.model_top_p ?? characterSettings.model_top_p,
  };
}

// 修改后
private mergeSettings(session: any) {
  const sessionSettings = session.settings ? JSON.parse(session.settings) : {};
  const characterSettings = session.character?.settings ? JSON.parse(session.character.settings) : {};
  
  return {
    ...characterSettings,
    ...sessionSettings,
    maxMemoryLength: sessionSettings.maxMemoryLength ?? characterSettings.maxMemoryLength ?? 20,
    systemPrompt: sessionSettings.systemPrompt ?? characterSettings.systemPrompt,
    modelTemperature: sessionSettings.modelTemperature ?? characterSettings.modelTemperature,
    modelTopP: sessionSettings.modelTopP ?? characterSettings.modelTopP,
  };
}
```

#### 3. 更新前端组件中的 snake_case 引用

**文件**: [`src/components/ChatPanel.vue`](file://d:\编程开发\AI\ai_chat\frontend\src\components\ChatPanel.vue#L33-L36)

```vue
<!-- 修改前 -->
<p class="text-sm text-gray-600 leading-6">{{ currentSession?.settings.system_prompt }}</p>

<!-- 修改后 -->
<p class="text-sm text-gray-600 leading-6">{{ currentSession?.settings.systemPrompt }}</p>
```

**文件**: [`src/components/ChatPanel/WelcomeScreen.vue`](file://d:\编程开发\AI\ai_chat\frontend\src\components\ChatPanel\WelcomeScreen.vue#L33)

```vue
<!-- 修改前 -->
{{ session?.settings.system_prompt }}

<!-- 修改后 -->
{{ session?.settings.systemPrompt }}
```

**文件**: [`src/components/CreateSessionChatPanel.vue`](file://d:\编程开发\AI\ai_chat\frontend\src\components\CreateSessionChatPanel.vue)

需要将所有 `max_memory_length` 改为 `maxMemoryLength`。

---

### 方案 B：统一使用 snake_case（不推荐）❌

**缺点**：
1. ❌ 不符合 JavaScript/TypeScript 编码规范
2. ❌ 需要修改大量前端代码
3. ❌ 与 Prisma 的自动映射机制冲突
4. ❌ 增加维护成本

---

## 📊 影响范围评估

### 后端影响（TypeScript）

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `src/scripts/seed.ts` | 更新种子数据为 camelCase | 🔴 高 |
| `src/modules/chat/agent.service.ts` | 更新 mergeSettings 读取逻辑 | 🔴 高 |

### 前端影响

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `src/components/ChatPanel.vue` | `system_prompt` → `systemPrompt` | 🔴 高 |
| `src/components/ChatPanel/WelcomeScreen.vue` | `system_prompt` → `systemPrompt` | 🔴 高 |
| `src/components/CreateSessionChatPanel.vue` | `max_memory_length` → `maxMemoryLength` | 🟡 中 |
| 其他引用 `settings.*` 的组件 | 检查并统一为 camelCase | 🟡 中 |

### 数据库影响

- ⚠️ **现有数据**：数据库中已存在的记录可能使用 snake_case
- ✅ **新数据**：前端保存的新记录使用 camelCase
- 🔧 **迁移策略**：
  1. 保持向后兼容（同时支持两种格式）
  2. 或编写数据迁移脚本统一格式

---

## 🔧 实施建议

### 阶段 1：修复核心逻辑（立即执行）

1. ✅ 更新 `agent.service.ts` 的 `mergeSettings` 方法
2. ✅ 更新 `seed.ts` 的种子数据格式
3. ✅ 运行种子脚本重新初始化数据

### 阶段 2：修复前端显示（短期）

1. ✅ 更新 `ChatPanel.vue` 中的字段引用
2. ✅ 更新 `WelcomeScreen.vue` 中的字段引用
3. ✅ 更新 `CreateSessionChatPanel.vue` 中的字段引用

### 阶段 3：全面检查（中期）

1. 🔍 搜索所有使用 `settings.*` 的地方
2. 🔍 确保统一使用 camelCase
3. 🔍 添加类型定义防止未来错误

### 阶段 4：数据迁移（可选）

如果需要统一现有数据：

```javascript
// 迁移脚本示例
const characters = await prisma.character.findMany();
for (const char of characters) {
  const settings = JSON.parse(char.settings);
  const migratedSettings = {
    systemPrompt: settings.system_prompt || settings.systemPrompt,
    modelTemperature: settings.temperature || settings.modelTemperature,
    maxMemoryLength: settings.max_tokens || settings.maxMemoryLength,
  };
  await prisma.character.update({
    where: { id: char.id },
    data: { settings: JSON.stringify(migratedSettings) }
  });
}
```

---

## ✅ 推荐的最终状态

### 统一的字段命名规范（camelCase）

| 字段含义 | 推荐命名 | 说明 |
|---------|---------|------|
| 系统提示词 | `systemPrompt` | 角色的系统提示 |
| 模型温度 | `modelTemperature` | 生成随机性控制 |
| Top P | `modelTopP` | 核采样参数 |
| 最大记忆长度 | `maxMemoryLength` | 上下文窗口大小 |
| 记忆类型 | `memoryType` | 记忆策略 |
| 助手名称 | `assistantName` | 助手显示名称 |
| 助手身份 | `assistantIdentity` | 助手人设描述 |
| 跳过工具调用 | `skipToolCalls` | 是否禁用工具 |
| 启用的工具 | `tools` | 本地工具列表 |
| 启用的 MCP 服务器 | `mcpServers` | MCP 服务器 ID 数组 |

---

## 📝 总结

### 当前问题
1. ❌ 字段命名在前端、后端、数据库之间不一致
2. ❌ Agent Service 读取 snake_case 但前端保存 camelCase
3. ❌ 种子脚本使用 snake_case 与前端不兼容

### 推荐方案
✅ **统一使用 camelCase**，符合 TypeScript/JavaScript 生态规范

### 需要修改的文件
- 🔴 `src/scripts/seed.ts` - 更新种子数据
- 🔴 `src/modules/chat/agent.service.ts` - 更新读取逻辑
- 🔴 `src/components/ChatPanel.vue` - 更新显示逻辑
- 🔴 `src/components/ChatPanel/WelcomeScreen.vue` - 更新显示逻辑
- 🟡 `src/components/CreateSessionChatPanel.vue` - 更新字段引用

### 预期收益
- ✅ 消除字段命名不一致导致的 bug
- ✅ 提高代码可维护性
- ✅ 符合项目整体技术规范
- ✅ 减少开发者的认知负担

---

**分析日期**: 2026-04-05  
**分析人员**: Lingma AI Assistant  
**风险等级**: 中（需要协调前后端修改）  
**建议优先级**: 🔴 高（影响核心聊天功能）
