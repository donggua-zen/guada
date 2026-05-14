<template>
  <div v-if="visible" class="window-manager-panel">
    <div class="panel-header">
      <h3>窗口管理</h3>
      <button class="close-btn" @click="$emit('close')" title="关闭面板">×</button>
    </div>
    
    <div class="window-list">
      <div 
        v-for="win in windows" 
        :key="win.windowId"
        class="window-item"
        :class="{ active: win.isActive, hidden: !win.isVisible }"
      >
        <div class="window-info" @click="activateWindow(win.windowId)">
          <div class="window-title">
            {{ truncateTitle(win.title || '未命名窗口') }}
            <span v-if="!win.isVisible" class="hidden-badge">后台</span>
          </div>
          <div class="window-url">{{ truncateUrl(win.url || '') }}</div>
        </div>
        <div class="window-actions">
          <button 
            class="window-toggle-btn" 
            @click.stop="toggleWindowVisibility(win.windowId)"
            :title="win.isVisible ? '隐藏窗口（后台模式）' : '显示窗口（前台模式）'"
          >
            <!-- 图标表示点击后要执行的操作 -->
            <!-- 窗口隐藏时显示 Eye（睁眼），表示点击后将显示 -->
            <!-- 窗口可见时显示 EyeOff（闭眼），表示点击后将隐藏 -->
            <component :is="win.isVisible ? EyeOff16Regular : Eye16Regular" />
          </button>
          <button 
            class="window-close-btn" 
            @click.stop="closeWindow(win.windowId)"
            title="关闭窗口"
          >
            ×
          </button>
        </div>
      </div>
      
      <div v-if="windows.length === 0" class="empty-state">
        <p>暂无打开的窗口</p>
      </div>
    </div>
    
    <div class="panel-footer">
      <button class="new-window-btn" @click="createNewWindow">
        + 新建窗口
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Eye16Regular, EyeOff16Regular } from '@vicons/fluent'

interface WindowInfo {
  windowId: string
  title: string
  url: string
  isActive?: boolean
  isVisible?: boolean // 窗口是否可见（前台/后台模式）
  metadata?: Record<string, any>
}

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const windows = ref<WindowInfo[]>([])

// 截断标题
function truncateTitle(title: string, maxLength: number = 30): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength) + '...'
}

// 截断 URL
function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url
  return url.substring(0, maxLength) + '...'
}

// 加载窗口列表
async function loadWindows() {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.getBrowserWindows()
    if (result.success && result.windows) {
      windows.value = result.windows
    }
  } catch (error) {
    console.error('Failed to load windows:', error)
  }
}

// 激活/聚焦窗口
async function activateWindow(windowId: string) {
  if (!window.electronAPI) return
  
  try {
    await window.electronAPI.activateBrowserWindow(windowId)
    // 更新列表
    await loadWindows()
  } catch (error) {
    console.error('Failed to activate window:', error)
  }
}

// 关闭窗口
async function closeWindow(windowId: string) {
  if (!window.electronAPI) return
  
  try {
    await window.electronAPI.closeBrowserWindow(windowId)
    // 从列表中移除
    windows.value = windows.value.filter(w => w.windowId !== windowId)
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

// 创建新窗口
async function createNewWindow() {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.createBrowserWindow('https://www.baidu.com')
    if (result.success) {
      // 重新加载列表
      await loadWindows()
    } else {
      alert('窗口数量已达上限（最多6个窗口）')
    }
  } catch (error) {
    console.error('Failed to create window:', error)
  }
}

// 切换窗口可见性（前台/后台模式）
async function toggleWindowVisibility(windowId: string) {
  if (!window.electronAPI || !window.electronAPI.toggleBrowserWindowVisibility) return
  
  try {
    const result = await window.electronAPI.toggleBrowserWindowVisibility(windowId)
    if (result.success) {
      // 更新本地状态
      const win = windows.value.find(w => w.windowId === windowId)
      if (win) {
        win.isVisible = result.isVisible
      }
    }
  } catch (error) {
    console.error('Failed to toggle window visibility:', error)
  }
}

// 监听窗口更新事件
function handleWindowUpdated(event: any, data: any) {
  const existingIndex = windows.value.findIndex(w => w.windowId === data.windowId)
  
  if (existingIndex !== -1) {
    // 更新现有窗口
    windows.value[existingIndex].title = data.title
    windows.value[existingIndex].url = data.url
    windows.value[existingIndex].isActive = data.isActive
    windows.value[existingIndex].isVisible = data.isVisible !== undefined ? data.isVisible : true
  } else {
    // 添加新窗口
    windows.value.push({
      windowId: data.windowId,
      title: data.title || '新窗口',
      url: data.url || '',
      isActive: data.isActive || false,
      isVisible: data.isVisible !== undefined ? data.isVisible : true,
    })
  }
}

// 监听窗口关闭事件
function handleWindowClosed(event: any, data: any) {
  windows.value = windows.value.filter(w => w.windowId !== data.windowId)
}

onMounted(() => {
  if (props.visible) {
    loadWindows()
    
    // 监听窗口更新
    if (window.electronAPI?.onBrowserWindowUpdated) {
      window.electronAPI.onBrowserWindowUpdated(handleWindowUpdated)
    }
    
    // 监听窗口关闭
    if (window.electronAPI?.onBrowserWindowClosed) {
      window.electronAPI.onBrowserWindowClosed(handleWindowClosed)
    }
  }
})

onUnmounted(() => {
  // 清理事件监听器（如果需要）
})
</script>

<style scoped>
.window-manager-panel {
  position: fixed;
  top: 50px;
  right: 20px;
  width: 350px;
  max-height: 500px;
  background: var(--color-bg-secondary, #ffffff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
}

.panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, #1f2937);
}

.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  color: var(--color-text-secondary, #6b7280);
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--color-hover-bg, #f3f4f6);
  color: var(--color-text-primary, #1f2937);
}

.window-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.window-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 6px;
  background: var(--color-bg-tertiary, #f9fafb);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.window-item:hover {
  background: var(--color-hover-bg, #f3f4f6);
  border-color: var(--color-border, #e5e7eb);
}

.window-item.active {
  background: var(--color-primary-light, #eff6ff);
  border-color: var(--color-primary, #3b82f6);
}

.window-item.hidden {
  opacity: 0.6;
  background: var(--color-bg-secondary, #f3f4f6);
}

.window-info {
  flex: 1;
  min-width: 0;
}

.window-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary, #1f2937);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hidden-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(107, 114, 128, 0.2);
  color: var(--color-text-secondary, #6b7280);
  border-radius: 3px;
  font-weight: normal;
}

.window-url {
  font-size: 11px;
  color: var(--color-text-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.window-toggle-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
  transition: all 0.2s;
}

.window-toggle-btn:hover {
  background: var(--color-hover-bg, #f3f4f6);
}

.window-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary, #6b7280);
  border-radius: 4px;
  margin-left: 8px;
  transition: all 0.2s;
}

.window-close-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-secondary, #6b7280);
}

.empty-state p {
  margin: 0;
  font-size: 13px;
}

.panel-footer {
  padding: 12px;
  border-top: 1px solid var(--color-border, #e5e7eb);
}

.new-window-btn {
  width: 100%;
  padding: 8px 16px;
  border: 1px dashed var(--color-border, #d1d5db);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-primary, #1f2937);
  border-radius: 6px;
  transition: all 0.2s;
}

.new-window-btn:hover {
  background: var(--color-hover-bg, #f3f4f6);
  border-color: var(--color-primary, #3b82f6);
  color: var(--color-primary, #3b82f6);
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .window-manager-panel {
    background: var(--color-bg-secondary, #1f2937);
    border-color: var(--color-border, #374151);
  }
  
  .panel-header h3 {
    color: var(--color-text-primary, #f9fafb);
  }
  
  .close-btn {
    color: var(--color-text-secondary, #9ca3af);
  }
  
  .close-btn:hover {
    background: var(--color-hover-bg, #374151);
    color: var(--color-text-primary, #f9fafb);
  }
  
  .window-item {
    background: var(--color-bg-tertiary, #111827);
  }
  
  .window-item:hover {
    background: var(--color-hover-bg, #374151);
  }
  
  .window-item.active {
    background: rgba(59, 130, 246, 0.2);
    border-color: var(--color-primary, #3b82f6);
  }
  
  .window-title {
    color: var(--color-text-primary, #f9fafb);
  }
  
  .window-url {
    color: var(--color-text-secondary, #9ca3af);
  }
  
  .new-window-btn {
    border-color: var(--color-border, #4b5563);
    color: var(--color-text-primary, #f9fafb);
  }
  
  .new-window-btn:hover {
    background: var(--color-hover-bg, #374151);
  }
}
</style>
