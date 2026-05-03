<!-- components/KnowledgeBasePage.vue -->
<template>
    <div class="h-full w-full flex flex-col bg-(--color-sidebar-bg) min-h-0">
        <!-- 视图模式：卡片列表 -->
        <div v-if="viewMode === 'list'" class="flex-1 overflow-hidden flex flex-col">
            <div class="flex flex-col h-full p-3 max-w-260 mx-auto w-full">
                <!-- 头部 -->
                <div class="flex justify-between items-center py-4">
                    <span class="text-lg font-semibold text-gray-800 dark:text-[#e8e9ed]">知识库</span>
                    <el-button type="primary" @click="showCreateModal = true" class="flex items-center">
                        <template #icon>
                            <Plus />
                        </template>
                        新建知识库
                    </el-button>
                </div>

                <!-- 搜索框 -->
                <div class="pb-4">
                    <el-input v-model="searchKeyword" placeholder="搜索知识库" clearable class="w-full">
                        <template #prefix>
                            <el-icon>
                                <Search />
                            </el-icon>
                        </template>
                    </el-input>
                </div>

                <!-- 知识库卡片网格列表 -->
                <div class="flex-1 overflow-y-auto">
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                        <!-- 知识库卡片 -->
                        <div v-for="kb in filteredKnowledgeBases" :key="kb.id"
                            class="kb-card group relative bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#232428] rounded-lg p-4 cursor-pointer hover:border-(--color-primary) transition-all duration-200 overflow-hidden"
                            @click="handleSelectKB(kb)">
                            <!-- 毛玻璃背景层 -->
                            <div class="absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                :style="{
                                    background: 'linear-gradient(135deg, rgba(251, 114, 153, 0.05) 0%, rgba(251, 114, 153, 0.02) 100%)'
                                }">
                            </div>

                            <!-- 内容区域 -->
                            <div class="relative z-10 flex flex-col h-full">
                                <div class="flex items-start gap-3">
                                    <div
                                        class="w-11 h-11 shrink-0 flex items-center justify-center text-(--color-primary) bg-gray-50 dark:bg-[#2a2c30] rounded-md overflow-hidden">
                                        <el-icon size="24">
                                            <MenuBookOutlined />
                                        </el-icon>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-start justify-between">
                                            <div class="font-medium text-base text-gray-900 dark:text-[#e8e9ed] truncate" :title="kb.name">
                                                {{
                                                    kb.name }}</div>
                                            <!-- 操作按钮 - 悬停显示 -->
                                            <div
                                                class="kb-actions flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                <el-dropdown trigger="click"
                                                    @command="(command: string) => handleDropdownCommand(command, kb)">
                                                    <template #dropdown>
                                                        <el-dropdown-menu>
                                                            <el-dropdown-item command="edit">
                                                                <Edit class="w-4 h-4 mr-2 inline-block" />
                                                                编辑
                                                            </el-dropdown-item>
                                                            <el-dropdown-item command="delete">
                                                                <Delete class="w-4 h-4 mr-2 inline-block" />
                                                                删除
                                                            </el-dropdown-item>
                                                        </el-dropdown-menu>
                                                    </template>
                                                    <div @click.stop class="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#2a2c30]">
                                                        <el-icon class="w-4 h-4">
                                                            <MoreFilled />
                                                        </el-icon>
                                                    </div>
                                                </el-dropdown>
                                            </div>
                                        </div>
                                        <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1.5">
                                            {{ kb.isPublic ? '公开' : '私有' }}
                                        </div>
                                    </div>
                                </div>
                                <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-2 line-clamp-2 leading-relaxed">{{ kb.description
                                    ||
                                    '暂无描述' }}
                                </div>
                            </div>

                            <!-- 悬停显示的渐变遮罩和按钮 -->
                            <div
                                class="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white via-white/90 to-transparent dark:from-[#232428] dark:via-[#232428]/90 dark:to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg">
                            </div>
                            <div
                                class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto z-20">
                                <el-button type="primary" size="small" class="flex-1 shadow-sm"
                                    @click.stop="handleSelectKB(kb)">
                                    进入知识库
                                </el-button>
                            </div>
                        </div>

                        <!-- 空状态 -->
                        <div v-if="!store.loading && filteredKnowledgeBases.length === 0"
                            class="col-span-full text-center py-12">
                            <el-icon size="48" class="text-gray-300 dark:text-[#3e4046] mb-3">
                                <MenuBookOutlined />
                            </el-icon>
                            <p class="text-lg text-gray-500 dark:text-[#8b8d95]">{{ searchKeyword ? '未找到匹配的知识库' : '暂无知识库' }}</p>
                            <p class="text-sm mt-1 text-gray-400 dark:text-[#6b6d75]">{{ searchKeyword ? '尝试调整搜索关键词' : '点击上方按钮创建第一个知识库' }}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 视图模式：知识库详情 -->
        <div v-else class="flex-1 flex flex-col overflow-hidden">
            <!-- 顶部导航栏 -->
            <div class="px-2 py-3 flex items-center gap-3 max-w-260 mx-auto w-full">
                <el-button link @click="backToList"
                    class="flex items-center gap-1 text-gray-900 dark:text-[#e8e9ed] hover:text-(--color-primary) font-medium">
                    <el-icon :size="22">
                        <ArrowLeft24Filled />
                    </el-icon>
                    <span class="text-base">返回知识库列表</span>
                </el-button>
                <el-divider direction="vertical" />
                <span class="font-semibold text-gray-800 dark:text-[#e8e9ed] text-base">{{ currentKB?.name }}</span>
            </div>

            <!-- 详情内容区域 -->
            <div class="flex-1 flex flex-col overflow-hidden max-w-260 mx-auto w-full min-h-0">
                <!-- Tab 切换区域 -->
                <div class="px-4 pt-3">
                    <el-tabs v-model="activeTab" class="kb-tabs">
                        <el-tab-pane label="文件列表" name="files">
                            <template #label>
                                <div class="flex items-center gap-2">
                                    <el-icon :size="17">
                                        <BookOpen24Regular />
                                    </el-icon>
                                    <span class="text-[15px]">文件列表</span>
                                </div>
                            </template>
                        </el-tab-pane>
                        <el-tab-pane label="搜索" name="search">
                            <template #label>
                                <div class="flex items-center gap-2">
                                    <el-icon :size="17">
                                        <Search24Regular />
                                    </el-icon>
                                    <span class="text-[15px]">搜索</span>
                                </div>
                            </template>
                        </el-tab-pane>
                    </el-tabs>
                </div>
                <!-- 文件列表 Tab -->
                <div v-show="activeTab === 'files'" class="flex-1 flex flex-col min-h-0">

                    <!-- 上传区域 -->
                    <div class="px-4 pt-4 pb-1">
                        <KBFileUploader :kb-id="store.activeKnowledgeBaseId!"
                            :current-folder-path="getCurrentFolderPath()" :get-current-files="getCurrentFiles"
                            @uploaded="handleUploadComplete" @show-upload-task="showUploadTaskModal = true"
                            @folder-created="handleFolderCreated" />
                    </div>

                    <!-- 文件列表内容区 -->
                    <div class="flex-1 m-4 overflow-hidden flex min-h-0 rounded-lg">
                        <ScrollContainer class="max-h-full w-full" ref="fileListContainer" @scroll="handleScroll">
                            <div class="rounded-lg p-2 bg-white dark:bg-[#232428]">
                                <KBFileTree ref="fileTreeRef" :kb-id="store.activeKnowledgeBaseId!"
                                    @view="handleViewFile" @retry="handleRetryFile" @delete="handleDeleteFile"
                                    @folder-change="handleFolderChange" @files-loaded="handleFilesLoaded" />
                            </div>
                        </ScrollContainer>
                    </div>

                </div>

                <!-- 搜索 Tab -->
                <div v-show="activeTab === 'search'" class="flex flex-1 overflow-hidden min-h-0 w-full">
                    <KBSearchPanel :knowledge-bases="store.knowledgeBases"
                        :default-kb-id="store.activeKnowledgeBaseId" />
                </div>
            </div>
        </div>
    </div>

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

            <!-- <el-form-item label="可见性">
                <el-switch v-model="createForm.isPublic" />
                <span class="text-sm text-gray-500 dark:text-gray-400 ml-2">公开的知识库可被其他人查看</span>
            </el-form-item> -->
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

    <!-- 上传任务弹窗 -->
    <UploadTaskModal v-model="showUploadTaskModal" :upload-tasks="uploadTasksList" @retry="handleRetryFile"
        @delete="handleDeleteFile" />
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
import { FileChunksViewer, KBFileItem, KBFileUploader, KBFileTree, KBSearchPanel, UploadTaskModal } from './index'
import { useStorage, useDebounceFn } from '@vueuse/core'
import { usePopup } from '@/composables/usePopup'
import { BookOpen24Regular, Search24Regular, ArrowLeft24Filled } from '@vicons/fluent'
import { MenuBookOutlined } from '@vicons/material'
import { apiService } from '@/services/ApiService'

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
const showUploadTaskModal = ref(false)  // 上传任务弹窗
const selectedFile = ref<KBFile | null>(null)  // 选中的文件
const activeTab = ref('files')  // 当前激活的 Tab: 'files' 或 'search'
const viewMode = ref<'list' | 'detail'>('list')  // 视图模式：列表或详情
const searchKeyword = ref('')  // 知识库搜索关键词
const embeddingModels = ref<any[]>([]) // 嵌入模型列表
const embeddingProviders = ref<any[]>([]) // 嵌入模型供应商列表

// 上传任务列表(独立于文件列表)
const uploadTasksList = ref<KBFile[]>([])

// 上传任务轮询定时器
let uploadTaskPollingTimer: number | null = null

// 自动关闭弹窗定时器
let autoCloseModalTimer: number | null = null

// 当前目录路径缓存(避免频繁调用API)
let cachedCurrentFolderPath: string | null = null

// 无限滚动相关状态
const fileListContainer = ref<any>(null) // 文件列表容器引用（ScrollContainer 组件）
const fileTreeRef = ref<any>(null) // 文件树组件引用
const scrollThreshold = 50 // 滚动触发阈值(像素)

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
 * 过滤后的知识库列表（支持搜索）
 */
const filteredKnowledgeBases = computed(() => {
    if (!searchKeyword.value || !searchKeyword.value.trim()) {
        return store.knowledgeBases
    }
    const keyword = searchKeyword.value.toLowerCase().trim()
    return store.knowledgeBases.filter(kb =>
        kb.name?.toLowerCase().includes(keyword) ||
        kb.description?.toLowerCase().includes(keyword)
    )
})

// ========== Methods ==========

/**
 * 加载嵌入模型列表
 */
const loadEmbeddingModels = async () => {
    try {
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
    viewMode.value = 'detail'

    // 更新路由（使用 params）
    router.replace({ name: 'KnowledgeBase', params: { id: kb.id } })

    try {
        // 选择新知识库时重置分页
        await refreshFileList()
        // toast.success(`已选择：${kb.name}`)
    } catch (error) {
        console.error('加载文件列表失败:', error)
        toast.error('加载文件列表失败')
    }
}

/**
 * 返回列表视图
 */
function backToList() {
    viewMode.value = 'list'
    store.setActiveKnowledgeBase(null)
    router.replace({ name: 'KnowledgeBase' })
}

/**
 * 处理下拉菜单命令
 */
function handleDropdownCommand(command: string, kb: KnowledgeBase) {
    if (command === 'edit') {
        handleEdit(kb)
    } else if (command === 'delete') {
        handleDelete(kb)
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
async function handleUploadComplete(task: UploadTask) {
    console.log('文件上传完成:', task.fileName)
    console.log('[DEBUG] 任务 relativePath:', task.relativePath)

    // 关键优化:将上传任务转换为 KBFile 格式
    const uploadedFile = uploadStore.taskToFileRecord(task)
    console.log('[DEBUG] 转换后的 KBFile relativePath:', uploadedFile.relativePath)

    // 智能插入到当前目录（如果需要）
    if (fileTreeRef.value && fileTreeRef.value.insertUploadedFile) {
        await fileTreeRef.value.insertUploadedFile(uploadedFile)
        console.log('[DEBUG] 已尝试智能插入文件')
    }

    // 注意:不再调用 refreshFileList,避免全局刷新
}

/**
 * 处理文件夹创建成功事件
 */
async function handleFolderCreated() {
    console.log('[DEBUG] 文件夹创建成功，刷新当前目录')

    // 刷新当前目录以显示新创建的文件夹
    if (fileTreeRef.value && fileTreeRef.value.forceReload) {
        await fileTreeRef.value.forceReload()
    }
}


/**
 * 处理滚动事件（带防抖）
 */
function handleScroll(event: Event) {
    if (!fileListContainer.value || !fileTreeRef.value) return

    const container = fileListContainer.value.getScrollElement?.() || fileListContainer.value.$el
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container

    // 计算距离底部的距离
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    // 如果距离底部小于阈值，且没有正在加载，则加载更多
    if (distanceToBottom <= scrollThreshold && fileTreeRef.value.loadMoreFiles) {
        console.log('[DEBUG] 触发无限滚动加载')
        fileTreeRef.value.loadMoreFiles()
    }
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
        await apiService.retryKBFile(store.activeKnowledgeBaseId, file.id)

        toast.success('已开始重新处理文件')

        // 关键修复：通过 KBFileTree 更新文件状态
        if (fileTreeRef.value && fileTreeRef.value.updateFileStatus) {
            fileTreeRef.value.updateFileStatus(file.id, {
                processingStatus: 'pending',
                progressPercentage: 0,
                currentStep: '等待重新处理...',
                errorMessage: null
            })
            console.log(`[DEBUG] 文件状态已更新为 pending: ${file.displayName}`)
        }

        // 注意:不需要手动启动轮询,K BFileTree 会在数据加载后触发 files-loaded 事件
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
 * 处理目录切换事件
 */
async function handleFolderChange(relativePath: string | null) {
    console.log(`[DEBUG] 目录切换到: ${relativePath || '根目录'}`)

    // 关键修复:更新缓存的当前目录路径
    cachedCurrentFolderPath = relativePath
    console.log(`[DEBUG] 更新缓存路径: ${cachedCurrentFolderPath}`)

    // 注意:不再在这里启动轮询,等待 files-loaded 事件触发
}

/**
 * 处理文件加载完成事件
 * 注意：KBFileTree 现在内部管理轮询，父组件无需干预
 */
function handleFilesLoaded(files: KBFile[]) {
    console.log(`[DEBUG] 收到 files-loaded 事件,文件数: ${files.length}`)
    // KBFileTree 内部已自动启动轮询，父组件无需任何操作
}

/**
 * 获取当前文件夹路径（从 KBFileTree 组件）
 */
function getCurrentFolderPath(): string | null {
    if (fileTreeRef.value && fileTreeRef.value.getCurrentFolderPath) {
        return fileTreeRef.value.getCurrentFolderPath()
    }
    return null
}

/**
 * 获取当前目录下的文件列表（从 KBFileTree 组件）
 */
function getCurrentFiles(): KBFile[] {
    if (fileTreeRef.value && fileTreeRef.value.getCurrentFiles) {
        return fileTreeRef.value.getCurrentFiles()
    }
    return []
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
            // 如果 ID 无效,显示列表视图
            viewMode.value = 'list'
        }
    } else {
        // 默认显示列表视图
        viewMode.value = 'list'
    }

    // 关键优化:检查是否有上传任务，按需启动轮询
    checkAndStartUploadTaskPolling()
})

// 关键修复:组件销毁时清理定时器,防止内存泄漏
onUnmounted(() => {
    console.log('[DEBUG] KnowledgeBasePage 组件销毁,清理定时器')
    // 注意：文件轮询已由 KBFileTree 内部管理，无需在此清理
    stopUploadTaskPolling() // 停止上传任务轮询
})

/**
 * 检查并启动上传任务轮询（如果尚未启动）
 */
function checkAndStartUploadTaskPolling() {
    // 如果已经有轮询定时器，不重复启动
    if (uploadTaskPollingTimer !== null) {
        return
    }

    // 检查是否有活跃的上传任务
    if (!store.activeKnowledgeBaseId) return

    const tasks = uploadStore.getTasksByKB(store.activeKnowledgeBaseId)
    const hasActiveTasks = tasks.some(task =>
        task.status === 'queued' ||
        task.status === 'uploading'
    )

    if (hasActiveTasks) {
        startUploadTaskPolling()
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

    // 关键优化:检查是否还有活跃任务，如果没有则停止轮询
    const hasActiveUploadTasks = remainingTasks.some(task =>
        task.status === 'queued' || task.status === 'uploading'
    )

    if (!hasActiveUploadTasks && uploadTaskPollingTimer !== null) {
        console.log('[DEBUG] 所有上传任务完成，停止上传任务轮询')
        stopUploadTaskPolling()
    }
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
 * 刷新文件列表
 * 注意：KBFileTree 现在内部管理文件列表和轮询，此函数仅用于触发 KBFileTree 重新加载
 */
async function refreshFileList() {
    if (!store.activeKnowledgeBaseId) return

    try {
        // 通知 KBFileTree 重新加载当前目录
        if (fileTreeRef.value && fileTreeRef.value.forceReload) {
            console.log('[DEBUG] 触发 KBFileTree 重新加载')
            await fileTreeRef.value.forceReload()
            // 注意:forceReload 内部会触发 files-loaded 事件,自动启动轮询
        }
    } catch (error) {
        console.error('刷新文件列表失败:', error)
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
    } else {
        // 如果没有 ID，返回列表视图
        viewMode.value = 'list'
        store.setActiveKnowledgeBase(null)
    }
})

// 关键优化:监听 uploadStore 的任务变化，动态启动/停止轮询
watch(
    () => uploadStore.getTasksByKB(store.activeKnowledgeBaseId || '').length,
    (newCount, oldCount) => {
        console.log(`[DEBUG] 上传任务数量变化: ${oldCount} -> ${newCount}`)

        // 如果有活跃任务且轮询未启动，则启动
        if (newCount > 0 && uploadTaskPollingTimer === null) {
            console.log('[DEBUG] 检测到新的上传任务，启动轮询')
            checkAndStartUploadTaskPolling()
        }
    }
)
</script>

<style scoped>
/* 空状态样式 */
.empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Tab 样式优化 */
.kb-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
}

.kb-tabs :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
}

.kb-tabs :deep(.el-tabs__item) {
    padding: 0 18px;
    height: 44px;
    line-height: 44px;
    font-size: 14px;
}

/* 知识库卡片样式 */
.kb-card {
    min-height: 140px;
}

.kb-actions {
    margin-left: auto;
    transition: opacity 0.2s ease;
}

/* 滚动条美化 */
.overflow-y-auto::-webkit-scrollbar {
    width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

.dark .overflow-y-auto::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
}
</style>
