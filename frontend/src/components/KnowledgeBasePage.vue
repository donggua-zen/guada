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
                                <el-button type="primary" @click="showUploadModal = true">
                                    <el-icon>
                                        <Upload />
                                    </el-icon>
                                    上传文件
                                </el-button>
                            </div>
                        </div>
                    </div>

                    <!-- 统一文件列表(包含上传任务和数据库记录) -->
                    <div class="flex-1 flex flex-col overflow-hidden">
                        <!-- Tab 切换栏 -->
                        <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                            <el-tabs v-model="activeTab" @tab-click="handleTabClick">
                                <el-tab-pane label="文件列表" name="files">
                                </el-tab-pane>
                                <el-tab-pane label="上传任务" name="uploads">
                                    <template #label>
                                        <span class="flex items-center gap-1">
                                            <span>上传任务</span>
                                            <el-badge :value="uploadTasksList.length"
                                                :hidden="uploadTasksList.length === 0" type="warning" class="ml-1" />
                                        </span>
                                    </template>
                                </el-tab-pane>
                            </el-tabs>
                        </div>
                        <!-- 上传区域(仅在文件列表 Tab 显示) -->
                        <div class="p-4">
                            <div v-if="activeTab === 'files'" class="mb-2">
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
                                            支持格式:txt, md, pdf, docx, 代码文件等,单个文件最大 50MB
                                        </div>
                                    </template>
                                </el-upload>
                            </div>
                        </div>

                        <!-- 文件列表内容区 -->
                        <div class="flex-1 p-4 overflow-hidden">
                            <ScrollContainer ref="fileListContainer"  @scroll="handleScroll">
                                <!-- 文件列表 Tab 内容 -->
                                <div v-if="activeTab === 'files'">
                                    <!-- 文件列表 -->
                                    <div v-if="files.length > 0" class="grid gap-3">
                                        <KBFileItem v-for="file in files" :key="file.id" :file="file"
                                            :is-temp-task="false" @view="handleViewFile" @retry="handleRetryFile"
                                            @delete="handleDeleteFile" />
                                    </div>

                                    <!-- 加载更多提示 -->
                                    <div v-if="files.length > 0" class="mt-4 text-center">
                                        <!-- 加载中状态 -->
                                        <div v-if="isLoadingMore"
                                            class="flex items-center justify-center py-3 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <el-icon class="animate-spin text-blue-500 mr-2" size="18">
                                                <Loading />
                                            </el-icon>
                                            <span class="text-sm text-gray-600 dark:text-gray-400">
                                                正在加载更多文件... ({{ files.length }}/{{ totalFiles }})
                                            </span>
                                        </div>

                                        <!-- 有更多可加载 -->
                                        <div v-else-if="hasMoreFiles"
                                            class="py-3 px-4 cursor-pointer group transition-all duration-200"
                                            @click="loadMoreFiles">
                                            <div class="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 
                                                    group-hover:text-blue-600 dark:group-hover:text-blue-400 
                                                    group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 
                                                    px-4 py-2 rounded-full transition-all duration-200">
                                                <span>点击加载更多</span>
                                                <span class="text-xs opacity-60">(剩余 {{ totalFiles - files.length }}
                                                    个文件)</span>
                                                <el-icon class="group-hover:translate-y-0.5 transition-transform"
                                                    size="14">
                                                    <ArrowDown />
                                                </el-icon>
                                            </div>
                                        </div>

                                        <!-- 已全部加载 -->
                                        <div v-else-if="totalFiles > 0" class="py-3 px-4">
                                            <div
                                                class="inline-flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                                                <el-icon size="16">
                                                    <CircleCheck />
                                                </el-icon>
                                                <span>已加载全部 {{ totalFiles }} 个文件</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- 空状态 -->
                                    <div v-else-if="!store.loading && !isLoadingMore" class="mt-6">
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
                                            <el-button type="primary"
                                                @click="showUploadModal = true">上传第一个文件</el-button>
                                        </div>
                                    </div>

                                    <!-- 加载中状态 -->
                                    <div v-else-if="isLoadingMore" class="mt-6 flex items-center justify-center py-12">
                                        <el-icon class="animate-spin text-gray-400" size="32">
                                            <Loading />
                                        </el-icon>
                                        <span class="ml-3 text-gray-500">正在加载文件...</span>
                                    </div>
                                </div>

                                <!-- 上传任务 Tab 内容 -->
                                <div v-if="activeTab === 'uploads'">
                                    <!-- 上传任务列表 -->
                                    <div v-if="uploadTasksList.length > 0" class="grid gap-3">
                                        <KBFileItem v-for="task in uploadTasksList" :key="task.id" :file="task"
                                            :is-temp-task="true" @view="handleViewFile" @retry="handleRetryFile"
                                            @delete="handleDeleteFile" />
                                    </div>

                                    <!-- 空状态 -->
                                    <div v-else class="mt-6">
                                        <div
                                            class="empty-state text-center text-gray-500 flex flex-col items-center justify-center py-12">
                                            <div class="empty-state-icon mb-3 text-gray-300">
                                                <el-icon size="48">
                                                    <Upload />
                                                </el-icon>
                                            </div>
                                            <div class="empty-state-title text-sm font-medium mb-1">
                                                暂无进行中的上传任务
                                            </div>
                                            <div class="empty-state-description text-xs text-gray-400 mb-3">
                                                上传文件后会在此处显示进度
                                            </div>
                                        </div>
                                    </div>
                                </div>
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
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem, ElTabs, ElTabPane, ElBadge } from 'element-plus'
import { Plus, Edit, Delete, Upload, MoreFilled, RefreshRight, Loading, Search, ArrowDown, CircleCheck } from '@element-plus/icons-vue'
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
const kbSidebarVisible = useStorage('kbSidebarVisible', true) // 知识库侧边栏可见状态,持久化到 localStorage
const embeddingModels = ref<any[]>([]) // 嵌入模型列表
const embeddingProviders = ref<any[]>([]) // 嵌入模型供应商列表

// Tab 切换相关状态
const activeTab = ref<'files' | 'uploads'>('files') // 当前激活的 Tab

// 无限滚动相关状态
const fileListContainer = ref<any>(null) // 文件列表容器引用（ScrollContainer 组件）
const currentPage = ref(1) // 当前页码
const pageSize = ref(30) // 每页数量
const totalFiles = ref(0) // 文件总数
const isLoadingMore = ref(false) // 是否正在加载更多
const scrollThreshold = 50 // 滚动触发阈值(像素)
let scrollTimer: number | null = null // 滚动防抖定时器

// 上传任务列表(独立于文件列表)
const uploadTasksList = ref<UnifiedFileRecord[]>([])

// 上传任务轮询定时器
let uploadTaskPollingTimer: number | null = null

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
 * 处理文件选择(支持并发控制)
 */
async function handleFileChange(file: any, fileList: any[]) {
    const rawFile = file.raw
    if (!rawFile) return

    // 验证文件大小
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (rawFile.size > maxSize) {
        toast.error(`文件大小超过限制 (${maxSize / 1024 / 1024}MB)`)
        return
    }

    try {
        // 关键修复:开始新上传前,清空已完成的上传任务(uploaded 状态)
        const completedTaskIds = uploadTasksList.value
            .filter(task => task.processingStatus === 'uploaded')
            .map(task => task.id)

        if (completedTaskIds.length > 0) {
            console.log(`[DEBUG] 清空 ${completedTaskIds.length} 个已完成的上传任务`)
            completedTaskIds.forEach(id => uploadStore.clearUploadTask(id))
        }

        // 创建上传任务(会自动加入队列,如果槽位可用会立即开始上传)
        const task = await uploadStore.uploadToKnowledgeBase(
            store.activeKnowledgeBaseId!,
            rawFile,
            (updatedTask: UploadTask) => {
                // 每次状态变化都触发响应式更新
                console.log(`[DEBUG] 上传进度更新:${updatedTask.fileName} - ${updatedTask.status} - ${updatedTask.progress}%`)

                // 找到对应的文件索引
                const index = uploadTasksList.value.findIndex(f => {
                    // 匹配临时任务(fileId 可能是 'pending' 或时间戳)
                    if (f.isTempTask) {
                        return f.id === updatedTask.id
                    }
                    // 匹配数据库记录(使用真实 ID)
                    return f.fileId === updatedTask.fileId
                })

                if (index !== -1) {
                    // 使用 Vue 的响应式方式更新整个对象
                    uploadTasksList.value[index] = {
                        ...uploadTasksList.value[index],
                        processingStatus: updatedTask.status,
                        progressPercentage: updatedTask.progress,
                        currentStep: updatedTask.currentStep,
                        errorMessage: updatedTask.errorMessage
                    }

                    console.log(`[DEBUG] 更新了文件 ${updatedTask.fileName} 的状态:${updatedTask.status}`)
                } else {
                    // 如果不在列表中,等待 refreshFileList 合并
                    console.log(`[DEBUG] 任务 ${updatedTask.fileName} 不在列表中,等待 refreshFileList 合并`)
                }
            }
        )

        // 上传任务添加后,刷新上传任务列表
        console.log(`[DEBUG] 上传任务已添加,刷新上传任务列表:${task.fileName}`)
        refreshUploadTasksList()

        // 关键修改:每次上传都自动切换到"上传任务" Tab
        activeTab.value = 'uploads'

        // 根据任务数量给出不同提示
        const stats = uploadStore.getUploadStats()
        if (stats.queued > 0) {
            toast.success(`已添加到队列:${rawFile.name} (排队中 ${stats.queued} 个)`)
        } else {
            toast.success(`开始上传:${rawFile.name}`)
        }
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
async function handleRetryFile(file: UnifiedFileRecord) {
    try {
        const confirmed = await confirm(
            '警告',
            `确定要重新处理文件“${file.displayName}”吗？这将重新启动后台处理任务。`,
            { type: 'warning' }
        )

        if (!confirmed) return

        if (!store.activeKnowledgeBaseId) return

        // 调用后端 API 重新处理文件
        const { apiService } = await import('@/services/ApiService')
        await apiService.retryKBFile(store.activeKnowledgeBaseId, file.id)

        toast.success('已开始重新处理文件')

        // 关键修改：仅更新该文件的状态，不刷新整个列表
        const index = files.value.findIndex(f => f.id === file.id)
        if (index !== -1) {
            files.value[index].processingStatus = 'pending'
            files.value[index].progressPercentage = 0
            files.value[index].currentStep = '等待重新处理...'
            files.value[index].errorMessage = null
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
async function handleDeleteFile(file: UnifiedFileRecord) {
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

        // 关键修改：从本地列表中移除，而不是完全刷新
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
 * 处理 Tab 切换
 */
function handleTabClick(tab: any) {
    console.log(`[DEBUG] 用户切换到 Tab: ${tab.props.name}`)

    // 如果切换到上传任务 Tab，确保上传任务列表是最新的
    if (tab.props.name === 'uploads') {
        refreshUploadTasksList()
    }
}

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
 * 刷新上传任务列表
 */
function refreshUploadTasksList() {
    if (!store.activeKnowledgeBaseId) return

    // 从 fileUpload store 获取当前知识库的上传任务
    const tasks = uploadStore.getTasksByKB(store.activeKnowledgeBaseId)

    // 转换为统一文件记录格式
    const newTasksList = tasks.map(task => uploadStore.taskToFileRecord(task))

    // 关键修复:保留已完成(uploaded)的任务,显示"上传完成"状态
    // 只过滤掉真正完成处理(completed)的任务
    const displayTasks = newTasksList.filter(task =>
        task.processingStatus !== 'completed'
    )

    // 如果任务数量发生变化,说明有任务完成了,需要刷新文件列表
    // 检查是否有任务从 uploading/queued 变为 uploaded
    const hasNewlyCompleted = displayTasks.some(task =>
        task.processingStatus === 'uploaded' &&
        !uploadTasksList.value.find(t => t.id === task.id && t.processingStatus === 'uploaded')
    )

    if (hasNewlyCompleted) {
        console.log('[DEBUG] 检测到上传任务完成,刷新文件列表')
        // 延迟刷新,确保后端已经创建了数据库记录
        setTimeout(() => {
            refreshFileList()
        }, 500)
    }

    uploadTasksList.value = displayTasks

    console.log(`[DEBUG] 刷新上传任务列表: ${uploadTasksList.value.length} 个任务`)
}

/**
 * 启动文件处理轮询
 */
function startPollingForProcessingFiles() {
    if (!store.activeKnowledgeBaseId) return

    // 对每个 processing/pending 状态的文件启动轮询
    const processingFileIds = files.value
        .filter(f => f.processingStatus === 'processing' || f.processingStatus === 'pending')
        .map(f => f.fileId)

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
                    // 使用 Vue 的响应式方式更新整个对象
                    const fileToUpdate = files.value[index]
                    fileToUpdate.processingStatus = updatedFile.processingStatus
                    fileToUpdate.progressPercentage = updatedFile.progressPercentage
                    fileToUpdate.currentStep = updatedFile.currentStep
                    fileToUpdate.errorMessage = updatedFile.errorMessage
                    fileToUpdate.totalChunks = updatedFile.totalChunks || undefined
                    fileToUpdate.totalTokens = updatedFile.totalTokens || undefined

                    console.log(`[DEBUG] 文件状态更新: ${fileToUpdate.displayName} -> ${updatedFile.processingStatus}`)
                }
            }
        )
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

        // 3. 同时刷新上传任务列表
        refreshUploadTasksList()

        // 4. 启动或更新轮询
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

// 监听 Tab 切换，保持分页状态
watch(activeTab, (newTab, oldTab) => {
    console.log(`[DEBUG] Tab 切换: ${oldTab} -> ${newTab}`)

    // 切换到文件列表 Tab 时，检查是否需要刷新
    if (newTab === 'files') {
        // 如果文件列表为空且有文件总数，说明需要重新加载
        if (files.value.length === 0 && totalFiles.value > 0) {
            console.log('[DEBUG] 文件列表为空但总数大于0，重新加载')
            refreshFileList(false) // 不重置分页，尝试恢复
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
