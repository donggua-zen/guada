<template>
  <div v-if="isElectron" class="custom-titlebar" :class="{ 'drag-region': true }">
    <!-- 左侧：应用标题 + 标签栏 -->
    <div class="titlebar-left">
      <!-- 主应用标签（不可关闭） -->
      <div 
        class="tab-item main-tab"
        :class="{ active: activeTabId === 'main_app' }"
        @click="switchTab('main_app')"
        title="主应用"
      >
        <span class="tab-title">GuaDa AI</span>
      </div>

      <!-- 其他标签页 -->
      <div 
        v-for="tab in tabs" 
        :key="tab.tabId"
        class="tab-item"
        :class="{ active: activeTabId === tab.tabId }"
        @click="switchTab(tab.tabId)"
      >
        <span class="tab-title">{{ truncateTitle(tab.title) }}</span>
        <button 
          v-if="!tab.isMainApp"
          class="tab-close" 
          @click.stop="closeTab(tab.tabId)"
          title="关闭标签"
        >
          ×
        </button>
      </div>

      <!-- 新建标签按钮（仅调试模式显示） -->
      <button v-if="isDebug" class="new-tab-btn" @click="createNewTab" title="新建标签">
        +
      </button>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="titlebar-right no-drag">
      <!-- Debug 下拉菜单 -->
      <div class="debug-dropdown" :class="{ 'active': showDebugMenu }">
        <button class="titlebar-button debug-button" @click="toggleDebugMenu" title="调试工具">
          <svg t="1777119117025" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3563" width="48" height="48">
            <path d="M1022.06544 583.40119c0 11.0558-4.034896 20.61962-12.111852 28.696576-8.077979 8.077979-17.639752 12.117992-28.690436 12.117992L838.446445 624.215758c0 72.690556-14.235213 134.320195-42.718941 184.89915l132.615367 133.26312c8.076956 8.065699 12.117992 17.634636 12.117992 28.690436 0 11.050684-4.034896 20.614503-12.117992 28.691459-7.653307 8.065699-17.209964 12.106736-28.690436 12.106736-11.475356 0-21.040199-4.041036-28.690436-12.106736L744.717737 874.15318c-2.124384 2.118244-5.308913 4.88424-9.558703 8.283664-4.259 3.3984-13.180184 9.463536-26.78504 18.171871-13.598716 8.715499-27.415396 16.473183-41.439808 23.276123-14.029528 6.797823-31.462572 12.966313-52.289923 18.49319-20.827351 5.517667-41.446971 8.28571-61.842487 8.28571L552.801776 379.38668l-81.611739 0 0 571.277058c-21.668509 0-43.250036-2.874467-64.707744-8.615215-21.473057-5.734608-39.960107-12.749372-55.476499-21.039175-15.518438-8.289804-29.541827-16.572444-42.077328-24.867364-12.541641-8.290827-21.781072-15.193027-27.739784-20.714787l-9.558703-8.93244L154.95056 998.479767c-8.500605 8.921183-18.699897 13.386892-30.606065 13.386892-10.201339 0-19.335371-3.40454-27.409257-10.202363-8.079002-7.652284-12.437264-17.10968-13.080923-28.372188-0.633427-11.263531 2.659573-21.143553 9.893324-29.647227l128.787178-144.727219c-24.650423-48.464805-36.980239-106.699114-36.980239-174.710091L42.738895 624.207571c-11.057847 0-20.61655-4.041036-28.690436-12.111852-8.079002-8.082072-12.120039-17.640776-12.120039-28.696576 0-11.050684 4.041036-20.61962 12.120039-28.689413 8.073886-8.072863 17.632589-12.107759 28.690436-12.107759l142.81466 0L185.553555 355.156836l-110.302175-110.302175c-8.074909-8.077979-12.113899-17.640776-12.113899-28.691459 0-11.04966 4.044106-20.61962 12.113899-28.690436 8.071839-8.076956 17.638729-12.123109 28.691459-12.123109 11.056823 0 20.612457 4.052293 28.692482 12.123109l110.302175 110.302175 538.128077 0 110.303198-110.302175c8.070816-8.076956 17.632589-12.123109 28.690436-12.123109 11.050684 0 20.617573 4.052293 28.689413 12.123109 8.077979 8.070816 12.119015 17.640776 12.119015 28.690436 0 11.050684-4.041036 20.614503-12.119015 28.691459l-110.302175 110.302175 0 187.448206 142.815683 0c11.0558 0 20.618597 4.034896 28.690436 12.113899 8.076956 8.069793 12.117992 17.638729 12.117992 28.683273l0 0L1022.06544 583.40119 1022.06544 583.40119zM716.021162 216.158085 307.968605 216.158085c0-56.526411 19.871583-104.667851 59.616796-144.414087 39.733956-39.746236 87.88256-59.611679 144.411017-59.611679 56.529481 0 104.678084 19.865443 144.413064 59.611679C696.156742 111.48921 716.021162 159.631674 716.021162 216.158085L716.021162 216.158085 716.021162 216.158085 716.021162 216.158085z" fill="currentColor"></path>
          </svg>
        </button>

        <!-- 下拉菜单 -->
        <div v-if="showDebugMenu" class="dropdown-menu">
          <div class="dropdown-item" @click="openDevTools">
            <span>开发者控制台</span>
          </div>
          <div class="dropdown-item" @click="openUserDataFolder">
            <span>打开数据目录</span>
          </div>
          <div class="dropdown-item" @click="openInstallFolder">
            <span>打开安装目录</span>
          </div>
        </div>
      </div>

      <!-- 更新提示 -->
      <div v-if="isElectron && updateAvailable" 
           class="update-badge cursor-pointer flex items-center px-3 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
           @click="handleUpdateClick"
           title="点击安装更新">
        <span>有新版本 {{ updateVersion }}</span>
      </div>

      <button class="titlebar-button" @click="minimizeWindow" title="最小化">
        <svg t="1776852968295" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5695" width="48" height="48">
          <path
            d="M45.60213333 478.13973333h932.79573334c22.9376 0 33.86026667 11.4688 34.4064 34.4064 0 22.9376-11.4688 34.4064-34.4064 34.4064H45.60213333c-22.9376 0-34.4064-11.4688-34.4064-34.4064 0-23.48373333 11.4688-34.4064 34.4064-34.4064z"
            fill="currentColor"></path>
        </svg>
      </button>

      <button class="titlebar-button" @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'">
        <!-- 最大化图标 -->
        <svg v-if="!isMaximized" t="1776852947844" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5524" width="48" height="48">
          <path
            d="M926.45937303 97.54062697v828.2973677H97.54062697V97.54062697h828.91874606m4.97102697-77.6722963h-838.8608c-39.7682157 0-72.07989097 32.31167525-72.07989097 72.07989096v839.48217837c0 39.7682157 32.31167525 72.07989097 72.07989097 72.07989097h839.48217837c39.7682157 0 72.07989097-32.31167525 72.07989096-72.07989097v-838.8608c0-40.38959408-32.31167525-72.70126933-72.70126933-72.70126933 0.62137837 0 0 0 0 0z"
            fill="currentColor"></path>
        </svg>
        <!-- 还原图标 -->
        <svg v-else t="1776852886552" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5352" width="48" height="48">
          <path
            d="M739.95130434 284.04869566v658.32336695H81.62793739V284.04869566h658.32336695m0.60787015-75.98376812H80.4121971c-41.33516985 0-75.37589797 33.43285797-75.37589797 75.37589797V943.5878029c0 41.33516985 33.43285797 75.37589797 75.37589797 75.37589797h660.14697739c41.33516985 0 75.37589797-33.43285797 75.37589797-75.37589797V283.44082551c0-41.94304-33.43285797-75.37589797-75.37589797-75.37589797z"
            fill="currentColor"></path>
          <path
            d="M944.19567304 5.64416928H282.83295536c-41.33516985 0-74.16015768 33.43285797-74.76802782 74.16015768v77.1995084h75.98376812V81.62793739h658.32336695v658.32336695h-75.98376812V815.93507246H943.5878029c41.33516985 0 74.16015768-33.43285797 74.76802782-74.76802782V79.80432696c0-40.72729971-33.43285797-74.16015768-74.16015768-74.16015768z"
            fill="currentColor"></path>
        </svg>
      </button>

      <button class="titlebar-button close-button" @click="closeWindow" title="关闭">
        <svg t="1776852982148" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5866" width="48" height="48">
          <path
            d="M578.36284173 512l422.30899284-422.30899284c18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0l-422.30899284 422.30899284-422.30899284-422.30899284c-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173l422.30899284 422.30899284-422.30899284 422.30899284c-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173 18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0l422.30899284-422.30899284 422.30899284 422.30899284c18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0 18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173l-422.30899284-422.30899284z"
            fill="currentColor"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})

// 标签页相关状态
interface TabInfo {
  tabId: string
  title: string
  url: string
  isMainApp: boolean
  isActive?: boolean
}

const tabs = ref<TabInfo[]>([])
const activeTabId = ref<string>('main_app')

// 截断标题
function truncateTitle(title: string, maxLength: number = 15): string {
  if (title.length <= maxLength) return title
  return title.substring(0, maxLength) + '...'
}

const isDebug = ref(import.meta.env.DEV)

// 切换标签
async function switchTab(tabId: string) {
  if (!window.electronAPI) return
  
  try {
    await window.electronAPI.activateTab(tabId)
    activeTabId.value = tabId
  } catch (error) {
    console.error('Failed to switch tab:', error)
  }
}

// 关闭标签
async function closeTab(tabId: string) {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.closeTab(tabId)
    if (result.success) {
      // 找到被关闭标签的索引
      const closedIndex = tabs.value.findIndex(t => t.tabId === tabId)
      // 移除本地列表中的标签
      tabs.value = tabs.value.filter(t => t.tabId !== tabId)
      
      // 如果关闭的是当前标签，切换到上一个标签（或主应用）
      if (activeTabId.value === tabId) {
        if (tabs.value.length > 0) {
          // 切换到上一个标签（如果索引超出范围则切换到最后一个）
          const newIndex = Math.min(closedIndex - 1, tabs.value.length - 1)
          const targetTab = tabs.value[Math.max(0, newIndex)]
          activeTabId.value = targetTab.tabId
          await window.electronAPI.activateTab(targetTab.tabId)
        } else {
          // 没有其他标签了，切换到主应用
          activeTabId.value = 'main_app'
          await window.electronAPI.activateTab('main_app')
        }
      }
    }
  } catch (error) {
    console.error('Failed to close tab:', error)
  }
}

// 创建新标签
async function createNewTab() {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.createTab('https://www.baidu.com')
    if (!result.success) {
      // 友好提示
      alert('标签数量已达上限（最多5个标签页）')
    }
    // 注意：不手动添加到 tabs.value，等待 tab-updated 事件自动添加
  } catch (error) {
    console.error('Failed to create tab:', error)
  }
}

// 加载标签列表
async function loadTabs() {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.getTabs()
    if (result.success) {
      // 过滤掉主应用标签（已在模板中硬编码）
      tabs.value = (result.tabs || []).filter(t => t.tabId !== 'main_app')
      // 找到活跃标签
      const activeTab = tabs.value.find(t => t.isActive)
      if (activeTab) {
        activeTabId.value = activeTab.tabId
      }
    }
  } catch (error) {
    console.error('Failed to load tabs:', error)
  }
}

// 监听标签更新事件
function handleTabUpdated(event: any, data: any) {
  const existingIndex = tabs.value.findIndex(t => t.tabId === data.tabId)
  
  if (existingIndex !== -1) {
    // 更新现有标签
    tabs.value[existingIndex].title = data.title
    tabs.value[existingIndex].url = data.url
  } else if (!data.isMainApp) {
    // 如果是新标签（非主应用），添加到列表
    tabs.value.push({
      tabId: data.tabId,
      title: data.title || '新标签页',
      url: data.url || '',
      isActive: false,
      isMainApp: false,
    })
  }
  
  if (data.isActive) {
    activeTabId.value = data.tabId
  }
}

// 监听标签关闭事件
function handleTabClosed(event: any, data: any) {
  // 从列表中移除已关闭的标签
  tabs.value = tabs.value.filter(t => t.tabId !== data.tabId)
  
  // 如果关闭的是当前激活的标签，切换到主应用
  if (activeTabId.value === data.tabId) {
    activeTabId.value = 'main_app'
  }
}

const isMaximized = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const showDebugMenu = ref(false)
const updateMaximizedState = async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.isMaximized()
  }
}

const handleUpdateStatus = (status: any) => {
  if (status.status === 'available') {
    updateAvailable.value = true
    updateVersion.value = status.info?.version || ''
  } else if (status.status === 'downloaded') {
    updateAvailable.value = true
  } else if (status.status === 'not-available' || status.status === 'error') {
    updateAvailable.value = false
  }
}

const handleUpdateClick = () => {
  if (window.electronAPI) {
    // 如果已经下载完成，直接安装；否则跳转到设置页查看进度
    // 这里简单处理为触发安装或跳转
    window.electronAPI.installAndRestart()
  }
}

const minimizeWindow = () => {
  window.electronAPI?.minimizeWindow()
}

const maximizeWindow = async () => {
  window.electronAPI?.maximizeWindow()
  // 切换后更新状态
  await updateMaximizedState()
}

const closeWindow = () => {
  window.electronAPI?.closeWindow()
}

const toggleDebugMenu = () => {
  showDebugMenu.value = !showDebugMenu.value
}

const openDevTools = () => {
  window.electronAPI?.toggleDevTools()
  showDebugMenu.value = false
}

const openUserDataFolder = () => {
  window.electronAPI?.openUserDataFolder()
  showDebugMenu.value = false
}

const openInstallFolder = () => {
  window.electronAPI?.openInstallFolder()
  showDebugMenu.value = false
}

// 监听窗口大小变化，自动更新最大化状态
const handleResize = () => {
  updateMaximizedState()
}

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  const dropdown = document.querySelector('.debug-dropdown')
  if (dropdown && !dropdown.contains(event.target as Node)) {
    showDebugMenu.value = false
  }
}

// 组件挂载时获取初始状态并添加监听器
onMounted(() => {
  updateMaximizedState()
  window.addEventListener('resize', handleResize)
  document.addEventListener('click', handleClickOutside)
  
  if (window.electronAPI && typeof window.electronAPI.onUpdateStatus === 'function') {
    window.electronAPI.onUpdateStatus(handleUpdateStatus)
  }
  
  // 加载标签列表
  if (isElectron.value) {
    loadTabs()
    
    // 监听标签更新事件
    window.electronAPI?.onTabUpdated?.(handleTabUpdated)
    
    // 监听标签关闭事件
    if (window.electronAPI && 'onTabClosed' in window.electronAPI) {
      ;(window.electronAPI as any).onTabClosed(handleTabClosed)
    }
  }
})

// 组件卸载时移除监听器
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.custom-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  /* background-color: transparent; */
  background-color: var(--color-titlebar-bg);
  border-bottom: 1px solid var(--color-titlebar-border);
  /* 透明背景，融入整体 */
  user-select: none;
  -webkit-app-region: drag;
  /* 允许拖拽 */
}

.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
  /* 按钮区域不可拖拽 */
}

.titlebar-left {
  display: flex;
  align-items: center;
  padding-left: 8px;
  flex: 1;
  gap: 4px;
  overflow-x: auto;
}

/* 标签页样式 */
.tab-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  cursor: pointer;
  min-width: 80px;
  max-width: 150px;
  transition: all 0.2s;
  user-select: none;
  -webkit-app-region: no-drag;
}

.tab-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab-item.active {
  background: var(--color-sidebar-bg-active);
  color: var(--color-sidebar-text-active);
}

.tab-item.main-tab {
  background: rgba(99, 102, 241, 0.1);
  font-weight: 500;
}

.tab-item.main-tab:hover {
  background: rgba(99, 102, 241, 0.15);
}

.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--titlebar-text-color);
}

.tab-close {
  margin-left: 6px;
  padding: 0 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #999;
  line-height: 1;
  border-radius: 3px;
  transition: all 0.15s;
}

.tab-close:hover {
  background: rgba(255, 0, 0, 0.2);
  color: #ff4444;
}

.new-tab-btn {
  padding: 4px 10px;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: var(--titlebar-text-color);
  border-radius: 4px;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
  opacity: 0.7;
}

.new-tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.4);
  opacity: 1;
}

.app-title {
  font-size: 12px;
  font-weight: 400;
  color: var(--titlebar-text-color);
  opacity: 0.8;
}

.titlebar-right {
  display: flex;
  align-items: center;
  height: 100%;
}

.titlebar-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--titlebar-text-color);
  transition: all 0.15s ease;
  opacity: 0.7;
  outline: none;
  /* 移除默认焦点边框 */
}

.titlebar-button:focus {
  outline: none;
  /* 确保聚焦时也没有边框 */
}

.titlebar-button:focus-visible {
  outline: none;
  /* 移除键盘导航时的焦点边框 */
}

.titlebar-button:hover {
  background-color: var(--titlebar-hover-bg);
  opacity: 1;
}

.titlebar-button.close-button:hover {
  background-color: #e81123;
  color: white;
  opacity: 1;
}

.titlebar-button svg,
.titlebar-button .icon {
  width: 12px;
  height: 12px;
}

.debug-button svg,
.debug-button .icon {
  width: 16px;
  height: 16px;
}

/* Debug 下拉菜单样式 */
.debug-dropdown {
  position: relative;
  display: flex;
  align-items: center;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background-color: var(--color-sidebar-bg);
  border: 1px solid var(--color-titlebar-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 160px;
  z-index: 1000;
  overflow: hidden;
}

.dropdown-item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--titlebar-text-color);
  transition: background-color 0.15s ease;
  white-space: nowrap;
}

.dropdown-item:hover {
  background-color: var(--titlebar-hover-bg);
  color: var(--color-text);
}

.dropdown-item span {
  display: block;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .app-title {
    color: var(--titlebar-text-color);
  }

  .titlebar-button {
    color: var(--titlebar-text-color);
  }

  .titlebar-button:hover {
    background-color: var(--titlebar-hover-bg);
  }
}

/* 支持通过 data-theme 属性手动切换主题 */
[data-theme="dark"] .app-title,
.dark .app-title {
  color: var(--titlebar-text-color);
}

[data-theme="dark"] .titlebar-button,
.dark .titlebar-button {
  color: var(--titlebar-text-color);
}

[data-theme="dark"] .titlebar-button:hover,
.dark .titlebar-button:hover {
  background-color: var(--titlebar-hover-bg);
}
</style>
