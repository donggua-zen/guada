<!-- components/EmbeddingModelSelector.vue -->
<template>
    <div class="embedding-model-selector">
        <!-- 触发按钮 -->
        <el-button @click="openDialog" plain type="primary" class="w-full flex items-center justify-between">
            <div class="flex items-center gap-2">
                <el-icon class="text-[var(--color-primary)]">
                    <ScienceOutlined />
                </el-icon>
                <span class="text-sm">{{ selectedModelName || '请选择嵌入模型' }}</span>
            </div>
            <el-icon class="text-xs opacity-60">
                <ArrowDropDownTwotone />
            </el-icon>
        </el-button>

        <!-- 模型选择对话框 -->
        <el-dialog v-model="dialogVisible" title="选择嵌入模型" :width="isMobile ? '90%' : '600px'" :append-to-body="true"
            destroy-on-close>
            <!-- 搜索框 -->
            <div class="mb-4">
                <el-input v-model="searchText" placeholder="搜索模型..." clearable>
                    <template #prefix>
                        <el-icon>
                            <SearchFilled />
                        </el-icon>
                    </template>
                </el-input>
            </div>

            <!-- 模型列表 -->
            <div class="model-list max-h-80 overflow-y-auto">
                <template v-for="provider in filteredProviders" :key="provider.id">
                    <div class="provider-group mb-4">
                        <div class="provider-name text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {{ provider.name }}
                        </div>
                        <div class="provider-models space-y-1">
                            <div v-for="model in getProviderModels(provider.id)" :key="model.id"
                                class="model-item p-3 rounded-lg cursor-pointer border transition-all" :class="{
                                    'bg-blue-50 dark:bg-blue-900/20 border-blue-300': tempSelectedModelId === model.id,
                                    'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800': tempSelectedModelId !== model.id
                                }" @click="selectModel(model.id)">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex-1 min-w-0">
                                        <div class="font-medium text-sm truncate text-gray-800 dark:text-gray-200">
                                            {{ model.model_name }}
                                        </div>
                                        <div v-if="model.description" class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                            {{ model.description }}
                                        </div>
                                    </div>
                                    <el-icon v-if="tempSelectedModelId === model.id" class="text-blue-500 flex-shrink-0"
                                        size="20">
                                        <CheckCircleFilled />
                                    </el-icon>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- 空状态 -->
                <div v-if="filteredModels.length === 0" class="text-center py-8 text-gray-400">
                    <el-icon size="48" class="mb-2">
                        <SearchFilled />
                    </el-icon>
                    <p>未找到匹配的嵌入模型</p>
                    <p class="text-xs mt-1">请确保后端已配置 Embedding 模型提供商</p>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-3">
                    <el-button @click="dialogVisible = false">取消</el-button>
                    <el-button type="primary" @click="confirmSelection">确定</el-button>
                </div>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ScienceOutlined, SearchFilled, CheckCircleFilled, ArrowDropDownTwotone } from '@vicons/material'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

interface Model {
    id: string
    model_name: string
    description?: string
    provider_id: string
    model_type?: string
    features?: string[]
}

interface Provider {
    id: string
    name: string
    models?: Model[]  // 后端返回的嵌套结构
}

interface Props {
    modelId?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
    (e: 'update:modelId', value: string): void
}>()

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')

// 响应式数据
const dialogVisible = ref(false)
const searchText = ref('')
const tempSelectedModelId = ref<string | null>(null)
const models = ref<Model[]>([])
const providers = ref<Provider[]>([])

// 加载所有模型和供应商
const loadModels = async () => {
    try {
        const { apiService } = await import('@/services/ApiService')
        const response = await apiService.fetchModels()
        
        // 只保留 embedding 类型的模型
        response.items.forEach(provider => {
            const embeddingModels = provider.models.filter(
                (m: Model) => m.model_type === 'embedding'
            )
            
            if (embeddingModels.length > 0) {
                providers.value.push({
                    id: provider.id,
                    name: provider.name
                })
                models.value.push(...embeddingModels)
            }
        })
        
        // 初始化选中状态
        if (props.modelId) {
            tempSelectedModelId.value = props.modelId
        }
    } catch (error: any) {
        console.error('获取模型列表失败:', error)
        ElMessage.error('加载模型列表失败')
    }
}

// 过滤后的模型列表（支持搜索）
const filteredModels = computed(() => {
    if (!searchText.value) return models.value
    
    const search = searchText.value.toLowerCase()
    return models.value.filter(model =>
        model.model_name?.toLowerCase().includes(search) ||
        model.description?.toLowerCase().includes(search) ||
        providers.value.find(p => p.id === model.provider_id)?.name.toLowerCase().includes(search)
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
const getProviderModels = (providerId: string) => {
    const provider = filteredProviders.value.find(p => p.id === providerId)
    return provider ? provider.models : []
}

// 打开对话框
const openDialog = () => {
    tempSelectedModelId.value = props.modelId || null
    searchText.value = ''
    dialogVisible.value = true
}

// 选择模型（仅更新临时状态）
const selectModel = (modelId: string) => {
    tempSelectedModelId.value = modelId
}

// 确认选择
const confirmSelection = () => {
    if (!tempSelectedModelId.value) {
        ElMessage.warning('请选择一个模型')
        return
    }
    
    const selectedModel = models.value.find(m => m.id === tempSelectedModelId.value)
    if (selectedModel) {
        // ✅ 直接返回模型的 ID，而不是 model_name
        emit('update:modelId', selectedModel.id)
        ElMessage.success(`已选择：${selectedModel.model_name}`)
    }
    
    dialogVisible.value = false
}

// 当前选中的模型名称
const selectedModelName = computed(() => {
    if (!props.modelId) return ''
    const model = models.value.find(m => m.model_name === props.modelId)
    return model ? model.model_name.split('/').pop() : props.modelId
})

// 生命周期
onMounted(() => {
    loadModels()
})
</script>

<style scoped>
.embedding-model-selector {
    width: 100%;
}

/* 模型列表项样式 */
.model-item {
    transition: all 0.2s ease;
}

.model-item:hover {
    transform: translateX(2px);
}

/* 供应商分组样式 */
.provider-group:last-child {
    margin-bottom: 0;
}

/* 滚动条美化 */
.model-list::-webkit-scrollbar {
    width: 6px;
}

.model-list::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
}

.model-list::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 3px;
}

.model-list::-webkit-scrollbar-thumb:hover {
    background: #555;
}

/* 暗黑模式滚动条 */
.dark .model-list::-webkit-scrollbar-track {
    background: #2d2d2d;
}

.dark .model-list::-webkit-scrollbar-thumb {
    background: #555;
}

.dark .model-list::-webkit-scrollbar-thumb:hover {
    background: #666;
}
</style>
