<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="340" :anchor-el="anchorEl"
    :max-height="480">
    <div class="ws-popover">
      <!-- 最近选择 -->
      <template v-if="recentList.length > 0">
        <div class="ws-section-header">最近选择</div>
        <div v-for="path in recentList" :key="path"
          class="ws-item"
          :class="{ 'ws-item-active': path === currentWorkspacePath }"
          @click="handleSelect(path)">
          <el-icon size="16" class="ws-item-icon shrink-0">
            <Folder20Regular />
          </el-icon>
          <div class="ws-item-text">
            <span class="ws-item-name">{{ getFolderName(path) }}</span>
            <span class="ws-item-path">{{ getParentPath(path) }}</span>
          </div>
          <el-icon v-if="path === currentWorkspacePath" size="14" class="ws-item-check shrink-0">
            <Checkmark16Filled />
          </el-icon>
        </div>
        <div class="ws-divider"></div>
      </template>

      <!-- 自动创建 -->
      <div class="ws-section-header">自动创建</div>
      <div class="ws-item"
        :class="{ 'ws-item-active': !currentWorkspacePath }"
        @click="handleSelect(null)">
        <el-icon size="16" class="ws-item-icon shrink-0">
          <FolderAdd24Regular />
        </el-icon>
        <div class="ws-item-text">
          <span class="ws-item-name">自动创建</span>
          <span class="ws-item-path">使用系统默认目录</span>
        </div>
        <el-icon v-if="!currentWorkspacePath" size="14" class="ws-item-check shrink-0">
          <Checkmark16Filled />
        </el-icon>
      </div>

      <!-- 打开文件夹（仅 Electron） -->
      <template v-if="isElectron">
        <div class="ws-divider"></div>
        <div class="ws-item" @click="handleOpenFolder">
          <el-icon size="16" class="ws-item-icon shrink-0">
            <FolderOpen24Regular />
          </el-icon>
          <div class="ws-item-text">
            <span class="ws-item-name">打开文件夹</span>
          </div>
        </div>
      </template>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ElIcon, ElMessage } from 'element-plus'
import { Folder20Regular, FolderOpen24Regular, FolderAdd24Regular, Checkmark16Filled } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentWorkspacePath?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [workspacePath: string | null]
}>()

const workspaceStore = useWorkspaceStore()
const recentList = workspaceStore.recentList

const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

function getFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

function getParentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.substring(0, idx)
}

function handleSelect(path: string | null) {
  emit('select', path)
  emit('update:visible', false)
}

async function handleOpenFolder() {
  if (!isElectron || !(window as any).electronAPI?.selectFolder) return
  try {
    const selectedPath = await (window as any).electronAPI.selectFolder()
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

<style scoped>
.ws-popover {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ws-section-header {
  font-size: 11px;
  font-weight: 500;
  color: #999;
  padding: 4px 8px;
  user-select: none;
}

.dark .ws-section-header {
  color: #6b7280;
}

.ws-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.ws-item:hover {
  background: var(--color-sidebar-bg-hover, #f5f5f5);
}

.dark .ws-item:hover {
  background: var(--color-sidebar-bg-hover, rgba(255, 255, 255, 0.06));
}

.ws-item-active {
  background: var(--color-sidebar-bg-active, #e8f0fe);
}

.ws-item-active:hover {
  background: var(--color-sidebar-bg-active, #e8f0fe);
}

.ws-item-icon {
  color: #666;
}

.dark .ws-item-icon {
  color: #9ca3af;
}

.ws-item-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ws-item-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark .ws-item-name {
  color: #e5e7eb;
}

.ws-item-path {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark .ws-item-path {
  color: #6b7280;
}

.ws-item-check {
  color: var(--el-color-primary, #409eff);
}

.ws-divider {
  height: 1px;
  background: #eee;
  margin: 6px 8px;
}

.dark .ws-divider {
  background: rgba(255, 255, 255, 0.08);
}
</style>
