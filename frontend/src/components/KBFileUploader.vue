<!-- components/KBFileUploader.vue -->
<template>
    <div class="p-4">
        <!-- 上传区域 -->
        <el-upload
            ref="uploadRef"
            drag
            :auto-upload="false"
            :on-change="handleFileChange"
            :limit="10"
            multiple
            accept=".txt,.md,.pdf,.docx,.py,.js,.ts,.java,.cpp,.c,.go,.rs,.json,.xml,.yaml,.yml,.csv,.html,.css"
            class="w-full"
        >
            <i class="iconfont icon-upload text-4xl text-gray-400"></i>
            <div class="el-upload__text">
                拖拽文件到此处或<em>点击上传</em>
            </div>
            <template #tip>
                <div class="el-upload__tip text-sm text-gray-500">
                    支持格式：txt, md, pdf, docx, 代码文件等，单个文件最大 50MB
                </div>
            </template>
        </el-upload>

        <!-- 空状态提示 -->
        <div v-if="uploadTasks.length === 0" class="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>暂无上传任务</p>
            <p class="mt-2">选择文件后会自动开始上传并处理</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useFileUploadStore } from '@/stores/fileUpload'
import type { UploadTask } from '@/stores/fileUpload'

interface Props {
    kbId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
    (e: 'upload-complete', task: UploadTask): void
}>()

const uploadStore = useFileUploadStore()
const uploadRef = ref()

// ========== Computed ==========
const uploadTasks = computed(() => 
    uploadStore.getTasksByKB(props.kbId)
)

const stats = computed(() => uploadStore.getUploadStats())

// ========== Methods ==========

/**
 * 处理文件选择
 */
async function handleFileChange(file: any) {
    const rawFile = file.raw
    if (!rawFile) return
    
    // 验证文件大小
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (rawFile.size > maxSize) {
        ElMessage.error(`文件大小超过限制 (${maxSize / 1024 / 1024}MB)`)
        return
    }
    
    try {
        await uploadStore.uploadToKnowledgeBase(
            props.kbId,
            rawFile,
            (task) => {
                // 进度更新回调
                if (task.status === 'completed') {
                    ElMessage.success(`${task.fileName} 处理完成`)
                    emit('upload-complete', task)
                } else if (task.status === 'failed') {
                    ElMessage.error(`${task.fileName} 处理失败：${task.errorMessage}`)
                }
            }
        )
        
        ElMessage.success(`开始上传：${rawFile.name}`)
    } catch (error: any) {
        console.error('上传失败:', error)
        ElMessage.error(error.response?.data?.detail || '上传失败')
    }
}

// ========== Lifecycle ==========
onUnmounted(() => {
    // 组件卸载时停止所有轮询
    uploadStore.stopAllPolling()
})
</script>

<style scoped>
/* 所有样式已迁移到 Tailwind CSS */
/* 仅需保留必要的自定义动画 */
@keyframes spin {
    from {
        transform: rotate(0deg);
    }
    to {
        transform: rotate(360deg);
    }
}

.animate-spin {
    animation: spin 2s linear infinite;
}
</style>
