<template>
    <div class="flex flex-col h-full">
        <div class="flex-1 overflow-hidden">
            <ScrollContainer class="h-full">
                <div class="px-4 space-y-8">
                    <!-- 标题总结设置 -->
                    <div class="mb-8">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">标题总结</h3>
                        <el-form ref="titleSummaryFormRef" :model="settingsForm" :rules="titleSummaryRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="标题总结模型" prop="default_title_summary_model_id">
                                <div class="flex items-center gap-2">
                                    <el-input v-model="titleSummaryModelName" readonly placeholder="请选择模型"
                                        style="flex: 1; cursor: pointer" @click="openModelDialog('title')">
                                        <template #prefix>
                                            <OpenAI class="w-4 h-4" />
                                        </template>
                                    </el-input>
                                    <el-button @click="openModelDialog('title')" plain type="primary">
                                        选择
                                    </el-button>
                                    <el-button v-if="settingsForm.default_title_summary_model_id"
                                        @click="clearModelSelection('title')" circle>
                                        <template #icon>
                                            <CloseOutlined />
                                        </template>
                                    </el-button>
                                </div>
                            </el-form-item>
                            <el-form-item label="标题总结提示词" prop="default_title_summary_prompt">
                                <el-input v-model="settingsForm.default_title_summary_prompt" type="textarea"
                                    placeholder="请输入生成会话标题的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 翻译设置 -->
                    <div class="mb-8">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">文本翻译</h3>
                        <el-form ref="translationFormRef" :model="settingsForm" :rules="translationRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="翻译模型" prop="default_translation_model_id">
                                <div class="flex items-center gap-2">
                                    <el-input v-model="translationModelName" readonly placeholder="请选择模型"
                                        style="flex: 1; cursor: pointer" @click="openModelDialog('translation')">
                                        <template #prefix>
                                            <OpenAI class="w-4 h-4" />
                                        </template>
                                    </el-input>
                                    <el-button @click="openModelDialog('translation')" plain type="primary">
                                        选择
                                    </el-button>
                                    <el-button v-if="settingsForm.default_translation_model_id"
                                        @click="clearModelSelection('translation')" circle>
                                        <template #icon>
                                            <CloseOutlined />
                                        </template>
                                    </el-button>
                                </div>
                            </el-form-item>
                            <el-form-item label="翻译提示词" prop="default_translation_prompt">
                                <el-input v-model="settingsForm.default_translation_prompt" type="textarea"
                                    placeholder="请输入翻译任务的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 历史压缩设置 -->
                    <div class="mb-8">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">历史压缩</h3>
                        <el-form ref="historyCompressionFormRef" :model="settingsForm" :rules="historyCompressionRules"
                            label-position="left" label-width="120px" size="large">
                            <el-form-item label="历史压缩模型" prop="default_history_compression_model_id">
                                <div class="flex items-center gap-2">
                                    <el-input v-model="historyCompressionModelName" readonly placeholder="请选择模型"
                                        style="flex: 1; cursor: pointer" @click="openModelDialog('compression')">
                                        <template #prefix>
                                            <OpenAI class="w-4 h-4" />
                                        </template>
                                    </el-input>
                                    <el-button @click="openModelDialog('compression')" plain type="primary">
                                        选择
                                    </el-button>
                                    <el-button v-if="settingsForm.default_history_compression_model_id"
                                        @click="clearModelSelection('compression')" circle>
                                        <template #icon>
                                            <CloseOutlined />
                                        </template>
                                    </el-button>
                                </div>
                            </el-form-item>
                            <el-form-item label="历史压缩提示词" prop="default_history_compression_prompt">
                                <el-input v-model="settingsForm.default_history_compression_prompt" type="textarea"
                                    placeholder="请输入历史压缩任务的系统提示词" :autosize="{ minRows: 4, maxRows: 6 }" />
                            </el-form-item>
                        </el-form>
                    </div>
                </div>
            </ScrollContainer>
        </div>
        <div class="footer pt-3 px-4 flex justify-start">
            <el-button type="primary" @click="handleSave">
                <template #icon>
                    <SaveOutlined />
                </template>
                保存全部设置
            </el-button>
        </div>

        <!-- 模型选择对话框 -->
        <el-dialog v-model="modelDialogVisible" title="选择模型" :width="isMobile ? '90%' : '600px'"
            :append-to-body="true" destroy-on-close>
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
                                class="model-item p-3 rounded-lg cursor-pointer border transition-all" :class="{
                                    'bg-blue-50 border-blue-300': tempModelId === model.id,
                                    'border-gray-200 hover:bg-gray-50': tempModelId !== model.id
                                }" @click="selectModel(model.id)">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1">
                                            <div class="font-medium text-sm truncate">{{ model.model_name }}</div>
                                            <!-- 特性标签 -->
                                            <div class="shrink-0 flex gap-1">
                                                <el-tag v-if="model.features?.includes('tools')" size="small"
                                                    type="info" class="h-4 text-[10px] px-1">
                                                    工具
                                                </el-tag>
                                                <el-tag v-if="model.features?.includes('thinking')" size="small"
                                                    type="warning" class="h-4 text-[10px] px-1">
                                                    混思
                                                </el-tag>
                                                <el-tag v-if="model.features?.includes('visual')" size="small"
                                                    type="success" class="h-4 text-[10px] px-1">
                                                    视觉
                                                </el-tag>
                                            </div>
                                        </div>
                                        <div v-if="model.description" class="text-xs text-gray-500 truncate mt-0.5">
                                            {{ model.description }}
                                        </div>
                                    </div>
                                    <el-icon v-if="tempModelId === model.id" class="text-blue-500 shrink-0"
                                        size="20">
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

            <template #footer>
                <div class="flex justify-end gap-3">
                    <el-button @click="modelDialogVisible = false">取消</el-button>
                    <el-button type="primary" @click="applyModelSelection">确定</el-button>
                </div>
            </template>
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
    CheckCircleFilled
} from "@vicons/material";

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
const titleSummaryFormRef = ref(null)
const translationFormRef = ref(null)
const historyCompressionFormRef = ref(null)

// 模型数据
const models = ref([])
const providers = ref([])

// 当前打开的对话框类型 ('title' | 'translation' | 'compression')
const currentDialogType = ref('')

// 模型选择对话框相关
const modelDialogVisible = ref(false)
const modelSearchText = ref('')
const tempModelId = ref(null) // 临时选中的模型 ID

// 表单数据
const settingsForm = reactive({
    default_title_summary_model_id: null,
    default_title_summary_prompt: '',
    default_translation_model_id: null,
    default_translation_prompt: '',
    default_history_compression_model_id: null,
    default_history_compression_prompt: '',
})

// 表单验证规则
const titleSummaryRules = {
    default_title_summary_prompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

const translationRules = {
    default_translation_prompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

const historyCompressionRules = {
    default_history_compression_prompt: [
        { max: 8000, message: '提示词长度不能超过 8000 个字符', trigger: ['input', 'blur'] }
    ]
}

// 计算各个模型的显示名称
const getModelNameById = (modelId) => {
    if (!modelId) return ''
    const model = models.value.find(m => m.id === modelId)
    return model ? model.model_name.split('/').pop() : ''
}

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

// 打开模型对话框
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

// 选择模型（仅更新临时状态）
const selectModel = (modelId) => {
    tempModelId.value = modelId
}

// 应用模型选择
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

// 清除模型选择
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
            models.value.push(...provider.models)
            delete provider.models
            providers.value.push(provider)
        })

    } catch (error) {
        console.error('获取模型列表失败:', error)
        notify.error('获取模型列表失败', error)
    }
}

// 加载全局设置
const loadGlobalSettings = async () => {
    try {
        const response = await apiService.fetchSettings()

        settingsForm.default_title_summary_model_id = response.default_title_summary_model_id
        settingsForm.default_title_summary_prompt = response.default_title_summary_prompt
        settingsForm.default_translation_model_id = response.default_translation_model_id
        settingsForm.default_translation_prompt = response.default_translation_prompt
        settingsForm.default_history_compression_model_id = response.default_history_compression_model_id
        settingsForm.default_history_compression_prompt = response.default_history_compression_prompt
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
