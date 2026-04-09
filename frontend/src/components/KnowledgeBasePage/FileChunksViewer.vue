<!-- KnowledgeBasePage/FileChunksViewer.vue -->
<template>
    <el-dialog 
        v-model="showModal" 
        :title="`文件分块内容 - ${selectedFile?.display_name}`" 
        width="800px" 
        :close-on-click-modal="true"
        @close="handleClose"
    >
        <div v-if="loading" class="loading-container text-center py-8">
            <el-icon class="text-2xl text-gray-400">
                <Loading />
            </el-icon>
            <p class="mt-2 text-gray-500">正在加载分块内容...</p>
        </div>
        <div v-else-if="chunks.length === 0" class="no-chunks-container text-center py-8">
            <el-icon class="text-2xl text-gray-400">
                <Document />
            </el-icon>
            <p class="mt-2 text-gray-500">暂无分块内容</p>
        </div>
        <div v-else class="chunks-container max-h-96 overflow-y-auto">
            <div 
                v-for="(chunk, index) in chunks" 
                :key="chunk.id" 
                class="chunk-item mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
                <div class="chunk-header flex justify-between items-center mb-2">
                    <span class="chunk-index text-sm font-mono text-gray-500 dark:text-gray-400">
                        #{{ (currentPage - 1) * pageSize + index + 1 }}
                    </span>
                    <span class="chunk-meta text-xs text-gray-400 dark:text-gray-500">
                        索引: {{ chunk.chunk_index }}, Token数: {{ chunk.token_count }}
                    </span>
                </div>
                <div class="chunk-content text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono">
                    {{ chunk.content }}
                </div>
            </div>
        </div>
        
        <!-- 分页控件 -->
        <template #footer v-if="chunks.length > 0">
            <div class="flex justify-between items-center">
                <div class="text-sm text-gray-500 dark:text-gray-400">
                    共 {{ totalChunks }} 个分块，当前显示 {{ Math.min(totalChunks, (currentPage - 1) * pageSize + 1) }} - {{ Math.min(totalChunks, currentPage * pageSize) }}
                </div>
                <el-pagination
                    v-model:current-page="currentPage"
                    :page-size="pageSize"
                    :total="totalChunks"
                    layout="prev, pager, next"
                    :hide-on-single-page="totalChunks <= pageSize"
                    @current-change="handlePageChange"
                />
            </div>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loading, Document } from '@element-plus/icons-vue'
import type { UnifiedFileRecord } from '@/stores/fileUpload'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { usePopup } from '@/composables/usePopup'

interface Props {
    modelValue: boolean
    selectedFile: UnifiedFileRecord | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
    'update:modelValue': [value: boolean]
}>()

const store = useKnowledgeBaseStore()
const { toast } = usePopup()

// 状态
const showModal = ref(false)
const loading = ref(false)
const chunks = ref<any[]>([])
const totalChunks = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)

// 监听外部传入的 modelValue
watch(() => props.modelValue, (newValue) => {
    showModal.value = newValue
    if (newValue && props.selectedFile) {
        // 打开弹窗时加载第一页数据
        currentPage.value = 1
        loadChunks()
    }
})

// 监听内部 showModal 变化，同步到外部
watch(showModal, (newValue) => {
    emit('update:modelValue', newValue)
})

/**
 * 加载文件分块内容
 */
async function loadChunks() {
    if (!props.selectedFile || !store.activeKnowledgeBaseId) {
        toast.error('未选择文件或知识库')
        return
    }
    
    // 仅对已完成处理的文件启用查看功能
    if (props.selectedFile.processingStatus !== 'completed') {
        toast.warning('文件尚未处理完成，无法查看分块内容')
        return
    }
    
    loading.value = true
    
    try {
        const { apiService } = await import('@/services/ApiService')
        
        // 获取分块数据，计算正确的 skip 值 (currentPage 从 1 开始，所以要减 1)
        const skip = (currentPage.value - 1) * pageSize.value
        const data = await apiService.getKBFileChunks(
            store.activeKnowledgeBaseId,
            props.selectedFile.id,
            skip,
            pageSize.value
        )
        
        chunks.value = data
        
        // 使用文件记录中的total_chunks字段作为总分块数
        totalChunks.value = props.selectedFile.totalChunks || 0
    } catch (error: any) {
        console.error('获取文件分块失败:', error)
        toast.error(error.response?.data?.detail || '获取文件分块失败')
        chunks.value = []
        totalChunks.value = 0
    } finally {
        loading.value = false
    }
}

/**
 * 处理分页变化
 */
async function handlePageChange(page: number) {
    currentPage.value = page
    await loadChunks()
}

/**
 * 处理关闭事件
 */
function handleClose() {
    // 重置状态
    chunks.value = []
    totalChunks.value = 0
    currentPage.value = 1
}

// 暴露方法供父组件调用
defineExpose({
    loadChunks
})
</script>

<style scoped>
/* 文件分块查看弹窗样式 */
.chunks-container {
    max-height: 50vh;
    overflow-y: auto;
}

.chunk-item {
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background-color: var(--el-fill-color-light);
    transition: all 0.2s ease;
}

.chunk-item:hover {
    border-color: var(--el-color-primary);
    box-shadow: 0 2px 8px var(--el-box-shadow-light);
}

.chunk-header {
    border-bottom: 1px solid var(--el-border-color);
    padding-bottom: 0.5rem;
}

.chunk-content {
    font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
    line-height: 1.6;
    padding: 0.75rem;
    background-color: var(--el-bg-color-overlay);
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
}

.chunk-index {
    font-weight: bold;
    color: var(--el-text-color-secondary);
}

.chunk-meta {
    color: var(--el-text-color-placeholder);
}

.loading-container {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}

.no-chunks-container {
    min-height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}
</style>
