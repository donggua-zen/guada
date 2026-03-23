# 会话设置与角色编辑分离说明

## 概述

已将**会话设置**和**角色编辑**功能分离为两个独立的组件，各自专注于不同的使用场景。

## 组件分工

### 1. SessionSettingPanel.vue (新增)

**用途**: 会话级别的配置面板  
**位置**: `frontend/src/components/SessionSettingPanel.vue`

**包含的设置项**:
- ✅ **模型设置**
  - 模型选择
  - 温度 (temperature)
  - Top P
  - 频率惩罚 (frequency_penalty)

- ✅ **记忆设置**
  - 上下文条数 (max_memory_length)
  - 最大记忆 tokens (max_memory_tokens)
  - 短期记忆 tokens (short_term_memory_tokens)

- ✅ **高级功能**
  - 网络搜索开关 (web_search_enabled)
  - 深度思考开关 (thinking_enabled)
  - 提示词模式 (use_user_prompt)

**特点**:
- 简洁明了，只包含会话运行时需要的配置
- 三栏布局：模型、记忆、高级
- 适用于对话过程中的快速调整

### 2. CharacterSettingPanel.vue (原有)

**用途**: 角色/智能体级别的编辑面板  
**位置**: `frontend/src/components/CharacterSettingPanel.vue`

**包含的设置项**:
- ✅ **基础设置**
  - 头像上传
  - 角色标题
  - 角色描述

- ✅ **提示词设置**
  - 系统提示词 (system_prompt)
  - 角色名称 (assistant_name)
  - 职业设定 (assistant_identity)
  - User Role 模式开关

- ✅ **模型设置**
  - 模型选择
  - 温度、Top P、频率惩罚

- ✅ **记忆设置**
  - 上下文条数
  - 最大记忆 tokens
  - 短期记忆 tokens

**特点**:
- 完整全面的角色配置
- 四栏布局：基础、提示词、模型、记忆
- 适用于创建/编辑角色模板

## 使用场景

### SessionSettingPanel 使用场景

1. **对话过程中调整参数**
   ```
   用户觉得 AI 回答太随机 → 调低温度
   需要更多上下文 → 增加上下文条数
   想要最新信息 → 开启网络搜索
   ```

2. **快速切换模型**
   ```
   当前模型效果不好 → 切换到其他模型
   需要特定功能 → 选择有该功能的模型
   ```

3. **个性化对话体验**
   ```
   针对当前对话调整记忆长度
   根据话题复杂度调整 tokens 限制
   ```

### CharacterSettingPanel 使用场景

1. **创建新角色**
   ```
   设定角色基本信息
   编写角色背景故事
   配置默认行为模式
   ```

2. **编辑现有角色**
   ```
   更新角色头像
   完善角色设定
   调整默认参数
   ```

3. **管理角色库**
   ```
   批量管理多个角色
   共享角色给其他用户
   优化角色表现
   ```

## 代码变更详情

### 1. 新建 SessionSettingPanel.vue

```vue
<template>
    <el-tabs v-model="tabsValue">
        <el-tab-pane name="model" label="模型">
            <!-- 模型相关设置 -->
        </el-tab-pane>
        <el-tab-pane name="memory" label="记忆">
            <!-- 记忆相关设置 -->
        </el-tab-pane>
        <el-tab-pane name="advanced" label="高级">
            <!-- 高级功能开关 -->
        </el-tab-pane>
    </el-tabs>
</template>
```

**关键特性**:
- 不包含头像、标题、描述等角色专属字段
- 不包含 system_prompt、assistant_name 等角色设定
- 专注于运行时参数调整

### 2. 修改 ChatPage.vue

**导入变更**:
```javascript
// 新增
const SessionSettingPanel = defineAsyncComponent(() => 
  import("@/components/SessionSettingPanel.vue")
);

// 保留
const CharacterSettingPanel = defineAsyncComponent(() => 
  import("@/components/CharacterSettingPanel.vue")
);
```

**使用变更**:
```vue
<!-- 之前 -->
<character-setting-panel :data="currentSession" ... />

<!-- 现在 -->
<session-setting-panel :data="currentSession" ... />
```

### 3. 修改 ChatPanel.vue

**数据访问路径修正**:
```vue
<!-- 之前 -->
<div v-if="currentSession.system_prompt">
  {{ currentSession.system_prompt }}
</div>

<!-- 现在 -->
<div v-if="currentSession.settings?.system_prompt">
  {{ currentSession.settings.system_prompt }}
</div>
```

**原因**: 会话继承角色配置后，system_prompt 在 settings 对象内

## 数据结构对比

### 会话数据结构

```javascript
{
  id: "session_123",
  title: "我的对话",
  model_id: "model_456",
  character_id: "char_789",  // 绑定的角色 ID
  settings: {
    // 运行时参数
    model_temperature: 0.7,
    model_top_p: 0.9,
    max_memory_length: 10,
    web_search_enabled: true,
    thinking_enabled: false,
    use_user_prompt: false,
    
    // 从角色继承的参数 (只读)
    system_prompt: "...",
    assistant_name: "...",
    assistant_identity: "...",
  }
}
```

### 角色数据结构

```javascript
{
  id: "char_789",
  title: "AI 助手",
  description: "一个有帮助的 AI",
  avatar_url: "/avatars/...",
  model_id: "model_456",
  settings: {
    // 角色核心设定
    assistant_name: "小智",
    assistant_identity: "AI 助手",
    system_prompt: "你是一个有帮助的 AI 助手",
    
    // 默认参数
    model_temperature: 0.7,
    model_top_p: 0.9,
    max_memory_length: 10,
    use_user_prompt: false,
  }
}
```

## 配置继承关系

```
角色配置 (CharacterSettingPanel 编辑)
    ↓
继承 + 选择性覆盖
    ↓
会话配置 (SessionSettingPanel 调整)
```

**示例**:

1. **角色设定** (通过 CharacterSettingPanel):
   ```json
   {
     "assistant_name": "小智",
     "system_prompt": "你是 AI 助手",
     "model_temperature": 0.7
   }
   ```

2. **会话调整** (通过 SessionSettingPanel):
   ```json
   {
     "model_temperature": 0.9,  // 覆盖
     "max_memory_length": 20     // 新增
   }
   ```

3. **最终生效**:
   ```json
   {
     "assistant_name": "小智",      // 从角色继承
     "system_prompt": "你是 AI 助手", // 从角色继承
     "model_temperature": 0.9,     // 会话覆盖
     "max_memory_length": 20       // 会话新增
   }
   ```

## 用户体验优化

### 分离前的问题

1. **信息过载**
   - 对话中调整参数时看到大量不相关的角色设置
   - 头像、标题等字段容易误改

2. **定位困难**
   - 找个温度设置要在一堆表单项中翻找
   - 不清楚哪些能改哪些不能改

3. **性能问题**
   - 加载完整的角色编辑组件较慢
   - 不必要的表单验证

### 分离后的优势

1. **专注高效**
   - 只显示当前需要的设置项
   - 快速找到并调整参数

2. **清晰明确**
   - 会话设置 vs 角色编辑，一目了然
   - 避免误操作

3. **轻量快速**
   - 组件更小，加载更快
   - 简化的验证逻辑

## API 调用

### SessionSettingPanel

```javascript
// 更新会话设置
await apiService.updateSession(sessionId, {
  model_id: "new_model",
  settings: {
    model_temperature: 0.9,
    max_memory_length: 20,
    web_search_enabled: true
  }
});
```

### CharacterSettingPanel

```javascript
// 创建/更新角色
await apiService.createCharacter({
  title: "AI 助手",
  model_id: "model_123",
  settings: {
    assistant_name: "小智",
    system_prompt: "...",
    model_temperature: 0.7
  }
});
```

## 测试建议

### 测试 SessionSettingPanel

1. **模型切换**
   - [ ] 选择不同的模型
   - [ ] 验证模型参数是否正确应用

2. **记忆调整**
   - [ ] 修改上下文条数
   - [ ] 修改 tokens 限制
   - [ ] 验证对话是否按新参数运行

3. **功能开关**
   - [ ] 切换网络搜索
   - [ ] 切换深度思考
   - [ ] 验证开关生效

### 测试 CharacterSettingPanel

1. **角色创建**
   - [ ] 填写完整信息
   - [ ] 上传头像
   - [ ] 保存成功

2. **角色编辑**
   - [ ] 修改各项设置
   - [ ] 验证修改生效

3. **基于角色创建会话**
   - [ ] 使用角色创建会话
   - [ ] 验证配置正确继承

## 向后兼容性

### 现有会话
- ✅ 不受影响，正常使用
- ✅ 可以通过 SessionSettingPanel 调整参数

### 现有角色
- ✅ 不受影响，继续通过 CharacterSettingPanel 编辑
- ✅ 基于角色创建的会话自动继承新设置

### 数据库结构
- ✅ 无需迁移
- ✅ 字段无变化

## 未来扩展

### SessionSettingPanel 可能的扩展

1. **预设配置**
   ```
   一键切换到"创意模式"(高温、高 top_p)
   一键切换到"严谨模式"(低温、低 top_p)
   ```

2. **使用统计**
   ```
   显示当前会话的 token 使用情况
   预估剩余可用 tokens
   ```

3. **实时预览**
   ```
   调整参数后立即看到效果评估
   "温度调高后，回答会更有创意但可能不够准确"
   ```

### CharacterSettingPanel 可能的扩展

1. **版本控制**
   ```
   查看角色的历史版本
   回滚到之前的配置
   ```

2. **批量管理**
   ```
   批量导出/导入角色
   复制角色配置
   ```

3. **协作编辑**
   ```
   多人共同维护角色
   审核角色的公开申请
   ```

---

**更新日期**: 2026-03-23  
**状态**: ✅ 完成  
**影响范围**: 前端 UI组件重构
