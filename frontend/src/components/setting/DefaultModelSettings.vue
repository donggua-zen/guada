<template>
    <div class="flex-1 overflow-hidden">
        <div class="space-y-8">
            <!-- 对话设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.defaultModel.chat') }}</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
                    <!-- 标题总结模型 -->
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.defaultModel.titleSummaryModel') }}</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.defaultModel.titleSummaryModelDesc') }}</span>
                        </div>
                        <div class="w-full max-w-md shrink-0">
                            <GdSelect v-model="titleModelValue" :options="textModelOptions" filterable clearable
                                :placeholder="t('settings.defaultModel.selectModel')" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- 视觉辅助设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.defaultModel.visual') }}</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.defaultModel.visualAssistantModel') }}</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.defaultModel.visualAssistantModelDesc') }}</span>
                        </div>
                        <div class="w-full max-w-md shrink-0">
                            <GdSelect v-model="visualModelValue" :options="visualModelOptions" filterable clearable
                                :placeholder="t('settings.defaultModel.selectVisualModel')" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- 历史压缩设置分组 -->
            <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.defaultModel.compression') }}</h3>
                <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
                    <div class="px-4 py-3.5 flex items-center justify-between gap-4">
                        <div class="flex flex-col gap-1 min-w-0">
                            <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.defaultModel.historyCompressionModel') }}</span>
                            <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.defaultModel.historyCompressionModelDesc') }}</span>
                        </div>
                        <div class="w-full max-w-md shrink-0">
                            <GdSelect v-model="compressionModelValue" :options="textModelOptions" filterable clearable
                                :placeholder="t('settings.defaultModel.selectModel')" />
                        </div>
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useI18n } from 'vue-i18n'

import { apiService } from '@/services/ApiService'
import { notify } from '@/components/ui/toastService';
import GdSelect from '@/components/ui/GdSelect.vue'

const { t } = useI18n()

// 表单引用（已移除 el-form，保留变量以便后续扩展）
const chatFormRef = ref(null)
const titleSummaryFormRef = ref(null)
const translationFormRef = ref(null)
const historyCompressionFormRef = ref(null)

// 模型数据
const models = ref([])
const providers = ref([])


// 表单数据
const settingsForm = reactive({
    defaultTitleSummaryModelId: null,
    // defaultTitleSummaryPrompt: '', // 已暂时移除，后端使用固定提示词
    defaultTranslationModelId: null,
    defaultTranslationPrompt: '',
    defaultHistoryCompressionModelId: null,
    defaultVisualAssistantModelId: null,
})

// 表单验证规则
const titleSummaryRules = computed(() => ({
    defaultTitleSummaryPrompt: [
        { max: 8000, message: t('settings.defaultModel.promptLengthError'), trigger: ['input', 'blur'] }
    ]
}))

const translationRules = computed(() => ({
    defaultTranslationPrompt: [
        { max: 8000, message: t('settings.defaultModel.promptLengthError'), trigger: ['input', 'blur'] }
    ]
}))

// 三个模型选择器：未设置时空串（GdSelect 用空串表示无值），清空回写 null
const titleModelValue = computed({
    get: () => settingsForm.defaultTitleSummaryModelId ?? '',
    set: (value) => { settingsForm.defaultTitleSummaryModelId = value === '' ? null : value },
})
const visualModelValue = computed({
    get: () => settingsForm.defaultVisualAssistantModelId ?? '',
    set: (value) => { settingsForm.defaultVisualAssistantModelId = value === '' ? null : value },
})
const compressionModelValue = computed({
    get: () => settingsForm.defaultHistoryCompressionModelId ?? '',
    set: (value) => { settingsForm.defaultHistoryCompressionModelId = value === '' ? null : value },
})

const shortModelName = (model) => (model?.modelName || '').split('/').pop() || model?.id || ''

// 下拉选项：供应商名作为 disabled 分组头（与智能体设置的模型下拉同一形态）。
// GdSelect 的过滤按 label 匹配，分组头只在自身命中时显示
const buildModelOptions = (filterFn) => {
    const options = []
    providers.value.forEach((provider) => {
        const providerModels = models.value.filter((model) =>
            model.providerId === provider.id && (!filterFn || filterFn(model))
        )
        if (!providerModels.length) return
        options.push({ label: provider.name, value: provider.id, disabled: true })
        providerModels.forEach((model) => {
            options.push({ label: shortModelName(model), value: model.id })
        })
    })
    return options
}

const textModelOptions = computed(() => buildModelOptions())
const visualModelOptions = computed(() => {
    const options = buildModelOptions((model) =>
        Array.isArray(model.config?.inputCapabilities) && model.config.inputCapabilities.includes('image')
    )
    // 历史配置可能指向已不满足图像输入的模型：保留一个禁选项，让触发器仍能显示名称
    const currentId = settingsForm.defaultVisualAssistantModelId
    if (currentId && !options.some((option) => option.value === currentId)) {
        const current = models.value.find((model) => model.id === currentId)
        if (current) options.unshift({ label: shortModelName(current), value: current.id, disabled: true })
    }
    return options
})

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
        notify.error(t('settings.defaultModel.loadModelsFailed'), error)
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
        settingsForm.defaultTitleSummaryModelId = response.defaultTitleSummaryModelId ?? null
        // settingsForm.defaultTitleSummaryPrompt = response.defaultTitleSummaryPrompt // 已暂时移除，后端使用固定提示词
        settingsForm.defaultTranslationModelId = response.defaultTranslationModelId ?? null
        settingsForm.defaultTranslationPrompt = response.defaultTranslationPrompt || ''
        settingsForm.defaultHistoryCompressionModelId = response.defaultHistoryCompressionModelId ?? null
        settingsForm.defaultVisualAssistantModelId = response.defaultVisualAssistantModelId ?? null

        // 备份原始数据
        originalSettings.value = JSON.parse(JSON.stringify(settingsForm))
    } catch (error) {
        console.error('获取全局设置失败:', error)
        notify.error(t('settings.defaultModel.loadSettingsFailed'), error)
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
            notify.error(t('common.saveFailed'), t('settings.defaultModel.formValidationError'))
            return
        }

        // 规范化数据：将 undefined 转换为 null，确保 JSON 序列化时不会丢失字段
        const dataToSave = {
            defaultTitleSummaryModelId: settingsForm.defaultTitleSummaryModelId ?? null,
            defaultTranslationModelId: settingsForm.defaultTranslationModelId ?? null,
            defaultTranslationPrompt: settingsForm.defaultTranslationPrompt || '',
            defaultHistoryCompressionModelId: settingsForm.defaultHistoryCompressionModelId ?? null,
            defaultVisualAssistantModelId: settingsForm.defaultVisualAssistantModelId ?? null,
        }

        // 使用新的分组设置接口更新 models 分组的设置
        await apiService.updateGroupSettings('models', dataToSave)

        // 保存成功后更新原始数据备份
        originalSettings.value = JSON.parse(JSON.stringify(settingsForm))

        notify.success(t('common.saveSuccess'), t('settings.defaultModel.updated'))
    } catch (error) {
        console.error('保存设置失败:', error)
        notify.error(t('common.saveFailed'), error.message || t('common.error.unknown'))
    }
}

// 生命周期
onMounted(async () => {
    await loadGlobalSettings()
    await loadModels()
})
</script>


