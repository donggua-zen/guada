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

    // ========== 返回公共属性 ==========

    return {
        // State
        knowledgeBases,
        activeKnowledgeBaseId,
        loading,

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
        searchInKB
    }
})
