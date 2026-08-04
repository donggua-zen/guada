<template>
  <div class="flex items-center justify-between gap-2 h-11 drag-region">
    <!-- 左侧：侧边栏切换按钮 -->
    <div class="flex items-center justify-start no-drag ml-3">
      <LTooltip v-if="!hideSidebarToggle" :content="layoutStore.sidebarVisible ? '收起侧边栏' : '展开侧边栏'" placement="bottom">
        <div class="header-icon-btn" @click="layoutStore.toggleSidebar()">
          <LeftBarIcon class="w-5 h-5" />
        </div>
      </LTooltip>
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
import LeftBarIcon from './icons/LeftBarIcon.vue'
import WindowControls from '@/components/WindowControls.vue'
import LTooltip from '@/components/ui/LTooltip.vue'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

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
</style>

<style>
.header-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 8px;
    color: var(--color-text-gray);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
}

.header-icon-btn:hover {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
}

.header-icon-btn.active {
    background: var(--color-sidebar-bg-hover);
    color: var(--color-text);
}
</style>
