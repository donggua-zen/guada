<template>
  <div v-if="isElectron" class="flex items-center justify-between h-10.5 bg-(--color-titlebar-bg) border-b border-(--color-titlebar-border) select-none drag-region">
    <!-- 左侧：应用标题 -->
    <div class="flex items-center pl-2 flex-1">
      <span class="text-xs font-normal text-(--titlebar-text-color) opacity-80">GuaDa AI</span>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="flex items-center h-full no-drag">
      <!-- 窗口管理按钮 -->
      <button 
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none" 
        @click="toggleWindowManager" 
        title="窗口管理"
      >
        <PanelSeparateWindow20Filled class="w-4 h-4" />
      </button>
      
      <!-- Debug 下拉菜单 -->
      <div class="relative flex items-center h-full debug-dropdown" :class="{ 'active': showDebugMenu }">
        <button 
          class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none debug-button" 
          @click="toggleDebugMenu" 
          title="调试工具"
        >
          <svg t="1777119117025" class="w-4 h-4" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3563">
            <path d="M1022.06544 583.40119c0 11.0558-4.034896 20.61962-12.111852 28.696576-8.077979 8.077979-17.639752 12.117992-28.690436 12.117992L838.446445 624.215758c0 72.690556-14.235213 134.320195-42.718941 184.89915l132.615367 133.26312c8.076956 8.065699 12.117992 17.634636 12.117992 28.690436 0 11.050684-4.034896 20.614503-12.117992 28.691459-7.653307 8.065699-17.209964 12.106736-28.690436 12.106736-11.475356 0-21.040199-4.041036-28.690436-12.106736L744.717737 874.15318c-2.124384 2.118244-5.308913 4.88424-9.558703 8.283664-4.259 3.3984-13.180184 9.463536-26.78504 18.171871-13.598716 8.715499-27.415396 16.473183-41.439808 23.276123-14.029528 6.797823-31.462572 12.966313-52.289923 18.49319-20.827351 5.517667-41.446971 8.28571-61.842487 8.28571L552.801776 379.38668l-81.611739 0 0 571.277058c-21.668509 0-43.250036-2.874467-64.707744-8.615215-21.473057-5.734608-39.960107-12.749372-55.476499-21.039175-15.518438-8.289804-29.541827-16.572444-42.077328-24.867364-12.541641-8.290827-21.781072-15.193027-27.739784-20.714787l-9.558703-8.93244L154.95056 998.479767c-8.500605 8.921183-18.699897 13.386892-30.606065 13.386892-10.201339 0-19.335371-3.40454-27.409257-10.202363-8.079002-7.652284-12.437264-17.10968-13.080923-28.372188-0.633427-11.263531 2.659573-21.143553 9.893324-29.647227l128.787178-144.727219c-24.650423-48.464805-36.980239-106.699114-36.980239-174.710091L42.738895 624.207571c-11.057847 0-20.61655-4.041036-28.690436-12.111852-8.079002-8.082072-12.120039-17.640776-12.120039-28.696576 0-11.050684 4.041036-20.61962 12.120039-28.689413 8.073886-8.072863 17.632589-12.107759 28.690436-12.107759l142.81466 0L185.553555 355.156836l-110.302175-110.302175c-8.074909-8.077979-12.113899-17.640776-12.113899-28.691459 0-11.04966 4.044106-20.61962 12.113899-28.690436 8.071839-8.076956 17.638729-12.123109 28.691459-12.123109 11.056823 0 20.612457 4.052293 28.692482 12.123109l110.302175 110.302175 538.128077 0 110.303198-110.302175c8.070816-8.076956 17.632589-12.123109 28.690436-12.123109 11.050684 0 20.617573 4.052293 28.689413 12.123109 8.077979 8.070816 12.119015 17.640776 12.119015 28.690436 0 11.050684-4.041036 20.614503-12.119015 28.691459l-110.302175 110.302175 0 187.448206 142.815683 0c11.0558 0 20.618597 4.034896 28.690436 12.113899 8.076956 8.069793 12.117992 17.638729 12.117992 28.683273l0 0L1022.06544 583.40119 1022.06544 583.40119zM716.021162 216.158085 307.968605 216.158085c0-56.526411 19.871583-104.667851 59.616796-144.414087 39.733956-39.746236 87.88256-59.611679 144.411017-59.611679 56.529481 0 104.678084 19.865443 144.413064 59.611679C696.156742 111.48921 716.021162 159.631674 716.021162 216.158085L716.021162 216.158085 716.021162 216.158085 716.021162 216.158085z" fill="currentColor"></path>
          </svg>
        </button>

        <!-- 下拉菜单 -->
        <div v-if="showDebugMenu" class="absolute top-full right-0 mt-1 bg-(--color-sidebar-bg) border border-(--color-titlebar-border) rounded-md shadow-lg min-w-40 z-1000 overflow-hidden">
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
           class="cursor-pointer flex items-center px-3 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
           @click="handleUpdateClick"
           title="点击安装更新">
        <span>有新版本 {{ updateVersion }}</span>
      </div>

      <button 
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none" 
        @click="minimizeWindow" 
        title="最小化"
      >
        <svg t="1776852968295" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5695">
          <path d="M45.60213333 478.13973333h932.79573334c22.9376 0 33.86026667 11.4688 34.4064 34.4064 0 22.9376-11.4688 34.4064-34.4064 34.4064H45.60213333c-22.9376 0-34.4064-11.4688-34.4064-34.4064 0-23.48373333 11.4688-34.4064 34.4064-34.4064z" fill="currentColor"></path>
        </svg>
      </button>

      <button 
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-(--titlebar-hover-bg) hover:opacity-100 focus:outline-none focus-visible:outline-none" 
        @click="maximizeWindow" 
        :title="isMaximized ? '还原' : '最大化'"
      >
        <!-- 最大化图标 -->
        <svg v-if="!isMaximized" t="1776852947844" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5524">
          <path d="M926.45937303 97.54062697v828.2973677H97.54062697V97.54062697h828.91874606m4.97102697-77.6722963h-838.8608c-39.7682157 0-72.07989097 32.31167525-72.07989097 72.07989096v839.48217837c0 39.7682157 32.31167525 72.07989097 72.07989097 72.07989097h839.48217837c39.7682157 0 72.07989097-32.31167525 72.07989096-72.07989097v-838.8608c0-40.38959408-32.31167525-72.70126933-72.70126933-72.70126933 0.62137837 0 0 0 0 0z" fill="currentColor"></path>
        </svg>
        <!-- 还原图标 -->
        <svg v-else t="1776852886552" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5352">
          <path d="M739.95130434 284.04869566v658.32336695H81.62793739V284.04869566h658.32336695m0.60787015-75.98376812H80.4121971c-41.33516985 0-75.37589797 33.43285797-75.37589797 75.37589797V943.5878029c0 41.33516985 33.43285797 75.37589797 75.37589797 75.37589797h660.14697739c41.33516985 0 75.37589797-33.43285797 75.37589797-75.37589797V283.44082551c0-41.94304-33.43285797-75.37589797-75.37589797-75.37589797z" fill="currentColor"></path>
          <path d="M944.19567304 5.64416928H282.83295536c-41.33516985 0-74.16015768 33.43285797-74.76802782 74.16015768v77.1995084h75.98376812V81.62793739h658.32336695v658.32336695h-75.98376812V815.93507246H943.5878029c41.33516985 0 74.16015768-33.43285797 74.76802782-74.76802782V79.80432696c0-40.72729971-33.43285797-74.16015768-74.16015768-74.16015768z" fill="currentColor"></path>
        </svg>
      </button>

      <button 
        class="flex items-center justify-center w-11.5 h-full border-none bg-transparent cursor-pointer text-(--titlebar-text-color) transition-all duration-150 ease-in-out opacity-70 outline-none hover:bg-[#e81123] hover:text-white hover:opacity-100 focus:outline-none focus-visible:outline-none close-button" 
        @click="closeWindow" 
        title="关闭"
      >
        <svg t="1776852982148" class="w-3 h-3" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5866">
          <path d="M578.36284173 512l422.30899284-422.30899284c18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0l-422.30899284 422.30899284-422.30899284-422.30899284c-18.09895683-18.09895683-48.2638849-18.09895683-66.36284173 0-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173l422.30899284 422.30899284-422.30899284 422.30899284c-18.09895683 18.09895683-18.09895683 48.2638849 0 66.36284173 18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0l422.30899284-422.30899284 422.30899284 422.30899284c18.09895683 18.09895683 48.2638849 18.09895683 66.36284173 0 18.09895683-18.09895683 18.09895683-48.2638849 0-66.36284173l-422.30899284-422.30899284z" fill="currentColor"></path>
        </svg>
      </button>
    </div>
  </div>
  
  <!-- 窗口管理面板 -->
  <WindowManager 
    v-if="showWindowManager" 
    :visible="showWindowManager"
    @close="showWindowManager = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { PanelSeparateWindow20Filled } from '@vicons/fluent'
import WindowManager from './WindowManager.vue'

const router = useRouter()

const isElectron = computed(() => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined
})

const isMaximized = ref(false)
const updateAvailable = ref(false)
const updateVersion = ref('')
const showDebugMenu = ref(false)
const showWindowManager = ref(false)

// 切换窗口管理面板
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
</style>
