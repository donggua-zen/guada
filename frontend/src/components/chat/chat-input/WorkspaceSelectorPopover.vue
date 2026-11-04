<template>
  <GdPopover :show="visible" @update:show="emit('update:visible', $event)" :width="340" :anchor-el="anchorEl"
    :max-height="480">
    <div class="flex flex-col gap-0.5">
      <!-- 最近选择 -->
      <template v-if="recentList.length > 0">
        <div class="text-[11px] font-medium text-[#999] dark:text-[#6b7280] px-2 py-1 select-none">{{ t('chat.input.recent') }}</div>
        <div v-for="path in filteredRecentList" :key="path"
          class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
          :class="path === currentWorkspacePath
            ? 'ws-item-active bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
            : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
          @click="handleSelect(path)">
          
            <Folder20Regular class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  />
          
          <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
            <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ getFolderName(path) }}</span>
            <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ path }}</span>
          </div>
          
            <Checkmark16Filled v-if="path === currentWorkspacePath" class="shrink-0 text-(--gd-color-primary) w-3.5 h-3.5"  />
          
        </div>
        <div class="h-px bg-[#eee] dark:bg-white/8 mx-2 my-1.5"></div>
      </template>

      <!-- 使用公共目录 -->
      <div v-if="publicPath"
        class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="publicPath === currentWorkspacePath
          ? 'ws-item-active bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active)'
          : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
        @click="handleSelect(publicPath)">
        
          <PeopleCommunity16Regular class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  />
        
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0">{{ t('chat.input.usePublicDir') }}</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ publicPath }}</span>
        </div>
        
          <Checkmark16Filled v-if="publicPath === currentWorkspacePath" class="shrink-0 text-(--gd-color-primary) w-3.5 h-3.5"  />
        
      </div>

      <!-- 自动创建 -->
      <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
        :class="!currentWorkspacePath
          ? 'ws-item-active bg-(--gd-color-sidebar-bg-active) hover:bg-(--gd-color-sidebar-bg-active)'
          : 'hover:bg-(--gd-color-sidebar-bg-hover)'"
        @click="handleSelect(null)">
        
          <FolderAdd24Regular class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  />
        
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb] whitespace-nowrap shrink-0 max-w-30 overflow-hidden text-ellipsis">{{ t('chat.input.autoCreate') }}</span>
          <span class="text-xs text-[#999] dark:text-[#6b7280] whitespace-nowrap overflow-hidden text-ellipsis">{{ t('chat.input.autoCreateDesc') }}</span>
        </div>
        
          <Checkmark16Filled v-if="!currentWorkspacePath" class="shrink-0 text-(--gd-color-primary) w-3.5 h-3.5"  />
        
      </div>

      <!-- 选择本地文件夹：Electron 走原生对话框，Web 打开服务端目录浏览器 -->
      <div class="flex items-center gap-1.25 px-2 py-1 rounded-md cursor-pointer transition-all duration-150 hover:bg-(--gd-color-sidebar-bg-hover)"
        @click="handleOpenFolder">
        
          <Desktop16Regular class="shrink-0 text-(--gd-color-text-gray) dark:text-(--gd-color-text-disabled) w-4.5 h-4.5"  />
        
        <div class="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span class="text-sm font-medium text-(--gd-color-text) dark:text-[#e5e7eb]">{{ t('chat.input.selectLocalFolder') }}</span>
        </div>
      </div>
    </div>
  </GdPopover>

  <!-- Web 模式：服务端目录浏览器对话框（Electron 走原生 selectFolder，不渲染） -->
  <DirectoryBrowserDialog v-if="!isElectron" v-model="browserVisible"
    :initial-path="currentWorkspacePath || ''"
    :title="t('chat.input.selectLocalFolder')"
    @select="handleBrowserSelect" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Folder20Regular, Desktop16Regular, FolderAdd24Regular, Checkmark16Filled, PeopleCommunity16Regular } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'
import DirectoryBrowserDialog from '../../DirectoryBrowserDialog.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { toast } from '@/components/ui/toastService';

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

const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const recentList = computed(() => workspaceStore.recentList)

// 过滤掉公共目录，避免与固定入口重复
const filteredRecentList = computed(() => {
  if (!publicPath.value) return recentList.value
  return recentList.value.filter((p: string) => p !== publicPath.value)
})

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

const browserVisible = ref(false)

const publicPath = computed(() => props.publicPath || null)

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
  if (isElectron && window.electronAPI?.selectFolder) {
    try {
      const selectedPath = await window.electronAPI.selectFolder()
      if (selectedPath) {
        emit('select', selectedPath)
      }
    } catch (error) {
      console.error('选择文件夹失败:', error)
      toast.error(t('chat.input.selectFolderFailed'))
    } finally {
      emit('update:visible', false)
    }
    return
  }
  // Web 模式：交给目录浏览器对话框，选择结果经 handleBrowserSelect 回流
  browserVisible.value = true
  emit('update:visible', false)
}

function handleBrowserSelect(path: string) {
  emit('select', path)
}
</script>

<style scoped>
/* 选中工作区行整行反色：active 底色在深色主题里是实心色（XP 的 #316AC5），
   而行内图标/名称/路径/勾各写了颜色类（路径还是 text-[#999] 这种字面量，主题翻不动）。
   sidebar-text-active 在默认主题 = 正文色，所以原主题下没有视觉变化。 */
.ws-item-active {
  color: var(--gd-color-sidebar-text-active);
}

.ws-item-active :is(div, span, svg) {
  color: inherit;
}
</style>
