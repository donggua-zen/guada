<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 链接打开方式 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.browser.linkOpenMode') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.markdownLinkOpenMode') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.browser.markdownLinkOpenModeDesc') }}</span>
            </div>
            <el-select v-model="linkOpenMode" @change="onLinkOpenModeChange" style="width: 140px">
              <el-option :label="t('settings.browser.internalBrowser')" value="internal" />
              <el-option :label="t('settings.browser.externalBrowser')" value="external" />
              <el-option :label="t('settings.browser.askEveryTime')" value="ask" />
            </el-select>
          </div>

          <!-- AI 浏览器侧边栏自动展开 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.autoExpandSidebar') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.browser.autoExpandSidebarDesc') }}</span>
            </div>
            <el-switch v-model="autoShowSidebar" @change="onAutoShowSidebarChange" />
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.browser.dataManagement') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <!-- 说明 -->
          <div class="px-4 py-3.5 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.automationData') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                {{ t('settings.browser.automationDataDesc') }}
              </span>
            </div>
          </div>

          <!-- 清空按钮 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.clearAllData') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.browser.clearAllDataDesc') }}</span>
            </div>
            <el-button type="danger" plain :loading="clearing" @click="handleClearData">
              {{ t('settings.browser.clearData') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { setLinkOpenMode, setAutoShowSidebar, type LinkOpenMode } from '@/utils/workspacePreview'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const { t } = useI18n()
const clearing = ref(false)
const linkOpenMode = ref<LinkOpenMode>('ask')
const autoShowSidebar = ref(false)

// 加载浏览器设置
async function loadBrowserSettings(): Promise<void> {
  try {
    const response = await apiService.fetchGroupSettings('browser')
    const mode = response.linkOpenMode as LinkOpenMode | undefined
    if (mode && ['internal', 'external', 'ask'].includes(mode)) {
      linkOpenMode.value = mode
      setLinkOpenMode(mode)
    }
    if (typeof response.autoShowSidebar === 'boolean') {
      autoShowSidebar.value = response.autoShowSidebar
      setAutoShowSidebar(response.autoShowSidebar)
    }
  } catch {
    // 后端不可用时使用默认值
  }
}

// 保存链接打开方式设置
async function onLinkOpenModeChange(val: string | number | boolean | undefined): Promise<void> {
  const mode = val as LinkOpenMode
  setLinkOpenMode(mode)
  try {
    await apiService.updateGroupSettings('browser', { linkOpenMode: mode })
  } catch (error) {
    console.error('保存链接打开方式失败:', error)
    ElMessage.error(t('common.error.saveFailed'))
  }
}

// 保存侧边栏自动展开设置
async function onAutoShowSidebarChange(val: string | number | boolean | undefined): Promise<void> {
  const enabled = val as boolean
  setAutoShowSidebar(enabled)
  try {
    await apiService.updateGroupSettings('browser', { autoShowSidebar: enabled })
  } catch (error) {
    console.error('保存侧边栏设置失败:', error)
    ElMessage.error(t('common.error.saveFailed'))
  }
}

async function handleClearData(): Promise<void> {
  if (!isElectron || !window.electronAPI?.clearBrowserData) {
    ElMessage.warning(t('settings.browser.desktopOnly'))
    return
  }

  try {
    await ElMessageBox.confirm(
      t('settings.browser.clearConfirmMessage'),
      t('settings.browser.clearConfirmTitle'),
      {
        confirmButtonText: t('settings.browser.clearConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  clearing.value = true
  try {
    const result = await window.electronAPI.clearBrowserData()
    if (result.success) {
      ElMessage.success(t('settings.browser.dataCleared'))
    } else {
      ElMessage.error(result.error || t('common.deleteFailed'))
    }
  } catch (error) {
    console.error('Failed to clear browser data:', error)
    ElMessage.error(t('common.deleteFailed'))
  } finally {
    clearing.value = false
  }
}

onMounted(() => {
  loadBrowserSettings()
})
</script>
