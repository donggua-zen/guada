# 默认模型设置组件 - 模型选择器升级

## 更新时间
2026-03-25

## 更新概述
将 `DefaultModelSettings.vue` 中的模型选择方式从传统的 `<el-select>` 下拉框升级为现代化的弹窗式选择器，参考 `ChatInput.vue` 的设计模式。

## 主要改进

### 1. UI/UX 升级 ✅

#### 原有方式（下拉框）
```vue
<el-select v-model="settingsForm.default_title_summary_model_id" placeholder="请选择模型">
    <el-option v-for="option in textModelOptions" :key="option.value"
        :label="option.label" :value="option.value" />
</el-select>
```

#### 新方式（弹窗选择器）
```vue
<div class="flex items-center gap-2">
    <!-- 只读输入框显示当前选择的模型 -->
    <el-input v-model="titleSummaryModelName" readonly placeholder="请选择模型"
        @click="openModelDialog('title')">
        <template #prefix>
            <OpenAI class="w-4 h-4" />
        </template>
    </el-input>
    
    <!-- 选择按钮 -->
    <el-button @click="openModelDialog('title')" plain type="primary">
        选择
    </el-button>
    
    <!-- 清除按钮（已选择时显示） -->
    <el-button v-if="settingsForm.default_title_summary_model_id"
        @click="clearModelSelection('title')" circle>
        <template #icon>
            <CloseOutlined />
        </template>
    </el-button>
</div>
```

### 2. 功能特性 ✅

#### 2.1 模型对话框
- **分组显示**：按供应商分组展示所有可用模型
- **搜索功能**：支持按模型名称或描述搜索
- **特性标签**：显示模型的特性标签（工具、混思、视觉）
- **选中状态**：清晰标识当前选中的模型
- **响应式设计**：适配移动端和桌面端

#### 2.2 交互优化
- **临时状态管理**：选择模型时不立即应用，点击"确定"后才生效
- **快速清除**：一键清除已选择的模型
- **错误提示**：未选择模型时点击"确定"会提示

### 3. 技术实现

#### 新增的响应式变量
```javascript
// 当前打开的对话框类型 ('title' | 'translation' | 'compression')
const currentDialogType = ref('')

// 模型选择对话框相关
const modelDialogVisible = ref(false)
const modelSearchText = ref('')
const tempModelId = ref(null) // 临时选中的模型 ID
```

#### 新增的计算属性
```javascript
// 计算各个模型输入框的显示值
const titleSummaryModelName = computed(() => 
    getModelNameById(settingsForm.default_title_summary_model_id)
)
const translationModelName = computed(() => 
    getModelNameById(settingsForm.default_translation_model_id)
)
const historyCompressionModelName = computed(() => 
    getModelNameById(settingsForm.default_history_compression_model_id)
)

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
    if (!modelSearchText.value) return models.value
    const searchText = modelSearchText.value.toLowerCase()
    return models.value.filter(model =>
        model.model_name?.toLowerCase().includes(searchText) ||
        model.description?.toLowerCase().includes(searchText)
    )
})

// 按供应商分组的过滤后模型列表
const filteredProviders = computed(() => {
    if (!models.value.length || !providers.value.length) return []
    const filtered = filteredModels.value
    return providers.value.map(provider => ({
        ...provider,
        models: filtered.filter(model => model.provider_id === provider.id)
    })).filter(provider => provider.models.length > 0)
})
```

#### 核心方法

##### 打开模型对话框
```javascript
const openModelDialog = (type) => {
    currentDialogType.value = type
    modelSearchText.value = ''
    
    // 根据类型设置当前选中的模型
    switch (type) {
        case 'title':
            tempModelId.value = settingsForm.default_title_summary_model_id
            break
        case 'translation':
            tempModelId.value = settingsForm.default_translation_model_id
            break
        case 'compression':
            tempModelId.value = settingsForm.default_history_compression_model_id
            break
    }
    
    modelDialogVisible.value = true
}
```

##### 选择模型（临时状态）
```javascript
const selectModel = (modelId) => {
    tempModelId.value = modelId
}
```

##### 应用模型选择
```javascript
const applyModelSelection = () => {
    if (!tempModelId.value) {
        notify.error('请选择模型')
        return
    }
    
    // 根据类型更新对应的模型 ID
    switch (currentDialogType.value) {
        case 'title':
            settingsForm.default_title_summary_model_id = tempModelId.value
            break
        case 'translation':
            settingsForm.default_translation_model_id = tempModelId.value
            break
        case 'compression':
            settingsForm.default_history_compression_model_id = tempModelId.value
            break
    }
    
    modelDialogVisible.value = false
    notify.success('已选择模型', `模型已更新`)
}
```

##### 清除模型选择
```javascript
const clearModelSelection = (type) => {
    switch (type) {
        case 'title':
            settingsForm.default_title_summary_model_id = null
            break
        case 'translation':
            settingsForm.default_translation_model_id = null
            break
        case 'compression':
            settingsForm.default_history_compression_model_id = null
            break
    }
}
```

### 4. 样式优化

#### 模型列表样式
```css
/* 模型项悬停效果 */
:deep(.model-item) {
    transition: all 0.2s;
}

:deep(.model-item:hover) {
    border-color: var(--el-color-primary-light-5);
}

/* 供应商标签样式 */
:deep(.provider-group) {
    margin-bottom: 1rem;
}

:deep(.provider-name) {
    color: var(--el-text-color-secondary);
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
}

/* 移动端特性标签隐藏 */
@media (max-width: 768px) {
    :deep(.model-item .el-tag) {
        display: none;
    }
}
```

## 对比优势

| 特性 | 原下拉框方式 | 新弹窗方式 |
|------|------------|-----------|
| **空间利用** | 占用较大垂直空间 | 紧凑，只在需要时展开 |
| **搜索体验** | 基础文本搜索 | 支持名称和描述搜索 |
| **信息展示** | 仅显示模型名称 | 显示名称 + 描述 + 特性标签 |
| **分组导航** | 有限 | 清晰的供应商分组 |
| **视觉反馈** | 一般 | 选中状态高亮 + 勾选图标 |
| **移动端适配** | 下拉框较小 | 全屏弹窗，更易操作 |
| **扩展性** | 受限 | 易于添加更多功能和标签页 |

## 文件变更

### 修改的文件
- `frontend/src/components/settings/DefaultModelSettings.vue` ✏️

### 新增的导入
- `CloseOutlined` from `@vicons/antd`
- `OpenAI` from `@/components/icons`
- `SearchFilled`, `CheckCircleFilled` from `@vicons/material`
- `ElDialog`, `ElTag`, `ElIcon` from `element-plus`
- `useBreakpoints` from `@vueuse/core`

## 测试建议

### 功能测试
1. ✅ 点击"选择"按钮能否正确打开对话框
2. ✅ 三个不同功能的模型选择是否独立工作
3. ✅ 搜索功能是否正常（按名称、描述）
4. ✅ 分组显示是否正确
5. ✅ 特性标签是否显示（工具、混思、视觉）
6. ✅ 选中状态是否正确显示
7. ✅ 点击"确定"后是否正确应用选择
8. ✅ 点击"取消"后是否放弃更改
9. ✅ 清除按钮是否能清空选择
10. ✅ 移动端适配是否正常

### 兼容性测试
- ✅ 桌面端浏览器
- ✅ 移动端浏览器
- ✅ 不同屏幕尺寸

## 用户体验提升

1. **更直观的模型选择**
   - 用户可以看到更多模型信息（描述、特性）
   - 分组显示帮助快速定位目标供应商

2. **更高效的搜索**
   - 实时搜索过滤
   - 支持名称和描述双重匹配

3. **更清晰的选择反馈**
   - 选中模型高亮显示
   - 勾选图标明确标识

4. **更便捷的操作**
   - 一键清除选择
   - 临时状态管理，避免误操作

## 后续优化建议

1. **性能优化**
   - 对模型列表进行缓存
   - 添加虚拟滚动优化大列表性能

2. **功能增强**
   - 添加最近使用的模型快捷入口
   - 支持收藏常用模型
   - 添加模型对比功能

3. **用户体验**
   - 添加模型推荐（基于使用频率）
   - 支持快捷键操作（Esc 关闭，Enter 确认）

---

**更新状态**: ✅ 已完成  
**参考设计**: ChatInput.vue 模型选择器
