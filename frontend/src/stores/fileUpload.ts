// stores/fileUpload.ts
import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'

/**
 * 文件上传任务
 */
export interface UploadTask {
    id: string // 临时 ID（用于前端追踪）
    fileId: string // 数据库文件 ID（上传完成后更新）
    fileName: string
    fileSize: number
    fileType: string
    fileExtension?: string
    status: 'uploading' | 'uploaded' | 'pending' | 'processing' | 'completed' | 'failed'
    progress: number
    currentStep: string | null
    errorMessage: string | null
    uploadedAt: string
    processedAt: string | null
    knowledgeBaseId: string
    timerId?: NodeJS.Timeout
}

/**
 * 统一的文件记录类型（兼容数据库记录和上传任务）
 */
export interface UnifiedFileRecord {
    id: string
    fileId: string // 数据库文件 ID
    knowledgeBaseId?: string // 知识库 ID（可选，用于兼容）
    fileName: string
    displayName: string
    fileSize: number
    fileType: string
    fileExtension: string
    contentHash?: string // 内容哈希（可选，临时任务没有）
    processingStatus: 'uploading' | 'uploaded' | 'pending' | 'processing' | 'completed' | 'failed'
    progressPercentage: number
    currentStep: string | null
    errorMessage: string | null
    uploadedAt: string | null
    processedAt: string | null
    totalChunks?: number
    totalTokens?: number
    isTempTask?: boolean // 标记是否为临时上传任务
}

/**
 * 文件上传 Store
 * 
 * 专门处理文件上传和进度轮询
 */
export const useFileUploadStore = defineStore('fileUpload', () => {
    // ========== 状态 ==========

    /** 所有上传任务 */
    const uploadTasks: Ref<Map<string, UploadTask>> = ref(new Map())


    // ========== Actions ==========

    /**
     * 添加上传任务
     */
    function addUploadTask(task: Omit<UploadTask, 'status' | 'progress' | 'currentStep' | 'errorMessage'>) {
        const newTask: UploadTask = {
            ...task,
            status: 'pending',
            progress: 0,
            currentStep: '等待处理...',
            errorMessage: null
        }

        uploadTasks.value.set(task.id, newTask)

        return newTask
    }

    /**
     * 更新上传任务状态
     */
    function updateUploadStatus(
        taskId: string,
        updates: Partial<Pick<UploadTask, 'status' | 'progress' | 'currentStep' | 'errorMessage' | 'processedAt'>>
    ) {
        const task = uploadTasks.value.get(taskId)
        if (task) {
            Object.assign(task, updates)
        }
    }

    /**
     * 获取上传任务
     */
    function getUploadTask(fileId: string): UploadTask | undefined {
        return uploadTasks.value.get(fileId)
    }

    /**
     * 获取所有上传任务列表
     */
    function getAllUploadTasks(): UploadTask[] {
        return Array.from(uploadTasks.value.values())
    }

    /**
     * 获取指定知识库的上传任务
     */
    function getTasksByKB(knowledgeBaseId: string): UploadTask[] {
        return Array.from(uploadTasks.value.values()).filter(
            task => task.knowledgeBaseId === knowledgeBaseId
        )
    }

    /**
     * 清除上传任务
     */
    function clearUploadTask(taskId: string) {
        uploadTasks.value.delete(taskId)
    }

    /**
     * 清除所有已完成的任务
     */
    function clearCompletedTasks() {
        const completedTasks = Array.from(uploadTasks.value.entries())
            .filter(([_, task]) =>
                task.status === 'completed' || task.status === 'failed'
            )

        completedTasks.forEach(([fileId, _]) => {
            uploadTasks.value.delete(fileId)
        })

    }


    /**
     * 上传文件到知识库
     */
    async function uploadToKnowledgeBase(
        kbId: string,
        file: File,
        onProgressUpdate?: (status: UploadTask) => void
    ) {
        try {
            // 从文件名提取扩展名
            const fileName = file.name
            const fileExtension = fileName.includes('.') ? fileName.split('.').pop()! : ''

            // 创建初始任务（pending 状态）
            const task = addUploadTask({
                id: Date.now().toString(),
                fileId: 'pending',
                fileName: fileName,
                fileSize: file.size,
                fileType: file.type || 'unknown',
                fileExtension: fileExtension,  // 添加扩展名
                uploadedAt: new Date().toISOString(),
                processedAt: null,
                knowledgeBaseId: kbId
            })

            // 使用 axios 直接调用以获取上传进度
            import('axios').then(async ({ default: axios }) => {
                const formData = new FormData()
                formData.append('file', file)

                // 从 auth store 获取 token
                const { useAuthStore } = await import('@/stores/auth')
                const authStore = useAuthStore()
                const token = authStore.token

                try {
                    const response = await axios.post(
                        `/api/v1/knowledge-bases/${kbId}/files/upload`,
                        formData,
                        {
                            headers: {
                                'Content-Type': 'multipart/form-data',
                                'Authorization': `Bearer ${token}`
                            },
                            onUploadProgress: (progressEvent) => {
                                if (!progressEvent.total) return

                                const percentCompleted = Math.round(
                                    (progressEvent.loaded * 100) / progressEvent.total
                                )

                                // 更新上传进度
                                updateUploadStatus(task.id, {
                                    status: 'uploading',
                                    progress: percentCompleted,
                                    currentStep: `上传中... ${percentCompleted}%`
                                })
                                onProgressUpdate?.(task)


                            }
                        }
                    )

                    // 上传成功，更新为真实 ID 和状态
                    const taskToUpdate = uploadTasks.value.get(task.id)
                    if (taskToUpdate) {
                        taskToUpdate.fileId = response.data.id
                        taskToUpdate.status = 'uploaded'
                        taskToUpdate.progress = 100
                        taskToUpdate.currentStep = '上传完成，等待处理...'
                        onProgressUpdate?.(taskToUpdate)

                        // 关键修复：上传成功后立即清除临时任务
                        // 避免 mergeFilesWithTasks 重复加载
                        // 数据库记录会在 refreshFileList 时自动加载
                        clearUploadTask(task.id)
                    }

                    // 注意：不再在这里启动轮询
                    // 轮询逻辑已移至 knowledgeBase store
                    // knowledgeBase store 会在 refreshFileList 时自动检测 processing 状态并启动轮询
                } catch (error) {
                    console.error('上传失败:', error)
                    updateUploadStatus(task.id, {
                        status: 'failed',
                        errorMessage: (error as any).response?.data?.detail || '上传失败'
                    })
                    onProgressUpdate?.(task)
                    throw error
                }
            })

            return task
        } catch (error) {
            console.error('上传文件失败:', error)
            throw error
        }
    }

    /**
     * 批量上传文件
     */
    async function uploadMultipleFiles(
        kbId: string,
        files: File[],
        onProgressUpdate?: (fileId: string, status: UploadTask) => void
    ) {
        const tasks: UploadTask[] = []

        for (const file of files) {
            try {
                const task = await uploadToKnowledgeBase(
                    kbId,
                    file,
                    (status) => onProgressUpdate?.(task.fileId, status)
                )
                tasks.push(task)
            } catch (error) {
                console.error(`上传文件 ${file.name} 失败:`, error)
                // 继续上传其他文件
            }
        }

        return tasks
    }

    /**
     * 获取上传统计信息
     */
    function getUploadStats() {
        const allTasks = Array.from(uploadTasks.value.values())

        return {
            total: allTasks.length,
            uploading: allTasks.length,
            completed: allTasks.filter(t => t.status === 'completed').length,
            failed: allTasks.filter(t => t.status === 'failed').length,
            pending: allTasks.filter(t => t.status === 'pending' || t.status === 'uploaded').length,
            processing: allTasks.filter(t => t.status === 'processing').length
        }
    }

    /**
     * 将上传任务转换为统一文件记录
     */
    function taskToFileRecord(task: UploadTask): UnifiedFileRecord {
        return {
            id: task.id,
            fileId: task.fileId,
            fileName: task.fileName,
            displayName: task.fileName,
            fileSize: task.fileSize,
            fileType: task.fileType,
            fileExtension: task.fileExtension || '',
            processingStatus: task.status,
            progressPercentage: task.progress,
            currentStep: task.currentStep,
            errorMessage: task.errorMessage,
            uploadedAt: task.uploadedAt,
            processedAt: task.processedAt,
            isTempTask: true
        }
    }

    /**
     * 合并数据库记录和上传任务为统一列表
     * @param dbFiles 数据库文件记录
     * @param kbId 知识库 ID
     * @param extraTempTasks 额外的临时任务列表（用于无限滚动时保留临时任务）
     */
    function mergeFilesWithTasks(dbFiles: any[], kbId: string, extraTempTasks?: UploadTask[]): UnifiedFileRecord[] {
        const result: UnifiedFileRecord[] = []

        // 1. 先添加临时上传任务（让它们显示在前面）
        let tasks = extraTempTasks || getTasksByKB(kbId)
        if (tasks.length > 0) {
            console.log(`[DEBUG] mergeFilesWithTasks: 添加了 ${tasks.length} 个临时任务到列表前面`)
            tasks.forEach(task => {
                result.push(taskToFileRecord(task))
            })
        }

        // 2. 后添加数据库记录
        dbFiles.forEach((file: any) => {
            result.push({
                id: file.id,
                fileId: file.id,
                knowledgeBaseId: file.knowledgeBaseId,
                fileName: file.fileName,
                displayName: file.displayName,
                fileSize: file.fileSize,
                fileType: file.fileType,
                fileExtension: file.fileExtension,
                contentHash: file.contentHash,
                processingStatus: file.processingStatus,
                progressPercentage: file.progressPercentage,
                currentStep: file.currentStep,
                errorMessage: file.errorMessage,
                uploadedAt: file.uploadedAt,
                processedAt: file.processedAt,
                totalChunks: file.totalChunks,
                totalTokens: file.totalTokens,
                isTempTask: false
            })
        })

        console.log(`[DEBUG] mergeFilesWithTasks: 最终列表共 ${result.length} 个文件`)
        return result
    }

    // ========== 返回公共属性 ==========

    return {
        // State
        uploadTasks,

        // Actions
        addUploadTask,
        updateUploadStatus,
        getUploadTask,
        getAllUploadTasks,
        getTasksByKB,
        clearUploadTask,
        clearCompletedTasks,
        uploadToKnowledgeBase,
        uploadMultipleFiles,
        getUploadStats,
        taskToFileRecord,
        mergeFilesWithTasks
    }
})
