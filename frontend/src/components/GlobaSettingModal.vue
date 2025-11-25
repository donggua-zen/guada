<template>

    <n-modal v-model:show="visible" :mask-closable="false" :auto-focus="false" style="width: 600px;max-width: 90vw;"
        title="系统设置" preset="card">
        <div class="max-h-80vh overflow-y-auto">

            <div class="flex flex-col h-full">
                <div class="flex-1">
                    <n-tabs type="segment" ref="tabsInstRef" v-model:value="tabsValue">
                        <!-- 基础设置 -->
                        <n-tab-pane name="basic" tab="基础" display-directive="show">
                            <div class="py-3">

                            </div>
                        </n-tab-pane>



                        <n-tab-pane name="chat" tab="对话设置" display-directive="show">
                            <div class="py-3">
                                <n-form ref="chatFormRef" :model="settingsForm" :rules="chatRules" label-placement="top"
                                    label-width="80px" size="large">
                                    <!-- 模型选择 -->
                                    <n-form-item label="默认对话模型" path="default_chat_model_id">
                                        <n-select v-model:value="settingsForm.default_chat_model_id"
                                            :options="chatModelOptions" placeholder="请选择模型"
                                            :fallback-option="(value) => ({ label: `请选择模型`, value: null })" />
                                    </n-form-item>


                                </n-form>
                            </div>
                        </n-tab-pane>

                        <n-tab-pane name="web_search" tab="网络搜索" display-directive="show">
                            <div class="py-3">
                                <n-form ref="webSearchFormRef" :model="settingsForm" :rules="webSearchRules"
                                    label-placement="left" size="large" label-width="120">
                                    <!-- 搜索模型 -->
                                    <n-form-item label="默认对话模型" path="default_search_model_id">
                                        <n-select v-model:value="settingsForm.default_search_model_id"
                                            :options="allowCurrentModelOptions"
                                            :fallback-option="(value) => ({ label: `和对话模型相同`, value: 'current' })" />
                                    </n-form-item>
                                    <n-form-item label="搜索API key" path="search_api_key">
                                        <n-input v-model:value="settingsForm.search_api_key" placeholder="" />
                                    </n-form-item>
                                    <n-form-item label="生成搜索词携带的上下文条数" path="search_prompt_context_length"
                                        label-placement="top">
                                        <n-slider v-model:value="settingsForm.search_prompt_context_length" :min="1"
                                            :max="20" :step="1" />
                                        <n-input-number v-model:value="settingsForm.search_prompt_context_length"
                                            :min="1" :max="20" :step="1" style="margin-left: 12px; width: 140px;"
                                            :show-button="false" placeholder="" clearable />
                                    </n-form-item>
                                </n-form>
                            </div>
                        </n-tab-pane>

                        <n-tab-pane name="summary" tab="摘要生成" display-directive="show">
                            <div class="py-3">
                                <n-form ref="summaryFormRef" :model="settingsForm" :rules="summaryRules"
                                    label-placement="top" label-width="80px" size="large">
                                    <n-form-item label="默认摘要模型" path="default_summary_model_id">
                                        <n-select v-model:value="settingsForm.default_summary_model_id"
                                            :options="allowCurrentModelOptions"
                                            :fallback-option="(value) => ({ label: `和对话模型相同`, value: 'current' })" />
                                    </n-form-item>
                                    <n-form-item :show-label="false" :show-feedback="false">
                                        <div class="flex items-center w-full justify-between">
                                            <span>摘要提示词</span>
                                            <div class="flex items-center">
                                                <!-- <n-checkbox v-model:checked="settingsForm.use_user_prompt" class="ml-2">
                                                    使用User Role
                                                </n-checkbox> -->
                                                <n-tooltip trigger="hover" placement="top">
                                                    <template #trigger>
                                                        <n-icon class="cursor-help text-gray-400 hover:text-gray-600"
                                                            size="16">
                                                            <QuestionCircleOutlined />
                                                        </n-icon>
                                                    </template>
                                                    启用后，系统将使用User角色而非System发送设定提示词，以优化部分模型的表现（如DeepSeek）
                                                </n-tooltip>
                                            </div>

                                        </div>
                                    </n-form-item>

                                    <!-- 详细设定 -->
                                    <n-form-item path="system_prompt" :show-label="false">
                                        <n-input v-model:value="settingsForm.system_prompt" type="textarea"
                                            placeholder="摘要提示词" :autosize="{ minRows: 5, maxRows: 8 }" />
                                    </n-form-item>



                                </n-form>
                            </div>
                        </n-tab-pane>
                    </n-tabs>
                </div>
                <div class="footer pb-5">
                    <n-button block type="primary" @click="handleSave" size="large">
                        <template #icon>
                            <n-icon>
                                <SaveOutlined />
                            </n-icon>
                        </template>
                        保存全部设置
                    </n-button>
                </div>
            </div>
        </div>
    </n-modal>
</template>


<script setup>
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import {
    NTabs,
    NTabPane,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NButton,
    NIcon,
    NSlider,
    NInputNumber,
    NModal,
    NTooltip,
    NCheckbox
} from 'naive-ui'
import {
    SaveOutlined,
    QuestionCircleOutlined
} from '@vicons/antd'

import { apiService } from '@/services/ApiService'


import { usePopup } from '@/composables/usePopup'

const { toast, notify } = usePopup()

// Props
const props = defineProps({
    data: {
        type: Object,
        default: () => ({})
    },
    tab: {
        type: String,
        default: 'basic'
    },
    visible: {
        type: Boolean,
        default: false
    }
})


// Emits
const emit = defineEmits(['update:data', 'update:tab', 'update:visible', 'saved'])

const visible = computed({
    get() {
        return props.visible
    },
    set(value) {
        emit('update:visible', value)
    }
})


// 响应式数据
const loading = ref(false)


// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const tabsInstRef = ref(null)
const basicFormRef = ref(null)
const summaryFormRef = ref(null)
const chatFormRef = ref(null)
const webSearchFormRef = ref(null)

// const tabsValue = computed({
//     get() {
//         return props.tab
//     },
//     set(value) {
//         emit('update:tab', value)
//     }
// })

const tabsValue = ref(props.tab)

// 表单数据
const settingsForm = reactive({
    default_chat_model_id: null,
    default_search_model_id: null,
    default_summary_model_id: null,
    // 聊天设定
    search_prompt_context_length: 10,
    search_api_key: '',
    // 摘要设定
    summary_model_id: null,
    summary_prompt: '',
})

// 验证规则
const basicRules = {
    title: [
        { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
        { min: 2, max: 20, message: '标题长度在2-20个字符之间', trigger: ['input', 'blur'] }
    ]
}

const summaryRules = {
    summary_model_id: [
        { min: 0, max: 8000, message: '详细设定长度在8000个字符之间', trigger: ['input', 'blur'] }
    ]
}

const chatRules = {
    model_id: [
        {
        },
    ],
}

const webSearchRules = {
    search_prompt_context_length: [
        { type: 'number', min: 1, max: 20, message: '长度应该在1-20之间', trigger: ['input', 'blur'] },
    ],
}



// 模型选择选项（按供应商分组）
const chatModelOptions = computed(() => {
    if (!models.value.length || !providers.value.length) return []

    const options = []

    providers.value?.forEach(provider => {
        // 获取该供应商下的text类型模型
        const providerModels = models.value.filter(model =>
            model.provider_id === provider.id && model.model_type === 'text'
        )

        if (providerModels.length > 0) {
            // 添加分组标签
            options.push({
                label: provider.name,
                key: provider.id,
                disabled: true,

            })

            // 添加该分组下的模型选项
            providerModels.forEach(model => {
                options.push({
                    label: model.model_name,
                    value: model.id,
                    key: model.id
                })
            })
        }
    })
    return options
})

const allowCurrentModelOptions = computed(() => {
    const options = []
    options.push({
        label: '和对话模型相同',
        value: 'current',
        key: 'current',
    })
    options.push(...chatModelOptions.value)

    return options
})


const loadModels = async () => {
    try {
        const response = await apiService.fetchModels()

        models.value = response.models || []
        providers.value = response.providers || []

    } catch (error) {
        console.error('获取模型列表失败:', error)
        notify.error('获取模型列表失败', error)
    }
}

const loadGlobalSettings = async () => {
    try {
        const response = await apiService.fetchSettings()

        settingsForm.default_chat_model_id = response.default_chat_model_id
        settingsForm.default_search_model_id = response.default_search_model_id
        settingsForm.search_prompt_context_length = response.search_prompt_context_length
        settingsForm.default_summary_model_id = response.default_summary_model_id
        settingsForm.search_api_key = response.search_api_key
    } catch (error) {
        console.error('获取全局设定失败:', error)
        notify.error('获取全局设定失败', error)
    }
}

const findModelById = (modelId) => {
    return models.value.find(model => model.id === modelId)
}

// 生命周期
onMounted(async () => {
    // if (!isSimpleStyle.value)
    loadGlobalSettings();
    loadModels();
})


const handleSave = async () => {
    try {
        // 并行验证所有表单
        var formValidates = [
            basicFormRef.value?.validate(),
            chatFormRef.value?.validate(),
            webSearchFormRef.value?.validate(),
            summaryFormRef.value?.validate(),
        ]
        //if (!isSimpleStyle.value) {
        // formValidates.push(chatFormRef.value?.validate())
        //}
        const validationResults = await Promise.allSettled(formValidates)

        // 检查是否有验证失败的表单
        const hasError = validationResults.some(result =>
            result.status === 'rejected'
        )

        if (hasError) {
            // 收集所有错误信息
            const errors = validationResults
                .filter(result => result.status === 'rejected')
                .map(result => result.reason)
                .flat()

            console.error('表单验证失败:', errors)
            // toast.error('请检查表单填写是否正确')

            // 自动切换到第一个有错误的tab
            const firstErrorIndex = validationResults.findIndex(result =>
                result.status === 'rejected'
            )
            if (firstErrorIndex !== -1) {
                const tabNames = ['basic', 'chat', 'web_search', 'summary',]
                tabsValue.value = tabNames[firstErrorIndex]
            }

            return
        }


        loading.value = true

        await apiService.updateSettings(settingsForm)

        emit('update:data', settingsForm)
        visible.value = false
    } catch (errors) {
        if (errors) {
            toast.error('请检查表单填写是否正确' + errors.toString())
        } else {
            toast.error('保存失败')
        }
    } finally {
        loading.value = false
    }
}

function parse(input) {
    const nums = input.replace(/,/g, "").trim();
    if (/^\d+(\.(\d+)?)?$/.test(nums))
        return Number(nums);
    return null;
}

function format(value) {
    if (value === null || value === "")
        return "不限制";
    return value.toLocaleString("en-US");
}
</script>