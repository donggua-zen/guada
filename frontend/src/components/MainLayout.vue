<template>
  <!-- Windows 标题栏行：左 logo/图标按钮，右窗口控制。
       Mac 无此行（红绿灯悬浮侧栏顶部），Web 无窗口按钮需求 -->
  <CustomTitlebar v-if="isElectron && !isMac" />

  <SidebarLayout :sidebarVisible="effectiveSidebarVisible" @update:sidebarVisible="handleSidebarUpdate"
    :sidebarWidth="layoutStore.sidebarWidth" resizable @update:sidebarWidth="layoutStore.setSidebarWidth"
    :showToggleButton="false" sidebarPosition="left" :z-index="20" class="flex-1">
    <template #sidebar>
      <GlobalSidebar v-if="!isSettingsRoute" />
      <div v-else id="settings-sidebar-portal" class="h-full"></div>
    </template>
    <template #content>
      <div
        class="content-card relative flex-1 min-w-0 overflow-hidden content-clear-wallpaper"
        :class="{ 'sidebar-collapsed': !effectiveSidebarVisible }">
        <RouterView />
      </div>
    </template>
  </SidebarLayout>

  <!-- 浏览器 Webview 浮层（跨会话持久，fixed 定位覆盖在预览占位区域上方） -->
  <BrowserWebviewLayer />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NEW_SESSION_ID } from '@/constants'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/session'
import { usePluginSlots } from '@/stores/pluginSlots'
import { apiService } from '@/services/ApiService'
import { getLocale } from '@/locales'
import { useSessionEvents } from '@/composables/useSessionEvents'
import { setPluginToolDisplays } from '@/utils/toolDisplay'
import SidebarLayout from './ui/SidebarLayout.vue'
import GlobalSidebar from './GlobalSidebar.vue'
import CustomTitlebar from './CustomTitlebar.vue'
import BrowserWebviewLayer from './BrowserWebviewLayer.vue'

const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const route = useRoute()
const router = useRouter()

const { init: initSessionEvents, cleanup: cleanupSessionEvents } = useSessionEvents()

const isSettingsRoute = computed(() => route.name === 'SystemSettings')

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const isMac = isElectron && window.electronAPI?.platform === 'darwin'

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

// 全局快捷键
const handleGlobalShortcut = (e: KeyboardEvent) => {
  if (e.isComposing || e.shiftKey) return
  const ctrlOrMeta = e.ctrlKey || e.metaKey

  // 新建会话：Electron 用 Ctrl/Cmd+N；Web 下 Ctrl+N 是浏览器保留快捷键无法拦截，改用 Ctrl+Alt+N
  if (e.code === 'KeyN') {
    if (!ctrlOrMeta) return
    const matched = isElectron ? !e.altKey : e.altKey
    if (!matched) return
    e.preventDefault()
    router.replace({ name: 'Chat', params: { sessionId: NEW_SESSION_ID } })
    return
  }

  // 工作区侧边栏：Ctrl+Alt+W（workspace）。Electron/Web 一致，无浏览器保留冲突
  if (e.code === 'KeyW' && e.ctrlKey && e.altKey && !e.metaKey) {
    e.preventDefault()
    layoutStore.setWorkspaceVisible(!layoutStore.workspaceVisible)
    return
  }

  // 主导航侧边栏：Electron Ctrl/Cmd+B（VS Code 默认同款）；Web 用 Ctrl+Alt+B（浏览器保留 Ctrl+B 不可拦截）
  if (e.code === 'KeyB') {
    const matchedB = isElectron ? ctrlOrMeta && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey
    if (!matchedB) return
    e.preventDefault()
    layoutStore.toggleSidebar()
    return
  }
}

// workspace SSE 连接：跟随当前激活会话（连接生命周期 = app 壳，不依赖任何 UI 组件；
// 后端 watcher 按工作目录共享，切换会话不重建 watcher；scope 订阅由消费方（GitStore/Sidebar）显式管理）
watch(
  () => sessionStore.activeSessionId,
  (id) => {
    if (id && id !== NEW_SESSION_ID) {
      apiService.connectWorkspaceWatcher(id)
    } else {
      apiService.disconnectWorkspaceWatcher()
    }
  },
  { immediate: true },
)

// 启动 SSE 连接 + 全局事件监听
onMounted(() => {
  console.log('[MainLayout] 启动 SSE 连接')
  apiService.connectSessionEvents()
  initSessionEvents()
  // 插件槽（含插件主题注册表）需在主界面即初始化：
  // 否则冷启动落在聊天页时无人触发 init，插件主题会一直 pending 不加载
  usePluginSlots().init()
  // 外观分组（壁纸/透明度/主题预设/语言）只在这里读一次：语言也由这次响应派生，
  // 不再由 App.vue 单独拉一份。applyWallpaperSettings 只写 documentElement，不依赖元素存在。
  layoutStore.loadAppearanceSettings()

  loadToolDisplays()

  window.addEventListener('keydown', handleGlobalShortcut)
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
  apiService.disconnectWorkspaceWatcher()
  window.removeEventListener('keydown', handleGlobalShortcut)
})
</script>

<style scoped>
/* 布局样式由 Tailwind 处理 */
</style>
