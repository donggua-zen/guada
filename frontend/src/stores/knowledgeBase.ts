// stores/knowledgeBase.ts
import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'
import { apiService } from '@/services/ApiService'

/**
 * 知识库类型定义
 */
export interface KnowledgeBase {
    id: string
    name: string
    description: string | null
    userId: string
    embeddingModelId: string
    chunkMaxSize: number
    chunkOverlapSize: number
    chunkMinSize: number
    isActive: boolean
    isPublic: boolean
    metadataConfig: Record<string, any> | null
    createdAt: string
    updatedAt: string
}

/**
 * 知识库文件类型定义
 */
export interface KBFile {
    id: string
    knowledgeBaseId: string
    fileName: string
    displayName: string
    fileSize: number
    fileType: string
    fileExtension: string
    contentHash: string
    relativePath?: string | null // 相对路径(例如: "docs/api/readme.md")
    parentFolderId?: string | null // 父文件夹ID
    isDirectory?: boolean // 是否为文件夹节点
    processingStatus: 'queued' | 'uploading' | 'uploaded' | 'pending' | 'processing' | 'completed' | 'failed'
    progressPercentage: number
    currentStep: string | null
    errorMessage: string | null
    totalChunks: number
    totalTokens: number
    uploadedAt: string
    processedAt: string | null
}


/**
 * 知识库 Store
 */
export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
    // ========== 状态 ==========

    /** 知识库列表 */
    const knowledgeBases: Ref<KnowledgeBase[]> = ref([])

    /** 当前选中的知识库 ID */
    const activeKnowledgeBaseId: Ref<string | null> = ref(null)

    /** 加载中状态 */
    const loading: Ref<boolean> = ref(false)


    /** 全局轮询间隔（毫秒） */
    const POLL_INTERVAL = 3000 // 3 秒

    /** 当前活跃的轮询定时器（全局唯一） */
    let activePollingTimer: NodeJS.Timeout | null = null

    /** 当前轮询的文件 ID 列表 */
    let pollingFileIds: Set<string> = new Set()

    /** 文件回调函数映射表 */
    const fileCallbacks: Ref<Map<string, (file: KBFile) => void>> = ref(new Map())

    // ========== Actions ==========

    /**
     * 获取知识库列表
     */
    async function fetchKnowledgeBases() {
        loading.value = true
        try {
            const response = await apiService.fetchKnowledgeBases()
            knowledgeBases.value = response.items || []
            return response
        } catch (error) {
            console.error('获取知识库列表失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    /**
     * 创建知识库
     */
    async function createKnowledgeBase(data: {
        name: string
        description?: string
        embeddingModelId: string
        chunkMaxSize?: number
        chunkOverlapSize?: number
        chunkMinSize?: number
        isPublic?: boolean
    }) {
        loading.value = true
        try {
            const response = await apiService.createKnowledgeBase(data)
            // 添加到列表
            knowledgeBases.value.unshift(response)
            return response
        } catch (error) {
            console.error('创建知识库失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    /**
     * 更新知识库
     */
    async function updateKnowledgeBase(kbId: string, data: Partial<KnowledgeBase>) {
        loading.value = true
        try {
            const response = await apiService.updateKnowledgeBase(kbId, data)
            // 更新列表中的项
            const index = knowledgeBases.value.findIndex(kb => kb.id === kbId)
            if (index !== -1) {
                knowledgeBases.value[index] = response
            }
            return response
        } catch (error) {
            console.error('更新知识库失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    /**
     * 删除知识库
     */
    async function deleteKnowledgeBase(kbId: string) {
        loading.value = true
        try {
            await apiService.deleteKnowledgeBase(kbId)
            // 从列表中移除
            knowledgeBases.value = knowledgeBases.value.filter(kb => kb.id !== kbId)
            // 如果删除的是当前选中的，清空选中状态
            if (activeKnowledgeBaseId.value === kbId) {
                activeKnowledgeBaseId.value = null
            }
        } catch (error) {
            console.error('删除知识库失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    /**
     * 设置当前选中的知识库
     */
    function setActiveKnowledgeBase(kbId: string | null) {
        activeKnowledgeBaseId.value = kbId
    }

    /**
     * 获取当前选中的知识库对象
     */
    function getActiveKnowledgeBase(): KnowledgeBase | null {
        if (!activeKnowledgeBaseId.value) return null
        return knowledgeBases.value.find(kb => kb.id === activeKnowledgeBaseId.value) || null
    }

    // ========== 文件管理相关 ==========

    /**
     * 获取知识库文件列表
     * @param kbId 知识库 ID
     * @param skip 跳过数量（用于分页）
     * @param limit 返回数量限制（用于分页）
     */
    async function fetchFiles(kbId: string, skip?: number, limit?: number) {
        loading.value = true
        try {
            const response = await apiService.fetchKBFiles(kbId, skip, limit)
            return response
        } catch (error) {
            console.error('获取文件列表失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    /**
     * 删除文件
     */
    async function deleteFile(kbId: string, fileId: string) {
        try {
            await apiService.deleteKBFile(kbId, fileId)
        } catch (error) {
            console.error('删除文件失败:', error)
            throw error
        }
    }

    /**
     * 重命名文件
     */
    async function renameFile(kbId: string, fileId: string, newName: string) {
        try {
            const response = await apiService.renameKBFile(kbId, fileId, newName)
            return response
        } catch (error) {
            console.error('重命名文件失败:', error)
            throw error
        }
    }

    /**
     * 移动文件
     */
    async function moveFile(
        kbId: string,
        fileId: string,
        targetParentFolderId: string | null,
    ) {
        try {
            const response = await apiService.moveKBFile(
                kbId,
                fileId,
                targetParentFolderId,
            )
            return response
        } catch (error) {
            console.error('移动文件失败:', error)
            throw error
        }
    }

    /**
     * 创建文件夹
     */
    async function createFolder(
        kbId: string,
        folderName: string,
        parentFolderId: string | null = null,
    ) {
        try {
            const response = await apiService.createKBFolder(
                kbId,
                folderName,
                parentFolderId,
            )
            return response
        } catch (error) {
            console.error('创建文件夹失败:', error)
            throw error
        }
    }


    // ========== 搜索相关 ==========

    /**
     * 在知识库中搜索
     */
    async function searchInKB(
        kbId: string,
        query: string,
        topK: number = 5,
        filterFileId?: string
    ) {
        loading.value = true
        try {
            const response = await apiService.searchKnowledgeBase(kbId, query, topK, filterFileId)
            return response
        } catch (error) {
            console.error('搜索失败:', error)
            throw error
        } finally {
            loading.value = false
        }
    }

    // ========== 文件处理轮询相关 ==========

    /**
     * 开始批量轮询文件处理进度（会先停止之前的轮询）
     * @param kbId 知识库 ID
     * @param fileIds 文件 ID 数组
     * @param onProgressUpdate 进度更新回调（每个文件都会调用一次）
     */
    function startFileProcessingPolling(
        kbId: string,
        fileIds: string[],
        onProgressUpdate?: (file: KBFile) => void
    ) {
        if (!fileIds || fileIds.length === 0) {
            return
        }

        // 关键：先停止之前的轮询
        stopAllFileProcessingPolling()

        // 为每个文件注册回调函数
        fileIds.forEach(fileId => {
            if (onProgressUpdate) {
                fileCallbacks.value.set(fileId, onProgressUpdate)
            }
            pollingFileIds.add(fileId)
        })

        const poll = async () => {
            try {
                // 批量获取文件状态
                const responses = await apiService.batchGetFileProcessingStatus(kbId, Array.from(pollingFileIds))

                console.log(`[DEBUG] 轮询收到 ${responses.length} 个文件的状态更新`)

                // 遍历结果并调用对应的回调
                responses.forEach((response: any) => {
                    console.log(`[DEBUG] 文件状态: id=${response.id}, status=${response.processingStatus}`)

                    const callback = fileCallbacks.value.get(response.id)
                    if (callback) {
                        // 将后端返回的字段映射为 KBFile 格式
                        const mappedFile: KBFile = {
                            id: response.id,
                            knowledgeBaseId: kbId,
                            fileName: response.fileName || response.displayName,
                            displayName: response.fileName || response.displayName,
                            fileSize: response.fileSize || 0,
                            fileType: response.fileType || '',
                            fileExtension: response.fileExtension || '',
                            contentHash: response.contentHash || '',
                            processingStatus: response.processingStatus,
                            progressPercentage: response.progressPercentage || 0,
                            currentStep: response.currentStep || null,
                            errorMessage: response.errorMessage || null,
                            totalChunks: response.totalChunks || 0,
                            totalTokens: response.totalTokens || 0,
                            uploadedAt: response.uploadedAt || new Date().toISOString(),
                            processedAt: response.processedAt || null
                        }
                        callback(mappedFile)
                    }

                    // 如果单个文件处理完成或失败，从轮询列表中移除
                    if (response.processingStatus === 'completed' ||
                        response.processingStatus === 'failed') {
                        console.log(`[DEBUG] 文件 ${response.id} 处理${response.processingStatus === 'completed' ? '完成' : '失败'},停止轮询`)
                        pollingFileIds.delete(response.id)
                        fileCallbacks.value.delete(response.id)
                    }
                })

                // 如果所有文件都处理完成，停止轮询
                if (pollingFileIds.size === 0) {
                    console.log('[DEBUG] 所有文件处理完成,停止轮询')
                    stopAllFileProcessingPolling()
                }
            } catch (error) {
                console.error(`批量轮询文件状态失败:`, error)
                // 出错时不停止轮询，继续尝试
            }
        }

        // 立即执行一次
        poll()

        // 定时轮询
        activePollingTimer = setInterval(poll, POLL_INTERVAL)
    }

    /**
     * 停止单个文件的轮询（从轮询列表中移除）
     */
    function stopFileProcessingPolling(fileId: string) {
        pollingFileIds.delete(fileId)
        fileCallbacks.value.delete(fileId)

        // 如果所有文件都已完成，停止轮询
        if (pollingFileIds.size === 0) {
            stopAllFileProcessingPolling()
        }
    }

    /**
     * 停止所有轮询
     */
    function stopAllFileProcessingPolling() {
        // 清除定时器
        if (activePollingTimer) {
            clearInterval(activePollingTimer)
            activePollingTimer = null
        }

        // 清空轮询列表和回调
        pollingFileIds.clear()
        fileCallbacks.value.clear()
    }

    /**
     * 检查是否有活跃的轮询
     */
    function hasActiveFilePolling(): boolean {
        return activePollingTimer !== null && pollingFileIds.size > 0
    }

    // ========== 返回公共属性 ==========

    return {
        // State
        knowledgeBases,
        activeKnowledgeBaseId,
        loading,
        POLL_INTERVAL,
        // pollingBatches 已移除，改为简单的 activePollingTimer

        // Actions - 知识库管理
        fetchKnowledgeBases,
        createKnowledgeBase,
        updateKnowledgeBase,
        deleteKnowledgeBase,
        setActiveKnowledgeBase,
        getActiveKnowledgeBase,

        // Actions - 文件管理
        fetchFiles,
        deleteFile,
        renameFile,  // 新增
        moveFile,    // 新增
        createFolder,  // 新增

        // Actions - 搜索
        searchInKB,

        // Actions - 文件处理轮询
        startFileProcessingPolling,  // 已重构为批量模式
        stopFileProcessingPolling,   // 已适配批量模式（兼容旧调用）
        stopAllFileProcessingPolling,
        hasActiveFilePolling  // 检查是否有活跃轮询
    }
})
