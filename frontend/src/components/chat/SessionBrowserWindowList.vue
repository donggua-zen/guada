<template>
  <div v-if="isElectron" class="session-window-list">
    <!-- 头部 -->
    <div class="shrink-0 flex items-center justify-between px-2">
      <h3 class="text-sm font-normal text-gray-500 dark:text-[#8b8d95] whitespace-nowrap mx-2">
        浏览器窗口
      </h3>
      <el-button text class="window-add-btn" @click.stop="createNewWindow" :disabled="!sessionId">
        <el-icon size="16">
          <Plus />
        </el-icon>
      </el-button>
    </div>

    <!-- 窗口列表 -->
    <div v-if="store.sessionWebviews.length === 0" class="text-center py-6 text-gray-400 dark:text-[#6b6d73] text-xs">
      暂无浏览器窗口
    </div>
    <div v-else class="overflow-y-auto py-2 px-1 space-y-0.5" style="max-height: 160px;">
      <div v-for="win in store.sessionWebviews" :key="win.windowId"
        class="mx-1 px-2 py-1 flex items-center gap-1 cursor-pointer transition-all duration-200 rounded" :class="{
          'bg-gray-100 dark:bg-[#2a2c30]': store.activeWindowId === win.windowId,
          'hover:bg-gray-100 dark:hover:bg-[#2a2c30]': store.activeWindowId !== win.windowId
        }" @click="activateWindow(win.windowId)">
        <!-- 网页 favicon -->
        <img v-if="win.favicon" :src="win.favicon" class="w-4 h-4 rounded-sm shrink-0 object-contain" alt=""
          @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'" />
        <span v-else class="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path
              d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </span>

        <!-- 窗口标题 -->
        <span class="text-xs text-gray-600 dark:text-[#8b8d95] truncate flex-1" :title="win.title || '未命名窗口'">
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
import { onMounted, onUnmounted, watch } from 'vue'
import { Close, Plus } from '@element-plus/icons-vue'
import { useBrowserWebviewStore } from '@/stores/browserWebview'

const props = defineProps<{
  sessionId: string | null
}>()

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const store = useBrowserWebviewStore()

// 截断标题
function truncateTitle(title: string, maxLength: number = 20): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength) + '...'
}

// 激活/切换窗口预览
function activateWindow(windowId: string): void {
  // 点击已激活的窗口 → 关闭预览；点击其他窗口 → 切换预览
  if (store.activeWindowId === windowId) {
    store.setActive(null)
  } else {
    store.setActive(windowId)
  }
}

// 关闭窗口
async function closeWindow(windowId: string): Promise<void> {
  if (!window.electronAPI) return

  try {
    await window.electronAPI.closeBrowserWindow(windowId)
    // store 中的数据由 browser:destroy-webview 事件驱动移除
  } catch (error) {
    console.error('[SessionBrowserWindowList] Failed to close window:', error)
  }
}

// 创建新浏览器窗口
async function createNewWindow(): Promise<void> {
  if (!window.electronAPI || !props.sessionId) return

  try {
    const result = await window.electronAPI.createBrowserWindow('about:blank', {
      sessionId: props.sessionId,
      createdBy: props.sessionId,
    })
    if (!result.success) {
      alert('窗口数量已达上限（最多6个窗口）')
    }
    // 窗口创建由 browser:create-webview 事件驱动
  } catch (error) {
    console.error('[SessionBrowserWindowList] Failed to create window:', error)
  }
}

// 监听会话 ID 变化
watch(() => props.sessionId, () => {
  // 不清除 webview（它们在 MainLayout 层持久），仅切换当前会话
  store.setCurrentSession(props.sessionId)
}, { immediate: true })

onMounted(() => {
  store.setCurrentSession(props.sessionId)
})

onUnmounted(() => {
  // 组件卸载时清除预览坐标（会话切换时占位区域消失）
  store.setPreviewRect(null)
})
</script>

<style scoped>
.window-add-btn {
  padding: 4px;
  margin-right: 8px;
  color: var(--color-text-secondary, #9ca3af);
  transition: all 0.2s;
}

.window-add-btn:hover {
  color: var(--color-primary, #3b82f6);
  background: var(--color-hover-bg, #f3f4f6);
  border-radius: 4px;
}
</style>
