<template>
    <div class="flex-1 overflow-hidden">
        <!-- 头部区域 -->
        <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
            <span>默认模型设置</span>
            <el-button type="primary" @click="handleSave" :disabled="!hasChanges">
                <template #icon>
                    <SaveOutlined />
                </template>
                保存设置
            </el-button>
        </div>

        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e] overflow-hidden">
            <ScrollContainer class="h-full">
                <div class="px-6 py-6 space-y-8"> 
                    <!-- 对话设置 -->
                    <div class="mb-8">
                        <el-form ref="chatFormRef" :model="settingsForm" label-position="left" label-width="120px"
                            size="large">
                            <el-form-item label="默认对话模型" prop="defaultChatModelId">
                                <el-select v-model="settingsForm.defaultChatModelId" placeholder="请选择模型" clearable
                                    @click="openModelDialog('chat')" style="width: fit-content; min-width: 240px;">
                                    <template #prefix>
                                        <OpenAI class="w-4 h-4" />
                                    </template>
                                    <el-option :value="settingsForm.defaultChatModelId" :label="chatModelName"
                                        v-if="chatModelName" />
                                </el-select>
                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 标题总结设置 -->
                    <div class="mb-8">
                        <el-form ref="titleSummaryFormRef" :model="settingsForm" :rules="titleSummaryRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="标题总结模型" prop="defaultTitleSummaryModelId">
                                <el-select v-model="settingsForm.defaultTitleSummaryModelId" placeholder="请选择模型"
                                    clearable @click="openModelDialog('title')"
                                    style="width: fit-content; min-width: 240px;">
                                    <template #prefix>
                                        <OpenAI class="w-4 h-4" />
                                    </template>
                                    <el-option :value="settingsForm.defaultTitleSummaryModelId"
                                        :label="titleSummaryModelName" v-if="titleSummaryModelName" />
                                </el-select>
                            </el-form-item>
                            <el-form-item label="标题总结提示词" prop="defaultTitleSummaryPrompt">
                                <el-input v-model="settingsForm.defaultTitleSummaryPrompt" type="textarea"
                                    placeholder="请输入生成会话标题的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 翻译设置 -->
                    <!-- <div class="mb-8">
                        <el-form ref="translationFormRef" :model="settingsForm" :rules="translationRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="翻译模型" prop="defaultTranslationModelId">
                                <el-select v-model="settingsForm.defaultTranslationModelId" placeholder="请选择模型"
                                    clearable @click="openModelDialog('translation')"
                                    style="width: fit-content; min-width: 240px;">
                                    <template #prefix>
                                        <OpenAI class="w-4 h-4" />
                                    </template>
                                    <el-option :value="settingsForm.defaultTranslationModelId"
                                        :label="translationModelName" v-if="translationModelName" />
                                </el-select>
                            </el-form-item>
                            <el-form-item label="翻译提示词" prop="defaultTranslationPrompt">
                                <el-input v-model="settingsForm.defaultTranslationPrompt" type="textarea"
                                    placeholder="请输入翻译任务的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item>
                        </el-form>
                    </div> -->

                    <!-- 历史压缩设置 -->
                    <div class="mb-8">
                        <el-form ref="historyCompressionFormRef" :model="settingsForm" :rules="historyCompressionRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="历史压缩模型" prop="defaultHistoryCompressionModelId">
                                <el-select v-model="settingsForm.defaultHistoryCompressionModelId" placeholder="请选择模型"
                                    clearable @click="openModelDialog('compression')"
                                    style="width: fit-content; min-width: 240px;">
                                    <template #prefix>
                                        <OpenAI class="w-4 h-4" />
                                    </template>
                                    <el-option :value="settingsForm.defaultHistoryCompressionModelId"
                                        :label="historyCompressionModelName" v-if="historyCompressionModelName" />
                                </el-select>
                            </el-form-item>
                            <!-- <el-form-item label="历史压缩提示词" prop="defaultHistoryCompressionPrompt">
                                <el-input v-model="settingsForm.defaultHistoryCompressionPrompt" type="textarea"
                                    placeholder="请输入历史压缩任务的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item> -->
                        </el-form>
                    </div>
                </div>
            </ScrollContainer>
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
                                    'border-gray-100 dark:border-gray-700 hover:bg-pink-50/50 dark:hover:bg-pink-900/10': tempModelId !== model.id
                                }" @click="selectAndClose(model.id)">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate mb-1">
                                            {{ model.modelName }}</div>
                                        <!-- 特性图标组 -->
                                        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                            <span
                                                class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 font-medium text-[10px]">
                                                {{ model.modelType === 'text' ? '对话' : '嵌入' }}
                                            </span>

                                            <!-- 输入/输出能力箭头组 -->
                                            <div v-if="model.modelType === 'text' && (model.config?.inputCapabilities || model.config?.outputCapabilities)"
                                                class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
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
import { ref, reactive, computed, onMounted } from 'vue'
import {
    SaveOutlined,
    CloseOutlined,
} from '@vicons/antd'
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
import { ScrollContainer } from '@/components/ui'

import { usePopup } from '@/composables/usePopup'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

// Element Plus 组件导入
import {
    ElForm,
    ElFormItem,
    ElInput,
    ElButton,
    ElDialog,
    ElTag,
    ElIcon
} from 'element-plus'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md') // md = 768px

const { notify } = usePopup()

// 表单引用
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
    defaultTitleSummaryPrompt: '',
    defaultTranslationModelId: null,
    defaultTranslationPrompt: '',
    defaultHistoryCompressionModelId: null,
    defaultHistoryCompressionPrompt: '',
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

    const filtered = filteredModels.value
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

// 加载全局设置
const loadGlobalSettings = async () => {
    try {
        const response = await apiService.fetchSettings()

        // 填充表单
        settingsForm.defaultChatModelId = response.defaultChatModelId
        settingsForm.defaultTitleSummaryModelId = response.defaultTitleSummaryModelId
        settingsForm.defaultTitleSummaryPrompt = response.defaultTitleSummaryPrompt
        settingsForm.defaultTranslationModelId = response.defaultTranslationModelId
        settingsForm.defaultTranslationPrompt = response.defaultTranslationPrompt
        settingsForm.defaultHistoryCompressionModelId = response.defaultHistoryCompressionModelId
        settingsForm.defaultHistoryCompressionPrompt = response.defaultHistoryCompressionPrompt

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
            chatFormRef.value?.validate(),
            titleSummaryFormRef.value?.validate(),
            translationFormRef.value?.validate(),
            historyCompressionFormRef.value?.validate(),
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

        await apiService.updateSettings(settingsForm)

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
