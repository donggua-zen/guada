<!-- components/KnowledgeBasePage.vue -->
<template>
    <SidebarLayout v-model:sidebar-visible="kbSidebarVisible" :sidebar-position="'left'" :z-index="50"
        :show-toggle-button="true">
        <!-- 左侧侧边栏：知识库列表 -->
        <template #sidebar>
            <KBSidebar
                :knowledge-bases="store.knowledgeBases"
                :active-id="store.activeKnowledgeBaseId"
                v-model:search-keyword="searchKeyword"
                @select="handleSelectKB"
                @create="showCreateModal = true"
                @edit="handleEdit"
                @delete="handleDelete"
            />
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
                                    <el-icon><Search /></el-icon>
                                    搜索
                                </el-button>
                                <el-button type="primary" @click="showUploadModal = true">
                                    <el-icon>
                                        <Upload />
                                    </el-icon>
                                    上传文件
                                </el-button>
                            </div>
                        </div>
                    </div>

                    <!-- 统一文件列表（包含上传任务和数据库记录） -->
                    <div ref="fileListContainer" class="flex-1 overflow-y-auto p-4" @scroll="handleScroll">
                        <!-- 上传区域 -->
                        <div class="mb-6">
                            <el-upload ref="uploadRef" drag :auto-upload="false" :on-change="handleFileChange"
                                :limit="1000" :show-file-list="false" multiple
                                accept=".txt,.md,.pdf,.docx,.py,.js,.ts,.java,.cpp,.c,.go,.rs,.json,.xml,.yaml,.yml,.csv,.html,.css"
                                class="w-full">
                                <i class="iconfont icon-upload text-4xl text-gray-400"></i>
                                <div class="el-upload__text">
                                    拖拽文件到此处或<em>点击上传</em>
                                </div>
                                <template #tip>
                                    <div class="el-upload__tip text-sm text-gray-500">
                                        支持格式:txt, md, pdf, docx, 代码文件等，单个文件最大 50MB
                                    </div>
                                </template>
                            </el-upload>
                        </div>

                        <!-- 文件列表 -->
                        <div v-if="files.length > 0" class="grid gap-3">
                            <KBFileItem 
                                v-for="file in files" 
                                :key="file.id"
                                :file="file"
                                :is-temp-task="file.isTempTask"
                                @view="handleViewFile"
                                @retry="handleRetryFile"
                                @delete="handleDeleteFile"
                            />
                        </div>

                        <!-- 加载更多提示 -->
                        <div v-if="files.length > 0" class="mt-4 text-center">
                            <div v-if="isLoadingMore" class="text-sm text-gray-500 dark:text-gray-400 py-2">
                                <el-icon class="animate-spin mr-2">
                                    <Loading />
                                </el-icon>
                                加载中...
                            </div>
                            <div v-else-if="hasMoreFiles" class="text-sm text-gray-400 dark:text-gray-500 py-2 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300"
                                @click="loadMoreFiles">
                                点击加载更多
                            </div>
                            <div v-else-if="totalFiles > pageSize" class="text-sm text-gray-400 dark:text-gray-500 py-2">
                                没有更多了
                            </div>
                        </div>

                        <!-- 空状态 -->
                        <div v-else-if="!store.loading" class="mt-6">
                            <div
                                class="empty-state text-center text-gray-500 flex flex-col items-center justify-center py-12">
                                <div class="empty-state-icon mb-3 text-gray-300">
                                    <el-icon size="48">
                                        <Upload />
                                    </el-icon>
                                </div>
                                <div class="empty-state-title text-sm font-medium mb-1">
                                    暂无文件
                                </div>
                                <div class="empty-state-description text-xs text-gray-400 mb-3">
                                    点击上方按钮或拖拽文件上传
                                </div>
                                <el-button type="primary" @click="showUploadModal = true">上传第一个文件</el-button>
                            </div>
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
                <el-select v-model="createForm.embedding_model_id" placeholder="请选择向量模型" class="w-full">
                    <template v-for="provider in embeddingProviders" :key="provider.id">
                        <!-- 分组标题（不可点击） -->
                        <el-option :label="provider.name" :value="''" disabled />
                        <!-- 模型选项 -->
                        <el-option v-for="model in provider.models" :key="model.id" :label="model.model_name"
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
                <el-input-number v-model="createForm.chunk_max_size" :min="100" :max="5000" :step="100"
                    class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">重叠大小</span>
                </template>
                <el-input-number v-model="createForm.chunk_overlap_size" :min="0" :max="500" :step="10"
                    class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最小分块大小</span>
                </template>
                <el-input-number v-model="createForm.chunk_min_size" :min="10" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item label="可见性">
                <el-switch v-model="createForm.is_public" />
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
                <el-input-number v-model="editForm.chunk_max_size" :min="100" :max="5000" :step="100" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">重叠大小</span>
                </template>
                <el-input-number v-model="editForm.chunk_overlap_size" :min="0" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item>
                <template #label>
                    <span class="font-medium text-gray-700 dark:text-gray-300">最小分块大小</span>
                </template>
                <el-input-number v-model="editForm.chunk_min_size" :min="10" :max="500" :step="10" class="w-full" />
            </el-form-item>

            <el-form-item label="可见性">
                <el-switch v-model="editForm.is_public" />
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
    <FileChunksViewer 
        v-model="showFileChunksModal" 
        :selected-file="selectedFile"
    />

    <!-- 知识库搜索对话框 -->
    <KBSearchDialog
        v-model="showSearchDialog"
        :knowledge-bases="store.knowledgeBases"
        :default-kb-id="store.activeKnowledgeBaseId"
    />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus'
import { Plus, Edit, Delete, Upload, MoreFilled, RefreshRight, Loading, Search } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useFileUploadStore } from '@/stores/fileUpload'
import type { KnowledgeBase, KBFile } from '@/stores/knowledgeBase'
import type { UploadTask, UnifiedFileRecord } from '@/stores/fileUpload'
import ScrollContainer from '@/components/ui/ScrollContainer.vue'
import SidebarLayout from '@/components/ui/SidebarLayout.vue'
import LeftBarIcon from './icons/LeftBarIcon.vue'
import { FileChunksViewer, KBFileItem, KBSidebar, KBSearchDialog } from './KnowledgeBasePage'
import { useStorage } from '@vueuse/core'
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
const selectedFile = ref<UnifiedFileRecord | null>(null)  // 选中的文件
const searchKeyword = ref('')
const files = ref<UnifiedFileRecord[]>([])
const kbSidebarVisible = useStorage('kbSidebarVisible', true) // 知识库侧边栏可见状态，持久化到 localStorage
const embeddingModels = ref<any[]>([]) // 嵌入模型列表
const embeddingProviders = ref<any[]>([]) // 嵌入模型供应商列表

// 无限滚动相关状态
const fileListContainer = ref<HTMLElement | null>(null) // 文件列表容器引用
const currentPage = ref(1) // 当前页码
const pageSize = ref(30) // 每页数量
const totalFiles = ref(0) // 文件总数
const isLoadingMore = ref(false) // 是否正在加载更多
const scrollThreshold = 50 // 滚动触发阈值（像素）
let scrollTimer: number | null = null // 滚动防抖定时器

// ========== 创建表单 ==========
const createForm = reactive({
    name: '',
    description: '',
    embedding_model_id: '',
    chunk_max_size: 1000,
    chunk_overlap_size: 100,
    chunk_min_size: 50,
    is_public: false
})

// ========== 编辑表单 ==========
const editForm = reactive({
    id: '',
    name: '',
    description: '',
    chunk_max_size: 1000,
    chunk_overlap_size: 100,
    chunk_min_size: 50,
    is_public: false
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
    // 只计算非临时任务的文件数量
    const dbFilesCount = files.value.filter(f => !f.isTempTask).length
    return dbFilesCount < totalFiles.value
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
                    (m: any) => m.model_type === 'embedding'
                )
                return embeddingModels_.length > 0
            })
            .map((provider: any) => ({
                id: provider.id,
                name: provider.name,
                models: provider.models.filter((m: any) => m.model_type === 'embedding')
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
        await refreshFileList()
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

    if (!createForm.embedding_model_id) {
        toast.warning('请选择向量模型')
        return
    }

    try {
        const newKb = await store.createKnowledgeBase({
            name: createForm.name,
            description: createForm.description || undefined,
            embedding_model_id: createForm.embedding_model_id,
            chunk_max_size: createForm.chunk_max_size,
            chunk_overlap_size: createForm.chunk_overlap_size,
            chunk_min_size: createForm.chunk_min_size,
            is_public: createForm.is_public
        })

        toast.success('创建成功')
        showCreateModal.value = false

        // 重置表单
        resetForm()

        // 刷新列表
        await store.fetchKnowledgeBases()
        
        // ✅ 关键修改：创建成功后自动选中新建的知识库
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
        chunk_max_size: kb.chunk_max_size,
        chunk_overlap_size: kb.chunk_overlap_size,
        chunk_min_size: kb.chunk_min_size,
        is_public: kb.is_public
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
            chunk_max_size: editForm.chunk_max_size,
            chunk_overlap_size: editForm.chunk_overlap_size,
            chunk_min_size: editForm.chunk_min_size,
            is_public: editForm.is_public
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
    createForm.embedding_model_id = ''
    createForm.chunk_max_size = 1000
    createForm.chunk_overlap_size = 100
    createForm.chunk_min_size = 50
    createForm.is_public = false
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
 * 处理文件选择
 */
async function handleFileChange(file: any) {
    const rawFile = file.raw
    if (!rawFile) return

    // 验证文件大小
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (rawFile.size > maxSize) {
        toast.error(`文件大小超过限制 (${maxSize / 1024 / 1024}MB)`)
        return
    }

    try {
        // ✅ 关键修复：先创建临时任务，确保能被 mergeFilesWithTasks 捕获
        const task = await uploadStore.uploadToKnowledgeBase(
            store.activeKnowledgeBaseId!,
            rawFile,
            (updatedTask: UploadTask) => {
                // ✅ 每次状态变化都触发响应式更新
                console.log(`[DEBUG] 上传进度更新：${updatedTask.fileName} - ${updatedTask.status} - ${updatedTask.progress}%`)

                // ✅ 关键修复 1: 找到对应的文件索引
                // 注意：updatedTask.fileId 可能是 'pending' 或真实 ID，都要匹配
                const index = files.value.findIndex(f => {
                    // 匹配临时任务（fileId 可能是 'pending' 或时间戳）
                    if (f.isTempTask) {
                        return f.id === updatedTask.id
                    }
                    // 匹配数据库记录（使用真实 ID）
                    return f.file_id === updatedTask.fileId
                })

                console.log(`[DEBUG] 查找索引：index=${index}, updatedTask.fileId=${updatedTask.fileId}, files.length=${files.value.length}`)

                if (index !== -1) {
                    console.log(`[DEBUG] 找到匹配项：files[${index}].id=${files.value[index].id}, files[${index}].file_id=${files.value[index].file_id}`)

                    // ✅ 关键修复 2: 使用 Vue 的响应式方式更新整个对象
                    // 不要直接修改属性，而是替换整个对象
                    files.value[index] = {
                        ...files.value[index],
                        processing_status: updatedTask.status,
                        progress_percentage: updatedTask.progress,
                        current_step: updatedTask.currentStep,
                        error_message: updatedTask.errorMessage
                    }

                    console.log(`[DEBUG] 更新了文件 ${updatedTask.fileName} 的状态：${updatedTask.status}`)

                    // ✅ 关键修复 3: 如果是完成或失败，延迟刷新整个列表确保数据一致
                    if (updatedTask.status === 'uploaded' || updatedTask.status === 'failed') {
                        console.log(`[DEBUG] 文件处理完成，刷新列表：${updatedTask.fileName}`)
                        setTimeout(() => refreshFileList(), 500)
                    }
                } else {
                    // ✅ 关键修复 4: 如果不在列表中，说明还没被 mergeFilesWithTasks 合并
                    // 此时不应该手动添加，因为 refreshFileList 会自动合并
                    // 只需要记录日志即可
                    console.log(`[DEBUG] 任务 ${updatedTask.fileName} 不在列表中，等待 refreshFileList 合并`)
                }
            }
        )

        // ✅ 上传开始后，立即刷新列表显示临时任务（mergeFilesWithTasks 会自动合并）
        console.log(`[DEBUG] 上传开始，刷新列表显示临时任务：${task.fileName}`)
        await refreshFileList()

        toast.success(`开始上传：${rawFile.name}`)
    } catch (error: any) {
        console.error('上传失败:', error)
        toast.error(error.response?.data?.detail || '上传失败')
    }
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

    const { scrollTop, scrollHeight, clientHeight } = fileListContainer.value
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
        // 计算下一页的 skip 值（只计算非临时任务的文件）
        const dbFilesCount = files.value.filter(f => !f.isTempTask).length
        const skip = dbFilesCount

        // 从数据库加载下一页文件记录
        const response = await store.fetchFiles(store.activeKnowledgeBaseId, skip, pageSize.value)
        const newDbFiles = (response.items || []) as KBFile[]

        // 更新总数
        totalFiles.value = response.total || 0

        if (newDbFiles.length > 0) {
            // 合并新文件到现有列表（保留临时任务）
            const existingDbFiles = files.value.filter(f => !f.isTempTask)
            
            // 合并：临时任务 + 已有数据库文件 + 新加载的数据库文件
            // mergeFilesWithTasks 会自动从 store 获取临时任务
            files.value = uploadStore.mergeFilesWithTasks(
                [...existingDbFiles, ...newDbFiles],
                store.activeKnowledgeBaseId
            )

            // 页码递增
            currentPage.value++

            console.log(`[DEBUG] 加载更多文件：${newDbFiles.length} 个，当前总共 ${files.value.length} 个`)
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
function resetPagination() {
    currentPage.value = 1
    totalFiles.value = 0
    isLoadingMore.value = false
}

/**
 * 处理上传完成事件
 */
async function handleRetryFile(file: UnifiedFileRecord) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要重新处理文件"${file.display_name}"吗？这将重新启动后台处理任务。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        if (!store.activeKnowledgeBaseId) return

        // 调用后端 API 重新处理文件
        const { apiService } = await import('@/services/ApiService')
        await apiService.retryKBFile(store.activeKnowledgeBaseId, file.id)

        toast.success('已开始重新处理文件')

        // 刷新文件列表
        await refreshFileList()
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('重新处理失败:', error)
            toast.error(error.response?.data?.detail || error.message || '重新处理失败')
        }
    }
}

/**
 * 格式化日期
 */
function formatDate(dateString: string | null): string {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
}

/**
 * 查看文件详情
 */
function handleViewFile(file: UnifiedFileRecord) {
    // 仅对已完成处理的文件启用查看功能
    if (file.processing_status !== 'completed') {
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
async function handleDeleteFile(file: UnifiedFileRecord) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要删除文件"${file.display_name}"吗？此操作不可恢复。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        if (!store.activeKnowledgeBaseId) return

        await store.deleteFile(store.activeKnowledgeBaseId, file.id)
        toast.success('删除成功')

        // 刷新列表
        await refreshFileList()
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('删除失败:', error)
            toast.error(error.response?.data?.detail || '删除失败')
        }
    }
}

// ========== Lifecycle ==========
onMounted(async () => {
    await loadEmbeddingModels() // 加载嵌入模型列表
    await store.fetchKnowledgeBases()

    // 从路由参数读取知识库 ID
    const kbIdFromRoute = route.params.id as string

    if (kbIdFromRoute && store.knowledgeBases.length > 0) {
        // 如果路由中有 ID，选择对应的知识库
        const kb = store.knowledgeBases.find(k => k.id === kbIdFromRoute)
        if (kb) {
            await handleSelectKB(kb)
            // ✅ refreshFileList 已在 handleSelectKB 中调用，无需重复
        } else {
            // 如果 ID 无效，选择第一个
            await handleSelectKB(store.knowledgeBases[0])
        }
    } else if (store.knowledgeBases.length > 0) {
        // 默认选中第一个知识库
        await handleSelectKB(store.knowledgeBases[0])
    }
})

// ✅ 关键修复：组件销毁时清理轮询定时器和滚动定时器，防止内存泄漏
onUnmounted(() => {
    console.log('[DEBUG] KnowledgeBasePage 组件销毁，清理定时器')
    store.stopAllFileProcessingPolling()
    
    // 清理滚动防抖定时器
    if (scrollTimer !== null) {
        clearTimeout(scrollTimer)
        scrollTimer = null
    }
})

/**
 * 刷新文件列表并启动未完成文件的轮询
 */
async function refreshFileList() {
    if (!store.activeKnowledgeBaseId) return

    try {
        // 重置分页状态
        resetPagination()

        // 1. 从数据库加载第一页文件记录
        const response = await store.fetchFiles(store.activeKnowledgeBaseId, 0, pageSize.value)
        const dbFiles = (response.items || []) as KBFile[]
        
        // 更新总数
        totalFiles.value = response.total || 0
        
        console.log(`[DEBUG] refreshFileList: 从数据库加载了 ${dbFiles.length} 个文件，总数：${totalFiles.value}`)

        // 2. 合并数据库记录和上传任务为统一列表
        files.value = uploadStore.mergeFilesWithTasks(dbFiles, store.activeKnowledgeBaseId)
        console.log(`[DEBUG] refreshFileList: 合并后的文件列表：${files.value.length} 个文件`)

        // 3. ✅ 关键修复：对每个 processing/failed 状态的文件启动轮询（使用 knowledgeBase store 的轮询）
        // 收集所有需要轮询的文件 ID
        const processingFileIds = files.value
            .filter(f => f.processing_status === 'processing' || f.processing_status === 'pending')
            .map(f => f.file_id)

        // 批量启动轮询（多个文件共享一个定时器）
        if (processingFileIds.length > 0) {
            console.log(`[DEBUG] 批量启动轮询：${processingFileIds.length} 个文件`)
            store.startFileProcessingPolling(
                store.activeKnowledgeBaseId,
                processingFileIds,
                (updatedFile: KBFile) => {
                    // 更新本地列表中的文件状态
                    const index = files.value.findIndex((f) => f.id === updatedFile.id)
                    if (index !== -1) {
                        const fileToUpdate = files.value[index]
                        fileToUpdate.processing_status = updatedFile.processing_status
                        fileToUpdate.progress_percentage = updatedFile.progress_percentage
                        fileToUpdate.current_step = updatedFile.current_step
                        fileToUpdate.error_message = updatedFile.error_message
                        fileToUpdate.total_chunks = updatedFile.total_chunks || undefined
                        fileToUpdate.total_tokens = updatedFile.total_tokens || undefined
                    }
                }
            )
        }
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
