<!-- KnowledgeBasePage/KBFileItem.vue -->
<template>
    <div 
        class="file-item group bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:shadow-md transition-all dark:bg-gray-800 dark:border-gray-700"
        :class="{
            'cursor-pointer': file.processingStatus === 'completed',
            'cursor-not-allowed': file.processingStatus !== 'completed'
        }"
        @click="handleClick"
    >
        <div class="flex items-center gap-3">
            <!-- 文件图标 -->
            <div class="w-10 h-10 flex items-center justify-center shrink-0">
                <img :src="fileIcon" class="w-8 h-8 object-contain" alt="file icon" />
            </div>

            <!-- 文件信息 -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-0.5">
                    <h4 class="text-sm font-medium text-gray-900 truncate pr-2 dark:text-gray-100">
                        {{ file.displayName }}
                    </h4>
                    <el-tag size="small" :type="statusType">
                        {{ statusText }}
                    </el-tag>
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ formatSize(file.fileSize) }} · {{ file.fileExtension ? file.fileExtension.toUpperCase() : 'UNKNOWN' }}
                    <span v-if="isTempTask" class="ml-2 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">上传中</span>
                </p>
            </div>
        </div>

        <!-- 进度条 -->
        <div v-if="file.processingStatus === 'processing' || file.processingStatus === 'uploading'" class="mt-2">
            <el-progress 
                v-if="file.processingStatus === 'uploading'" 
                :percentage="file.progressPercentage" 
                :stroke-width="3" 
            />
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {{ file.currentStep || '处理中...' }}
            </p>
        </div>

        <!-- 错误信息 -->
        <div v-if="file.processingStatus === 'failed' && file.errorMessage" 
            class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
            {{ file.errorMessage }}
        </div>

        <!-- 详细信息 (可选展开) -->
        <div v-if="file.processingStatus === 'completed' || file.processingStatus === 'failed'" 
            class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div class="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                <div class="flex gap-3">
                    <span v-if="file.totalChunks">{{ file.totalChunks }} 分块</span>
                </div>
                <!-- 操作按钮 -->
                <div class="flex items-center gap-1 shrink-0" @click.stop>
                    <el-button size="small" link @click="handleRetry">
                        <RefreshRight class="w-3 h-3 mr-1" />
                        重新处理
                    </el-button>
                    <el-button size="small" type="danger" link @click="handleDelete">
                        <Delete class="w-3 h-3 mr-1" />
                        删除
                    </el-button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RefreshRight, Delete } from '@element-plus/icons-vue'
import type { UnifiedFileRecord } from '@/stores/fileUpload'

// 导入所有文件图标
import fileCodeIcon from '@/assets/file_code.svg'
import fileExcelIcon from '@/assets/file_excel.svg'
import fileHtmlIcon from '@/assets/file_html.svg'
import fileMusicIcon from '@/assets/file_music.svg'
import filePptIcon from '@/assets/file_ppt.svg'
import fileTxtIcon from '@/assets/file_txt.svg'
import fileVideoIcon from '@/assets/file_video.svg'
import fileWordIcon from '@/assets/file_word.svg'
import fileZipIcon from '@/assets/file_zip.svg'

interface Props {
    file: UnifiedFileRecord
    isTempTask?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
    view: [file: UnifiedFileRecord]
    retry: [file: UnifiedFileRecord]
    delete: [file: UnifiedFileRecord]
}>()

/**
 * 文件类型到图标的映射
 */
const fileIconMap: Record<string, string> = {
    // 代码文件
    'js': fileCodeIcon,
    'ts': fileCodeIcon,
    'vue': fileCodeIcon,
    'py': fileCodeIcon,
    'java': fileCodeIcon,
    'h': fileCodeIcon,
    'hpp': fileCodeIcon,
    'cpp': fileCodeIcon,
    'c': fileCodeIcon,
    'go': fileCodeIcon,
    'rs': fileCodeIcon,
    'php': fileCodeIcon,
    'rb': fileCodeIcon,
    'css': fileCodeIcon,
    'json': fileCodeIcon,
    'xml': fileCodeIcon,
    'sh': fileCodeIcon,
    'yaml': fileCodeIcon,
    'yml': fileCodeIcon,

    // html
    'html': fileHtmlIcon,
    'htm': fileHtmlIcon,

    // 文档文件
    'doc': fileWordIcon,
    'docx': fileWordIcon,
    'xls': fileExcelIcon,
    'xlsx': fileExcelIcon,
    'csv': fileExcelIcon,
    'ppt': filePptIcon,
    'pptx': filePptIcon,
    'txt': fileTxtIcon,
    'md': fileTxtIcon,
    'markdown': fileTxtIcon,

    // 媒体文件
    'mp3': fileMusicIcon,
    'wav': fileMusicIcon,
    'flac': fileMusicIcon,
    'mp4': fileVideoIcon,
    'avi': fileVideoIcon,
    'mkv': fileVideoIcon,
    'mov': fileVideoIcon,

    // 压缩文件
    'zip': fileZipIcon,
    'rar': fileZipIcon,
    '7z': fileZipIcon,
    'tar': fileZipIcon,
    'gz': fileZipIcon,
}

/**
 * 根据文件扩展名获取图标
 */
const fileIcon = computed(() => {
    let ext = ''

    // 方法 1: 从 fileExtension 提取（去掉点号）
    if (props.file.fileExtension) {
        ext = props.file.fileExtension.toLowerCase().replace(/^\./, '')
    }

    // 方法 2: 如果还是空，尝试从 fileType (MIME) 推断
    if (!ext && props.file.fileType) {
        const mimeMap: Record<string, string> = {
            'application/pdf': 'pdf',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'text/plain': 'txt',
            'text/html': 'html',
            'text/css': 'css',
            'text/javascript': 'js',
            'application/json': 'json',
            'application/xml': 'xml',
            'text/xml': 'xml',
            'application/x-python-code': 'py',
            'text/x-python': 'py',
            'text/x-java-source': 'java',
            'text/x-c': 'c',
            'text/x-c++': 'cpp',
            'text/x-go': 'go',
            'text/x-rust': 'rs',
            'text/x-php': 'php',
            'text/x-ruby': 'rb',
            'application/zip': 'zip',
            'application/x-zip-compressed': 'zip',
            'application/x-rar-compressed': 'rar'
        }
        ext = mimeMap[props.file.fileType] || 'txt'
    }

    // 方法 3: 如果还是空，默认 txt
    if (!ext) {
        ext = 'txt'
    }

    return fileIconMap[ext] || fileTxtIcon
})

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

/**
 * 获取状态标签类型
 */
const statusType = computed(() => {
    const types: Record<string, string> = {
        'uploading': 'warning',
        'uploaded': 'info',
        'pending': 'info',
        'processing': 'warning',
        'completed': 'success',
        'failed': 'danger',
    }
    return types[props.file.processingStatus] || 'info'
})

/**
 * 获取状态文本
 */
const statusText = computed(() => {
    const texts: Record<string, string> = {
        'uploading': '上传中',
        'uploaded': '等待处理',
        'pending': '等待处理',
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败',
    }
    return texts[props.file.processingStatus] || props.file.processingStatus
})

/**
 * 处理点击事件
 */
function handleClick() {
    if (props.file.processingStatus === 'completed') {
        emit('view', props.file)
    }
}

/**
 * 处理重新处理
 */
function handleRetry() {
    emit('retry', props.file)
}

/**
 * 处理删除
 */
function handleDelete() {
    emit('delete', props.file)
}
</script>

<style scoped>
.file-item {
    transition: all 0.2s ease;
}

.file-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
