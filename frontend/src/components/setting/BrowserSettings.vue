<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 链接打开方式 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.browser.linkOpenMode') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
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

      <!-- 渲染视口 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.browser.viewport') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
          <!-- 预设尺寸 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.viewportSize') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.browser.viewportSizeDesc') }}</span>
            </div>
            <el-select v-model="selectedPreset" @change="onPresetChange" style="width: 150px">
              <el-option
                v-for="p in VIEWPORT_PRESETS"
                :key="`${p.width}x${p.height}`"
                :label="`${p.width} × ${p.height}`"
                :value="`${p.width}x${p.height}`"
              />
              <el-option :label="t('settings.browser.viewportCustom')" value="custom" />
            </el-select>
          </div>

          <!-- 自定义尺寸 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">{{ t('settings.browser.viewportCustomSize') }}</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ t('settings.browser.viewportCustomSizeDesc') }}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <el-input-number
                v-model="customWidth"
                :min="VIEWPORT_MIN.width" :max="VIEWPORT_MAX.width" :step="10"
                controls-position="right" style="width: 110px"
                @change="onCustomSizeChange"
              />
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">×</span>
              <el-input-number
                v-model="customHeight"
                :min="VIEWPORT_MIN.height" :max="VIEWPORT_MAX.height" :step="10"
                controls-position="right" style="width: 110px"
                @change="onCustomSizeChange"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">{{ t('settings.browser.dataManagement') }}</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--gd-color-surface) overflow-hidden">
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
import {
  VIEWPORT_PRESETS, VIEWPORT_MIN, VIEWPORT_MAX,
  saveDefaultViewport, isValidViewportSize, loadBrowserSettings,
} from '@/utils/browserViewport'
import { useBrowserWebviewStore } from '@/stores/browserWebview'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
const { t } = useI18n()
const clearing = ref(false)
const linkOpenMode = ref<LinkOpenMode>('ask')
const autoShowSidebar = ref(false)

// ── 默认渲染视口（设置中心只管全局默认；单个网页可在预览工具栏临时覆盖） ──
const browserStore = useBrowserWebviewStore()
const selectedPreset = ref('custom')
const customWidth = ref(1280)
const customHeight = ref(720)

/** 依据尺寸同步下拉选中项与输入框 */
function syncViewportControls(width: number, height: number): void {
  const matched = VIEWPORT_PRESETS.some(p => p.width === width && p.height === height)
  selectedPreset.value = matched ? `${width}x${height}` : 'custom'
  customWidth.value = width
  customHeight.value = height
}

async function persistViewport(width: number, height: number): Promise<void> {
  // 先本地即时生效（store 默认值），再异步落盘后端
  try {
    await saveDefaultViewport(width, height)
  } catch {
    ElMessage.error(t('common.error.saveFailed'))
  }
}

async function onPresetChange(val: string | number | boolean | undefined): Promise<void> {
  const key = String(val ?? '')
  if (key === 'custom') {
    // 切到"自定义"：保持当前尺寸不变，等用户在输入框调整
    return
  }
  const [w, h] = key.split('x').map(Number)
  if (!isValidViewportSize(w, h)) return
  await persistViewport(w, h)
}

async function onCustomSizeChange(): Promise<void> {
  const w = Math.round(Number(customWidth.value) || 0)
  const h = Math.round(Number(customHeight.value) || 0)
  if (!isValidViewportSize(w, h)) return
  await persistViewport(w, h)
}

// 加载浏览器设置
async function loadSettings(): Promise<void> {
  try {
    // 复用启动期已拉取并归一化的分组（同一份 payload）：browser 分组只读一次，本页不再二次请求
    const settings = await loadBrowserSettings()
    if (!settings) throw new Error('browser 分组不可用')

    if (settings.linkOpenMode) {
      linkOpenMode.value = settings.linkOpenMode
      setLinkOpenMode(settings.linkOpenMode)
    }
    if (settings.autoShowSidebar !== undefined) {
      autoShowSidebar.value = settings.autoShowSidebar
      setAutoShowSidebar(settings.autoShowSidebar)
    }
    // 渲染视口：后端值为准，同步下拉/输入框显示（不回写）；后端未给时显示 store 现值
    if (settings.viewport) {
      syncViewportControls(settings.viewport.width, settings.viewport.height)
    } else {
      syncViewportControls(browserStore.viewportWidth, browserStore.viewportHeight)
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
  loadSettings()
})
</script>
