<template>
  <GdDialog v-model="dialogVisible" size="md" :title="title || t('ui.directoryBrowser.title')"
    :close-on-click-modal="true" append-to-body class="directory-browser-dialog" @open="handleOpen">
    <!-- 路径输入 + 跳转 + 返回上级 -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <button type="button" :disabled="!canGoUp || loading" :title="t('ui.directoryBrowser.goUp')"
        class="flex items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0"
        :class="canGoUp && !loading
          ? 'cursor-pointer hover:bg-(--gd-color-sidebar-bg-hover) text-(--gd-color-text)'
          : 'opacity-30 cursor-default text-gray-400'"
        @click="goUp">
        <el-icon size="16"><ArrowUp16Regular /></el-icon>
      </button>
      <input ref="inputRef" v-model="inputPath" type="text" spellcheck="false"
        :placeholder="t('ui.directoryBrowser.pathPlaceholder')"
        class="flex-1 min-w-0 bg-transparent outline-none text-sm text-(--gd-color-text) placeholder-gray-400 font-mono"
        @keyup.enter="navigateTo(inputPath)" />
      <GdButton size="small" :disabled="loading || !inputPath.trim()" @click="navigateTo(inputPath)">
        {{ t('ui.directoryBrowser.jump') }}
      </GdButton>
    </div>

    <!-- 目录列表 -->
    <div class="h-80 overflow-y-auto py-1">
      <!-- 加载中 -->
      <div v-if="loading" class="flex flex-col items-center justify-center h-full text-gray-400">
        <el-icon class="animate-spin text-2xl mb-2"><Loading /></el-icon>
        <span class="text-xs">{{ t('ui.directoryBrowser.loading') }}</span>
      </div>

      <!-- 加载失败（无权限等） -->
      <div v-else-if="error" class="flex flex-col items-center justify-center h-full text-gray-400 px-6">
        <DismissCircle16Regular class="w-8 h-8 mb-2 text-red-400" />
        <span class="text-xs text-center">{{ error }}</span>
      </div>

      <!-- 路径不存在 -->
      <div v-else-if="!exists" class="flex flex-col items-center justify-center h-full text-gray-400 px-6">
        <FolderProhibited16Regular class="w-8 h-8 mb-2 opacity-40" />
        <span class="text-xs">{{ t('ui.directoryBrowser.notExist') }}</span>
      </div>

      <!-- 空目录 -->
      <div v-else-if="dirEntries.length === 0" class="flex flex-col items-center justify-center h-full text-gray-400">
        <Folder16Regular class="w-8 h-8 mb-2 opacity-40" />
        <span class="text-xs">{{ t('ui.directoryBrowser.empty') }}</span>
      </div>

      <!-- 目录条目（只列目录，点文件无操作） -->
      <template v-else>
        <div v-for="entry in dirEntries" :key="entry.name"
          class="flex items-center gap-2 mx-1 px-3 py-1.5 rounded-md transition-colors duration-150"
          :class="entry.isDirectory
            ? 'cursor-pointer hover:bg-(--gd-color-sidebar-bg-hover)'
            : 'opacity-50 cursor-default'"
          :title="entry.name"
          @click="entry.isDirectory && enterDir(entry.name)"
          @dblclick.prevent="entry.isDirectory && enterDir(entry.name)">
          <el-icon size="16" class="shrink-0" :class="entry.isDirectory ? 'text-(--gd-color-warning, #e6a23c)' : 'text-gray-400'">
            <Folder16Regular v-if="entry.isDirectory" />
            <Document16Regular v-else />
          </el-icon>
          <span class="flex-1 truncate text-sm text-(--gd-color-text)">{{ entry.name }}</span>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <span class="flex-1 truncate text-xs text-gray-400 font-mono" :title="currentPath">{{ currentPath }}</span>
        <GdButton size="small" @click="dialogVisible = false">{{ t('common.cancel') }}</GdButton>
        <GdButton size="small" type="primary" :disabled="!exists || loading" @click="confirmSelect">
          {{ confirmText || t('ui.directoryBrowser.confirm') }}
        </GdButton>
      </div>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { ArrowUp16Regular, DismissCircle16Regular, Document16Regular, Folder16Regular, FolderProhibited16Regular } from '@vicons/fluent'
import GdDialog from '@/components/ui/GdDialog.vue'
import GdButton from '@/components/ui/GdButton.vue'
import { apiService } from '@/services/ApiService'
import type { DirEntry } from '@/services/modules/remote-workspace.api'
import { getErrorMessage } from '@/utils/errorMessage'
import { canGoUp as computeCanGoUp, createBrowseRequestGuard, joinPath, parentPath } from '@/utils/directoryBrowser'

const props = defineProps<{
  modelValue: boolean
  /** 初始浏览目录；空则由后端回退用户主目录 */
  initialPath?: string
  title?: string
  confirmText?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'select': [path: string]
}>()

const { t } = useI18n()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const inputPath = ref('')

const currentPath = ref('')
const dirEntries = ref<DirEntry[]>([])
const loading = ref(false)
const exists = ref(false)
const error = ref('')

/**
 * 请求守卫：自增代次淘汰迟到响应（快速连点目录/切路径时旧请求后到，
 * 不作废会覆盖最新目录的状态）——模式同 zcode DirectoryBrowser 的 requestGuard。
 */
const guard = createBrowseRequestGuard()

const canGoUp = computed(() => computeCanGoUp(currentPath.value))

async function navigateTo(target?: string) {
  const trimmed = (target ?? inputPath.value).trim()
  const gen = guard.begin()
  loading.value = true
  error.value = ''
  try {
    const result = await apiService.browseLocalPath(trimmed)
    if (!guard.isCurrent(gen)) return
    currentPath.value = result.path
    inputPath.value = result.path
    dirEntries.value = result.entries
    exists.value = result.exists
  } catch (e) {
    if (!guard.isCurrent(gen)) return
    dirEntries.value = []
    exists.value = false
    error.value = getErrorMessage(e) || t('ui.directoryBrowser.loadFailed')
  } finally {
    if (guard.isCurrent(gen)) loading.value = false
  }
}

function enterDir(name: string) {
  navigateTo(joinPath(currentPath.value, name))
}

function goUp() {
  if (!canGoUp.value) return
  navigateTo(parentPath(currentPath.value))
}

function confirmSelect() {
  if (!exists.value) return
  emit('select', currentPath.value)
  dialogVisible.value = false
}

function handleOpen() {
  loading.value = false
  error.value = ''
  exists.value = false
  dirEntries.value = []
  currentPath.value = ''
  inputPath.value = props.initialPath?.trim() || ''
  navigateTo(inputPath.value)
}
</script>
