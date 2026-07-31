<template>
  <div class="flex items-center px-2 h-10 select-none drag-region shrink-0">
    <div class="flex items-center h-full no-drag">
      <img :src="logoPath" class="h-6 ml-2 mr-2" />
      <span class="text-xs font-normal text-(--titlebar-text-color) opacity-80 mr-3">GuaDa AI</span>

      <!-- 搜索按钮 -->
      <el-tooltip v-if="authStore.isAuthenticated" content="搜索会话" placement="bottom">
        <button class="titlebar-menu-btn" @click="showSearchDialog = true">
          <Search16Regular class="w-4 h-4" />
        </button>
      </el-tooltip>

      <!-- Debug 下拉菜单（仅 Electron） -->
      <div v-if="isElectron" class="relative flex items-center h-full debug-dropdown" :class="{ 'active': showDebugMenu }">
        <el-tooltip content="调试工具" placement="bottom">
          <button class="titlebar-menu-btn debug-button" @click="toggleDebugMenu">
            <Bug16Regular class="w-4 h-4" />
          </button>
        </el-tooltip>

        <div v-if="showDebugMenu"
          class="absolute top-full left-0 mt-1 bg-(--color-sidebar-bg) border border-(--color-titlebar-border) rounded-md shadow-lg min-w-40 z-1000 overflow-hidden">
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openDevTools">
            <span>开发者控制台</span>
          </div>
          <div v-if="migrationStatus === 'available'"
            class="px-4 py-2 cursor-pointer text-sm text-yellow-400 transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg)" @click="startMigration">
            <span>📦 数据迁移</span>
          </div>
          <div v-if="migrationStatus === 'migrated'"
            class="px-4 py-2 text-sm text-green-400 whitespace-nowrap opacity-70">
            <span>✅ 数据已迁移</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openUserDataFolder">
            <span>打开数据目录</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--titlebar-hover-bg) hover:text-(--color-text)" @click="openInstallFolder">
            <span>打开安装目录</span>
          </div>
        </div>
      </div>

      <!-- GitHub 仓库 -->
      <el-tooltip content="GitHub 仓库" placement="bottom">
        <button class="titlebar-menu-btn" @click="openInExternalBrowser('https://github.com/donggua-zen/guada')">
          <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </button>
      </el-tooltip>

      <!-- 更新提示 -->
      <el-tooltip v-if="updateAvailable" content="发现新版本，点击查看" placement="bottom">
        <div
          class="titlebar-menu-btn relative flex items-center px-2 cursor-pointer"
          @click="handleUpdateClick">
          <svg class="w-4 h-4" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M512 128c-211.744 0-384 172.256-384 384 0 211.744 172.256 384 384 384 211.744 0 384-172.256 384-384 0-211.744-172.256-384-384-384z m0 704c-176.448 0-320-143.552-320-320 0-176.448 143.552-320 320-320 176.448 0 320 143.552 320 320 0 176.448-143.552 320-320 320z" fill="currentColor" />
            <path d="M512 320c-17.664 0-32 14.336-32 32v160c0 17.664 14.336 32 32 32s32-14.336 32-32v-160c0-17.664-14.336-32-32-32z" fill="currentColor" />
            <path d="M480 608a32 32 0 1 0 64 0 32 32 0 1 0-64 0z" fill="currentColor" />
          </svg>
          <span class="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
        </div>
      </el-tooltip>
    </div>
  </div>

  <!-- 更新弹窗 -->
  <UpdateDialog v-model:visible="showUpdateDialog" :update-info="updateInfo" :is-skipped="skipVersion === updateInfo?.version" @dont-remind="handleDontRemind" @cancel-skip="handleCancelSkip" />

  <!-- 会话搜索弹窗 -->
  <SessionSearchDialog v-model="showSearchDialog" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Bug16Regular, Search16Regular } from '@vicons/fluent'
import UpdateDialog from './UpdateDialog.vue'
import SessionSearchDialog from './SessionSearchDialog.vue'
import { fixFrontendAssetUrl } from '@/utils/url'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { useAuthStore } from '@/stores/auth'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined

const authStore = useAuthStore()

const logoPath = computed(() => fixFrontendAssetUrl('/images/guada_logo_small.png'))

const isMaximized = ref(false)
const updateAvailable = ref(false)
const updateInfo = ref<any>(null)
const showDebugMenu = ref(false)
const showUpdateDialog = ref(false)
const showSearchDialog = ref(false)
const skipVersion = ref<string | null>(localStorage.getItem('update-skip-version'))
const migrationStatus = ref<string>('')
const isMigrating = ref(false)

const handleUpdateStatus = (status: any) => {
  if (status.status === 'available') {
    updateInfo.value = status.info
    updateAvailable.value = true
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

const loadMigrationStatus = async () => {
  if (!window.electronAPI) return
  try {
    const info = await window.electronAPI.getAppInfo()
    migrationStatus.value = info.migration?.status || ''
  } catch {
    // ignore
  }
}

const startMigration = async () => {
  if (!window.electronAPI || isMigrating.value) return
  isMigrating.value = true
  showDebugMenu.value = false

  const confirmed = confirm('即将把数据从 AppData 目录迁移到用户主目录下的 .guada 目录，此过程需要重启后端，是否继续？')
  if (!confirmed) {
    isMigrating.value = false
    return
  }

  try {
    const result = await window.electronAPI.migrateData()
    if (result.success) {
      alert('✅ 数据迁移成功！数据已迁移至 ~/.guada/')
      migrationStatus.value = 'migrated'
    } else {
      alert(`❌ 迁移失败：${result.message}`)
    }
  } catch (error: any) {
    alert(`❌ 迁移异常：${error.message || error}`)
  } finally {
    isMigrating.value = false
  }
}

const handleClickOutside = (event: MouseEvent) => {
  const dropdown = document.querySelector('.debug-dropdown')
  if (dropdown && !dropdown.contains(event.target as Node)) {
    showDebugMenu.value = false
  }
}

onMounted(() => {
  loadMigrationStatus()

  if (window.electronAPI && typeof window.electronAPI.onUpdateStatus === 'function') {
    window.electronAPI.onUpdateStatus(handleUpdateStatus)
  }

  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

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
