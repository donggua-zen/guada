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
                                <n-form ref="basicFormRef" :model="characterForm" :rules="basicRules"
                                    label-placement="top" label-width="80px" size="large">


                                    <!-- 角色标题 -->
                                    <n-form-item label="角色标题" path="title">
                                        <n-input v-model:value="characterForm.title" placeholder="请输入角色标题" />
                                    </n-form-item>

                                    <!-- 角色描述 -->
                                    <n-form-item label="角色描述" path="description">
                                        <n-input v-model:value="characterForm.description" type="textarea"
                                            placeholder="请输入角色描述" :autosize="{ minRows: 3, maxRows: 5 }" />
                                    </n-form-item>
                                </n-form>
                            </div>
                        </n-tab-pane>



                        <n-tab-pane name="chat" tab="对话设置" display-directive="show">
                            <div class="py-3">
                                <n-form ref="modelFormRef" :model="characterForm" :rules="modelRules"
                                    label-placement="top" label-width="80px" size="large">
                                    <!-- 模型选择 -->
                                    <n-form-item label="默认对话模型" path="default_chat_model_id">
                                        <n-select v-model:value="characterForm.default_chat_model_id"
                                            :options="modelOptions" placeholder="请选择模型"
                                            :fallback-option="(value) => ({ label: `请选择模型`, value: null })" />
                                    </n-form-item>


                                </n-form>
                            </div>
                        </n-tab-pane>

                        <n-tab-pane name="web_search" tab="网络搜索" display-directive="show">
                            <div class="py-3">
                                <n-form ref="memoryFormRef" :model="characterForm" :rules="memoryRules"
                                    label-placement="top" size="large">
                                    <!-- 搜索模型 -->
                                    <n-form-item label="默认对话模型" path="default_chat_model_id">
                                        <n-select v-model:value="characterForm.default_search_model_id"
                                            :options="allowCurrentModelOptions"
                                            :fallback-option="(value) => ({ label: `和对话模型相同`, value: 'current' })" />
                                    </n-form-item>
                                    <n-form-item label="生成搜索词携带的上下文条数" path="search_prompt_context_length">
                                        <n-slider v-model:value="characterForm.search_prompt_context_length" :min="1"
                                            :max="20" :step="1" />
                                        <n-input-number v-model:value="characterForm.search_prompt_context_length"
                                            :min="1" :max="20" :step="1" style="margin-left: 12px; width: 140px;"
                                            :show-button="false" placeholder="" clearable />
                                    </n-form-item>

                                </n-form>
                            </div>
                        </n-tab-pane>

                        <n-tab-pane name="prompt" tab="摘要生成" display-directive="show">
                            <div class="py-3">
                                <n-form ref="promptFormRef" :model="characterForm" :rules="promptRules"
                                    label-placement="top" label-width="80px" size="large">
                                    <n-form-item label="默认摘要模型" path="default_chat_model_id">
                                        <n-select v-model:value="characterForm.default_search_model_id"
                                            :options="allowCurrentModelOptions"
                                            :fallback-option="(value) => ({ label: `和对话模型相同`, value: 'current' })" />
                                    </n-form-item>
                                    <n-form-item :show-label="false" :show-feedback="false">
                                        <div class="flex items-center w-full justify-between">
                                            <span>摘要提示词</span>
                                            <div class="flex items-center">
                                                <n-checkbox v-model:checked="characterForm.use_user_prompt"
                                                    class="ml-2">
                                                    使用User Role
                                                </n-checkbox>
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
                                        <n-input v-model:value="characterForm.system_prompt" type="textarea"
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
        default: () => ({
            id: '',
            title: '',
            description: '',
            avatar_url: '',
            settings: {
                assistant_name: '',
                assistant_identity: '',
                system_prompt: '',
                model_id: null,
                memory_type: null,
                model_temperature: null,
                model_top_p: null,
                model_frequency_penalty: null,
                max_memory_length: null,
                use_user_prompt: false
            }
        })
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
const promptFormRef = ref(null)
const modelFormRef = ref(null)
const memoryFormRef = ref(null)

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
const characterForm = reactive({
    default_chat_model_id: null,
    default_search_model_id: null,
    search_prompt_context_length: 10,


})

// 验证规则
const basicRules = {
    title: [
        { required: true, message: '请输入角色标题', trigger: ['input', 'blur'] },
        { min: 2, max: 20, message: '标题长度在2-20个字符之间', trigger: ['input', 'blur'] }
    ]
}

const promptRules = {
    system_prompt: [
        { min: 2, max: 8000, message: '详细设定长度在8000个字符之间', trigger: ['input', 'blur'] }
    ]
}

const modelRules = {
    model_id: [
        {
            required: true, message: '请选择模型', trigger: ['change'], validator: (rule, value) => {
                // 明确检查空值情况
                return value !== null && value !== '' && value !== undefined;
            }
        },
    ],

}

const memoryRules = {
    memory_type: [
        { required: true, message: '请选择记忆类型', trigger: ['change'] },
    ],
    max_memory_tokens: [
        { type: 'number', min: 256, message: '最大记忆长度最少为256', trigger: ['input', 'blur'] }
    ],
    short_term_memory_tokens: [
        { type: 'number', min: 256, message: '短期记忆长度最少为256', trigger: ['input', 'blur'] }
    ],
    max_memory_length: [
        // { type: 'number', required: true, message: '请输入最大记忆长度', trigger: ['input', 'blur'] },
        { type: 'number', min: 1, max: 500, message: '最大记忆长度在1-500之间', trigger: ['input', 'blur'] },
    ],
}



// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
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
    options.push(...modelOptions.value)

    return options
})

// 响应式调整抽屉宽度
// const updateDrawerWidth = () => {
//     const width = window.innerWidth
//     if (width < 768) {
//         drawerWidth.value = '90%'
//     } else if (width < 1200) {
//         drawerWidth.value = 400
//     } else {
//         drawerWidth.value = 400
//     }
// }


watch(() => props.data, (newVal) => {


}, { immediate: true })

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

const findModelById = (modelId) => {
    return models.value.find(model => model.id === modelId)
}

// 生命周期
onMounted(async () => {
    // if (!isSimpleStyle.value)
    loadModels();
})

onUnmounted(() => {
    // window.removeEventListener('resize', updateDrawerWidth)
    if (characterForm.avatar_url && characterForm.avatar_url.startsWith('blob:')) {
        URL.revokeObjectURL(characterForm.avatar_url);
    }
})

// 方法
const handleClose = () => {

}




const handleSave = async () => {
    try {
        // 并行验证所有表单
        var formValidates = [
            basicFormRef.value?.validate(),
            promptFormRef.value?.validate(),
            memoryFormRef.value?.validate(),
            modelFormRef.value?.validate(),
        ]
        //if (!isSimpleStyle.value) {
        // formValidates.push(modelFormRef.value?.validate())
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
                const tabNames = ['basic', 'prompt', 'memory', 'model',]
                tabsValue.value = tabNames[firstErrorIndex]
            }

            return
        }


        loading.value = true

        // 模拟保存操作 
        // await new Promise(resolve => setTimeout(resolve, 1000))

        // 触发保存事件
        let finalData = {
            'title': characterForm.title,
            'description': characterForm.description,
            'name': characterForm.name,
            'avatar_url': characterForm.avatar_url.startsWith('blob:') ? (props.data.avatar_url || '') : characterForm.avatar_url,
            'avatar_file': characterForm.avatar_file,
            'identity': characterForm.identity,
            'model_id': characterForm.model_id,
            'model': findModelById(characterForm.model_id),
            'settings': {
                'assistant_name': characterForm.assistant_name,
                'assistant_identity': characterForm.assistant_identity,
                'system_prompt': characterForm.system_prompt,
                'memory_type': characterForm.memory_type,
                'max_memory_tokens': characterForm.max_memory_tokens,
                'short_term_memory_tokens': characterForm.short_term_memory_tokens,
                'max_memory_length': characterForm.max_memory_length,
                // 模型
                'model_name': findModelById(characterForm.model_id).model_name || '请选择模型',
                'model_temperature': characterForm.model_temperature,
                'model_top_p': characterForm.model_top_p,
                'model_frequency_penalty': characterForm.model_frequency_penalty,
                'use_user_prompt': characterForm.use_user_prompt,
            }
        }
        emit('update:data', finalData)
        // toast.success('保存成功')
        // handleClose()
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

<style scoped>
/* .settings-header {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
} */
.settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 60px;
    list-style: 60px;
    font-size: 18px;
    font-weight: 600;
    padding: 0 20px;
    /* background-color: #ffffff; */
    border-bottom: 1px solid rgba(21, 23, 28, .1);
    border-radius: 0;

    /* margin: 0 40px; */
}

.avatar-upload-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    width: 100%;
}

.avatar-upload-actions {
    display: flex;
    gap: 10px;
}

.avatar-preview {
    width: 100px;
    height: 100px;
}

.modal-body {
    height: 400px;
}
</style>