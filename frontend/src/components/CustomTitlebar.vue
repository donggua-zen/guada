<template>
  <div v-if="isElectron"
    class="custom-titlebar flex items-center justify-between h-8 sidebar-transparent-bg select-none drag-region">
    <!-- 左侧：应用标题 + 菜单按钮 -->
    <div class="flex items-center pl-2  h-full no-drag">
      <img :src="logoPath" class="h-6 ml-2 mr-2" />
      <span class="text-xs font-normal text-(--titlebar-text-color) opacity-80 mr-3">GuaDa AI</span>

      <!-- 浏览器管理按钮 -->
      <button class="titlebar-menu-btn" @click="toggleWindowManager">
        浏览器管理
      </button>

      <!-- Debug 下拉菜单 -->
      <div class="relative flex items-center h-full debug-dropdown" :class="{ 'active': showDebugMenu }">
        <button class="titlebar-menu-btn debug-button" @click="toggleDebugMenu">
          调试工具
        </button>

        <div v-if="showDebugMenu"
          class="absolute top-full left-0 mt-1 bg-(--color-sidebar-bg) border border-(--color-titlebar-border) rounded-md shadow-lg min-w-40 z-1000 overflow-hidden">
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openDevTools">
            <span>开发者控制台</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openUserDataFolder">
            <span>打开数据目录</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openInstallFolder">
            <span>打开安装目录</span>
          </div>
        </div>
      </div>

      <!-- 更新提示 -->
      <div v-if="isElectron && updateAvailable"
        class="titlebar-menu-btn relative flex items-center px-2 cursor-pointer"
        @click="handleUpdateClick" title="发现新版本，点击查看">
        <svg class="w-4 h-4" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path d="M512 128c-211.744 0-384 172.256-384 384 0 211.744 172.256 384 384 384 211.744 0 384-172.256 384-384 0-211.744-172.256-384-384-384z m0 704c-176.448 0-320-143.552-320-320 0-176.448 143.552-320 320-320 176.448 0 320 143.552 320 320 0 176.448-143.552 320-320 320z" fill="currentColor" />
          <path d="M512 320c-17.664 0-32 14.336-32 32v160c0 17.664 14.336 32 32 32s32-14.336 32-32v-160c0-17.664-14.336-32-32-32z" fill="currentColor" />
          <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor" />
        </svg>
        <span class="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
      </div>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="flex items-center h-full no-drag">

      <button
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none"
        @click="minimizeWindow" title="最小化">
        <svg t="1776852968295" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5695">
          <path
            d="M45.60213333 478.13973333h932.79573334c22.9376 0 33.86026667 11.4688 34.4064 34.4064 0 22.9376-11.4688 34.4064-34.4064 34.4064H45.60213333c-22.9376 0-34.4064-11.4688-34.4064-34.4064 0-23.48373333 11.4688-34.4064 34.4064-34.4064z"
            fill="currentColor"></path>
        </svg>
      </button>

      <button
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none"
        @click="maximizeWindow" :title="isMaximized ? '还原' : '最大化'">
        <!-- 最大化图标 -->
        <svg v-if="!isMaximized" t="1776852947844" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1"
          xmlns="http://www.w3.org/2000/svg" p-id="5524">
          <path
            d="M926.45937303 97.54062697v828.2973677H97.54062697V97.54062697h828.91874606m4.97102697-77.6722963h-838.8608c-39.7682157 0-72.07989097 32.31167525-72.07989097 72.07989096v839.48217837c0 39.7682157 32.31167525 72.07989097 72.07989097 72.07989097h839.48217837c39.7682157 0 72.07989097-32.31167525 72.07989096-72.07989097v-838.8608c0-40.38959408-32.31167525-72.70126933-72.70126933-72.70126933 0.62137837 0 0 0 0 0z"
            fill="currentColor"></path>
        </svg>
        <!-- 还原图标 -->
        <svg v-else t="1776852886552" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1"
          xmlns="http://www.w3.org/2000/svg" p-id="5352">
          <path
            d="M739.95130434 284.04869566v658.32336695H81.62793739V284.04869566h658.32336695m0.60787015-75.98376812H80.4121971c-41.33516985 0-75.37589797 33.43285797-75.37589797 75.37589797V943.5878029c0 41.33516985 33.43285797 75.37589797 75.37589797 75.37589797h660.14697739c41.33516985 0 75.37589797-33.43285797 75.37589797-75.37589797V283.44082551c0-41.94304-33.43285797-75.37589797-75.37589797-75.37589797z"
            fill="currentColor"></path>
          <path
            d="M944.19567304 5.64416928H282.83295536c-41.33516985 0-74.16015768 33.43285797-74.76802782 74.16015768v77.1995084h75.98376812V81.62793739h658.32336695v658.32336695h-75.98376812V815.93507246H943.5878029c41.33516985 0 74.16015768-33.43285797 74.76802782-74.76802782V79.80432696c0-40.72729971-33.43285797-74.16015768-74.16015768-74.16015768z"
            fill="currentColor"></path>
        </svg>
      </button>

      <button
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-[#e81123] hover:text-white hover:opacity-100 focus:outline-none focus-visible:outline-none close-button"
        @click="closeWindow" title="关闭">
        <svg t="1776852982148" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
          p-id="5866">
          <path
            d="M578.36284173 512l422.30899284-422.30899284c18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0l-422.30899284 422.30899284-422.30899284-422.30899284c-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173l422.30899284 422.30899284-422.30899284 422.30899284c-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173 18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0l422.30899284-422.30899284 422.30899284 422.30899284c18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0 18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173l-422.30899284-422.30899284z"
            fill="currentColor"></path>
        </svg>
      </button>
    </div>
  </div>

  <!-- 浏览器管理面板 -->
  <WindowManager v-if="showWindowManager" :visible="showWindowManager" @close="showWindowManager = false" />

  <!-- 更新弹窗 -->
  <UpdateDialog v-model:visible="showUpdateDialog" :update-info="updateInfo" :is-skipped="skipVersion === updateInfo?.version" @dont-remind="handleDontRemind" @cancel-skip="handleCancelSkip" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { PanelSeparateWindow20Filled } from '@vicons/fluent'
import WindowManager from './WindowManager.vue'
import UpdateDialog from './UpdateDialog.vue'
import { fixFrontendAssetUrl } from '@/utils/url'

const router = useRouter()

// Logo 路径（使用 fixFrontendAssetUrl 适配 Electron 环境）
const logoPath = computed(() => fixFrontendAssetUrl('/images/guada_logo_small.png'))

// 声明组件可能发出的事件
defineEmits(['openGuide'])

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})

const isMaximized = ref(false)
const updateAvailable = ref(false)
const updateInfo = ref<any>(null)
const showDebugMenu = ref(false)
const showWindowManager = ref(false)
const showUpdateDialog = ref(false)
const skipVersion = ref<string | null>(localStorage.getItem('update-skip-version'))

// 切换浏览器管理面板
function toggleWindowManager() {
  showWindowManager.value = !showWindowManager.value
}

const updateMaximizedState = async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.isMaximized()
  }
}

const handleUpdateStatus = (status: any) => {
  if (status.status === 'available') {
    updateInfo.value = status.info
    updateAvailable.value = true
    // 如果用户选择了跳过此版本，则不自动弹窗，但红点徽标仍显示
    if (skipVersion.value !== status.info?.version) {
      showUpdateDialog.value = true
    }
  } else if (status.status === 'not-available' || status.status === 'error') {
    updateAvailable.value = false
    updateInfo.value = null
  }
}

const handleUpdateClick = () => {
  if (updateInfo.value) {
    showUpdateDialog.value = true
  }
}

const closeUpdateDialog = () => {
  showUpdateDialog.value = false
}

const handleDontRemind = () => {
  if (updateInfo.value?.version) {
    skipVersion.value = updateInfo.value.version
    localStorage.setItem('update-skip-version', updateInfo.value.version)
  }
}

const handleCancelSkip = () => {
  skipVersion.value = null
  localStorage.removeItem('update-skip-version')
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
})

// 组件卸载时移除监听器
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
/* Electron 拖拽区域控制 */
.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

/* Windows 菜单栏风格按钮 */
.titlebar-menu-btn {
  display: flex;
  align-items: center;
  height: 22px;
  margin: 2px 2px;
  padding: 0 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--titlebar-text-color, rgba(255,255,255,0.4));
  border-radius: 4px;
  transition: all 0.15s ease-in-out;
  outline: none;
  font-family: inherit;
  white-space: nowrap;
}

.titlebar-menu-btn:hover {
  background: var(--titlebar-hover-bg, rgba(255,255,255,0.1));
  color: var(--titlebar-text-color, rgba(255,255,255,0.7));
}
</style>
