<!-- components/KBFileUploader.vue -->
<template>
    <div class="">
        <!-- 上传按钮组 -->
        <div class="flex gap-2 items-center">
            <!-- 新建文件夹按钮 -->
            <el-button class="upload-btn" @click="showCreateFolderDialog = true">
                <FolderAdd16Regular class="btn-icon" />
                新建文件夹
            </el-button>

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

        <!-- 新建文件夹对话框 -->
        <el-dialog v-model="showCreateFolderDialog" title="新建文件夹" width="400px" :close-on-click-modal="false" append-to-body>
            <el-input
                v-model="newFolderName"
                placeholder="输入文件夹名称"
                @keyup.enter="confirmCreateFolder"
            />
            <template #footer>
                <el-button @click="showCreateFolderDialog = false">取消</el-button>
                <el-button type="primary" @click="confirmCreateFolder" :loading="createFolderLoading">确定</el-button>
            </template>
        </el-dialog>

        <!-- 冲突处理对话框 -->
        <el-dialog v-model="showConflictDialog" title="文件冲突" width="600px" :close-on-click-modal="false">
            <div class="space-y-4">
                <p class="text-sm text-gray-600 dark:text-gray-400">
                    以下文件/目录已存在，请选择处理方式：
                </p>

                <div class="max-h-80 overflow-y-auto space-y-2">
                    <div v-for="conflict in conflicts" :key="conflict.relativePath"
                        class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <el-icon size="20" :class="conflict.type === 'directory' ? 'text-yellow-500' : 'text-blue-500'">
                            <Folder v-if="conflict.type === 'directory'" />
                            <Document v-else />
                        </el-icon>
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {{ conflict.originalName }}
                            </div>
                            <div class="text-xs text-gray-500 dark:text-gray-400">
                                {{ conflict.type === 'directory' ? '目录' : '文件' }}已存在
                            </div>
                            <div v-if="conflictMode === 'keep-both'" class="text-xs text-green-600 dark:text-green-400 mt-1">
                                将重命名为: {{ conflict.suggestedName }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="mt-4">
                    <el-radio-group v-model="conflictMode" class="flex flex-col gap-3">
                        <el-radio value="overwrite" size="large">
                            <div class="flex flex-col">
                                <span class="font-medium">覆盖已有文件</span>
                                <span class="text-xs text-gray-500">新文件将替换旧文件</span>
                            </div>
                        </el-radio>
                        <el-radio value="keep-both" size="large">
                            <div class="flex flex-col">
                                <span class="font-medium">都保留（自动重命名）</span>
                                <span class="text-xs text-gray-500">在名称后添加时间戳以区分</span>
                            </div>
                        </el-radio>
                    </el-radio-group>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-3">
                    <el-button @click="showConflictDialog = false">取消</el-button>
                    <el-button type="primary" @click="handleConflictConfirm">确定</el-button>
                </div>
            </template>
        </el-dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { Upload, Folder, Document } from '@element-plus/icons-vue'
import { DocumentAdd16Regular, FolderAdd16Regular } from '@vicons/fluent'
import { ElMessage } from 'element-plus'
import { useFileUploadStore } from '@/stores/fileUpload'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { UploadTask } from '@/stores/fileUpload'
import type { KBFile } from '@/stores/knowledgeBase'

/**
 * 上传冲突信息
 */
interface UploadConflict {
    type: 'file' | 'directory'
    originalName: string          // 原始名称
    suggestedName: string         // 建议的新名称（加时间戳）
    relativePath: string          // 完整相对路径
    existingItem?: KBFile         // 已存在的文件/目录信息
}

interface Props {
    kbId: string
    currentFolderPath?: string | null  // 当前文件夹路径（可选）
    getCurrentFiles?: () => KBFile[]  // 获取当前目录文件列表的函数（可选）
}

const props = defineProps<Props>()
const emit = defineEmits<{
    (e: 'uploaded', task: UploadTask): void
    (e: 'show-upload-task'): void  // 新增: 触发显示上传任务弹窗
    (e: 'folder-created'): void  // 新增: 文件夹创建成功事件
}>()

const uploadStore = useFileUploadStore()
const kbStore = useKnowledgeBaseStore()
const fileInputRef = ref<HTMLInputElement>()
const folderInputRef = ref<HTMLInputElement>()  // 新增: 文件夹输入框引用

// 新建文件夹相关状态
const showCreateFolderDialog = ref(false)
const newFolderName = ref('')
const createFolderLoading = ref(false)

// 冲突处理相关状态
const showConflictDialog = ref(false)
const conflictMode = ref<'overwrite' | 'keep-both'>('keep-both')
const pendingFiles = ref<Array<{ file: File, relativePath: string }>>([])
const conflicts = ref<UploadConflict[]>([])

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

// ========== 工具函数 ==========

/**
 * 生成时间戳后缀（格式：YYYYMMDDHHmm）
 */
function generateTimestampSuffix(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hour = String(now.getHours()).padStart(2, '0')
    const minute = String(now.getMinutes()).padStart(2, '0')
    return `${year}${month}${day}${hour}${minute}`
}

/**
 * 为“都保留”模式生成新名称
 * @param name 原始名称
 * @param isDirectory 是否为目录
 * @returns 重命名后的名称
 */
function renameForKeepBoth(name: string, isDirectory: boolean): string {
    const timestamp = generateTimestampSuffix()
    
    if (isDirectory) {
        return `${name}_${timestamp}`
    } else {
        // 文件：在扩展名前插入时间戳
        const lastDotIndex = name.lastIndexOf('.')
        if (lastDotIndex === -1) {
            return `${name}_${timestamp}`
        }
        const baseName = name.substring(0, lastDotIndex)
        const extension = name.substring(lastDotIndex)
        return `${baseName}_${timestamp}${extension}`
    }
}

/**
 * 检测上传冲突
 * @param filesToUpload 待上传的文件列表
 * @param currentItems 当前目录下的文件/目录列表
 * @returns 冲突列表（已去重）
 */
function detectUploadConflicts(
    filesToUpload: Array<{ file: File, relativePath: string }>,
    currentItems: KBFile[]
): UploadConflict[] {
    const conflicts: UploadConflict[] = []
    const checkedPaths = new Set<string>()  // 用于去重
    
    for (const { file, relativePath } of filesToUpload) {
        // 提取需要检查的名称和路径
        let checkName: string
        let checkPath: string  // 用于去重的键
        let isDirectory = false
        
        if (relativePath.includes('/')) {
            // 文件夹上传：只检查顶级目录
            const parts = relativePath.split('/')
            checkName = parts[0]
            checkPath = checkName  // 用顶级目录名作为键
            isDirectory = true
        } else {
            // 单文件上传：检查文件名
            checkName = relativePath
            checkPath = relativePath  // 用完整路径作为键
            isDirectory = false
        }
        
        // 跳过已检查的路径
        if (checkedPaths.has(checkPath)) {
            continue
        }
        checkedPaths.add(checkPath)
        
        // 检查当前目录是否存在同名项
        const existingItem = currentItems.find(item => 
            item.displayName === checkName && 
            item.isDirectory === isDirectory
        )
        
        if (existingItem) {
            conflicts.push({
                type: isDirectory ? 'directory' : 'file',
                originalName: checkName,
                suggestedName: renameForKeepBoth(checkName, isDirectory),
                relativePath: checkPath,  // 存储检查路径，而非原始文件路径
                existingItem
            })
        }
    }
    
    return conflicts
}

/**
 * 应用冲突解决方案（重命名）
 * @param filesToUpload 待上传的文件列表
 * @param conflicts 冲突列表
 * @param mode 冲突处理模式
 * @returns 处理后的文件列表（包含重命名后的 File 对象）
 */
function applyConflictResolution(
    filesToUpload: Array<{ file: File, relativePath: string }>,
    conflicts: UploadConflict[],
    mode: 'overwrite' | 'keep-both'
): Array<{ file: File, relativePath: string }> {
    console.log('[DEBUG] applyConflictResolution 被调用')
    console.log('[DEBUG] mode:', mode)
    console.log('[DEBUG] conflicts:', conflicts)
    
    if (mode === 'overwrite') {
        console.log('[DEBUG] 覆盖模式，直接返回原文件列表')
        return filesToUpload
    }
    
    // 构建冲突映射：checkPath → newName
    const conflictMap = new Map<string, string>()
    conflicts.forEach(conflict => {
        conflictMap.set(conflict.relativePath, conflict.suggestedName)
        console.log(`[DEBUG] 添加冲突映射: ${conflict.relativePath} → ${conflict.suggestedName}`)
    })
    
    console.log('[DEBUG] conflictMap:', Array.from(conflictMap.entries()))
    
    const result = filesToUpload.map(({ file, relativePath }) => {
        console.log(`[DEBUG] 处理文件: ${relativePath}`)
        
        // 提取检查路径
        let checkPath: string
        let newName: string | null = null
        
        if (relativePath.includes('/')) {
            const parts = relativePath.split('/')
            checkPath = parts[0]
            console.log(`[DEBUG]   → 文件夹，checkPath: ${checkPath}`)
        } else {
            checkPath = relativePath
            console.log(`[DEBUG]   → 单文件，checkPath: ${checkPath}`)
        }
        
        if (conflictMap.has(checkPath)) {
            // 需要重命名
            newName = conflictMap.get(checkPath)!
            console.log(`[DEBUG]   → 检测到冲突，重命名为: ${newName}`)
            
            if (relativePath.includes('/')) {
                // 文件夹：替换顶级目录名
                const parts = relativePath.split('/')
                const oldTopDir = parts[0]
                parts[0] = newName  // 只替换第一层
                const newPath = parts.join('/')
                console.log(`[DEBUG]   → 新路径: ${newPath}`)
                
                // 关键修复:对于文件夹中的文件，不需要修改 File.name
                // 因为后端会根据 relativePath 创建目录结构
                // File.name 保持原样即可
                return { file, relativePath: newPath }
            } else {
                // 单文件：直接使用新名称
                console.log(`[DEBUG]   → 新路径: ${newName}`)
                
                // 关键修复:创建新的 File 对象，使用重命名后的文件名
                const renamedFile = new File([file], newName, { type: file.type })
                return { file: renamedFile, relativePath: newName }
            }
        }
        
        console.log(`[DEBUG]   → 无冲突，保持原路径`)
        return { file, relativePath }
    })
    
    console.log('[DEBUG] applyConflictResolution 完成，返回:', result.map(f => f.relativePath))
    return result
}

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
        .map(file => {
            // 关键修复:拼接当前文件夹路径
            const relativePath = props.currentFolderPath 
                ? `${props.currentFolderPath}/${file.name}`
                : file.name
            return {
                file,
                relativePath
            }
        })

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
        .map(file => {
            // 获取浏览器提供的相对路径
            const browserRelativePath = (file as any).webkitRelativePath || file.name
            
            // 关键修复:拼接当前文件夹路径
            const relativePath = props.currentFolderPath
                ? `${props.currentFolderPath}/${browserRelativePath}`
                : browserRelativePath
            
            return {
                file,
                relativePath
            }
        })

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
    // 关键修复:上传前检查冲突
    if (props.getCurrentFiles) {
        const currentItems = props.getCurrentFiles()
        const detectedConflicts = detectUploadConflicts(filesWithPath, currentItems)
        
        if (detectedConflicts.length > 0) {
            // 发现冲突，显示对话框让用户选择
            console.log(`[DEBUG] 检测到 ${detectedConflicts.length} 个冲突`)
            conflicts.value = detectedConflicts
            pendingFiles.value = filesWithPath
            showConflictDialog.value = true
            return  // 等待用户选择后再继续
        }
    }
    
    // 没有冲突，直接上传
    await executeUpload(filesWithPath, 'keep-both')
}

/**
 * 执行实际上传
 * @param filesWithPath 文件列表
 * @param mode 冲突处理模式
 */
async function executeUpload(
    filesWithPath: Array<{ file: File, relativePath: string }>,
    mode: 'overwrite' | 'keep-both'
) {
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

            // TODO: 传递 conflictMode 参数到后端
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

/**
 * 处理冲突确认
 */
async function handleConflictConfirm() {
    showConflictDialog.value = false
    
    console.log('[DEBUG] ===== 开始处理冲突 =====')
    console.log('[DEBUG] 冲突列表:', conflicts.value)
    console.log('[DEBUG] 待处理文件:', pendingFiles.value.map(f => f.relativePath))
    console.log('[DEBUG] 用户选择的模式:', conflictMode.value)
    
    // 应用冲突解决方案
    const resolvedFiles = applyConflictResolution(
        pendingFiles.value,
        conflicts.value,
        conflictMode.value
    )
    
    console.log('[DEBUG] 重命名后的文件:', resolvedFiles.map(f => f.relativePath))
    console.log('[DEBUG] 冲突处理模式:', conflictMode.value)
    console.log('[DEBUG] 重命名后的文件数:', resolvedFiles.length)
    
    // 执行上传
    await executeUpload(resolvedFiles, conflictMode.value)
    
    // 清空状态
    pendingFiles.value = []
    conflicts.value = []
}

/**
 * 确认创建文件夹
 */
async function confirmCreateFolder() {
    if (!newFolderName.value || !newFolderName.value.trim()) {
        ElMessage.warning('文件夹名称不能为空')
        return
    }

    // 前端验证
    const validation = validateFileName(newFolderName.value.trim())
    if (!validation.valid) {
        ElMessage.warning(validation.message)
        return
    }

    createFolderLoading.value = true
    try {
        // 需要将 currentFolderPath 转换为 parentFolderId
        // 这里暂时传 null，让后端根据 relativePath 计算
        await kbStore.createFolder(
            props.kbId,
            newFolderName.value.trim(),
            null, // TODO: 需要根据 currentFolderPath 获取 parentFolderId
        )
        
        ElMessage.success('文件夹创建成功')
        showCreateFolderDialog.value = false
        newFolderName.value = ''
        
        // 通知父组件刷新
        emit('folder-created')
    } catch (error: any) {
        ElMessage.error(error.message || '创建文件夹失败')
    } finally {
        createFolderLoading.value = false
    }
}

/**
 * 验证文件或文件夹名称
 */
function validateFileName(name: string): { valid: boolean; message?: string } {
    if (!name || name.trim() === '') {
        return { valid: false, message: '名称不能为空' }
    }

    if (name.length > 255) {
        return { valid: false, message: '名称不能超过 255 个字符' }
    }

    // 不允许的字符：/ \ : * ? " < > | 以及控制字符
    const invalidChars = /[\\/:*?"<>|\x00-\x1f\x7f]/
    if (invalidChars.test(name)) {
        return { 
            valid: false, 
            message: '名称包含非法字符，不允许使用：\\ / : * ? " < > | 及控制字符' 
        }
    }

    // Windows 保留名称检查
    const reservedNames = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
    ]
    if (reservedNames.includes(name.toUpperCase())) {
        return { valid: false, message: `名称「${name}」是系统保留名称，不能使用` }
    }

    // 不允许以空格或点号开头/结尾
    if (name.startsWith(' ') || name.endsWith(' ') || 
        name.startsWith('.') || name.endsWith('.')) {
        return { valid: false, message: '名称不能以空格或点号开头或结尾' }
    }

    return { valid: true }
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
