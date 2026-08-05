<template>
  <div class="flex-1 overflow-hidden">
    <div class="space-y-8">
      <!-- 链接打开方式 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">链接打开方式</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <div class="px-4 py-3.5 flex items-center justify-between gap-4 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">Markdown 链接打开方式</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">设置点击聊天消息中的链接时的默认打开方式。内置浏览器在侧边栏预览区打开，不影响主窗口。</span>
            </div>
            <el-select v-model="linkOpenMode" @change="onLinkOpenModeChange" style="width: 140px">
              <el-option label="内置浏览器" value="internal" />
              <el-option label="外部浏览器" value="external" />
              <el-option label="每次询问" value="ask" />
            </el-select>
          </div>

          <!-- AI 浏览器侧边栏自动展开 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">AI 使用浏览器时自动展开侧边栏</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">关闭后，AI 打开浏览器时不会自动切换到预览页面，浏览器窗口仍在后台正常运行。可在侧边栏手动查看。</span>
            </div>
            <el-switch v-model="autoShowSidebar" @change="onAutoShowSidebarChange" />
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div>
        <h3 class="text-sm font-semibold text-gray-900 dark:text-[#e8e9ed] mb-3">数据管理</h3>
        <div class="rounded-xl border border-gray-200 dark:border-[#2e3035] bg-(--color-surface) overflow-hidden">
          <!-- 说明 -->
          <div class="px-4 py-3.5 border-b border-gray-100 dark:border-[#2e3035]">
            <div class="flex flex-col gap-1">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">浏览器自动化数据</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">
                所有浏览器自动化窗口共享同一套数据（Cookie、登录状态、本地存储等）。清空后所有窗口将被关闭并重置为初始状态，不影响主程序。
              </span>
            </div>
          </div>

          <!-- 清空按钮 -->
          <div class="px-4 py-3.5 flex items-center justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-base text-gray-900 dark:text-[#e8e9ed]">清空所有浏览器数据</span>
              <span class="text-xs text-gray-500 dark:text-[#8b8d95]">包含 Cookie、缓存、localStorage、IndexedDB、Service Worker 等</span>
            </div>
            <el-button type="danger" plain :loading="clearing" @click="handleClearData">
              清空数据
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { setLinkOpenMode, setAutoShowSidebar, type LinkOpenMode } from '@/utils/workspacePreview'

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined
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
    ElMessage.error('保存设置失败')
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
    ElMessage.error('保存设置失败')
  }
}

async function handleClearData(): Promise<void> {
  if (!isElectron || !window.electronAPI?.clearBrowserData) {
    ElMessage.warning('此功能仅在桌面端可用')
    return
  }

  try {
    await ElMessageBox.confirm(
      '此操作将关闭所有浏览器窗口并清空全部数据（Cookie、登录状态、缓存等），不可恢复。确定继续吗？',
      '清空浏览器数据',
      {
        confirmButtonText: '确定清空',
        cancelButtonText: '取消',
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
      ElMessage.success('浏览器数据已清空')
    } else {
      ElMessage.error(result.error || '清空失败')
    }
  } catch (error) {
    console.error('Failed to clear browser data:', error)
    ElMessage.error('清空失败')
  } finally {
    clearing.value = false
  }
}

onMounted(() => {
  loadBrowserSettings()
})
</script>
