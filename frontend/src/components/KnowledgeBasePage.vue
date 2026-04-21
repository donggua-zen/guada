<!-- components/KnowledgeBasePage.vue -->
<template>
    <SidebarLayout v-model:sidebar-visible="kbSidebarVisible" :sidebar-position="'left'" :z-index="50"
        :show-toggle-button="true">
        <!-- 左侧侧边栏：知识库列表 -->
        <template #sidebar>
            <KBSidebar :knowledge-bases="store.knowledgeBases" :active-id="store.activeKnowledgeBaseId"
                v-model:search-keyword="searchKeyword" @select="handleSelectKB" @create="showCreateModal = true"
                @edit="handleEdit" @delete="handleDelete" />
        </template>

        <!-- 右侧主区域：文件列表和管理 -->
        <template #content>
            <div class="kb-main h-full flex flex-col bg-white dark:bg-gray-900">
                <template v-if="store.activeKnowledgeBaseId">
                    <!-- 文件列表头部 -->
                    <div class="px-4 py-3.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <!-- 侧边栏切换按钮 -->
                                <div v-if="kbSidebarVisible !== undefined"
                                    class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-gray-400 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"
                                    @click="kbSidebarVisible = !kbSidebarVisible"
                                    :title="kbSidebarVisible ? '收起知识库列表' : '展开知识库列表'">
                                    <LeftBarIcon class="w-5 h-5" />
                                </div>
                                <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    {{ currentKB?.name }}
                                </h3>
                            </div>
                            <div class="flex items-center gap-2">
                                <!-- 搜索按钮 -->
                                <el-button @click="showSearchDialog = true">
                                    <el-icon>
                                        <Search />
                                    </el-icon>
                                    搜索
                                </el-button>
                            </div>
                        </div>
                    </div>

                    <!-- 统一文件列表 -->
                    <div class="flex-1 flex flex-col overflow-hidden">
                        <!-- 上传区域 -->
                        <div class="px-4 pt-4 pb-1">
                            <KBFileUploader 
                                :kb-id="store.activeKnowledgeBaseId!"
                                @uploaded="handleUploadComplete"
                                @show-upload-task="showUploadTaskModal = true"
                            />
                        </div>

                        <!-- 文件列表内容区 -->
                        <div class="flex-1 px-4 pb-4 overflow-hidden">
                            <ScrollContainer ref="fileListContainer"  @scroll="handleScroll">
                                <KBFileTree 
                                    ref="fileTreeRef"
                                    :files="files"
                                    :kb-id="store.activeKnowledgeBaseId!"
                                    @view="handleViewFile"
                                    @retry="handleRetryFile"
                                    @delete="handleDeleteFile"
                                />
                            </ScrollContainer>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <!-- 未选择知识库时的空状态 -->
                    <div class="flex-1 flex items-center justify-center">
                        <div
                            class="empty-state text-center text-gray-500 flex flex-col items-center justify-center py-12">
                            <div class="empty-state-icon mb-3 text-gray-300">
                                <el-icon size="48">
                                    <MoreFilled />
                                </el-icon>
                            </div>
                            <div class="empty-state-title text-sm font-medium mb-1">
                                请选择一个知识库
                            </div>
                            <div class="empty-state-description text-xs text-gray-400 mb-3">
                                从左侧列表选择或创建新的知识库
                            </div>
                            <el-button type="primary" @click="showCreateModal = true">创建知识库</el-button>
                        </div>
                    </div>
                </template>
            </div>
        </template>
    </SidebarLayout>

    <!-- 创建/编辑知识库对话框 -->
    <el-dialog v-model="showCreateModal" title="创建知识库" width="600px" :close-on-click-modal="false">
        <el-form :model="createForm" label-width="140px" size="large">
            <el-form-item label="知识库名称" required>
                <el-input v-model="createForm.name" placeholder="请输入知识库名称" maxlength="255" show-word-limit />
            </el-form-item>

            <el-form-item label="描述">
                <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="可选，描述知识库的用途和特点"
                    maxlength="2000" show-word-limit />
            </el-form-item>

            <el-form-item label="向量模型" required>
                <el-select v-model="createForm.embeddingModelId" placeholder="请选择向量模型" class="w-full">
                    <template v-for="provider in embeddingProviders" :key="provider.id">
                        <!-- 分组标题（不可点击） -->
                        <el-option :label="provider.name" :value="''" disabled />
                        <!-- 模型选项 -->
                        <el-option v-for="model in provider.models" :key="model.id" :label="model.modelName"
                            :value="model.id" />
                    </template>
                </el-select>
            </el-form-item>

            <el-divider />

            <!-- 分块大小配置 -->
            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最大分块大小</span>
                </template>
                <el-input-number v-model="createForm.chunkMaxSize" :min="100" :max="5000" :step="100" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">重叠大小</span>
                </template>
                <el-input-number v-model="createForm.chunkOverlapSize" :min="0" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最小分块大小</span>
                </template>
                <el-input-number v-model="createForm.chunkMinSize" :min="10" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item label="可见性">
                <el-switch v-model="createForm.isPublic" />
                <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">公开的知识库可被其他人查看</span>
            </el-form-item>
        </el-form>

        <template #footer>
            <div class="flex justify-end gap-3">
                <el-button @click="showCreateModal = false">取消</el-button>
                <el-button type="primary" @click="handleCreate" :loading="store.loading">
                    创建
                </el-button>
            </div>
        </template>
    </el-dialog>

    <!-- 编辑知识库对话框 -->
    <el-dialog v-model="showEditModal" title="编辑知识库" width="600px" :close-on-click-modal="false">
        <el-form :model="editForm" label-width="140px" size="large">
            <el-form-item label="知识库名称" required>
                <el-input v-model="editForm.name" placeholder="请输入知识库名称" maxlength="255" show-word-limit />
            </el-form-item>

            <el-form-item label="描述">
                <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="可选，描述知识库的用途和特点"
                    maxlength="2000" show-word-limit />
            </el-form-item>

            <el-divider />

            <!-- 分块大小配置 -->
            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最大分块大小</span>
                </template>
                <el-input-number v-model="editForm.chunkMaxSize" :min="100" :max="5000" :step="100" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">重叠大小</span>
                </template>
                <el-input-number v-model="editForm.chunkOverlapSize" :min="0" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最小分块大小</span>
                </template>
                <el-input-number v-model="editForm.chunkMinSize" :min="10" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item label="可见性">
                <el-switch v-model="editForm.isPublic" />
                <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">公开的知识库可被其他人查看</span>
            </el-form-item>
        </el-form>

        <template #footer>
            <div class="flex justify-end gap-3">
                <el-button @click="showEditModal = false">取消</el-button>
                <el-button type="primary" @click="handleUpdate" :loading="store.loading">
                    保存
                </el-button>
            </div>
        </template>
    </el-dialog>

    <!-- 文件分块查看弹窗 -->
    <FileChunksViewer v-model="showFileChunksModal" :selected-file="selectedFile" />

    <!-- 知识库搜索对话框 -->
    <KBSearchDialog v-model="showSearchDialog" :knowledge-bases="store.knowledgeBases"
        :default-kb-id="store.activeKnowledgeBaseId" />

    <!-- 上传任务弹窗 -->
    <UploadTaskModal 
        v-model="showUploadTaskModal"
        :upload-tasks="uploadTasksList"
        @retry="handleRetryFile"
        @delete="handleDeleteFile"
    />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { Plus, Edit, Delete, Upload, MoreFilled, RefreshRight, Loading, Search, CircleCheck } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useFileUploadStore } from '@/stores/fileUpload'
import type { KnowledgeBase, KBFile } from '@/stores/knowledgeBase'
import type { UploadTask } from '@/stores/fileUpload'
import ScrollContainer from '@/components/ui/ScrollContainer.vue'
import SidebarLayout from '@/components/ui/SidebarLayout.vue'
import LeftBarIcon from './icons/LeftBarIcon.vue'
import { FileChunksViewer, KBFileItem, KBFileUploader, KBFileTree, KBSidebar, KBSearchDialog, UploadTaskModal } from './KnowledgeBasePage'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { usePopup } from '@/composables/usePopup'

// 初始化组合式函数
const { confirm, toast } = usePopup()
const store = useKnowledgeBaseStore()
const uploadStore = useFileUploadStore()
const route = useRoute()
const router = useRouter()

// ========== 状态 ==========
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showUploadModal = ref(false)
const showFileChunksModal = ref(false)  // 文件分块查看弹窗
const showSearchDialog = ref(false)  // 搜索对话框
const showUploadTaskModal = ref(false)  // 上传任务弹窗
const selectedFile = ref<KBFile | null>(null)  // 选中的文件
const searchKeyword = ref('')
const files = ref<KBFile[]>([])
const kbSidebarVisible = useStorage('kbSidebarVisible', true) // 知识库侧边栏可见状态,持久化到 localStorage
const embeddingModels = ref<any[]>([]) // 嵌入模型列表
const embeddingProviders = ref<any[]>([]) // 嵌入模型供应商列表

// 上传任务列表(独立于文件列表)
const uploadTasksList = ref<KBFile[]>([])

// 上传任务轮询定时器
let uploadTaskPollingTimer: number | null = null

// 自动关闭弹窗定时器
let autoCloseModalTimer: number | null = null

// 无限滚动相关状态
const fileListContainer = ref<any>(null) // 文件列表容器引用（ScrollContainer 组件）
const fileTreeRef = ref<any>(null) // 文件树组件引用
const currentPage = ref(1) // 当前页码
const pageSize = ref(30) // 每页数量
const totalFiles = ref(0) // 文件总数
const isLoadingMore = ref(false) // 是否正在加载更多
const scrollThreshold = 50 // 滚动触发阈值(像素)
let scrollTimer: number | null = null // 滚动防抖定时器

// ========== 创建表单 ==========
const createForm = reactive({
    name: '',
    description: '',
    embeddingModelId: '',
    chunkMaxSize: 1000,
    chunkOverlapSize: 100,
    chunkMinSize: 50,
    isPublic: false
})

// ========== 编辑表单 ==========
const editForm = reactive({
    id: '',
    name: '',
    description: '',
    chunkMaxSize: 1000,
    chunkOverlapSize: 100,
    chunkMinSize: 50,
    isPublic: false
})

// ========== 计算属性 ==========
/**
 * 当前选中的知识库对象
 */
const currentKB = computed(() => {
    if (!store.activeKnowledgeBaseId) return null
    return store.knowledgeBases.find(kb => kb.id === store.activeKnowledgeBaseId) || null
})

/**
 * 是否还有更多文件可加载
 */
const hasMoreFiles = computed(() => {
    return files.value.length < totalFiles.value
})

// ========== Methods ==========

/**
 * 加载嵌入模型列表
 */
const loadEmbeddingModels = async () => {
    try {
        const { apiService } = await import('@/services/ApiService')
        const response = await apiService.fetchModels()

        // 只保留 embedding 类型的模型
        embeddingModels.value = []
        embeddingProviders.value = response.items
            .filter((provider: any) => {
                const embeddingModels_ = provider.models.filter(
                    (m: any) => m.modelType === 'embedding'
                )
                return embeddingModels_.length > 0
            })
            .map((provider: any) => ({
                id: provider.id,
                name: provider.name,
                models: provider.models.filter((m: any) => m.modelType === 'embedding')
            }))
    } catch (error: any) {
        console.error('获取嵌入模型列表失败:', error)
    }
}

/**
 * 选择知识库并加载文件列表
 */
async function handleSelectKB(kb: KnowledgeBase) {
    store.setActiveKnowledgeBase(kb.id)

    // 更新路由（使用 params）
    router.replace({ name: 'KnowledgeBase', params: { id: kb.id } })

    try {
        // 选择新知识库时重置分页
        await refreshFileList(true)
        // toast.success(`已选择：${kb.name}`)
    } catch (error) {
        console.error('加载文件列表失败:', error)
        toast.error('加载文件列表失败')
    }
}

/**
 * 创建知识库
 */
async function handleCreate() {
    // 验证必填字段
    if (!createForm.name.trim()) {
        toast.warning('请输入知识库名称')
        return
    }

    if (!createForm.embeddingModelId) {
        toast.warning('请选择向量模型')
        return
    }

    try {
        const newKb = await store.createKnowledgeBase({
            name: createForm.name,
            description: createForm.description || undefined,
            embeddingModelId: createForm.embeddingModelId,
            chunkMaxSize: createForm.chunkMaxSize,
            chunkOverlapSize: createForm.chunkOverlapSize,
            chunkMinSize: createForm.chunkMinSize,
            isPublic: createForm.isPublic
        })

        toast.success('创建成功')
        showCreateModal.value = false

        // 重置表单
        resetForm()

        // 刷新列表
        await store.fetchKnowledgeBases()

        // 关键修改：创建成功后自动选中新建的知识库
        const createdKb = store.knowledgeBases.find(kb => kb.id === newKb.id)
        if (createdKb) {
            await handleSelectKB(createdKb)
        }
    } catch (error: any) {
        console.error('创建失败:', error)
        toast.error(error.response?.data?.detail || '创建失败')
    }
}

/**
 * 编辑知识库
 */
function handleEdit(kb: KnowledgeBase) {
    Object.assign(editForm, {
        id: kb.id,
        name: kb.name,
        description: kb.description || '',
        chunkMaxSize: kb.chunkMaxSize,
        chunkOverlapSize: kb.chunkOverlapSize,
        chunkMinSize: kb.chunkMinSize,
        isPublic: kb.isPublic
    })
    showEditModal.value = true
}

/**
 * 更新知识库
 */
async function handleUpdate() {
    if (!editForm.name.trim()) {
        toast.warning('请输入知识库名称')
        return
    }

    try {
        await store.updateKnowledgeBase(editForm.id, {
            name: editForm.name,
            description: editForm.description,
            chunkMaxSize: editForm.chunkMaxSize,
            chunkOverlapSize: editForm.chunkOverlapSize,
            chunkMinSize: editForm.chunkMinSize,
            isPublic: editForm.isPublic
        })

        toast.success('保存成功')
        showEditModal.value = false

        // 刷新列表
        await store.fetchKnowledgeBases()
    } catch (error: any) {
        console.error('更新失败:', error)
        toast.error(error.response?.data?.detail || '更新失败')
    }
}

/**
 * 删除知识库
 */
async function handleDelete(kb: KnowledgeBase) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要删除知识库"${kb.name}"吗？此操作不可恢复。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        // 记录当前删除的知识库 ID 和索引
        const deletedKbId = kb.id
        const currentIndex = store.knowledgeBases.findIndex(k => k.id === deletedKbId)

        // 执行删除
        await store.deleteKnowledgeBase(kb.id)
        toast.success('删除成功')

        // 删除后处理：自动选中下一个知识库
        handleAfterDelete(deletedKbId, currentIndex)
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('删除失败:', error)
            toast.error(error.response?.data?.detail || '删除失败')
        }
    }
}

/**
 * 删除知识库后的自动选中逻辑
 */
function handleAfterDelete(deletedKbId: string, currentIndex: number) {
    // 获取删除后的列表（从 store 中获取最新列表）
    const remainingKBs = store.knowledgeBases.filter(kb => kb.id !== deletedKbId)

    if (remainingKBs.length === 0) {
        // 如果列表为空，清空选中状态
        store.setActiveKnowledgeBase(null)
        router.replace({ name: 'KnowledgeBase' })
        return
    }

    // 计算应该选中的索引
    let nextIndex = currentIndex

    // 如果删除的是最后一个元素，则选中前一个
    if (currentIndex >= remainingKBs.length) {
        nextIndex = remainingKBs.length - 1
    }

    // 确保索引有效
    if (nextIndex < 0) {
        nextIndex = 0
    }

    // 选中下一个知识库
    const nextKb = remainingKBs[nextIndex]
    if (nextKb) {
        handleSelectKB(nextKb)
    }
}

/**
 * 重置创建表单
 */
function resetForm() {
    createForm.name = ''
    createForm.description = ''
    createForm.embeddingModelId = ''
    createForm.chunkMaxSize = 1000
    createForm.chunkOverlapSize = 100
    createForm.chunkMinSize = 50
    createForm.isPublic = false
}

/**
 * 处理上传完成事件
 */
function handleUploadComplete(task: UploadTask) {
    console.log('文件上传完成，刷新列表:', task.fileName)
    // 延迟刷新列表，确保后台任务已创建记录
    setTimeout(refreshFileList, 500)
}


/**
 * 处理滚动事件（带防抖）
 */
function handleScroll(event: Event) {
    // 清除之前的定时器
    if (scrollTimer !== null) {
        clearTimeout(scrollTimer)
    }

    // 设置防抖，300ms 后执行
    scrollTimer = window.setTimeout(() => {
        checkScrollPosition()
    }, 300)
}

/**
 * 检查滚动位置，判断是否需要加载更多
 */
function checkScrollPosition() {
    if (!fileListContainer.value || isLoadingMore.value || !hasMoreFiles.value) {
        return
    }

    const element = fileListContainer.value.getScrollElement?.() || fileListContainer.value
    const { scrollTop, scrollHeight, clientHeight } = element
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    // 如果距离底部小于阈值，则加载更多
    if (distanceToBottom <= scrollThreshold) {
        loadMoreFiles()
    }
}

/**
 * 加载更多文件
 */
async function loadMoreFiles() {
    if (!store.activeKnowledgeBaseId || isLoadingMore.value || !hasMoreFiles.value) {
        return
    }

    isLoadingMore.value = true

    try {
        // 计算下一页的 skip 值
        const skip = files.value.length

        // 从数据库加载下一页文件记录
        const response = await store.fetchFiles(store.activeKnowledgeBaseId, skip, pageSize.value)
        const newDbFiles = (response.items || []) as KBFile[]

        // 更新总数
        totalFiles.value = response.total || 0

        if (newDbFiles.length > 0) {
            // 将新文件转换为统一格式并添加到列表
            const newFiles = newDbFiles.map((file: any) => ({
                id: file.id,
                fileId: file.id,
                knowledgeBaseId: file.knowledgeBaseId,
                fileName: file.fileName,
                displayName: file.displayName,
                fileSize: file.fileSize,
                fileType: file.fileType,
                fileExtension: file.fileExtension,
                contentHash: file.contentHash,
                relativePath: file.relativePath,
                parentFolderId: file.parentFolderId,
                isDirectory: file.isDirectory,
                processingStatus: file.processingStatus,
                progressPercentage: file.progressPercentage,
                currentStep: file.currentStep,
                errorMessage: file.errorMessage,
                uploadedAt: file.uploadedAt,
                processedAt: file.processedAt,
                totalChunks: file.totalChunks,
                totalTokens: file.totalTokens,
                isTempTask: false
            }))

            files.value = [...files.value, ...newFiles]

            // 页码递增
            currentPage.value++
        }
    } catch (error) {
        console.error('加载更多文件失败:', error)
        toast.error('加载更多文件失败')
    } finally {
        isLoadingMore.value = false
    }
}

/**
 * 重置分页状态
 */
function resetPaginationState() {
    currentPage.value = 1
    totalFiles.value = 0
    isLoadingMore.value = false
    files.value = [] // 清空文件列表
}

/**
 * 处理上传完成事件
 */
async function handleRetryFile(file: KBFile) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要重新处理文件"${file.displayName}"吗？这将重新启动后台处理任务。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        if (!store.activeKnowledgeBaseId) return

        // 调用后端 API 重新处理文件
        const { apiService } = await import('@/services/ApiService')
        await apiService.retryKBFile(store.activeKnowledgeBaseId, file.id)

        toast.success('已开始重新处理文件')

        // 关键修复：使用响应式方式更新文件状态（替换整个对象）
        const index = files.value.findIndex(f => f.id === file.id)
        if (index !== -1) {
            const updatedFile = {
                ...files.value[index],
                processingStatus: 'pending',
                progressPercentage: 0,
                currentStep: '等待重新处理...',
                errorMessage: null
            }
            // 替换整个对象以触发响应式更新
            files.value.splice(index, 1, updatedFile)
            
            console.log(`[DEBUG] 文件状态已更新为 pending: ${file.displayName}`)
        }

        // 启动对该文件的轮询
        startPollingForProcessingFiles()
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('重新处理失败:', error)
            toast.error(error.response?.data?.detail || error.message || '重新处理失败')
        }
    }
}

/**
 * 查看文件详情
 */
function handleViewFile(file: KBFile) {
    // 仅对已完成处理的文件启用查看功能
    if (file.processingStatus !== 'completed') {
        toast.warning('文件尚未处理完成，无法查看分块内容')
        return
    }

    // 打开分块查看弹窗
    showFileChunksModal.value = true
    selectedFile.value = file
}

/**
 * 删除文件
 */
async function handleDeleteFile(file: KBFile) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要删除文件“${file.displayName}”吗？此操作不可恢复。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        if (!store.activeKnowledgeBaseId) return

        await store.deleteFile(store.activeKnowledgeBaseId, file.id)
        toast.success('删除成功')

        // 关键优化：从本地列表中移除，避免重新请求后端数据导致闪烁
        const index = files.value.findIndex(f => f.id === file.id)
        if (index !== -1) {
            files.value.splice(index, 1)
            totalFiles.value--

            // 如果当前页为空且不是第一页，加载上一页的数据
            if (files.value.length === 0 && currentPage.value > 1) {
                currentPage.value--
                await loadPreviousPage()
            }
        }
        
        // 关键优化:通知 KBFileTree 从本地列表中移除文件,避免重建 DOM 树
        if (fileTreeRef.value && fileTreeRef.value.removeFileLocally) {
            console.log('[DEBUG] 删除文件后本地更新文件树')
            fileTreeRef.value.removeFileLocally(file.id)
        }
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('删除失败:', error)
            toast.error(error.response?.data?.detail || '删除失败')
        }
    }
}

/**
 * 加载上一页数据（用于删除文件后保持分页连续性）
 */
async function loadPreviousPage() {
    if (currentPage.value <= 1) return

    try {
        const skip = (currentPage.value - 1) * pageSize.value
        const response = await store.fetchFiles(store.activeKnowledgeBaseId!, skip, pageSize.value)
        const dbFiles = (response.items || []) as KBFile[]

        if (dbFiles.length > 0) {
            const prevFiles = dbFiles.map((file: any) => ({
                id: file.id,
                fileId: file.id,
                knowledgeBaseId: file.knowledgeBaseId,
                fileName: file.fileName,
                displayName: file.displayName,
                fileSize: file.fileSize,
                fileType: file.fileType,
                fileExtension: file.fileExtension,
                contentHash: file.contentHash,
                relativePath: file.relativePath,
                parentFolderId: file.parentFolderId,
                isDirectory: file.isDirectory,
                processingStatus: file.processingStatus,
                progressPercentage: file.progressPercentage,
                currentStep: file.currentStep,
                errorMessage: file.errorMessage,
                uploadedAt: file.uploadedAt,
                processedAt: file.processedAt,
                totalChunks: file.totalChunks,
                totalTokens: file.totalTokens,
                isTempTask: false
            }))
            files.value = prevFiles
        }
    } catch (error) {
        console.error('加载上一页失败:', error)
        // 失败时回退到第一页
        await refreshFileList(true)
    }
}

// ========== Lifecycle ==========
onMounted(async () => {
    await loadEmbeddingModels() // 加载嵌入模型列表
    await store.fetchKnowledgeBases()

    // 从路由参数读取知识库 ID
    const kbIdFromRoute = route.params.id as string

    if (kbIdFromRoute && store.knowledgeBases.length > 0) {
        // 如果路由中有 ID,选择对应的知识库
        const kb = store.knowledgeBases.find(k => k.id === kbIdFromRoute)
        if (kb) {
            await handleSelectKB(kb)
            // refreshFileList 已在 handleSelectKB 中调用,无需重复
        } else {
            // 如果 ID 无效,选择第一个
            await handleSelectKB(store.knowledgeBases[0])
        }
    } else if (store.knowledgeBases.length > 0) {
        // 默认选中第一个知识库
        await handleSelectKB(store.knowledgeBases[0])
    }

    // 启动上传任务轮询
    startUploadTaskPolling()
})

// 关键修复:组件销毁时清理轮询定时器和滚动定时器,防止内存泄漏
onUnmounted(() => {
    console.log('[DEBUG] KnowledgeBasePage 组件销毁,清理定时器')
    store.stopAllFileProcessingPolling()
    stopUploadTaskPolling() // 停止上传任务轮询

    // 清理滚动防抖定时器
    if (scrollTimer !== null) {
        clearTimeout(scrollTimer)
        scrollTimer = null
    }
})

/**
 * 启动上传任务轮询
 */
function startUploadTaskPolling() {
    // 清除旧的定时器
    if (uploadTaskPollingTimer !== null) {
        clearInterval(uploadTaskPollingTimer)
    }

    // 每 500ms 刷新一次上传任务列表
    uploadTaskPollingTimer = window.setInterval(() => {
        refreshUploadTasksList()
    }, 500)

    console.log('[DEBUG] 启动上传任务轮询')
}

/**
 * 停止上传任务轮询
 */
function stopUploadTaskPolling() {
    if (uploadTaskPollingTimer !== null) {
        clearInterval(uploadTaskPollingTimer)
        uploadTaskPollingTimer = null
        console.log('[DEBUG] 停止上传任务轮询')
    }
}

/**
 * 防抖刷新文件列表(使用 VueUse)
 */
const debouncedRefreshFileList = useDebounceFn(async () => {
    console.log('[DEBUG] 检测到上传任务完成,刷新文件列表')
    try {
        await refreshFileList()
        
        // 关键:通知 KBFileTree 重新加载当前目录
        if (fileTreeRef.value && fileTreeRef.value.forceReload) {
            console.log('[DEBUG] 触发 KBFileTree 重新加载')
            await fileTreeRef.value.forceReload()
        }
    } catch (error) {
        console.error('防抖刷新文件列表失败:', error)
    }
}, 500)  // 500ms 防抖延迟

/**
 * 刷新上传任务列表
 */
function refreshUploadTasksList() {
    if (!store.activeKnowledgeBaseId) return

    // 从 fileUpload store 获取当前知识库的上传任务
    const tasks = uploadStore.getTasksByKB(store.activeKnowledgeBaseId)

    console.log(`[DEBUG] refreshUploadTasksList: store中有 ${tasks.length} 个任务`)
    console.log(`[DEBUG] 任务状态分布:`, tasks.reduce((acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1
        return acc
    }, {} as Record<string, number>))

    // 关键修复:上传完成(uploaded)的任务应该从上传弹窗移除,显示到文件列表
    // 只保留正在上传或排队中的任务: queued, uploading, failed
    const displayTasks = tasks.filter(task =>
        task.status !== 'uploaded'
    )

    console.log(`[DEBUG] 过滤后显示 ${displayTasks.length} 个任务`)

    // 如果任务数量发生变化,说明有任务完成了,需要刷新文件列表
    // 检查是否有任务从 uploading/queued 变为 uploaded
    const hasNewlyCompleted = tasks.some(task =>
        task.status === 'uploaded' &&
        !uploadTasksList.value.find(t => t.id === task.id && t.processingStatus === 'uploaded')
    )

    // 关键修复:使用 VueUse 的防抖函数,避免频繁刷新文件列表
    if (hasNewlyCompleted) {
        debouncedRefreshFileList()
    }

    // 关键修复:只有当任务列表真正变化时才更新,避免不必要的响应式触发
    const oldLength = uploadTasksList.value.length
    const newLength = displayTasks.length
    const hasContentChange = oldLength !== newLength || 
        displayTasks.some((task, index) => task.id !== uploadTasksList.value[index]?.id)
    
    if (hasContentChange) {
        // 转换为 KBFile 格式用于显示
        uploadTasksList.value = displayTasks.map(task => uploadStore.taskToFileRecord(task))
        console.log(`[DEBUG] 刷新上传任务列表: ${uploadTasksList.value.length} 个任务`)
    }
    
    // 关键修复:先清除已完成的任务
    autoRemoveCompletedTasks(tasks)
    
    // 关键修复:清除任务后,重新从 store 获取最新列表来判断是否关闭弹窗
    const remainingTasks = uploadStore.getTasksByKB(store.activeKnowledgeBaseId)
    checkAndAutoCloseModal(remainingTasks)
}

/**
 * 自动移除已完成的任务
 * @param allTasks 所有上传任务列表(UploadTask[])
 */
function autoRemoveCompletedTasks(allTasks: any[]) {
    const completedTaskIds = allTasks
        .filter(task => task.status === 'uploaded' || task.status === 'failed')
        .map(task => task.id)
    
    // 立即从 uploadStore 中清除上传完成或失败的任务
    completedTaskIds.forEach(taskId => {
        uploadStore.clearUploadTask(taskId)
        console.log(`[DEBUG] 立即移除任务: ${taskId}`)
    })
}

/**
 * 检查并自动关闭弹窗
 * @param allTasks 所有上传任务列表(UploadTask[])
 */
function checkAndAutoCloseModal(allTasks: any[]) {
    console.log(`[DEBUG] checkAndAutoCloseModal: 收到 ${allTasks.length} 个任务`)
    console.log(`[DEBUG] 任务状态:`, allTasks.map(t => ({ id: t.id.substring(0, 8), status: t.status })))
    
    // 检查是否有活跃任务（排除 uploaded 和 failed）
    const hasActiveTasks = allTasks.some(task => 
        task.status !== 'uploaded' && 
        task.status !== 'failed'
    )
    
    console.log(`[DEBUG] hasActiveTasks: ${hasActiveTasks}, showUploadTaskModal: ${showUploadTaskModal.value}, autoCloseModalTimer: ${autoCloseModalTimer}`)
    
    // 如果没有活跃任务且弹窗正在显示，则自动关闭
    if (!hasActiveTasks && showUploadTaskModal.value) {
        // 关键修复:只在定时器不存在时才设置,避免被轮询不断重置
        if (autoCloseModalTimer === null) {
            console.log('[DEBUG] 满足自动关闭条件，1秒后关闭弹窗')
            autoCloseModalTimer = window.setTimeout(() => {
                showUploadTaskModal.value = false
                autoCloseModalTimer = null
                console.log('[DEBUG] 所有任务完成，自动关闭弹窗')
            }, 1000)
        } else {
            console.log('[DEBUG] 已有自动关闭定时器，跳过重置')
        }
    } else {
        // 如果还有活跃任务，清除定时器
        if (autoCloseModalTimer !== null) {
            clearTimeout(autoCloseModalTimer)
            autoCloseModalTimer = null
            console.log('[DEBUG] 检测到新的活跃任务，清除自动关闭定时器')
        }
    }
}

/**
 * 启动文件处理轮询
 */
function startPollingForProcessingFiles() {
    if (!store.activeKnowledgeBaseId) return

    // 先停止所有现有的轮询
    store.stopAllFileProcessingPolling()

    // 对每个 processing/pending 状态的文件启动轮询
    const processingFileIds = files.value
        .filter(f => f.processingStatus === 'processing' || f.processingStatus === 'pending')
        .map(f => f.fileId)

    console.log(`[DEBUG] 当前文件列表总数: ${files.value.length}`)
    console.log(`[DEBUG] 需要轮询的文件数: ${processingFileIds.length}`)
    console.log(`[DEBUG] 需要轮询的文件ID:`, processingFileIds)

    // 批量启动轮询(多个文件共享一个定时器)
    if (processingFileIds.length > 0) {
        console.log(`[DEBUG] 批量启动轮询:${processingFileIds.length} 个文件`)
        store.startFileProcessingPolling(
            store.activeKnowledgeBaseId,
            processingFileIds,
            (updatedFile: KBFile) => {
                // 更新本地列表中的文件状态（响应式更新）
                const index = files.value.findIndex((f) => f.id === updatedFile.id)
                if (index !== -1) {
                    // 使用 Vue 的响应式方式更新整个对象（替换而非修改属性）
                    const currentFile = files.value[index]
                    const updatedFileObj = {
                        ...currentFile,
                        processingStatus: updatedFile.processingStatus,
                        progressPercentage: updatedFile.progressPercentage,
                        currentStep: updatedFile.currentStep,
                        errorMessage: updatedFile.errorMessage,
                        totalChunks: updatedFile.totalChunks || currentFile.totalChunks,
                        totalTokens: updatedFile.totalTokens || currentFile.totalTokens
                    }
                    // 替换整个对象以触发响应式更新
                    files.value.splice(index, 1, updatedFileObj)

                    console.log(`[DEBUG] 文件状态更新: ${currentFile.displayName} -> ${updatedFile.processingStatus}`)
                } else {
                    console.warn(`[DEBUG] 未找到文件 ${updatedFile.id},无法更新状态`)
                }
            }
        )
    } else {
        console.log('[DEBUG] 没有需要轮询的文件')
        console.log('[DEBUG] 当前文件列表状态:', files.value.map(f => ({
            id: f.id,
            name: f.displayName,
            status: f.processingStatus
        })))
    }
}

/**
 * 刷新文件列表并启动未完成文件的轮询
 * @param shouldResetPagination 是否重置分页状态（首次加载时为 true，增量刷新时为 false）
 */
async function refreshFileList(shouldResetPagination: boolean = true) {
    if (!store.activeKnowledgeBaseId) return

    try {
        // 仅在需要时重置分页状态
        if (shouldResetPagination) {
            resetPaginationState()
        }

        // 1. 从数据库加载第一页文件记录
        const response = await store.fetchFiles(store.activeKnowledgeBaseId, 0, pageSize.value)
        const dbFiles = (response.items || []) as KBFile[]

        // 更新总数
        totalFiles.value = response.total || 0

        console.log(`[DEBUG] refreshFileList: 从数据库加载了 ${dbFiles.length} 个文件,总数:${totalFiles.value}`)

        // 2. 仅保存数据库记录(不再合并上传任务)
        files.value = dbFiles.map((file: any) => ({
            id: file.id,
            fileId: file.id,
            knowledgeBaseId: file.knowledgeBaseId,
            fileName: file.fileName,
            displayName: file.displayName,
            fileSize: file.fileSize,
            fileType: file.fileType,
            fileExtension: file.fileExtension,
            contentHash: file.contentHash,
            relativePath: file.relativePath,
            parentFolderId: file.parentFolderId,
            isDirectory: file.isDirectory,
            processingStatus: file.processingStatus,
            progressPercentage: file.progressPercentage,
            currentStep: file.currentStep,
            errorMessage: file.errorMessage,
            uploadedAt: file.uploadedAt,
            processedAt: file.processedAt,
            totalChunks: file.totalChunks,
            totalTokens: file.totalTokens,
            isTempTask: false
        }))

        console.log(`[DEBUG] refreshFileList: 文件列表共 ${files.value.length} 个文件`)

        // 3. 关键修复:移除 refreshUploadTasksList() 调用
        // 上传任务有自己独立的轮询(每500ms),不需要在这里重复调用
        // 否则会导致: refreshUploadTasksList -> refreshFileList -> refreshUploadTasksList 无限循环
        // refreshUploadTasksList()  // ❌ 已移除

        // 4. 每次刷新文件列表时,重新启动轮询(确保轮询列表与当前文件列表一致)
        startPollingForProcessingFiles()
    } catch (error) {
        console.error('加载文件列表失败:', error)
    }
}

// 监听路由变化，处理 URL 中的 id 参数
watch(() => route.params.id, async (newKbId: string | string[] | undefined) => {
    // 如果是数组，取第一个值；如果是字符串直接使用；否则为 undefined
    const kbId = Array.isArray(newKbId) ? newKbId[0] : newKbId

    if (kbId && store.knowledgeBases.length > 0) {
        const kb = store.knowledgeBases.find(k => k.id === kbId)
        if (kb && store.activeKnowledgeBaseId !== kb.id) {
            await handleSelectKB(kb)
        }
    }
})
</script>

<style scoped>
/* 空状态样式 */
.empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
}
</style>
