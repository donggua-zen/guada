<template>
  <div class="flex items-center justify-between gap-2 px-3 h-10">
    <!-- 左侧：侧边栏切换按钮 -->
    <div class="flex items-center justify-start">
      <div
        class="cursor-pointer p-1 rounded-lg text-gray-600 dark:text-[#8b8d95] transition-all duration-200 hover:bg-gray-100 dark:hover:bg-[#2a2c30] hover:text-gray-900 dark:hover:text-[#e8e9ed] active:translate-x-0"
        @click="layoutStore.toggleSidebar()" :title="layoutStore.sidebarVisible ? '收起侧边栏' : '展开侧边栏'">
        <LeftBarIcon class="w-5 h-5" />
      </div>
    </div>

    <!-- 中间：标题区域 -->
    <div v-if="title || $slots.title" class="flex items-center flex-1 min-w-0">
      <slot name="title">
        <span class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed] m-0 truncate">{{ title }}</span>
      </slot>
    </div>

    <!-- 右侧：操作按钮组 -->
    <div class="flex items-center justify-end min-w-10 gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLayoutStore } from '@/stores/layout'
import LeftBarIcon from './icons/LeftBarIcon.vue'

/**
 * 页面通用标题栏组件
 * 提供侧边栏切换、标题展示和操作按钮插槽
 */
const layoutStore = useLayoutStore()

defineProps<{
  title?: string
}>()
</script>
