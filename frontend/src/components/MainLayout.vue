<template>
  <div class="flex flex-1 overflow-hidden">
    <!-- 左侧统一导航侧边栏 -->
    <MainSidebar v-model:active-tab="activeTab" :sidebar-width="sidebarWidth" />

    <!-- 右侧内容区 -->
    <div class="flex-1 min-w-0 overflow-hidden rounded-tl-lg">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import MainSidebar from './MainSidebar.vue'

const route = useRoute()
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')

// 当前激活的导航标签 - 类型化
const activeTab = ref<string>('chat')

// 侧边栏宽度 - 类型化
const sidebarWidth = computed((): string => {
  return isMobile.value ? '0px' : '64px'  // 优化为更紧凑的宽度
})

// 监听路由变化，同步更新 activeTab - 类型化
watch(
  () => route.name,
  (newName: string | symbol | null | undefined) => {
    if (newName === 'Chat') {
      activeTab.value = 'chat'
    } else if (newName === 'Characters') {
      activeTab.value = 'characters'
    } else if (newName === 'Settings') {
      activeTab.value = 'settings'
    }
  },
  { immediate: true }
)
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
