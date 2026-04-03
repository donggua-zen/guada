<!-- components/KnowledgeBasePage.vue -->
<template>
    <SidebarLayout v-model:sidebar-visible="kbSidebarVisible" :sidebar-position="'left'" :z-index="50"
        :show-toggle-button="true">
        <!-- 左侧侧边栏：知识库列表 -->
        <template #sidebar>
            <div
                class="kb-sidebar h-full flex flex-col bg-[var(--color-conversation-bg)] border-r border-gray-200 dark:border-gray-700">
                <!-- 头部 -->
                <div class="px-4 pt-3.5 pb-3.5 border-b border-gray-200 dark:border-gray-700">
                    <div class="flex justify-between items-center">
                        <span class="font-semibold text-base text-[var(--color-text)]">知识库</span>
                        <el-button type="primary" @click="showCreateModal = true" :icon="Plus">
                            新建
                        </el-button>
                    </div>
                </div>

                <!-- 搜索框 -->
                <div class="search-box px-3.5 py-3">
                    <el-input v-model="searchKeyword" placeholder="搜索知识库" clearable class="search-input" />
                </div>

                <!-- 知识库列表 -->
                <div class="flex-1 overflow-y-auto py-2">
                    <ScrollContainer>
                        <template v-if="filteredKnowledgeBases.length === 0">
                            <div
                                class="empty-state text-center text-gray-500 flex flex-col items-center justify-center h-full py-12">
                                <div class="empty-state-icon mb-3 text-gray-300">
                                    <el-icon size="32">
                                        <Plus />
                                    </el-icon>
                                </div>
                                <div class="empty-state-title text-sm font-medium mb-1">
                                    {{ searchKeyword ? '未找到匹配的知识库' : '没有知识库' }}
                                </div>
                                <div class="empty-state-description text-xs text-gray-400">
                                    {{ searchKeyword ? '尝试调整搜索关键词' : '点击上方按钮创建新的知识库' }}
                                </div>
                            </div>
                        </template>
                        <template v-else>
                            <div v-for="kb in filteredKnowledgeBases" :key="kb.id" class="kb-item group" :class="{
                                'kb-item-active': store.activeKnowledgeBaseId === kb.id,
                                'kb-item-inactive': store.activeKnowledgeBaseId !== kb.id
                            }" @click="handleSelectKB(kb)">
                                <div class="kb-info flex-1 min-w-0 flex items-center">
                                    <div class="kb-title truncate text-sm font-medium w-full">
                                        {{ kb.name }}
                                    </div>
                                </div>
                                <!-- <div class="kb-desc mt-0.5 truncate text-xs">
                                    {{ kb.description || '暂无描述' }}
                                </div> -->
                                <div class="kb-actions flex items-center opacity-0 group-hover:opacity-100">
                                    <el-dropdown trigger="click"
                                        @command="(command) => handleDropdownCommand(command, kb)">
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
                                        <div @click.stop class="kb-action-trigger">
                                            <el-icon class="w-4 h-4">
                                                <MoreFilled />
                                            </el-icon>
                                        </div>
                                    </el-dropdown>
                                </div>
                            </div>
                        </template>
                    </ScrollContainer>
                </div>
            </div>
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
                            <el-button type="primary" @click="showUploadModal = true">
                                <el-icon>
                                    <Upload />
                                </el-icon>
                                上传文件
                            </el-button>
                        </div>
                    </div>

                    <!-- 统一文件列表（包含上传任务和数据库记录） -->
                    <div class="flex-1 overflow-y-auto p-4">
                        <!-- 上传区域 -->
                        <div class="mb-6">
                            <el-upload ref="uploadRef" drag :auto-upload="false" :on-change="handleFileChange"
                                :limit="10" :show-file-list="false" multiple
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
                            <div v-for="file in files" :key="file.id"
                                class="file-item group bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:shadow-md transition-all cursor-pointer dark:bg-gray-800 dark:border-gray-700"
                                @click="handleViewFile(file)">
                                <div class="flex items-center gap-3">
                                    <!-- 文件图标 -->
                                    <div class="w-10 h-10 flex items-center justify-center flex-shrink-0">
                                        <img :src="getFileIcon(file.file_type, file.file_extension)"
                                            class="w-8 h-8 object-contain" alt="file icon" />
                                    </div>

                                    <!-- 文件信息 -->
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center justify-between mb-0.5">
                                            <h4
                                                class="text-sm font-medium text-gray-900 truncate pr-2 dark:text-gray-100">
                                                {{ file.display_name }}
                                            </h4>
                                            <el-tag size="small" :type="getStatusType(file.processing_status)">
                                                {{ getStatusText(file.processing_status) }}
                                            </el-tag>
                                        </div>
                                        <p class="text-xs text-gray-500 dark:text-gray-400">
                                            {{ formatSize(file.file_size) }} · {{ file.file_extension ?
                                                file.file_extension.toUpperCase() : 'UNKNOWN' }}
                                            <span v-if="file.isTempTask"
                                                class="ml-2 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">上传中</span>
                                        </p>
                                    </div>
                                </div>

                                <!-- 进度条 -->
                                <div v-if="file.processing_status === 'processing' || file.processing_status === 'uploading'"
                                    class="mt-2">
                                    <el-progress :percentage="file.progress_percentage"
                                        v-if="file.processing_status === 'uploading'" :stroke-width="3" />
                                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {{ file.current_step || '处理中...' }}
                                    </p>
                                </div>

                                <!-- 错误信息 -->
                                <div v-if="file.processing_status === 'failed' && file.error_message"
                                    class="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
                                    {{ file.error_message }}
                                </div>

                                <!-- 详细信息 (可选展开) -->
                                <div v-if="file.processing_status === 'completed' && (file.total_chunks || file.total_tokens)"
                                    class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                    <div
                                        class="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                                        <div class="flex gap-3">
                                            <span v-if="file.total_chunks">{{ file.total_chunks }} 分块</span>
                                        </div>
                                        <!-- 操作按钮 -->
                                        <div class="flex items-center gap-1 flex-shrink-0" @click.stop>
                                            <el-button size="small" link @click="handleRetryFile(file)">
                                                <RefreshRight class="w-3 h-3 mr-1" />
                                                重新处理
                                            </el-button>
                                            <el-button size="small" type="danger" link @click="handleDeleteFile(file)">
                                                <Delete class="w-3 h-3 mr-1" />
                                                删除
                                            </el-button>
                                        </div>
                                    </div>
                                </div>
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
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox, ElDropdown, ElDropdownMenu, ElDropdownItem } from 'element-plus'
import { Plus, Edit, Delete, Upload, MoreFilled, RefreshRight } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import { useFileUploadStore } from '@/stores/fileUpload'
import type { KnowledgeBase, KBFile } from '@/stores/knowledgeBase'
import type { UploadTask, UnifiedFileRecord } from '@/stores/fileUpload'
import ScrollContainer from '@/components/ui/ScrollContainer.vue'
import SidebarLayout from '@/components/ui/SidebarLayout.vue'
import LeftBarIcon from './icons/LeftBarIcon.vue'
import { useStorage } from '@vueuse/core'
import { usePopup } from '@/composables/usePopup'

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
const searchKeyword = ref('')
const files = ref<UnifiedFileRecord[]>([])
const kbSidebarVisible = useStorage('kbSidebarVisible', true) // 知识库侧边栏可见状态，持久化到 localStorage
const embeddingModels = ref<any[]>([]) // 嵌入模型列表
const embeddingProviders = ref<any[]>([]) // 嵌入模型供应商列表

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
 * 过滤后的知识库列表（支持搜索）
 */
const filteredKnowledgeBases = computed(() => {
    if (!searchKeyword.value.trim()) {
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
        await store.createKnowledgeBase({
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

        await store.deleteKnowledgeBase(kb.id)
        toast.success('删除成功')
    } catch (error: any) {
        if (error !== 'cancel') {
            console.error('删除失败:', error)
            toast.error(error.response?.data?.detail || '删除失败')
        }
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
function getFileIcon(fileType?: string, fileExtension?: string): string {
    // ✅ 优先从文件名推断（最可靠）
    let ext = ''

    // 方法 1: 从 fileExtension 提取（去掉点号）
    if (fileExtension) {
        ext = fileExtension.toLowerCase().replace(/^\./, '')  // 只去掉开头的点
    }

    // 方法 2: 如果还是空，尝试从 fileType (MIME) 推断
    if (!ext && fileType) {
        const mimeMap: Record<string, string> = {
            // 文档类
            'application/pdf': 'pdf',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',

            // 文本类
            'text/plain': 'txt',
            'text/html': 'html',
            'text/css': 'css',
            'text/javascript': 'js',
            'application/json': 'json',
            'application/xml': 'xml',
            'text/xml': 'xml',

            // 代码类
            'application/x-python-code': 'py',
            'text/x-python': 'py',
            'text/x-java-source': 'java',
            'text/x-c': 'c',
            'text/x-c++': 'cpp',
            'text/x-go': 'go',
            'text/x-rust': 'rs',
            'text/x-php': 'php',
            'text/x-ruby': 'rb',

            // 压缩文件
            'application/zip': 'zip',
            'application/x-zip-compressed': 'zip',
            'application/x-rar-compressed': 'rar'
        }
        ext = mimeMap[fileType] || 'txt'
    }

    // 方法 3: 如果还是空，默认 txt
    if (!ext) {
        ext = 'txt'
    }

    console.log(`[DEBUG] getFileIcon: fileType=${fileType}, fileExtension=${fileExtension} → ext=${ext}`)
    return fileIconMap[ext] || fileTxtIcon
}

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
function getStatusType(status: string): string {
    const types: Record<string, string> = {
        'uploading': 'warning',
        'uploaded': 'info',
        'pending': 'info',
        'processing': 'warning',
        'completed': 'success',
        'failed': 'danger',
    }
    return types[status] || 'info'
}

/**
 * 获取状态文本
 */
function getStatusText(status: string): string {
    const texts: Record<string, string> = {
        'uploading': '上传中',
        'uploaded': '等待处理',
        'pending': '等待处理',
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败',
    }
    return texts[status] || status
}

/**
 * 判断是否显示进度条
 */
function shouldShowProgress(status: string): boolean {
    return status === 'uploading'
}

/**
 * 判断是否显示刷新/重试按钮（仅在 failed 或 completed 状态显示）
 */
function shouldShowRefreshButton(status: string): boolean {
    return status === 'failed' || status === 'completed'
}

/**
 * 重新处理文件（用于失败或已完成的文件）
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
    // TODO: 跳转到文件详情页或打开预览
    toast.info('查看功能开发中...')
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

// ✅ 关键修复：组件销毁时清理轮询定时器，防止内存泄漏
onUnmounted(() => {
    console.log('[DEBUG] KnowledgeBasePage 组件销毁，清理轮询定时器')
    store.stopAllFileProcessingPolling()
})

/**
 * 刷新文件列表并启动未完成文件的轮询
 */
async function refreshFileList() {
    if (!store.activeKnowledgeBaseId) return

    try {
        // 1. 从数据库加载文件记录
        const response = await store.fetchFiles(store.activeKnowledgeBaseId)
        const dbFiles = (response.items || []) as KBFile[]
        console.log(`[DEBUG] refreshFileList: 从数据库加载了 ${dbFiles.length} 个文件`)

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
/* 搜索框样式 */
.search-box :deep(.el-input__wrapper) {
    background-color: var(--color-surface);
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--color-border) inset;
    padding: 6px 12px;
    transition: all 0.2s ease;
}

.search-box :deep(.el-input__wrapper:hover) {
    box-shadow: 0 0 0 1px var(--color-primary-300) inset;
}

.search-box :deep(.el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1px var(--color-primary) inset;
}

.search-box :deep(.el-input__inner) {
    font-size: 13px;
}

/* 知识库列表项样式 - 参考 ChatSidebar.vue */
.kb-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    margin: 0.125rem 0.625rem;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.kb-item-inactive {
    color: var(--color-text);
}

.kb-item-inactive:hover {
    background-color: var(--color-conversation-bg-hover);
    color: var(--color-conversation-text-hover);
}

.kb-item-active {
    background-color: var(--color-conversation-bg-active);
    color: var(--color-conversation-text-active);
}

.kb-title {
    line-height: 1.4;
}

.kb-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    margin-left: 2rem;
}

.kb-actions {
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.2s ease;
}

/* 鼠标悬停时操作按钮显示 */
.kb-item:hover .kb-actions {
    opacity: 1;
}

/* 选中状态下操作按钮始终显示 */
/* .kb-item-active .kb-actions {
    opacity: 1;
} */

.kb-action-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.kb-action-trigger:hover {
    background-color: rgba(0, 0, 0, 0.05);
}

.dark .kb-action-trigger:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

/* 空状态样式 */
.empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* 文件列表项样式 - 参考 FileItem.vue */
.file-item {
    transition: all 0.2s ease;
}

.file-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 滚动条美化 - 参考 ChatSidebar.vue */
.kb-sidebar :deep(.el-scrollbar__bar) {
    opacity: 0.6;
    transition: opacity 0.2s;
}

.kb-sidebar :deep(.el-scrollbar__bar:hover) {
    opacity: 1;
}
</style>
