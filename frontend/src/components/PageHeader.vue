<template>
  <div class="flex items-center justify-between gap-2 h-10 drag-region"
    :class="{ 'mac-sidebar-collapsed-padding': isMac && !layoutStore.sidebarVisible }">
    <!-- 左侧：侧边栏切换按钮 -->
    <div class="flex items-center justify-start no-drag ml-3">
      <GdTooltip v-if="!hideSidebarToggle" :content="layoutStore.sidebarVisible ? t('common.sidebar.collapse') : t('common.sidebar.expand')" placement="bottom">
        <div class="header-icon-btn" @click="layoutStore.toggleSidebar()">
          <LeftBarIcon class="w-5 h-5" />
        </div>
      </GdTooltip>
    </div>

    <!-- 中间：标题区域 -->
    <div v-if="title || $slots.title" class="flex items-center flex-1 min-w-0">
      <slot name="title">
        <span class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed] m-0 truncate">{{ title }}</span>
      </slot>
    </div>

    <!-- 右侧：操作按钮组 -->
    <div class="flex items-center justify-end min-w-10 gap-2 no-drag mr-3">
      <slot name="actions" />
    </div>

    <!-- Electron 窗口控制按钮 -->
    <WindowControls v-if="isElectron && !hideWindowControls" />
  </div>
</template>

<script setup lang="ts">
import { useLayoutStore } from '@/stores/layout'
import { useI18n } from 'vue-i18n'
import LeftBarIcon from './icons/LeftBarIcon.vue'
import WindowControls from '@/components/WindowControls.vue'
import GdTooltip from '@/components/ui/GdTooltip.vue'

const { t } = useI18n()

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const isMac = isElectron && window.electronAPI.platform === 'darwin'

/**
 * 页面通用标题栏组件
 * 提供侧边栏切换、标题展示和操作按钮插槽
 */
const layoutStore = useLayoutStore()

defineProps<{
  title?: string
  hideWindowControls?: boolean
  hideSidebarToggle?: boolean
}>()
</script>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

/* macOS：全局侧边栏折叠后红绿灯按钮会压在主内容区顶部，左侧预留空间避让 */
.mac-sidebar-collapsed-padding {
  padding-left: 78px;
}
</style>

<style>
.header-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 8px;
    color: var(--gd-color-text-gray);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
}

.header-icon-btn:hover {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}

.header-icon-btn.active {
    background: var(--gd-color-sidebar-bg-hover);
    color: var(--gd-color-text);
}
</style>
