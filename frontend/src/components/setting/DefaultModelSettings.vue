<template>
    <div class="flex-1 overflow-hidden">
        <div class="space-y-8">
            <!-- 对话设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">对话</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                    <!-- 默认对话模型 -->
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">默认对话模型</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">用于日常对话生成的默认 AI 模型</span>
                        </div>
                        <el-select v-model="settingsForm.defaultChatModelId" placeholder="请选择模型" clearable
                            @visible-change="(visible) => visible && openModelDialog('chat')" class="w-full max-w-md shrink-0">
                            <template #prefix>
                                <OpenAI class="w-4 h-4" />
                            </template>
                            <el-option :value="settingsForm.defaultChatModelId" :label="chatModelName"
                                v-if="chatModelName || settingsForm.defaultChatModelId" />
                        </el-select>
                    </div>
                    <!-- 标题总结模型 -->
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">标题总结模型</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">用于自动生成会话标题的 AI 模型</span>
                        </div>
                        <el-select v-model="settingsForm.defaultTitleSummaryModelId" placeholder="请选择模型" clearable
                            @visible-change="(visible) => visible && openModelDialog('title')" class="w-full max-w-md shrink-0">
                            <template #prefix>
                                <OpenAI class="w-4 h-4" />
                            </template>
                            <el-option :value="settingsForm.defaultTitleSummaryModelId" :label="titleSummaryModelName"
                                v-if="titleSummaryModelName || settingsForm.defaultTitleSummaryModelId" />
                        </el-select>
                    </div>
                </div>
            </div>

            <!-- 视觉辅助设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">视觉</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">视觉辅助模型</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">用于图片识别等视觉任务的 AI 模型（需支持图像输入）</span>
                        </div>
                        <el-select v-model="settingsForm.defaultVisualAssistantModelId" placeholder="请选择支持图像的模型"
                            clearable @visible-change="(visible) => visible && openModelDialog('visual')" class="w-full max-w-md shrink-0">
                            <template #prefix>
                                <OpenAI class="w-4 h-4" />
                            </template>
                            <el-option :value="settingsForm.defaultVisualAssistantModelId"
                                :label="visualAssistantModelName" v-if="visualAssistantModelName || settingsForm.defaultVisualAssistantModelId" />
                        </el-select>
                    </div>
                </div>
            </div>

            <!-- 历史压缩设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">压缩</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#232428] overflow-hidden">
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">历史压缩模型</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">用于压缩对话历史以优化上下文长度的 AI 模型</span>
                        </div>
                        <el-select v-model="settingsForm.defaultHistoryCompressionModelId" placeholder="请选择模型" clearable
                            @visible-change="(visible) => visible && openModelDialog('compression')" class="w-full max-w-md shrink-0">
                            <template #prefix>
                                <OpenAI class="w-4 h-4" />
                            </template>
                            <el-option :value="settingsForm.defaultHistoryCompressionModelId"
                                :label="historyCompressionModelName" v-if="historyCompressionModelName || settingsForm.defaultHistoryCompressionModelId" />
                        </el-select>
                    </div>
                </div>
            </div>
        </div>

        <!-- 模型选择对话框 -->
        <el-dialog v-model="modelDialogVisible" title="选择模型" :width="isMobile ? '90%' : '600px'" :append-to-body="true"
            destroy-on-close>
            <div class="mb-4">
                <el-input v-model="modelSearchText" placeholder="搜索模型..." clearable>
                    <template #prefix>
                        <el-icon>
                            <SearchFilled />
                        </el-icon>
                    </template>
                </el-input>
            </div>
            <div class="model-list max-h-[60vh] overflow-y-auto">
                <template v-for="provider in filteredProviders" :key="provider.id">
                    <div class="provider-group mb-4">
                        <div class="provider-name text-sm font-medium text-gray-700 mb-2">
                            {{ provider.name }}
                        </div>
                        <div class="provider-models space-y-1">
                            <div v-for="model in getProviderModels(provider.id)" :key="model.id"
                                class="model-item p-3 rounded-lg cursor-pointer border transition-all mb-2 last:mb-0"
                                :class="{
                                    'bg-pink-50 dark:bg-pink-900/20 border-pink-300 dark:border-pink-700': tempModelId === model.id,
                                    'border-gray-100 dark:border-[#2e3035] hover:bg-pink-50/50 dark:hover:bg-pink-900/10': tempModelId !== model.id
                                }" @click="selectAndClose(model.id)">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium text-sm text-gray-800 dark:text-[#e8e9ed] truncate mb-1">
                                            {{ model.modelName }}</div>
                                        <!-- 特性图标组 -->
                                        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-[#8b8d95]">
                                            <span
                                                class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#2a2c30] font-medium text-[10px]">
                                                {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                                            </span>

                                            <!-- 输入/输出能力箭头组 -->
                                            <div v-if="model.modelType === 'text' && (model.config?.inputCapabilities || model.config?.outputCapabilities)"
                                                class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-[#2a2c30] border border-gray-100 dark:border-[#2e3035]">
                                                <template v-for="cap in (model.config?.inputCapabilities || ['text'])"
                                                    :key="'in-' + cap">
                                                    <el-icon :size="14">
                                                        <TextT24Regular v-if="cap === 'text'" />
                                                        <Image24Regular v-else />
                                                    </el-icon>
                                                </template>
                                                <el-icon :size="10" class="text-gray-300">
                                                    <ArrowRightTwotone />
                                                </el-icon>
                                                <template v-for="cap in (model.config?.outputCapabilities || ['text'])"
                                                    :key="'out-' + cap">
                                                    <el-icon :size="14">
                                                        <TextT24Regular v-if="cap === 'text'" />
                                                        <Image24Regular v-else />
                                                    </el-icon>
                                                </template>
                                            </div>

                                            <!-- 高级功能图标 -->
                                            <template v-for="feature in (model.config?.features || [])" :key="feature">
                                                <el-tooltip :content="getFeatureLabel(feature)" placement="top">
                                                    <el-icon class="hover:text-primary transition-colors" :size="14">
                                                        <WrenchScrewdriver24Regular v-if="feature === 'tools'" />
                                                        <LightbulbFilament24Regular
                                                            v-else-if="feature === 'thinking'" />
                                                    </el-icon>
                                                </el-tooltip>
                                            </template>
                                        </div>
                                    </div>
                                    <el-icon v-if="tempModelId === model.id" class="text-primary shrink-0 mt-1"
                                        size="18">
                                        <CheckCircleFilled />
                                    </el-icon>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
                <div v-if="filteredModels.length === 0" class="text-center py-8 text-gray-400">
                    <el-icon size="48" class="mb-2">
                        <SearchFilled />
                    </el-icon>
                    <p>未找到匹配的模型</p>
                </div>
            </div>
        </el-dialog>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { OpenAI } from "@/components/icons";
import {
    SearchFilled,
    CheckCircleFilled,
    ArrowRightTwotone
} from "@vicons/material";
import {
    TextT24Regular, LightbulbFilament24Regular, WrenchScrewdriver24Regular, Image24Regular
} from '@vicons/fluent'

import { apiService } from '@/services/ApiService'

import { usePopup } from '@/composables/usePopup'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

// Element Plus 组件导入
import {
    ElButton,
    ElDialog,
    ElTag,
    ElIcon
} from 'element-plus'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const { notify } = usePopup()

// 表单引用（已移除 el-form，保留变量以便后续扩展）
const chatFormRef = ref(null)
const titleSummaryFormRef = ref(null)
const translationFormRef = ref(null)
const historyCompressionFormRef = ref(null)

// 模型数据
const models = ref([])
const providers = ref([])

// 当前打开的对话框类型 ('chat' | 'title' | 'translation' | 'compression')
const currentDialogType = ref('')

// 模型选择对话框相关
const modelDialogVisible = ref(false)
const modelSearchText = ref('')
const tempModelId = ref(null) // 临时选中的模型 ID

// 表单数据
const settingsForm = reactive({
    defaultChatModelId: null,
    defaultTitleSummaryModelId: null,
    // defaultTitleSummaryPrompt: '', // 已暂时移除，后端使用固定提示词
    defaultTranslationModelId: null,
    defaultTranslationPrompt: '',
    defaultHistoryCompressionModelId: null,
    defaultHistoryCompressionPrompt: '',
    defaultVisualAssistantModelId: null,
})

// 表单验证规则
const titleSummaryRules = {
    defaultTitleSummaryPrompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

const translationRules = {
    defaultTranslationPrompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

const historyCompressionRules = {
    defaultHistoryCompressionPrompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

// 计算各个模型的显示名称
const getModelNameById = (modelId) => {
    if (!modelId) return ''
    const model = models.value.find(m => m.id === modelId)
    return model ? model.modelName.split('/').pop() : ''
}

// 计算各个模型输入框的显示值
const chatModelName = computed(() =>
    getModelNameById(settingsForm.defaultChatModelId)
)

const titleSummaryModelName = computed(() =>
    getModelNameById(settingsForm.defaultTitleSummaryModelId)
)

const translationModelName = computed(() =>
    getModelNameById(settingsForm.defaultTranslationModelId)
)

const historyCompressionModelName = computed(() =>
    getModelNameById(settingsForm.defaultHistoryCompressionModelId)
)

const visualAssistantModelName = computed(() => {
    const model = models.value.find(m => m.id === settingsForm.defaultVisualAssistantModelId)
    return model ? model.modelName.split('/').pop() : ''
})

// 打开模型对话框
const openModelDialog = (type) => {
    currentDialogType.value = type
    modelSearchText.value = ''

    // 根据类型设置当前选中的模型
    switch (type) {
        case 'chat':
            tempModelId.value = settingsForm.defaultChatModelId
            break
        case 'title':
            tempModelId.value = settingsForm.defaultTitleSummaryModelId
            break
        case 'translation':
            tempModelId.value = settingsForm.defaultTranslationModelId
            break
        case 'compression':
            tempModelId.value = settingsForm.defaultHistoryCompressionModelId
            break
        case 'visual':
            tempModelId.value = settingsForm.defaultVisualAssistantModelId
            break
    }

    modelDialogVisible.value = true
}

// 选择并自动关闭对话框
const selectAndClose = (modelId) => {
    if (!modelId) return

    // 根据类型更新对应的模型 ID
    switch (currentDialogType.value) {
        case 'chat':
            settingsForm.defaultChatModelId = modelId
            break
        case 'title':
            settingsForm.defaultTitleSummaryModelId = modelId
            break
        case 'translation':
            settingsForm.defaultTranslationModelId = modelId
            break
        case 'compression':
            settingsForm.defaultHistoryCompressionModelId = modelId
            break
        case 'visual':
            settingsForm.defaultVisualAssistantModelId = modelId
            break
    }

    modelDialogVisible.value = false
}

// 清除模型选择
const clearModelSelection = (type) => {
    switch (type) {
        case 'chat':
            settingsForm.defaultChatModelId = null
            break
        case 'title':
            settingsForm.defaultTitleSummaryModelId = null
            break
        case 'translation':
            settingsForm.defaultTranslationModelId = null
            break
        case 'compression':
            settingsForm.defaultHistoryCompressionModelId = null
            break
        case 'visual':
            settingsForm.defaultVisualAssistantModelId = null
            break
    }
}

// 获取特性标签名称
const getFeatureLabel = (type) => {
    switch (type) {
        case 'tools': return '工具调用';
        case 'thinking': return '混合思考';
        default: return type;
    }
}

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
    if (!modelSearchText.value) return models.value
    const searchText = modelSearchText.value.toLowerCase()
    return models.value.filter(model =>
        model.modelName?.toLowerCase().includes(searchText) ||
        model.description?.toLowerCase().includes(searchText)
    )
})

// 按供应商分组的过滤后模型列表
const filteredProviders = computed(() => {
    if (!models.value.length || !providers.value.length) return []

    let filtered = filteredModels.value
    
    // 如果是视觉辅助模型选择，仅显示支持图像输入的模型
    if (currentDialogType.value === 'visual') {
        filtered = filtered.filter(model => {
            const inputCapabilities = model.config?.inputCapabilities
            return Array.isArray(inputCapabilities) && inputCapabilities.includes('image')
        })
    }
    
    return providers.value.map(provider => ({
        ...provider,
        models: filtered.filter(model => model.providerId === provider.id)
    })).filter(provider => provider.models.length > 0)
})

// 获取指定供应商的模型列表
const getProviderModels = (providerId) => {
    const provider = filteredProviders.value.find(p => p.id === providerId)
    return provider ? provider.models : []
}

// 加载模型列表
const loadModels = async () => {
    try {
        const response = await apiService.fetchModels()

        response.items.forEach(provider => {
            // 过滤只保留 modelType 为 'text' 的模型
            const textModels = provider.models.filter(model => model.modelType === "text")
            models.value.push(...textModels)
            delete provider.models
            // 只有当该供应商有符合条件的模型时才加入列表
            if (textModels.length > 0) {
                providers.value.push(provider)
            }
        })

    } catch (error) {
        console.error('获取模型列表失败:', error)
        notify.error('获取模型列表失败', error)
    }
}

// 原始设置备份，用于对比是否有改动
const originalSettings = ref(null)

// 计算是否有改动
const hasChanges = computed(() => {
    if (!originalSettings.value) return false
    return JSON.stringify(settingsForm) !== JSON.stringify(originalSettings.value)
})

// 自动保存（防抖 300ms）
const debouncedSave = useDebounceFn(async () => {
    if (!hasChanges.value) return
    await handleSave()
}, 300)

// 监听设置变化自动保存
watch(() => ({
    defaultChatModelId: settingsForm.defaultChatModelId,
    defaultTitleSummaryModelId: settingsForm.defaultTitleSummaryModelId,
    defaultVisualAssistantModelId: settingsForm.defaultVisualAssistantModelId,
    defaultHistoryCompressionModelId: settingsForm.defaultHistoryCompressionModelId,
}), () => {
    debouncedSave()
}, { deep: true })

// 加载全局设置
const loadGlobalSettings = async () => {
    try {
        // 使用新的分组设置接口获取 models 分组的设置
        const response = await apiService.fetchGroupSettings('models')

        // 填充表单：使用 ?? 运算符确保 undefined 被转换为 null
        settingsForm.defaultChatModelId = response.defaultChatModelId ?? null
        settingsForm.defaultTitleSummaryModelId = response.defaultTitleSummaryModelId ?? null
        // settingsForm.defaultTitleSummaryPrompt = response.defaultTitleSummaryPrompt // 已暂时移除，后端使用固定提示词
        settingsForm.defaultTranslationModelId = response.defaultTranslationModelId ?? null
        settingsForm.defaultTranslationPrompt = response.defaultTranslationPrompt || ''
        settingsForm.defaultHistoryCompressionModelId = response.defaultHistoryCompressionModelId ?? null
        settingsForm.defaultHistoryCompressionPrompt = response.defaultHistoryCompressionPrompt || ''
        settingsForm.defaultVisualAssistantModelId = response.defaultVisualAssistantModelId ?? null

        // 备份原始数据
        originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
    } catch (error) {
        console.error('获取全局设置失败:', error)
        notify.error('获取全局设置失败', error)
    }
}

// 保存设置
const handleSave = async () => {
    try {
        // 并行验证所有表单
        const formValidates = [
            // 表单验证已移除，保留逻辑结构以便后续扩展
        ]

        const validationResults = await Promise.allSettled(formValidates)

        // 检查是否有验证失败的表单
        const hasError = validationResults.some(result =>
            result.status === 'rejected'
        )

        if (hasError) {
            const errors = validationResults
                .filter(result => result.status === 'rejected')
                .map(result => result.reason)
                .flat()

            console.error('表单验证失败:', errors)
            notify.error('请检查表单填写是否正确')
            return
        }

        // 规范化数据：将 undefined 转换为 null，确保 JSON 序列化时不会丢失字段
        const dataToSave = {
            defaultChatModelId: settingsForm.defaultChatModelId ?? null,
            defaultTitleSummaryModelId: settingsForm.defaultTitleSummaryModelId ?? null,
            defaultTranslationModelId: settingsForm.defaultTranslationModelId ?? null,
            defaultTranslationPrompt: settingsForm.defaultTranslationPrompt || '',
            defaultHistoryCompressionModelId: settingsForm.defaultHistoryCompressionModelId ?? null,
            defaultHistoryCompressionPrompt: settingsForm.defaultHistoryCompressionPrompt || '',
            defaultVisualAssistantModelId: settingsForm.defaultVisualAssistantModelId ?? null,
        }

        // 使用新的分组设置接口更新 models 分组的设置
        await apiService.updateGroupSettings('models', dataToSave)

        // 保存成功后更新原始数据备份
        originalSettings.value = JSON.parse(JSON.stringify(settingsForm))

        notify.success('保存成功', '默认模型设置已更新')
    } catch (error) {
        console.error('保存设置失败:', error)
        notify.error('保存失败', error.message || '未知错误')
    }
}

// 生命周期
onMounted(async () => {
    await loadGlobalSettings()
    await loadModels()
})
</script>

<style scoped>
.footer {
    border-top: 1px solid var(--color-border);
}

/* 模型选择器按钮样式 */
:deep(.model-item) {
    transition: all 0.2s;
}

:deep(.model-item:hover) {
    border-color: var(--el-color-primary-light-5);
}

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
</style>
