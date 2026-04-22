<!-- KnowledgeBasePage/KBFileTree.vue -->
<template>
  <div class="pt-4">
    <!-- 面包屑导�?-->
    <div v-if="breadcrumbPath.length > 0" class="mb-3 py-1.5">
      <div class="flex items-center gap-1 text-sm">
        <button @click="navigateToFolderByPath(null)"
          class="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer">
          知识库
        </button>

        <!-- 路径分隔符和各级文件夹-->
        <template v-for="(folder, index) in breadcrumbPath" :key="folder.path">
          <span class="text-gray-400 mx-0.5">></span>
          <button v-if="index !== breadcrumbPath.length - 1" @click="navigateToFolderByPath(folder.path)"
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
        <!-- 名称-->
        <div class="flex items-center gap-2 min-w-0">
          <!-- 文件图标 -->
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
      <p>{{ currentRelativePath ? '该文件夹为空' : '暂无文件' }}</p>
    </div>

    <!-- 右键菜单 -->
    <div v-if="contextMenu.visible"
      class="fixed bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50 min-w-[160px]"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
      <div
        class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleRenameFromMenu">
        <el-icon>
          <Edit />
        </el-icon>
        重命名
      </div>
      <div
        class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2"
        @click="handleMoveFromMenu">
        <el-icon>
          <Position />
        </el-icon>
        移动到...
      </div>
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

    <!-- 重命名对话框 -->
    <el-dialog v-model="showRenameDialog" title="重命名" width="400px" :close-on-click-modal="false" append-to-body>
      <el-input v-model="renameForm.newName" placeholder="输入新名称" @keyup.enter="confirmRename" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename" :loading="renameLoading">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动对话框 -->
    <el-dialog v-model="showMoveDialog" title="移动到" width="500px" :close-on-click-modal="false" append-to-body>
      <div class="max-h-80 overflow-y-auto">
        <!-- 根目录选项 -->
        <div
          class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          :class="{ 'bg-blue-50 dark:bg-blue-900/30': selectedTargetFolderId === null }"
          @click="selectRootDirectory"
        >
          <el-icon><Folder /></el-icon>
          <span>根目录</span>
        </div>

        <!-- 文件夹树 -->
        <el-tree :data="folderTreeData" :props="{ label: 'displayName', children: 'children' }" node-key="id"
          highlight-current @node-click="selectTargetFolder" class="mt-2">
          <template #default="{ node, data }">
            <span class="flex items-center gap-2">
              <el-icon>
                <Folder />
              </el-icon>
              {{ node.label }}
            </span>
          </template>
        </el-tree>
      </div>
      <template #footer>
        <el-button @click="showMoveDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmMove" :loading="moveLoading">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { Folder, View, RefreshRight, Delete, Loading, Edit, Position } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { KBFile } from '@/stores/knowledgeBase'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'

// 导入文件图标
import fileCodeIcon from '@/assets/file_code.svg'
import fileTxtIcon from '@/assets/file_txt.svg'
import fileWordIcon from '@/assets/file_word.svg'
import fileExcelIcon from '@/assets/file_excel.svg'
import filePptIcon from '@/assets/file_ppt.svg'
import filePdfIcon from '@/assets/file_zip.svg'

interface Props {
  kbId: string  // 知识库ID
}

const props = defineProps<Props>()

const emit = defineEmits<{
  view: [file: KBFile]
  retry: [file: KBFile]
  delete: [file: KBFile]
  folderChange: [folderPath: string | null]  // 目录切换事件
  filesLoaded: [files: KBFile[]]  // 文件加载完成事件
}>()

const kbStore = useKnowledgeBaseStore()

/**
 * 当前所在的文件夹ID (null表示根目录)
 */
/**
 * 当前相对路径（核心状态，替代 currentFolderId）
 */
const currentRelativePath = ref<string | null>(null)

/**
 * 当前目录下的文件和文件夹(懒加载)
 */
const currentItems = ref<KBFile[]>([])

/**
 * 加载状态
 */
const isLoading = ref(false)

/**
 * 面包屑路径（使用路径而非ID）
 */
const breadcrumbPath = ref<Array<{ path: string; displayName: string }>>([])

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
 * 重命名表单状态
 */
const showRenameDialog = ref(false)
const renameForm = ref({ newName: '' })
const renameLoading = ref(false)
const renamingFileId = ref<string | null>(null) // 保存正在重命名的文件ID

/**
 * 移动对话框状态
 */
const showMoveDialog = ref(false)
const selectedTargetFolderId = ref<string | null>(null)
const folderTreeData = ref<any[]>([])
const moveLoading = ref(false)
const movingFileId = ref<string | null>(null) // 保存正在移动的文件ID

/**
 * 文件处理轮询相关状态
 */
const POLL_INTERVAL = 3000 // 3 秒轮询间隔
let pollingTimer: NodeJS.Timeout | null = null
let pollingFileIds = new Set<string>()

/**
 * 加载指定路径的文件夹内容
 */
async function loadFolderContents(relativePath: string | null) {
  isLoading.value = true

  try {
    const { apiService } = await import('@/services/ApiService')

    // 直接使用路径查询接口
    const response = await apiService.fetchKBFilesByPath(
      props.kbId,
      relativePath,
      0,
      100  // 每页100条足够显示单层内容
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

    // 更新面包屑路径（直接从 relativePath 解析）
    updateBreadcrumbPathFromRelativePath(relativePath)

    // 关键修复:数据加载完成后,通知父组件
    emit('filesLoaded', currentItems.value)
    console.log(`[DEBUG] KBFileTree 文件加载完成,共 ${currentItems.value.length} 个文件`)

    // 关键优化:数据加载完成后,自动启动轮询
    await startFileProcessingPolling()

  } catch (error) {
    console.error('加载文件夹内容失败', error)
    currentItems.value = []
    // 即使出错也通知父组件
    emit('filesLoaded', [])
  } finally {
    isLoading.value = false
  }
}

/**
 * 从 relativePath 直接解析面包屑路径（同步方法，无需API调用）
 */
function updateBreadcrumbPathFromRelativePath(relativePath: string | null) {
  if (!relativePath) {
    breadcrumbPath.value = []
    return
  }

  // 从 relativePath 解析出每一级目录
  // 例如: "docs/api/guide" → [
  //   { path: "docs", displayName: "docs" },
  //   { path: "docs/api", displayName: "api" },
  //   { path: "docs/api/guide", displayName: "guide" }
  // ]
  const pathParts = relativePath.split('/')
  const path: Array<{ path: string; displayName: string }> = []

  let accumulatedPath = ''
  for (let i = 0; i < pathParts.length; i++) {
    const partName = pathParts[i]
    accumulatedPath = accumulatedPath ? `${accumulatedPath}/${partName}` : partName

    path.push({
      path: accumulatedPath,
      displayName: partName
    })
  }

  breadcrumbPath.value = path
}

/**
 * 启动文件处理轮询（组件内部管理）
 */
async function startFileProcessingPolling() {
  // 筛选出 processing/pending 状态的文件
  const processingFiles = currentItems.value.filter(file =>
    file.processingStatus === 'processing' || file.processingStatus === 'pending'
  )

  if (processingFiles.length === 0) {
    console.log('[DEBUG] KBFileTree: 没有需要轮询的文件')
    stopFileProcessingPolling()
    return
  }

  // 停止之前的轮询
  stopFileProcessingPolling()

  // 添加新的文件 ID
  processingFiles.forEach(file => pollingFileIds.add(file.id))

  console.log(`[DEBUG] KBFileTree: 开始轮询 ${pollingFileIds.size} 个文件`)

  const poll = async () => {
    try {
      const { apiService } = await import('@/services/ApiService')

      // 批量获取文件状态
      const responses = await apiService.batchGetFileProcessingStatus(
        props.kbId,
        Array.from(pollingFileIds)
      )

      console.log(`[DEBUG] KBFileTree: 轮询收到 ${responses.length} 个文件的状态更新`)

      // 遍历结果并更新本地状态
      responses.forEach((response: any) => {
        // 更新本地文件状态
        updateFileStatus(response.id, {
          processingStatus: response.processingStatus,
          progressPercentage: response.progressPercentage || 0,
          currentStep: response.currentStep || null,
          errorMessage: response.errorMessage || null,
          totalChunks: response.totalChunks || 0,
          totalTokens: response.totalTokens || 0
        })

        // 如果文件处理完成或失败，从轮询列表中移除
        if (response.processingStatus === 'completed' ||
          response.processingStatus === 'failed') {
          console.log(`[DEBUG] KBFileTree: 文件 ${response.id} 处理${response.processingStatus === 'completed' ? '完成' : '失败'},停止轮询`)
          pollingFileIds.delete(response.id)
        }
      })

      // 如果所有文件都处理完成，停止轮询
      if (pollingFileIds.size === 0) {
        console.log('[DEBUG] KBFileTree: 所有文件处理完成,停止轮询')
        stopFileProcessingPolling()
      }
    } catch (error) {
      console.error(`[DEBUG] KBFileTree: 批量轮询文件状态失败:`, error)
      // 出错时不停止轮询，继续尝试
    }
  }

  // 立即执行一次
  await poll()

  // 定时轮询
  pollingTimer = setInterval(poll, POLL_INTERVAL)
}

/**
 * 停止文件处理轮询
 */
function stopFileProcessingPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
    console.log('[DEBUG] KBFileTree: 停止轮询')
  }
  pollingFileIds.clear()
}

/**
 * 导航到指定文件夹（通过路径）
 */
function navigateToFolderByPath(relativePath: string | null) {
  // 直接设置路径，watch 会自动触发 loadFolderContents
  currentRelativePath.value = relativePath
}

/**
 * 处理项目点击
 */
function handleItemClick(item: KBFile) {
  if (item.isDirectory) {
    // 文件夹: 导航到该路径
    currentRelativePath.value = item.relativePath || null
  } else if (item.processingStatus === 'completed') {
    // 文件: 触发查看事件
    emit('view', item)
  }
}

/**
 * 监听当前文件夹
 */
// 监听当前路径变化，自动加载内容
watch(currentRelativePath, async (newPath) => {
  await loadFolderContents(newPath)
  // 关键修复:通知父组件目录已切换,需要重新轮询
  emit('folderChange', newPath)
}, { immediate: true })

/**
 * 强制重新加载当前目录
 */
async function forceReload() {
  console.log('[DEBUG] KBFileTree 强制重新加载当前目录')
  await loadFolderContents(currentRelativePath.value)
}

/**
 * 从本地列表中移除文件（供父组件调用）
 */
function removeFileLocally(fileId: string) {
  const index = currentItems.value.findIndex(item => item.id === fileId)
  if (index !== -1) {
    currentItems.value.splice(index, 1)
    console.log(`[DEBUG] KBFileTree 本地移除文件: ${fileId}`)
  }
}

/**
 * 更新文件状态（供父组件轮询回调使用）
 */
function updateFileStatus(fileId: string, updates: Partial<KBFile>) {
  const index = currentItems.value.findIndex(item => item.id === fileId)
  if (index !== -1) {
    const updatedItem = { ...currentItems.value[index], ...updates }
    currentItems.value.splice(index, 1, updatedItem)
    console.log(`[DEBUG] KBFileTree 更新文件状态: ${updatedItem.displayName} -> ${updates.processingStatus}`)
  }
}

/**
 * 获取当前目录的所有文件（供父组件查询）
 */
function getCurrentFiles(): KBFile[] {
  return currentItems.value
}

/**
 * 智能插入上传完成的文件（增量更新）
 * @param uploadedFile 上传完成的文件信息
 */
async function insertUploadedFile(uploadedFile: KBFile) {
  console.log(`[DEBUG] KBFileTree: 尝试插入文件 ${uploadedFile.displayName}, relativePath: ${uploadedFile.relativePath}`)

  const currentPath = currentRelativePath.value

  // 关键修复:上传完成后状态应为 pending（后端还在处理）
  const fileToInsert: KBFile = {
    ...uploadedFile,
    processingStatus: 'pending',  // 改为 pending
    progressPercentage: 0,
    currentStep: '等待处理...'
  }

  // 情况1: 文件属于当前目录的一级子项
  if (isDirectChildOfCurrentPath(fileToInsert.relativePath, currentPath)) {
    console.log('[DEBUG] KBFileTree: 文件是一级子项，直接插入')

    // 检查是否已存在（避免重复）
    const exists = currentItems.value.some(item => item.id === fileToInsert.id)
    if (!exists) {
      // 关键修复:智能插入位置 - 文件插入到文件列表顶部，但保持目录在上方
      insertItemAtCorrectPosition(fileToInsert)
      console.log(`[DEBUG] KBFileTree: 已插入文件 ${fileToInsert.displayName}`)

      // 关键修复:插入后检查是否需要启动轮询
      if (fileToInsert.processingStatus === 'pending' || fileToInsert.processingStatus === 'processing') {
        console.log('[DEBUG] KBFileTree: 检测到 pending/processing 状态文件，重启轮询')
        await startFileProcessingPolling()
      }
    } else {
      console.log('[DEBUG] KBFileTree: 文件已存在，跳过插入')
    }
    return
  }

  // 情况2: 文件属于当前目录的深层子项，需要创建临时目录
  const tempDirName = getFirstLevelSubdir(fileToInsert.relativePath, currentPath)
  if (tempDirName) {
    console.log(`[DEBUG] KBFileTree: 文件是深层子项，创建临时目录 ${tempDirName}`)

    // 检查临时目录是否已存在
    const dirExists = currentItems.value.some(item =>
      item.isDirectory && item.displayName === tempDirName
    )

    if (!dirExists) {
      // 创建临时目录对象
      const tempDir: KBFile = {
        id: `temp-dir-${tempDirName}-${Date.now()}`,  // 临时ID
        knowledgeBaseId: fileToInsert.knowledgeBaseId,
        fileName: tempDirName,
        displayName: tempDirName,
        fileSize: 0,
        fileType: 'directory',
        fileExtension: '',
        contentHash: '',
        relativePath: currentPath ? `${currentPath}/${tempDirName}` : tempDirName,
        parentFolderId: null,
        isDirectory: true,
        processingStatus: 'completed',
        progressPercentage: 100,
        currentStep: null,
        errorMessage: null,
        uploadedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        totalChunks: 0,
        totalTokens: 0
      }

      // 关键修复:目录插入到目录列表顶部
      insertItemAtCorrectPosition(tempDir)
      console.log(`[DEBUG] KBFileTree: 已创建临时目录 ${tempDirName}`)
    } else {
      console.log(`[DEBUG] KBFileTree: 临时目录 ${tempDirName} 已存在，跳过`)
    }
    return
  }

  // 情况3: 文件不属于当前目录，不处理
  console.log('[DEBUG] KBFileTree: 文件不属于当前目录，跳过插入')
}

/**
 * 智能插入项目到正确位置（目录在上方，文件在下方）
 * @param item 要插入的项目
 */
function insertItemAtCorrectPosition(item: KBFile) {
  if (item.isDirectory) {
    // 目录：找到第一个非目录项的位置，插入到它前面
    const firstFileIndex = currentItems.value.findIndex(i => !i.isDirectory)
    if (firstFileIndex === -1) {
      // 没有文件，直接添加到最后
      currentItems.value.push(item)
    } else {
      // 插入到第一个文件之前
      currentItems.value.splice(firstFileIndex, 0, item)
    }
  } else {
    // 文件：找到第一个文件的位置，插入到它前面
    const firstFileIndex = currentItems.value.findIndex(i => !i.isDirectory)
    if (firstFileIndex === -1) {
      // 没有文件，直接添加到最后
      currentItems.value.push(item)
    } else {
      // 插入到第一个文件之前（即文件列表的顶部）
      currentItems.value.splice(firstFileIndex, 0, item)
    }
  }
}

/**
 * 判断文件是否是当前路径的直接子项
 */
function isDirectChildOfCurrentPath(fileRelativePath: string | null | undefined, currentPath: string | null): boolean {
  // 当前在根目录
  if (!currentPath) {
    // 文件也在根目录（relativePath 为 null、空、或不包含 /）
    if (!fileRelativePath || fileRelativePath === '') {
      return true
    }
    // 关键修复:根目录下，只要路径不包含 /，就是直接子项
    return !fileRelativePath.includes('/')
  }

  // 当前在子目录，文件必须是该目录的直接子项
  // 例如: currentPath="a", fileRelativePath="a/file.txt" → true
  //       currentPath="a", fileRelativePath="a/b/file.txt" → false
  if (fileRelativePath) {
    const expectedPrefix = currentPath + '/'
    if (fileRelativePath.startsWith(expectedPrefix)) {
      const remaining = fileRelativePath.substring(expectedPrefix.length)
      // 剩余部分不能包含 / ，说明是直接子项
      return !remaining.includes('/')
    }
  }

  return false
}

/**
 * 获取第一层子目录名称
 * @param fileRelativePath 文件的相对路径
 * @param currentPath 当前目录路径
 * @returns 第一层子目录名称，如果不是深层子项则返回 null
 */
function getFirstLevelSubdir(fileRelativePath: string | null | undefined, currentPath: string | null): string | null {
  if (!fileRelativePath) return null

  // 当前在根目录的情况
  if (!currentPath) {
    // 文件路径包含 / ，说明在子目录中
    if (fileRelativePath.includes('/')) {
      const parts = fileRelativePath.split('/')
      return parts[0]  // 返回第一层目录名
    }
    // 文件在根目录，不需要创建目录
    return null
  }

  // 当前在子目录的情况
  const expectedPrefix = currentPath + '/'
  if (!fileRelativePath.startsWith(expectedPrefix)) return null

  const remaining = fileRelativePath.substring(expectedPrefix.length)
  const parts = remaining.split('/')

  // 如果只有一层，说明是直接子项，不需要创建目录
  if (parts.length <= 1) return null

  // 返回第一层目录名
  return parts[0]
}

// 暴露方法给父组件
defineExpose({
  forceReload,
  removeFileLocally,
  updateFileStatus,
  getCurrentFiles,
  insertUploadedFile,  // 新增:智能插入上传完成的文件
  getCurrentFolderPath: () => currentRelativePath.value
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
 * 从重命名菜单触发
 */
function handleRenameFromMenu() {
  if (contextMenu.value.item) {
    renamingFileId.value = contextMenu.value.item.id // 保存文件ID
    renameForm.value.newName = contextMenu.value.item.displayName
    showRenameDialog.value = true
  }
  closeContextMenu()
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

/**
 * 确认重命名
 */
async function confirmRename() {
  console.log('[DEBUG] 确认重命名:', {
    newName: renameForm.value.newName,
    fileId: renamingFileId.value,
  })
  
  if (!renameForm.value.newName || !renamingFileId.value) {
    console.warn('[DEBUG] 重命名参数无效')
    return
  }

  // 前端验证
  const validation = validateFileName(renameForm.value.newName)
  if (!validation.valid) {
    ElMessage.warning(validation.message)
    return
  }

  renameLoading.value = true
  try {
    await kbStore.renameFile(
      props.kbId,
      renamingFileId.value,
      renameForm.value.newName,
    )
    ElMessage.success('重命名成功')
    showRenameDialog.value = false
    
    // 刷新当前目录
    await loadFolderContents(currentRelativePath.value)
  } catch (error: any) {
    console.error('[DEBUG] 重命名失败:', error)
    ElMessage.error(error.message || '重命名失败')
  } finally {
    renameLoading.value = false
  }
}

/**
 * 从移动菜单触发
 */
async function handleMoveFromMenu() {
  if (!contextMenu.value.item) {
    return
  }

  movingFileId.value = contextMenu.value.item.id // 保存文件ID
  // 加载文件夹树
  await loadFolderTree()
  showMoveDialog.value = true
  closeContextMenu()
}

/**
 * 加载文件夹树（用于移动选择）
 */
async function loadFolderTree() {
  try {
    const { apiService } = await import('@/services/ApiService')

    // 获取所有文件夹（递归）
    const response = await apiService.fetchKBFiles(props.kbId, 0, 1000)
    const allItems = response.items || []

    // 过滤出文件夹，并构建树形结构
    const folders = allItems.filter((item: any) => item.isDirectory)
    folderTreeData.value = buildFolderTree(folders)
  } catch (error) {
    console.error('加载文件夹树失败:', error)
    folderTreeData.value = []
  }
}

/**
 * 构建文件夹树
 */
function buildFolderTree(folders: any[]): any[] {
  const folderMap = new Map<string, any>()
  const rootFolders: any[] = []

  // 创建映射
  folders.forEach(folder => {
    folderMap.set(folder.id, {
      id: folder.id,
      displayName: folder.displayName,
      relativePath: folder.relativePath,
      children: [],
    })
  })

  // 构建树
  folders.forEach(folder => {
    const node = folderMap.get(folder.id)!
    if (folder.parentFolderId && folderMap.has(folder.parentFolderId)) {
      const parent = folderMap.get(folder.parentFolderId)!
      parent.children.push(node)
    } else {
      rootFolders.push(node)
    }
  })

  return rootFolders
}

/**
 * 选择目标文件夹
 */
function selectTargetFolder(data: any) {
  selectedTargetFolderId.value = data.id
}

/**
 * 选择根目录
 */
function selectRootDirectory() {
  selectedTargetFolderId.value = null
}

/**
 * 确认移动
 */
async function confirmMove() {
  console.log('[DEBUG] 确认移动:', {
    fileId: movingFileId.value,
    targetParentFolderId: selectedTargetFolderId.value,
  })
  
  if (!movingFileId.value) {
    console.warn('[DEBUG] 移动参数无效')
    return
  }

  moveLoading.value = true
  try {
    await kbStore.moveFile(
      props.kbId,
      movingFileId.value,
      selectedTargetFolderId.value,
    )
    ElMessage.success('移动成功')
    showMoveDialog.value = false
    
    // 刷新当前目录
    await loadFolderContents(currentRelativePath.value)
  } catch (error: any) {
    console.error('[DEBUG] 移动失败:', error)
    ElMessage.error(error.message || '移动失败')
  } finally {
    moveLoading.value = false
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

// 组件卸载时清理轮询定时器
onUnmounted(() => {
  console.log('[DEBUG] KBFileTree 组件销毁,清理轮询定时器')
  stopFileProcessingPolling()
})
</script>

<style scoped>
.node-content:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

.dark .node-content:hover {
  background-color: rgba(255, 255, 255, 0.04);
}
</style>
