<template>
  <div v-if="isElectron && sessionWindows.length > 0" class="session-window-list">
    <!-- 头部 -->
    <div
      class="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-[#2e3035] bg-white dark:bg-[#1a1b1e]">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed] whitespace-nowrap mr-1.5">
        浏览器窗口
        <span class="ml-1 text-xs text-gray-400 font-normal">({{ sessionWindows.length }})</span>
      </h3>
    </div>

    <!-- 窗口列表 -->
    <div class="window-items overflow-y-auto py-2" style="max-height: 160px;">
      <div v-for="win in sessionWindows" :key="win.windowId"
        class="window-item px-2 py-1.5 flex items-center gap-2 cursor-pointer transition-all duration-200"
        :class="{
          'bg-blue-50 dark:bg-blue-900/20': animatedWindowId === win.windowId,
          'hover:bg-gray-100 dark:hover:bg-[#2a2c30]': animatedWindowId !== win.windowId
        }"
        @click="activateWindow(win.windowId)">
        <!-- 窗口状态指示器 -->
        <span class="w-2 h-2 rounded-full shrink-0"
          :class="win.isVisible ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'"
          :title="win.isVisible ? '前台显示中' : '后台运行中'">
        </span>

        <!-- 窗口标题 -->
        <span class="text-xs text-gray-600 dark:text-[#8b8d95] truncate flex-1"
          :title="win.title || '未命名窗口'">
          {{ truncateTitle(win.title || '未命名窗口') }}
        </span>

        <!-- 关闭按钮 -->
        <el-icon size="12" class="text-gray-400 hover:text-red-500 cursor-pointer shrink-0"
          @click.stop="closeWindow(win.windowId)">
          <Close />
        </el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'

interface WindowInfo {
  windowId: string
  title: string
  url: string
  isActive?: boolean
  isVisible?: boolean
  metadata?: Record<string, any>
}

const props = defineProps<{
  sessionId: string | null
}>()

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const sessionWindows = ref<WindowInfo[]>([])
const animatedWindowId = ref<string | null>(null)

// 截断标题
function truncateTitle(title: string, maxLength: number = 20): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength) + '...'
}

// 加载当前会话的窗口列表
async function loadSessionWindows() {
  if (!window.electronAPI || !props.sessionId) return

  try {
    const result = await window.electronAPI.getBrowserWindows()
    if (result.success && result.windows) {
      // 只显示属于当前会话的窗口
      sessionWindows.value = result.windows.filter(
        (w: any) => w.metadata?.sessionId === props.sessionId
      )
    }
  } catch (error) {
    console.error('[SessionBrowserWindowList] Failed to load windows:', error)
  }
}

// 激活/聚焦窗口
async function activateWindow(windowId: string) {
  if (!window.electronAPI) return

  try {
    await window.electronAPI.activateBrowserWindow(windowId)
    await loadSessionWindows()
  } catch (error) {
    console.error('[SessionBrowserWindowList] Failed to activate window:', error)
  }
}

// 关闭窗口
async function closeWindow(windowId: string) {
  if (!window.electronAPI) return

  try {
    await window.electronAPI.closeBrowserWindow(windowId)
    sessionWindows.value = sessionWindows.value.filter(w => w.windowId !== windowId)
  } catch (error) {
    console.error('[SessionBrowserWindowList] Failed to close window:', error)
  }
}

// 处理窗口更新事件
function handleWindowUpdated(event: any, data: any) {
  // 只处理属于当前会话的窗口
  if (data.metadata?.sessionId !== props.sessionId) return

  const existingIndex = sessionWindows.value.findIndex(w => w.windowId === data.windowId)
  if (existingIndex !== -1) {
    sessionWindows.value[existingIndex].title = data.title
    sessionWindows.value[existingIndex].url = data.url
    sessionWindows.value[existingIndex].isActive = data.isActive
    sessionWindows.value[existingIndex].isVisible = data.isVisible !== undefined ? data.isVisible : true
  } else {
    sessionWindows.value.push({
      windowId: data.windowId,
      title: data.title || '新窗口',
      url: data.url || '',
      isActive: data.isActive || false,
      isVisible: data.isVisible !== undefined ? data.isVisible : true,
      metadata: data.metadata,
    })
  }
}

// 处理窗口关闭事件
function handleWindowClosed(event: any, data: any) {
  sessionWindows.value = sessionWindows.value.filter(w => w.windowId !== data.windowId)
}

// 处理窗口创建事件（带动画）
function handleWindowCreated(event: any, data: any) {
  // 只处理属于当前会话的窗口
  if (data.metadata?.sessionId !== props.sessionId) return

  // 添加到列表
  const existingIndex = sessionWindows.value.findIndex(w => w.windowId === data.windowId)
  if (existingIndex === -1) {
    sessionWindows.value.push({
      windowId: data.windowId,
      title: data.title || '新窗口',
      url: data.url || '',
      isActive: data.isActive || false,
      isVisible: data.isVisible !== undefined ? data.isVisible : true,
      metadata: data.metadata,
    })
  }

  // 播放动画
  if (data.animate) {
    animatedWindowId.value = data.windowId
    setTimeout(() => {
      if (animatedWindowId.value === data.windowId) {
        animatedWindowId.value = null
      }
    }, 1500)
  }
}

// 监听会话 ID 变化，重新加载窗口列表
watch(() => props.sessionId, () => {
  sessionWindows.value = []
  loadSessionWindows()
}, { immediate: true })

onMounted(() => {
  loadSessionWindows()

  // 监听窗口事件
  if (window.electronAPI?.onBrowserWindowUpdated) {
    window.electronAPI.onBrowserWindowUpdated(handleWindowUpdated)
  }
  if (window.electronAPI?.onBrowserWindowClosed) {
    window.electronAPI.onBrowserWindowClosed(handleWindowClosed)
  }
  if (window.electronAPI?.onBrowserWindowCreated) {
    window.electronAPI.onBrowserWindowCreated(handleWindowCreated)
  }
})

onUnmounted(() => {
  // 清理事件监听器（ipcRenderer 事件由主进程管理，此处无需手动移除）
})
</script>

<style scoped>


.window-items {
  scrollbar-width: thin;
}

.window-items::-webkit-scrollbar {
  width: 4px;
}

.window-items::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.dark .window-items::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.1);
}

.window-item {
  border-radius: 4px;
  margin: 0 4px;
}
</style>
