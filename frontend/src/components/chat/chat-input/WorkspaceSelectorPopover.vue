<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="340" :anchor-el="anchorEl"
    :max-height="480">
    <div class="flex flex-col gap-0.5">
      <!-- 最近选择 -->
      <template v-if="recentList.length > 0">
        <div class="text-[11px] font-medium text-[#999] dark:text-[#6b7280] px-2 py-1 select-none">最近选择</div>
        <div v-for="path in filteredRecentList" :key="path"
          class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
          :class="path === currentWorkspacePath
            ? 'bg-(--color-sidebar-bg-active) hover:bg-(--color-sidebar-bg-active) text-(--color-sidebar-text-active)'
            : 'hover:bg-(--color-sidebar-bg-hover)'"
          @click="handleSelect(path)">
          <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
            <Folder20Regular />
          </el-icon>
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ getFolderName(path) }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ path }}</span>
          </div>
          <el-icon v-if="path === currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
            <Checkmark16Filled />
          </el-icon>
        </div>
        <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      </template>

      <!-- 使用公共目录 -->
      <div v-if="publicPath"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="publicPath === currentWorkspacePath
          ? 'bg-(--color-sidebar-bg-active) hover:bg-(--color-sidebar-bg-active)'
          : 'hover:bg-(--color-sidebar-bg-hover)'"
        @click="handleSelect(publicPath)">
        <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
          <PeopleCommunity16Regular />
        </el-icon>
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0">使用公共目录</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ publicPath }}</span>
        </div>
        <el-icon v-if="publicPath === currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>

      <!-- 自动创建 -->
      <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="!currentWorkspacePath
          ? 'bg-(--color-sidebar-bg-active) hover:bg-(--color-sidebar-bg-active)'
          : 'hover:bg-(--color-sidebar-bg-hover)'"
        @click="handleSelect(null)">
        <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
          <FolderAdd24Regular />
        </el-icon>
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">自动创建</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">创建随机名称的工作目录</span>
        </div>
        <el-icon v-if="!currentWorkspacePath" size="14" class="shrink-0 text-(--el-color-primary)">
          <Checkmark16Filled />
        </el-icon>
      </div>

      <!-- 打开文件夹（仅 Electron） -->
      <template v-if="isElectron">
        <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--color-sidebar-bg-hover)"
          @click="handleOpenFolder">
          <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
            <Desktop16Regular />
          </el-icon>
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] whitespace-nowrap">选择本地文件夹</span>
          </div>
        </div>
      </template>

      <!-- 远端目录 -->
      <div
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--color-sidebar-bg-hover)"
        @click="remoteDialogVisible = true"
      >
        <el-icon size="18" class="shrink-0 text-(--color-text-gray) dark:text-(--color-text-disabled)">
          <Cloud24Regular />
        </el-icon>
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--color-text) dark:text-[#e5e7eb] whitespace-nowrap">远端目录...</span>
        </div>
      </div>
    </div>
  </CustomPopover>

  <RemoteConnectionDialog
    v-model:visible="remoteDialogVisible"
    :selected-workspace-path="currentWorkspacePath"
    @select="handleRemoteSelect"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElIcon, ElMessage } from 'element-plus'
import { Folder20Regular, Desktop16Regular, FolderAdd24Regular, Checkmark16Filled, PeopleCommunity16Regular, Cloud24Regular } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'
import RemoteConnectionDialog from './RemoteConnectionDialog.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentWorkspacePath?: string | null
  publicPath?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [workspacePath: string | null]
}>()

const workspaceStore = useWorkspaceStore()
const recentList = computed(() => workspaceStore.recentList)

// 过滤掉公共目录，避免与固定入口重复
const filteredRecentList = computed(() => {
  if (!publicPath.value) return recentList.value
  return recentList.value.filter((p: string) => p !== publicPath.value)
})

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

const publicPath = computed(() => props.publicPath || null)

const remoteDialogVisible = ref(false)

function handleRemoteSelect(workspacePath: string) {
  emit('select', workspacePath)
}

function getFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

function handleSelect(path: string | null) {
  emit('select', path)
  emit('update:visible', false)
}

async function handleOpenFolder() {
  if (!isElectron || !window.electronAPI?.selectFolder) return
  try {
    const selectedPath = await window.electronAPI.selectFolder()
    if (selectedPath) {
      emit('select', selectedPath)
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    ElMessage.error('选择文件夹失败')
  } finally {
    emit('update:visible', false)
  }
}
</script>
