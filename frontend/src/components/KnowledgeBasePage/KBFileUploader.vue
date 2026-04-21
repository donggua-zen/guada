<!-- components/KBFileUploader.vue -->
<template>
    <div class="">
        <!-- 上传按钮组 -->
        <div class="flex gap-2 items-center">
            <!-- 上传文件按钮 -->
            <input ref="fileInputRef" type="file" multiple :accept="ALLOWED_FILE_EXTENSIONS" @change="handleFileSelect"
                class="hidden" />
            <el-button class="upload-btn" @click="triggerFileInput">
                <DocumentAdd16Regular class="btn-icon" />
                上传文件
            </el-button>

            <!-- 上传文件夹按钮 -->
            <input ref="folderInputRef" type="file" webkitdirectory directory multiple @change="handleFolderSelect"
                class="hidden" />
            <el-button class="upload-btn" @click="triggerFolderInput">
                <FolderAdd16Regular class="btn-icon" />
                上传文件夹
            </el-button>

            <!-- 上传任务按钮(仅在有任务时显示) -->
            <el-button v-if="uploadTasks.length > 0" @click="emit('show-upload-task')" class="upload-btn">
                <Upload class="btn-icon" />
                上传任务
                <el-badge :value="uploadTasks.length" type="warning" class="ml-1" />
            </el-button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { Upload } from '@element-plus/icons-vue'
import { DocumentAdd16Regular, FolderAdd16Regular } from '@vicons/fluent'
import { ElMessage } from 'element-plus'
import { useFileUploadStore } from '@/stores/fileUpload'
import type { UploadTask } from '@/stores/fileUpload'

interface Props {
    kbId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
    (e: 'uploaded', task: UploadTask): void
    (e: 'show-upload-task'): void  // 新增: 触发显示上传任务弹窗
}>()

const uploadStore = useFileUploadStore()
const fileInputRef = ref<HTMLInputElement>()
const folderInputRef = ref<HTMLInputElement>()  // 新增: 文件夹输入框引用

// 定义允许的文件扩展名(与 ChatInput 保持一致)
const ALLOWED_EXTENSIONS = [
    '.txt', '.md', '.js', '.ts', '.html', '.css', '.json', '.xml', '.csv', '.log',
    '.py', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.sql', '.sh',
    '.bat', '.yml', '.yaml', '.ini', '.conf', '.properties', '.vue', '.toml',
    '.env', '.cfg', '.config', '.reg', '.pem', '.tex', '.rst', '.adoc', '.org',
    '.swift', '.kt', '.scala', '.dart', '.ex', '.r', '.jl', '.ps1', '.vbs', '.fish',
    '.j2', '.ejs', '.hbs', '.lock', '.patch', '.diff', '.ics', '.vcf', '.srt',
    '.proto', '.graphql', '.sol', '.pdf',
    '.doc', '.docx',  // Word 文档
    '.dts', '.dtsi'   // 设备树源文件
]

// HTML input accept 属性格式(逗号分隔)
const ALLOWED_FILE_EXTENSIONS = ALLOWED_EXTENSIONS.join(',')

// ========== Computed ==========
const uploadTasks = computed(() =>
    uploadStore.getTasksByKB(props.kbId)
)

// ========== Methods ==========

/**
 * 触发文件选择
 */
function triggerFileInput() {
    fileInputRef.value?.click()
}

/**
 * 触发文件夹选择
 */
function triggerFolderInput() {
    folderInputRef.value?.click()
}

/**
 * 处理文件选择(普通文件上传)
 */
async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    if (!input.files || input.files.length === 0) return

    // 过滤文件,只保留允许的格式
    const filesWithPath = Array.from(input.files)
        .filter(file => {
            const fileName = file.name.toLowerCase()
            const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
            return hasAllowedExtension
        })
        .map(file => ({
            file,
            relativePath: file.name  // 普通文件没有路径,直接用文件名
        }))

    // 计算被过滤掉的文件数量
    const filteredCount = input.files.length - filesWithPath.length

    if (filesWithPath.length === 0) {
        ElMessage.warning('未找到支持的文件格式')
        input.value = ''
        return
    }

    if (filteredCount > 0) {
        // ElMessage.info(`检测到 ${input.files.length} 个文件，其中 ${filteredCount} 个不支持的格式已过滤，将上传 ${filesWithPath.length} 个文件...`)
        console.log(`检测到 ${input.files.length} 个文件，其中 ${filteredCount} 个不支持的格式已过滤，将上传 ${filesWithPath.length} 个文件...`)
    } else {
        // ElMessage.info(`检测到 ${filesWithPath.length} 个文件，开始依次上传...`)
        console.log(`检测到 ${filesWithPath.length} 个文件，开始依次上传...`)
    }

    await uploadFilesWithPaths(filesWithPath)

    // 清空input,允许重复选择同一文件
    input.value = ''
}

/**
 * 处理文件夹选择(保留目录结构)
 */
async function handleFolderSelect(event: Event) {
    const input = event.target as HTMLInputElement
    if (!input.files || input.files.length === 0) return

    // 定义允许的文件扩展名(与 ChatInput 保持一致)
    const ALLOWED_EXTENSIONS = [
        '.txt', '.md', '.js', '.ts', '.html', '.css', '.json', '.xml', '.csv', '.log',
        '.py', '.java', '.cpp', '.c', '.go', '.rs', '.php', '.rb', '.sql', '.sh',
        '.bat', '.yml', '.yaml', '.ini', '.conf', '.properties', '.vue', '.toml',
        '.env', '.cfg', '.config', '.reg', '.pem', '.tex', '.rst', '.adoc', '.org',
        '.swift', '.kt', '.scala', '.dart', '.ex', '.r', '.jl', '.ps1', '.vbs', '.fish',
        '.j2', '.ejs', '.hbs', '.lock', '.patch', '.diff', '.ics', '.vcf', '.srt',
        '.proto', '.graphql', '.sol', '.pdf'
    ]

    // 过滤文件,只保留允许的格式
    const filesWithPath = Array.from(input.files)
        .filter(file => {
            const fileName = file.name.toLowerCase()
            const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))
            return hasAllowedExtension
        })
        .map(file => ({
            file,
            relativePath: (file as any).webkitRelativePath || file.name
        }))

    // 计算被过滤掉的文件数量
    const filteredCount = input.files.length - filesWithPath.length

    if (filesWithPath.length === 0) {
        ElMessage.warning('未找到支持的文件格式')
        input.value = ''
        return
    }

    if (filteredCount > 0) {
        // ElMessage.info(`检测到 ${input.files.length} 个文件，其中 ${filteredCount} 个不支持的格式已过滤，将上传 ${filesWithPath.length} 个文件...`)
        console.log(`检测到 ${input.files.length} 个文件，其中 ${filteredCount} 个不支持的格式已过滤，将上传 ${filesWithPath.length} 个文件...`)
    } else {
        // ElMessage.info(`检测到 ${filesWithPath.length} 个文件，开始依次上传...`)
        console.log(`检测到 ${filesWithPath.length} 个文件，开始依次上传...`)
    }

    await uploadFilesWithPaths(filesWithPath)

    // 清空input,允许重复选择同一文件夹
    input.value = ''
}

/**
 * 统一上传逻辑(带相对路径)
 */
async function uploadFilesWithPaths(filesWithPath: Array<{ file: File, relativePath: string }>) {
    let successCount = 0
    let failCount = 0

    // 触发显示上传任务弹窗
    emit('show-upload-task')

    for (const { file, relativePath } of filesWithPath) {
        try {
            // 验证文件大小
            const maxSize = 50 * 1024 * 1024 // 50MB
            if (file.size > maxSize) {
                ElMessage.warning(`${relativePath} 文件大小超过限制 (50MB)，已跳过`)
                failCount++
                continue
            }

            // 调用上传方法(传递 relativePath)
            await uploadStore.uploadToKnowledgeBaseWithPath(
                props.kbId,
                file,
                relativePath,
                (task) => {
                    // 进度更新回调
                    if (task.status === 'uploaded') {
                        // ElMessage.success(`${task.fileName} 处理完成`)
                        emit('uploaded', task)
                        successCount++
                    } else if (task.status === 'failed') {
                        ElMessage.error(`${task.fileName} 处理失败：${task.errorMessage}`)
                        failCount++
                    }
                }
            )
        } catch (error: any) {
            console.error(`${relativePath} 上传失败:`, error)
            ElMessage.error(`${relativePath} 上传失败：${error.response?.data?.detail || '未知错误'}`)
            failCount++
        }
    }

}

// ========== Lifecycle ==========
onUnmounted(() => {
    // 组件卸载时的清理工作(如需要)
})
</script>

<style scoped>
/* 所有样式已使用 Tailwind CSS */

/* 上传按钮图标样式 */
.upload-btn :deep(.btn-icon) {
    width: 18px;
    height: 18px;
    margin-right: 6px;
    display: inline-block;
    vertical-align: middle;
}
</style>
