<template>
    <div class="flex flex-col h-full">
        <div class="settings-header" v-if="!isSimpleStyle">
            <h2>对话设置</h2>
        </div>
        <div class="flex-1 overflow-y-auto">
        <el-form ref="modelFormRef" :model="sessionForm" :rules="modelRules" label-position="top"
            label-width="80px" size="large">
            <!-- 模型选择 -->
            <el-form-item label="模型选择" prop="model_id">
                <el-select v-model="sessionForm.model_id" :options="modelOptions" placeholder="请选择模型"
                    clearable @change="handleModelChange">
                </el-select>
            </el-form-item>

            <!-- 上下文条数 -->
            <el-form-item label="上下文条数" prop="max_memory_length">
                <el-slider-optional v-model="sessionForm.max_memory_length" :min="2" :max="500"
                    :step="1" show-input optional-direction="max" optional-text="No Limit" />
            </el-form-item>
        </el-form>
        </div>
        <div class="footer pb-5 flex justify-end">
            <el-button round block type="primary" @click="handleSave" size="large">
                应用设置
            </el-button>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, watch, computed, onMounted } from 'vue'
import {
    ElForm,
    ElFormItem,
    ElSelect,
    ElButton
} from 'element-plus'

import { apiService } from '../services/ApiService'
import { usePopup } from '../composables/usePopup'

const { toast, notify } = usePopup()

// Props
const props = defineProps({
    simple: {
        type: Boolean,
        default: false
    },
    data: {
        type: Object,
        default: () => ({
            id: '',
            title: '',
            model_id: null,
            settings: {
                max_memory_length: null
            }
        })
    },
    tab: {
        type: String,
        default: ''
    }
})

// Emits
const emit = defineEmits(['update:data', 'update:tab', 'saved'])

// 响应式数据
const isSimpleStyle = ref(false)
const loading = ref(false)

// 模型数据
const models = ref([]);
const providers = ref([]);

// 表单引用
const modelFormRef = ref(null)

// 表单数据
const sessionForm = reactive({
    model_id: '',
    max_memory_length: null
})

// 验证规则
const modelRules = {
    model_id: [
        {
            required: true, message: '请选择模型', trigger: ['change'], validator: (rule, value, callback) => {
                if (value !== null && value !== '' && value !== undefined) {
                    callback();
                } else {
                    callback(new Error('请选择模型'));
                }
            }
        },
    ],
}

// 模型选择选项（按供应商分组）
const modelOptions = computed(() => {
    if (!models.value.length || !providers.value.length) return []

    const options = []

    providers.value?.forEach(provider => {
        const providerModels = models.value.filter(model =>
            model.provider_id === provider.id && model.model_type === 'text'
        )

        if (providerModels.length > 0) {
            options.push({
                label: provider.name,
                key: provider.id,
                disabled: true,
            })

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

// 当前选中的模型
const currentModel = computed(() => {
    if (sessionForm.model_id) {
        return models.value.find(model => model.id === sessionForm.model_id)
    }
    return null
})

// 监听 props.simple 变化
watch(() => props.simple, (newVal) => {
    isSimpleStyle.value = newVal;
}, { immediate: true })


watch(() => props.data, (newVal) => {
    sessionForm.model_id = newVal.model_id || '';
    sessionForm.model_temperature = newVal.settings?.model_temperature || null;
    sessionForm.model_top_p = newVal.settings?.model_top_p || null;
    sessionForm.model_frequency_penalty = newVal.settings?.model_frequency_penalty || null;
    sessionForm.max_memory_length = newVal.settings?.max_memory_length || null;
    sessionForm.max_memory_tokens = newVal.settings?.max_memory_tokens || null;
}, { immediate: true })

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

const findModelById = (modelId) => {
    return models.value.find(model => model.id === modelId)
}

const handleModelChange = (modelId) => {
    // 模型变化时的回调
    console.log('Model changed to:', modelId)
}

// 监听 props.data 变化
watch(() => props.data, (newVal) => {
    sessionForm.model_id = newVal.model_id || '';
    sessionForm.max_memory_length = newVal.settings?.max_memory_length || null;
}, { immediate: true })

onMounted(async () => {
    loadModels();
})

const handleSave = async () => {
    try {
        // 验证表单
        const validationResults = await Promise.allSettled([
            modelFormRef.value?.validate(),
        ])

        const hasError = validationResults.some(result =>
            result.status === 'rejected'
        )

        if (hasError) {
            const errors = validationResults
                .filter(result => result.status === 'rejected')
                .map(result => result.reason)
                .flat()

            console.error('表单验证失败:', errors)
            toast.error('请检查表单填写是否正确')
            return
        }

        loading.value = true

        // 触发保存事件
        let finalData = {
            'model_id': sessionForm.model_id,
            'model': findModelById(sessionForm.model_id),
            'settings': {
                'max_memory_length': sessionForm.max_memory_length,
            }
        }
        emit('update:data', finalData)
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
</script>

<style scoped>
.settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 60px;
    font-size: 18px;
    font-weight: 600;
    padding: 0 20px;
    border-bottom: 1px solid rgba(21, 23, 28, .1);
}

.footer {
    border-top: 1px solid rgba(21, 23, 28, .1);
    padding-top: 15px;
}
</style>
