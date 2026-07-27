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
          'bg-gray-100 dark:bg-[#2a2c30]': isActive(win.windowId),
          'hover:bg-gray-100 dark:hover:bg-[#2a2c30]': !isActive(win.windowId)
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
          @click.stop="emit('close', win.windowId)">
          <Close />
        </el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, computed } from 'vue'
import { Close, Plus } from '@element-plus/icons-vue'
import { useBrowserWebviewStore } from '@/stores/browserWebview'

const props = defineProps<{
  sessionId: string | null
  /** 当前激活的标签 key（来自父组件的 activeTabKey） */
  activeTabKey?: string | null
}>()

const emit = defineEmits<{
  /** 激活浏览器窗口（切换到该窗口的预览） */
  activate: [windowId: string]
  /** 关闭浏览器窗口 */
  close: [windowId: string]
  /** 创建新浏览器窗口 */
  create: []
}>()

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const store = useBrowserWebviewStore()

function truncateTitle(title: string, maxLength: number = 20): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength) + '...'
}

/** 判断窗口是否激活（通过 activeTabKey 而非 store.activeWindowId） */
function isActive(windowId: string): boolean {
  return props.activeTabKey === `browser:${windowId}`
}

// 激活窗口预览：委托给父组件
// 此列表仅在非预览模式下可见，点击始终意味着"切换到该窗口预览"
function activateWindow(windowId: string): void {
  emit('activate', windowId)
}

// 创建新浏览器窗口
async function createNewWindow(): Promise<void> {
  emit('create')
}

// 监听会话 ID 变化
watch(() => props.sessionId, () => {
  store.setCurrentSession(props.sessionId)
}, { immediate: true })

onMounted(() => {
  store.setCurrentSession(props.sessionId)
})

onUnmounted(() => {
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
