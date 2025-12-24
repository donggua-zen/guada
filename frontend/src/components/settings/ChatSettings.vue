<template>
    <div class="flex flex-col h-full">
        <div class="flex-1 overflow-hidden">
            <ScrollContainer class="h-full">
                <div class="px-4">
                    <!-- 对话设置部分 -->
                    <div class="mb-8" style="display: none;">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">对话设置</h3>
                        <el-form ref="chatFormRef" :model="settingsForm" :rules="chatRules" label-position="left"
                            label-width="105px" size="large">
                            <!-- 模型选择 -->
                            <el-form-item label="对话模型" prop="default_chat_model_id">
                                <el-select v-model="settingsForm.default_chat_model_id" placeholder="请选择模型"
                                    style="width: 100%">
                                    <el-option v-for="option in chatModelOptions" :key="option.key"
                                        :label="option.label" :value="option.value" :disabled="option.disabled" />
                                </el-select>
                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 网络搜索部分 -->
                    <div class="mb-8">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">网络搜索</h3>
                        <el-form ref="webSearchFormRef" :model="settingsForm" :rules="webSearchRules"
                            label-position="left" size="large" label-width="105px">
                            <!-- 搜索模型 -->
                            <el-form-item label="搜索模型" prop="default_search_model_id">
                                <el-select v-model="settingsForm.default_search_model_id" style="width: 100%">
                                    <el-option v-for="option in allowCurrentModelOptions" :key="option.key"
                                        :label="option.label" :value="option.value" />
                                </el-select>
                            </el-form-item>
                            <el-form-item label="搜索API key" prop="search_api_key">
                                <el-input v-model="settingsForm.search_api_key" placeholder="" />
                            </el-form-item>
                            <el-form-item label="上下文条数" prop="search_prompt_context_length">
                                <el-slider v-model="settingsForm.search_prompt_context_length" :min="1" :max="20"
                                    :step="1" class="flex-1" />
                                <el-input-number v-model="settingsForm.search_prompt_context_length" :min="1" :max="20"
                                    :step="1" controls-position="right" style="margin-left: 12px; width: 140px;"
                                    placeholder="" />

                            </el-form-item>
                        </el-form>
                    </div>

                    <!-- 摘要生成部分 -->
                    <div class="mb-8">
                        <h3 class="text-lg mb-4 pb-2 text-gray-500">摘要生成</h3>
                        <el-form ref="summaryFormRef" :model="settingsForm" :rules="summaryRules" label-position="left"
                            label-width="105px" size="large">
                            <el-form-item label="摘要模型" prop="default_summary_model_id">
                                <el-select v-model="settingsForm.default_summary_model_id" style="width: 100%"
                                    :options="allowCurrentModelOptions">

                                </el-select>
                            </el-form-item>
                            <!-- <el-form-item :show-label="true" :show-feedback="false">
                                <div class="flex items-center w-full justify-between">
                                    <span>摘要提示词</span>
                                </div>
                            </el-form-item> -->

                            <!-- 详细设定 -->
                            <el-form-item prop="system_prompt" label="摘要提示词" :show-label="true">
                                <el-input v-model="settingsForm.system_prompt" type="textarea" placeholder="摘要提示词"
                                    :autosize="{ minRows: 5, maxRows: 8 }" />
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
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
    SaveOutlined,
} from '@vicons/antd'

import { apiService } from '@/services/ApiService'
import { ScrollContainer } from '@/components/ui'

import { usePopup } from '@/composables/usePopup'

// Element Plus 组件导入
import {
    ElForm,
    ElFormItem,
    ElInput,
    ElSelect,
    ElOption,
    ElSlider,
    ElInputNumber,
    ElButton
} from 'element-plus'

const { toast, notify } = usePopup()

// Props
const props = defineProps({
    data: {
        type: Object,
        default: () => ({})
    },
    tab: {
        type: String,
        default: 'chat'
    }
})


// Emits
const emit = defineEmits(['update:data', 'update:tab', 'saved'])




// 响应式数据
const loading = ref(false)


// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const basicFormRef = ref(null)
const summaryFormRef = ref(null)
const chatFormRef = ref(null)
const webSearchFormRef = ref(null)

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
            chatFormRef.value?.validate(),
            webSearchFormRef.value?.validate(),
            summaryFormRef.value?.validate(),
        ]

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
                const tabNames = ['chat', 'web_search', 'summary',]
                tabsValue.value = tabNames[firstErrorIndex]
            }

            return
        }


        loading.value = true

        await apiService.updateSettings(settingsForm)

        emit('update:data', settingsForm)
        toast.success('保存成功')
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