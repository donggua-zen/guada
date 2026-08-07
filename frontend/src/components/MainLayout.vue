<template>
  <!-- 全屏模式下悬浮对话面板（必须在 SidebarLayout 之前确保 #floating-chat 先于 Teleport 挂载） -->
  <FloatingChatPanel />

  <SidebarLayout :sidebarVisible="effectiveSidebarVisible" @update:sidebarVisible="handleSidebarUpdate"
    :sidebarWidth="300" :showToggleButton="false" sidebarPosition="left" :z-index="20" class="flex-1">
    <template #sidebar>
      <GlobalSidebar v-if="!isSettingsRoute" />
      <div v-else id="settings-sidebar-portal" class="h-full"></div>
    </template>
    <template #content>
      <div
        class="relative h-full flex-1 min-w-0 overflow-hidden content-clear-wallpaper border-l border-gray-200 dark:border-[#2f2f2f]">
        <RouterView />
      </div>
    </template>
  </SidebarLayout>

  <!-- 浏览器 Webview 浮层（跨会话持久，fixed 定位覆盖在预览占位区域上方） -->
  <BrowserWebviewLayer />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
import { apiService } from '@/services/ApiService'
import { useSessionEvents } from '@/composables/useSessionEvents'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'
import BrowserWebviewLayer from './BrowserWebviewLayer.vue'
import FloatingChatPanel from './chat/FloatingChatPanel.vue'

const layoutStore = useLayoutStore()
const route = useRoute()

const { init: initSessionEvents, cleanup: cleanupSessionEvents } = useSessionEvents()

const isSettingsRoute = computed(() => route.name === 'SystemSettings')

// 设置页侧边栏的本地可见性状态（移动端可折叠）
const settingsSidebarVisible = ref(true)

const effectiveSidebarVisible = computed(() => {
  // 设置路由时使用本地状态，为 Teleport 提供挂载位置
  if (isSettingsRoute.value) return settingsSidebarVisible.value
  return layoutStore.sidebarVisible
})

const handleSidebarUpdate = (val: boolean) => {
  if (isSettingsRoute.value) {
    settingsSidebarVisible.value = val
  } else {
    layoutStore.setSidebarVisible(val)
  }
}

// 启动 SSE 连接 + 全局事件监听
onMounted(() => {
  console.log('[MainLayout] 启动 SSE 连接')
  apiService.connectSessionEvents()
  initSessionEvents()
  // 组件挂载后再加载外观设置，确保 content-clear-wallpaper 元素已存在
  layoutStore.loadAppearanceSettings()
})

// 组件卸载时断开 SSE 连接，清理监听
onUnmounted(() => {
  console.log('[MainLayout] 断开 SSE 连接')
  cleanupSessionEvents()
  apiService.disconnectSessionEvents()
})
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
