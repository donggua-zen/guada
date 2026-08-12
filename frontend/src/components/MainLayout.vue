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
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLayoutStore } from '@/stores/layout'
import { apiService } from '@/services/ApiService'
import { getLocale } from '@/locales'
import { useSessionEvents } from '@/composables/useSessionEvents'
import { setPluginToolDisplays } from '@/utils/toolDisplay'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'
import BrowserWebviewLayer from './BrowserWebviewLayer.vue'
import FloatingChatPanel from './chat/FloatingChatPanel.vue'

const layoutStore = useLayoutStore()
const route = useRoute()

const { init: initSessionEvents, cleanup: cleanupSessionEvents } = useSessionEvents()

const isSettingsRoute = computed(() => route.name === 'SystemSettings')

const effectiveSidebarVisible = computed(() => layoutStore.sidebarVisible)

const handleSidebarUpdate = (val: boolean) => {
  layoutStore.setSidebarVisible(val)
}

// 加载工具展示文案注册表（按当前语言解析 %key% 引用）
function loadToolDisplays() {
  apiService.fetchToolDisplays(getLocale()).then((displays) => {
    setPluginToolDisplays(displays)
  }).catch((e) => {
    console.warn('加载工具文案失败，使用默认文案', e)
  })
}

// 启动 SSE 连接 + 全局事件监听
onMounted(() => {
  console.log('[MainLayout] 启动 SSE 连接')
  apiService.connectSessionEvents()
  initSessionEvents()
  // 组件挂载后再加载外观设置，确保 content-clear-wallpaper 元素已存在
  layoutStore.loadAppearanceSettings()

  loadToolDisplays()
})

// 语言切换时重新拉取工具展示文案（后端按 lang 解析 %key% 引用）
watch(getLocale, () => {
  loadToolDisplays()
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
