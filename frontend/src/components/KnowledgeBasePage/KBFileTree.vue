<!-- KnowledgeBasePage/KBFileTree.vue -->
<template>
  <div class="pt-4">
    <!-- 面包屑导�?-->
    <div v-if="breadcrumbPath.length > 0" class="mb-3 py-1.5">
      <div class="flex items-center gap-1 text-sm">
        <button @click="navigateToFolder(null)"
          class="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer">
          知识库
        </button>

        <!-- 路径分隔符和各级文件夹-->
        <template v-for="(folder, index) in breadcrumbPath" :key="folder.id">
          <span class="text-gray-400 mx-0.5">></span>
          <button v-if="index !== breadcrumbPath.length - 1" @click="navigateToFolder(folder.id)"
            class="transition-colors cursor-pointer text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
            {{ folder.displayName }}
          </button>
          <span v-else class="text-gray-900 dark:text-gray-100 font-semibold">
            {{ folder.displayName }}
          </span>
        </template>
      </div>
    </div>

    <!-- 文件/文件夹列�?-->
    <div v-if="isLoading" class="text-center py-8">
      <el-icon class="animate-spin text-blue-500" size="32">
        <Loading />
      </el-icon>
      <p class="mt-2 text-sm text-gray-500">加载中..</p>
    </div>

    <div v-else-if="currentItems.length > 0">
      <!-- 表头 -->
      <div
        class="grid grid-cols-[1fr_100px_100px_120px_160px] gap-4 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
        <div>名称</div>
        <div>状态</div>
        <div>类型</div>
        <div>大小</div>
        <div>修改时间</div>
      </div>

      <!-- 文件列表 -->
      <div v-for="item in currentItems" :key="item.id"
        class="file-row grid grid-cols-[1fr_100px_100px_120px_160px] gap-4 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-800 last:border-b-0"
        @click="handleItemClick(item)" @contextmenu.prevent="handleContextMenu($event, item)">
        <!-- 名称�?-->
        <div class="flex items-center gap-2 min-w-0">
          <!-- 文件�?文件图标 -->
          <el-icon v-if="item.isDirectory" class="text-yellow-500 shrink-0" size="18">
            <Folder />
          </el-icon>
          <img v-else :src="getFileIcon(item)" class="w-5 h-5 object-contain shrink-0" alt="file icon" />

          <!-- 名称 -->
          <span class="text-sm text-gray-700 dark:text-gray-300 truncate" :title="item.displayName">
            {{ item.displayName }}
          </span>
        </div>

        <!-- 状态列 -->
        <div class="flex items-center">
          <el-tag v-if="!item.isDirectory" size="small" :type="getStatusType(item.processingStatus)">
            {{ getStatusText(item.processingStatus) }}
          </el-tag>
          <span v-else class="text-xs text-gray-400">-</span>
        </div>

        <!-- 类型-->
        <div class="flex items-center">
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ item.isDirectory ? '文件夹' : (item.fileExtension?.toUpperCase() || '-') }}
          </span>
        </div>

        <!-- 大小-->
        <div class="flex items-center">
          <span v-if="!item.isDirectory" class="text-xs text-gray-500 dark:text-gray-400">
            {{ formatSize(item.fileSize) }}
          </span>
          <span v-else class="text-xs text-gray-400">-</span>
        </div>

        <!-- 修改时间-->
        <div class="flex items-center">
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ formatDate(item.uploadedAt) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 空文件夹-->
    <div v-else class="text-center py-8 text-gray-500 dark:text-gray-400">
      <p>{{ currentFolderId ? '该文件夹为空' : '暂无文件' }}</p>
    </div>

    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible"
      class="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[160px]"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
      <div v-if="!contextMenu.item?.isDirectory"
        class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleRetryFromMenu">
        <el-icon>
          <RefreshRight />
        </el-icon>
        重新处理
      </div>
      <div
        class="px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleDeleteFromMenu">
        <el-icon>
          <Delete />
        </el-icon>
        删除
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Folder, View, RefreshRight, Delete, Loading } from '@element-plus/icons-vue'
import type { KBFile } from '@/stores/knowledgeBase'

// 导入文件图标
import fileCodeIcon from '@/assets/file_code.svg'
import fileTxtIcon from '@/assets/file_txt.svg'
import fileWordIcon from '@/assets/file_word.svg'
import fileExcelIcon from '@/assets/file_excel.svg'
import filePptIcon from '@/assets/file_ppt.svg'
import filePdfIcon from '@/assets/file_zip.svg'

interface Props {
  files: KBFile[]
  kbId: string  // 知识库ID
}

const props = defineProps<Props>()

const emit = defineEmits<{
  view: [file: KBFile]
  retry: [file: KBFile]
  delete: [file: KBFile]
}>()

/**
 * 当前所在的文件夹ID (null表示根目录)
 */
const currentFolderId = ref<string | null>(null)

/**
 * 当前目录下的文件和文件夹(懒加载)
 */
const currentItems = ref<KBFile[]>([])

/**
 * 加载状态
 */
const isLoading = ref(false)

/**
 * 面包屑路径
 */
const breadcrumbPath = ref<Array<{ id: string; displayName: string }>>([])

/**
 * 右键菜单状态
 */
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  item: null as KBFile | null
})

/**
 * 加载指定文件夹的内容
 */
async function loadFolderContents(folderId: string | null) {
  isLoading.value = true

  try {
    const { apiService } = await import('@/services/ApiService')
    const response = await apiService.fetchKBFilesByParent(
      props.kbId,
      folderId,
      0,
      100  // 每页100�?足够显示单层内容
    )

    currentItems.value = (response.items || []).map((file: any) => ({
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

    // 更新面包屑路径
    await updateBreadcrumbPath(folderId)

  } catch (error) {
    console.error('加载文件夹内容失败', error)
    currentItems.value = []
  } finally {
    isLoading.value = false
  }
}

/**
 * 更新面包屑路径
 */
async function updateBreadcrumbPath(folderId: string | null) {
  if (!folderId) {
    breadcrumbPath.value = []
    return
  }

  const path: Array<{ id: string; displayName: string }> = []
  let currentId: string | null = folderId

  let depth = 0
  while (currentId && depth < 10) {
    const folder = currentItems.value.find(f => f.id === currentId && f.isDirectory)

    if (folder) {
      path.unshift({ id: folder.id, displayName: folder.displayName })
      currentId = folder.parentFolderId || null
    } else {
      try {
        const { apiService } = await import('@/services/ApiService')
        const fileDetail = await apiService.getKBFile(props.kbId, currentId) as any

        if (fileDetail && fileDetail.isDirectory) {
          path.unshift({ id: fileDetail.id, displayName: fileDetail.displayName })
          currentId = fileDetail.parentFolderId || null
        } else {
          break
        }
      } catch (error) {
        console.error('获取文件夹信息失�?', error)
        break
      }
    }

    depth++
  }

  breadcrumbPath.value = path
}

/**
 * 导航到指定文件夹
 */
async function navigateToFolder(folderId: string | null) {
  currentFolderId.value = folderId
  // watch会自动触发loadFolderContents
}

/**
 * 处理项目点击
 */
function handleItemClick(item: KBFile) {
  if (item.isDirectory) {
    currentFolderId.value = item.id
  } else if (item.processingStatus === 'completed') {
    // 文件: 触发查看事件
    emit('view', item)
  }
}

/**
 * 监听当前文件夹
 */
watch(currentFolderId, async (newFolderId) => {
  await loadFolderContents(newFolderId)
}, { immediate: true })

/**
 * 强制重新加载当前目录
 */
async function forceReload() {
  console.log('[DEBUG] KBFileTree 强制重新加载当前目录')
  await loadFolderContents(currentFolderId.value)
}

/**
 * 从本地列表中移除文件
 */
function removeFileLocally(fileId: string) {
  const index = currentItems.value.findIndex(item => item.id === fileId)
  if (index !== -1) {
    currentItems.value.splice(index, 1)
    console.log(`[DEBUG] KBFileTree 本地移除文件: ${fileId}`)
  }
}

/**
 * 监听父组件传递的 files 变化,同步更新 currentItems
 * 这是轮询状态更新的关键:当父组件通过轮询更新文件状态时,
 */
watch(
  () => props.files,
  (newFiles) => {
    if (!newFiles || newFiles.length === 0) return

    console.log(`[DEBUG] KBFileTree 监听 props.files 变化, 共 ${newFiles.length} 个文件`)

    newFiles.forEach(newFile => {
      const index = currentItems.value.findIndex(item => item.id === newFile.id)
      if (index !== -1) {
        const oldFile = currentItems.value[index]
        currentItems.value.splice(index, 1, {
          ...newFile,
          id: newFile.id,
          knowledgeBaseId: newFile.knowledgeBaseId,
          fileName: newFile.fileName,
          displayName: newFile.displayName,
          fileSize: newFile.fileSize,
          fileType: newFile.fileType,
          fileExtension: newFile.fileExtension,
          contentHash: newFile.contentHash,
          relativePath: newFile.relativePath,
          parentFolderId: newFile.parentFolderId,
          isDirectory: newFile.isDirectory,
          processingStatus: newFile.processingStatus,
          progressPercentage: newFile.progressPercentage,
          currentStep: newFile.currentStep,
          errorMessage: newFile.errorMessage,
          uploadedAt: newFile.uploadedAt,
          processedAt: newFile.processedAt,
          totalChunks: newFile.totalChunks,
          totalTokens: newFile.totalTokens,
        })
        console.log(`[DEBUG] KBFileTree 同步更新文件状态: ${newFile.displayName} -> ${newFile.processingStatus}`)
      }
    })
  },
  { deep: true }
)

// 暴露方法给父组件
defineExpose({
  forceReload,
  removeFileLocally
})

/**
 * 获取文件图标
 */
function getFileIcon(file: KBFile): string {
  const ext = file.fileExtension?.toLowerCase() || ''

  const iconMap: Record<string, string> = {
    'pdf': filePdfIcon,
    'doc': fileWordIcon,
    'docx': fileWordIcon,
    'xls': fileExcelIcon,
    'xlsx': fileExcelIcon,
    'ppt': filePptIcon,
    'pptx': filePptIcon,
    'txt': fileTxtIcon,
    'md': fileTxtIcon,
    'js': fileCodeIcon,
    'ts': fileCodeIcon,
    'py': fileCodeIcon,
    'java': fileCodeIcon,
  }

  return iconMap[ext] || fileTxtIcon
}

/**
 * 格式化文件大�?
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

/**
 * 获取状态类�?
 */
function getStatusType(status: string): string {
  const types: Record<string, string> = {
    'pending': 'info',
    'processing': 'warning',
    'completed': 'success',
    'failed': 'danger',
  }
  return types[status] || 'info'
}

/**
 * 获取状态
 */
function getStatusText(status: string): string {
  const texts: Record<string, string> = {
    'pending': '等待处理',
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败',
  }
  return texts[status] || status
}

/**
 * 处理查看文件
 */
function handleViewFile(file: KBFile) {
  emit('view', file)
}

/**
 * 处理重新处理
 */
function handleRetryFile(file: KBFile) {
  emit('retry', file)
}

/**
 * 处理删除
 */
function handleDeleteFile(file: KBFile) {
  emit('delete', file)
}

/**
 * 格式化日�?
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
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
 * 处理右键菜单
 */
function handleContextMenu(event: MouseEvent, item: KBFile) {
  event.preventDefault()
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    item
  }
}

/**
 * 从菜单重新处�?
 */
function handleRetryFromMenu() {
  if (contextMenu.value.item) {
    emit('retry', contextMenu.value.item)
  }
  closeContextMenu()
}

/**
 * 从菜单删�?
 */
function handleDeleteFromMenu() {
  if (contextMenu.value.item) {
    emit('delete', contextMenu.value.item)
  }
  closeContextMenu()
}

/**
 * 关闭右键菜单
 */
function closeContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.item = null
}

// 点击其他地方关闭菜单
if (typeof window !== 'undefined') {
  window.addEventListener('click', closeContextMenu)
}
</script>

<style scoped>
.node-content:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.dark .node-content:hover {
  background-color: rgba(255, 255, 255, 0.04);
}
</style>
