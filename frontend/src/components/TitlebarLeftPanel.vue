<template>
  <div class="flex items-center px-2 h-10 select-none drag-region shrink-0">
    <div class="flex items-center h-full no-drag">
      <!-- macOS 下红绿灯占用左上角，隐藏 logo 与文案为侧边栏腾出空间；
           移动端省掉 logo/文案/更新胶囊的宽度，保证搜索等按钮不被挤出视口 -->
      <!-- 尺寸取整数盒：只写 h-6 时宽度由图片固有比例算出（实测 22.31px），
           会把后面的文案与搜索/调试按钮整体推到小数 x 上（实测 46.31 / 114.56） -->
      <img v-if="!isMac && !isMobileDevice" :src="logoPath" class="h-6 w-6 object-contain ml-2 mr-2" />
      <span v-if="!isMac && !isMobileDevice" class="text-xs font-normal text-(--gd-titlebar-text-color) opacity-80 mr-3">GuaDa AI</span>

      <!-- 搜索按钮 -->
      <GdTooltip v-if="authStore.isAuthenticated" :content="t('ui.titlebar.searchSession')" placement="bottom">
        <button class="titlebar-menu-btn" @click="showSearchDialog = true">
          <Search16Regular class="w-4 h-4" />
        </button>
      </GdTooltip>

      <!-- Debug 下拉菜单（仅 Electron） -->
      <div v-if="isElectron" class="relative flex items-center h-full debug-dropdown" :class="{ 'active': showDebugMenu }">
        <GdTooltip :content="t('ui.titlebar.debugTools')" placement="bottom">
          <button class="titlebar-menu-btn debug-button" @click="toggleDebugMenu">
            <Bug16Regular class="w-4 h-4" />
          </button>
        </GdTooltip>

        <div v-if="showDebugMenu"
          class="absolute top-full left-0 mt-1 bg-(--gd-color-sidebar-bg) border border-(--gd-color-titlebar-border) rounded-md shadow-lg min-w-40 z-1000 overflow-hidden">
          <div class="px-4 py-2 cursor-pointer text-sm text-(--gd-titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--gd-titlebar-hover-bg) hover:text-(--gd-color-text)" @click="openDevTools">
            <span>{{ t('ui.titlebar.devConsole') }}</span>
          </div>
          <div v-if="migrationStatus === 'available'"
            class="px-4 py-2 cursor-pointer text-sm text-yellow-400 transition-colors duration-150 whitespace-nowrap hover:bg-(--gd-titlebar-hover-bg)" @click="startMigration">
            <span>{{ t('ui.titlebar.dataMigration') }}</span>
          </div>
          <div v-if="migrationStatus === 'migrated'"
            class="px-4 py-2 text-sm text-green-400 whitespace-nowrap opacity-70">
            <span>{{ t('ui.titlebar.dataMigrated') }}</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--gd-titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--gd-titlebar-hover-bg) hover:text-(--gd-color-text)" @click="openUserDataFolder">
            <span>{{ t('ui.titlebar.openDataFolder') }}</span>
          </div>
          <div class="px-4 py-2 cursor-pointer text-sm text-(--gd-titlebar-text-color) transition-colors duration-150 whitespace-nowrap hover:bg-(--gd-titlebar-hover-bg) hover:text-(--gd-color-text)" @click="openInstallFolder">
            <span>{{ t('ui.titlebar.openInstallFolder') }}</span>
          </div>
        </div>
      </div>

      <!-- GitHub 仓库 -->
      <GdTooltip :content="t('ui.titlebar.githubRepo')" placement="bottom">
        <button class="titlebar-menu-btn" @click="openInExternalBrowser('https://github.com/donggua-zen/guada')">
          <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </button>
      </GdTooltip>

      <!-- 更新提示：胶囊式版本标签，直接显示「新版本 / 下载中 / 待安装」 -->
      <GdTooltip v-if="updateStore.hasUpdate" :content="updateTooltip" placement="bottom">
        <button
          type="button"
          class="update-badge"
          :class="updateBadgeClass"
          :aria-label="updateTooltip"
          @click="handleUpdateClick"
        >
          <span v-if="updateStore.status === 'available'" class="update-badge__dot"></span>
          <component
            v-else-if="isUpdateSpinning"
            :is="ArrowSync16Regular"
            class="update-badge__icon animate-spin"
          />
          <ArrowDownload16Regular v-else class="update-badge__icon" />
          <span>{{ updateBadgeLabel }}</span>
        </button>
      </GdTooltip>
    </div>
  </div>

  <!-- 更新弹窗 -->
  <UpdateDialog v-model:visible="showUpdateDialog" :is-skipped="updateStore.isSkipped" @dont-remind="updateStore.dontRemind" @cancel-skip="updateStore.cancelSkip" />

  <!-- 会话搜索弹窗 -->
  <SessionSearchDialog v-model="showSearchDialog" />
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownload16Regular, ArrowSync16Regular, Bug16Regular, Search16Regular } from '@vicons/fluent'
import UpdateDialog from './UpdateDialog.vue'
import SessionSearchDialog from './SessionSearchDialog.vue'
import { fixFrontendAssetUrl } from '@/utils/url'
import { openInExternalBrowser } from '@/utils/browserUtils'
import { isMobileDevice } from '@/composables/useDevice'
import { useAuthStore } from '@/stores/auth'
import { useUpdateStore } from '@/stores/update'
import GdTooltip from '@/components/ui/GdTooltip.vue'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const isMac = isElectron && window.electronAPI?.platform === 'darwin'

const authStore = useAuthStore()
const updateStore = useUpdateStore()

const { t } = useI18n()

const logoPath = computed(() => fixFrontendAssetUrl('/images/guada_logo_small.png'))

const showDebugMenu = ref(false)
const showUpdateDialog = ref(false)
const showSearchDialog = ref(false)
const migrationStatus = ref<string>('')
const isMigrating = ref(false)

const handleUpdateClick = () => {
  if (updateStore.hasUpdate) {
    showUpdateDialog.value = true
  }
}

const updateVersion = computed(() => String(updateStore.info?.version || ''))
const updatePercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(updateStore.progress?.percent || 0))),
)
const isUpdateSpinning = computed(
  () => updateStore.status === 'downloading' || updateStore.status === 'installing',
)

const updateBadgeLabel = computed(() => {
  const version = updateVersion.value
  switch (updateStore.status) {
    case 'downloading':
      return t('ui.titlebar.updateDownloading', { percent: updatePercent.value })
    case 'downloaded':
      return version
        ? t('ui.titlebar.updateReady', { version })
        : t('ui.titlebar.updateReadyNoVersion')
    case 'installing':
      return t('ui.titlebar.updateInstalling')
    default:
      return version
        ? t('ui.titlebar.updateAvailable', { version })
        : t('ui.titlebar.updateAvailableNoVersion')
  }
})

const updateTooltip = computed(() => {
  const version = updateVersion.value
  switch (updateStore.status) {
    case 'downloading':
      return t('ui.titlebar.updateTooltipDownloading', { percent: updatePercent.value })
    case 'downloaded':
      return t('ui.titlebar.updateTooltipReady')
    case 'installing':
      return t('ui.titlebar.updateTooltipInstalling')
    default:
      return version
        ? t('ui.titlebar.updateTooltipAvailable', { version })
        : t('ui.titlebar.newVersionTip')
  }
})

const updateBadgeClass = computed(() => ({
  'update-badge--downloading': updateStore.status === 'downloading',
  'update-badge--ready': updateStore.status === 'downloaded',
  'update-badge--installing': updateStore.status === 'installing',
}))

// 自动弹窗：只在“发现新版本”时弹一次；下载/已下载状态不重复打扰。
watch(
  () => updateStore.status,
  (status) => {
    if (status === 'available' && !updateStore.isSkipped) {
      showUpdateDialog.value = true
    }
  },
)

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

  const confirmed = confirm(t('ui.titlebar.migrationConfirm'))
  if (!confirmed) {
    isMigrating.value = false
    return
  }

  try {
    const result = await window.electronAPI.migrateData()
    if (result.success) {
      alert(t('ui.titlebar.migrationSuccess'))
      migrationStatus.value = 'migrated'
    } else {
      alert(t('ui.titlebar.migrationFailed', { reason: result.message }))
    }
  } catch (error) {
    alert(t('ui.titlebar.migrationError', { reason: getErrorMessage(error) }))
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
  updateStore.init()
  // init() 里的状态查询是异步的；若检查结果已在挂载前到达，这里补一次自动弹窗。
  if (updateStore.status === 'available' && !updateStore.isSkipped) {
    showUpdateDialog.value = true
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
  color: var(--gd-titlebar-text-color, rgba(255,255,255,0.4));
  border-radius: 4px;
  transition: all 0.15s ease-in-out;
  outline: none;
  font-family: inherit;
  white-space: nowrap;
}

.titlebar-menu-btn:hover {
  background: var(--gd-titlebar-hover-bg, rgba(255,255,255,0.1));
  color: var(--gd-titlebar-text-color, rgba(255,255,255,0.7));
}

/* 更新徽标：胶囊式版本标签，比单独的小圆点更醒目 */
.update-badge {
  --update-accent: #ea580c;
  --update-accent-bg: rgba(249, 115, 22, 0.13);
  --update-accent-border: rgba(249, 115, 22, 0.38);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  margin-left: 4px;
  padding: 0 10px;
  border: 1px solid var(--update-accent-border);
  border-radius: 999px;
  background: var(--update-accent-bg);
  color: var(--update-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.update-badge:hover {
  background: color-mix(in srgb, var(--update-accent) 24%, transparent);
  border-color: color-mix(in srgb, var(--update-accent) 62%, transparent);
  transform: translateY(-0.5px);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--update-accent) 18%, transparent);
}

.update-badge:active {
  transform: translateY(0);
  box-shadow: none;
}

.update-badge__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.update-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  animation: update-badge-pulse 1.6s ease-in-out infinite;
}

.update-badge--downloading,
.update-badge--installing {
  --update-accent: #2563eb;
  --update-accent-bg: rgba(59, 130, 246, 0.12);
  --update-accent-border: rgba(59, 130, 246, 0.35);
}

.update-badge--ready {
  --update-accent: #059669;
  --update-accent-bg: rgba(16, 185, 129, 0.13);
  --update-accent-border: rgba(16, 185, 129, 0.38);
}

html.dark .update-badge {
  --update-accent: #fb923c;
  --update-accent-bg: rgba(251, 146, 60, 0.14);
  --update-accent-border: rgba(251, 146, 60, 0.36);
}

html.dark .update-badge--downloading,
html.dark .update-badge--installing {
  --update-accent: #60a5fa;
  --update-accent-bg: rgba(96, 165, 250, 0.14);
  --update-accent-border: rgba(96, 165, 250, 0.36);
}

html.dark .update-badge--ready {
  --update-accent: #34d399;
  --update-accent-bg: rgba(52, 211, 153, 0.14);
  --update-accent-border: rgba(52, 211, 153, 0.36);
}

@keyframes update-badge-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
</style>
