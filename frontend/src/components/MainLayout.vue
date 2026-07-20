<template>
  <SidebarLayout :sidebarVisible="effectiveSidebarVisible" @update:sidebarVisible="handleSidebarUpdate"
    :sidebarWidth="300" :showToggleButton="false" sidebarPosition="left" :z-index="20" class="flex-1">
    <template #sidebar>
      <GlobalSidebar />
    </template>
    <template #content>
      <div
        class="relative h-full flex-1 min-w-0 overflow-hidden content-clear-wallpaper"
        :class="{ 'border-l border-gray-100 dark:border-[#2f2f2f]': !isSettingsRoute }">
        <RouterView />
      </div>
    </template>
  </SidebarLayout>

  <!-- 浏览器 Webview 浮层（跨会话持久，fixed 定位覆盖在预览占位区域上方） -->
  <BrowserWebviewLayer />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
import { apiService } from '@/services/ApiService'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'
import BrowserWebviewLayer from './BrowserWebviewLayer.vue'

const layoutStore = useLayoutStore()
const route = useRoute()

const isSettingsRoute = computed(() => route.name === 'SystemSettings')

const effectiveSidebarVisible = computed(() => {
  if (isSettingsRoute.value) return false
  return layoutStore.sidebarVisible
})

const handleSidebarUpdate = (val: boolean) => {
  if (!isSettingsRoute.value) {
    layoutStore.setSidebarVisible(val)
  }
}

// 启动 SSE 连接
onMounted(() => {
  console.log('[MainLayout] 启动 SSE 连接')
  apiService.connectSessionEvents()
  // 组件挂载后再加载外观设置，确保 content-clear-wallpaper 元素已存在
  layoutStore.loadAppearanceSettings()
})

// 组件卸载时断开 SSE 连接，避免内存泄漏
onUnmounted(() => {
  console.log('[MainLayout] 断开 SSE 连接')
  apiService.disconnectSessionEvents()
})
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
