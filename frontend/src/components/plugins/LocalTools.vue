<template>
  <div class="flex-1 overflow-hidden">
    <div class="flex items-center justify-between gap-4 mb-8 mt-2">
      <div class="min-w-0">
          <h1 class="text-xl font-bold text-gray-900 dark:text-[#e8e9ed]">{{ t('plugins.localTools.title') }}</h1>
        <p class="text-sm text-gray-500 dark:text-[#8b8d95] mt-1">{{ t('plugins.localTools.subtitle') }}</p>
      </div>
      <el-button 
        v-if="loading" 
        :loading="true" 
        size="small"
      >
        {{ t('common.loading') }}
      </el-button>
    </div>

    <div class="space-y-4">
      <div class="grid gap-y-4 gap-x-3" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
        <div
          v-for="tool in globalTools"
          :key="tool.pluginId"
          class="plugin-card flex flex-col overflow-hidden p-2.5 rounded-[var(--size-surface-radius)] border border-(--color-surface-border) bg-(--color-surface) transition-all hover:bg-(--color-surface-hover) hover:shadow-sm cursor-pointer"
          @click="showDetail(tool)"
        >
          <!-- Header: icon + name + source tag -->
          <div class="flex items-center gap-2.5 mb-3">
            <CardAvatar :src="tool.icon ? `/api/v1/plugins/${tool.pluginId}/icon` : null" :name="tool.displayName" :disabled="!tool.enabled" />
            <h3 class="font-semibold text-gray-900 dark:text-[#e8e9ed] truncate flex-1 min-w-0" style="font-size: var(--size-text-sm);">
              {{ tool.displayName }}
            </h3>
            <el-tag v-if="tool.source === 'dev'" size="small" type="warning" effect="dark">{{ t('plugins.localTools.sourceDev') }}</el-tag>
            <el-tag v-else-if="tool.source === 'user'" size="small" type="success" effect="plain">{{ t('plugins.localTools.sourceUser') }}</el-tag>
          </div>

          <!-- Description (max 2 lines) -->
          <p class="text-gray-400 dark:text-[#6b6d75] line-clamp-2 h-[2.5rem]" style="font-size: calc(var(--size-text-base) - 2px);">
            {{ tool.description }}
          </p>

          <!-- Footer: uninstall + switch -->
          <div class="flex items-center justify-end gap-2 mt-3">
            <el-button
              v-if="tool.source === 'dev' || tool.source === 'user'"
              link
              size="small"
              type="danger"
              @click.stop="handleUninstall(tool.pluginId)"
            >
              {{ t('plugins.localTools.uninstall') }}
            </el-button>
            <el-switch
              :model-value="tool.enabled"
              :loading="updatingTools.has(tool.pluginId)"
              @update:model-value="(val: string | number | boolean) => handleToggleTool(tool.pluginId, !!val)"
              @click.stop
              size="small"
              inline-prompt
              :active-text="t('plugins.localTools.enable')"
              :inactive-text="t('plugins.localTools.disable')"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Dialog -->
    <el-dialog v-model="detailVisible" width="560px" align-center destroy-on-close>
      <template #header>
        <div class="flex items-center gap-3">
          <CardAvatar :src="currentTool?.icon ? `/api/v1/plugins/${currentTool?.pluginId}/icon` : null" :name="currentTool?.displayName" size="md" />
          <div class="flex items-center gap-2">
            <span class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ currentTool?.displayName }}</span>
            <el-tag v-if="currentTool?.source === 'dev'" size="small" type="warning" effect="dark">{{ t('plugins.localTools.sourceDev') }}</el-tag>
            <el-tag v-else-if="currentTool?.source === 'user'" size="small" type="success" effect="plain">{{ t('plugins.localTools.sourceUser') }}</el-tag>
          </div>
        </div>
      </template>

      <div v-if="currentTool" class="space-y-4">
        <div>
          <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">{{ t('plugins.localTools.descLabel') }}</div>
          <p class="text-sm text-gray-700 dark:text-[#d0d1d5] leading-relaxed">{{ currentTool.description }}</p>
        </div>

        <div v-if="currentTool.tools && currentTool.tools.length > 0">
          <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-2">{{ t('plugins.localTools.toolsLabel', { count: currentTool.tools.length }) }}</div>
          <div class="space-y-1.5">
            <div v-for="sub in currentTool.tools" :key="sub.name"
              class="flex items-start gap-2 py-1.5 px-3 rounded-[var(--size-surface-radius)] bg-gray-50 dark:bg-[#2a2a2e]">
              <div class="flex-1 min-w-0">
                <div class="text-sm text-gray-700 dark:text-[#d0d1d5] font-medium">{{ sub.name }}</div>
                <div v-if="sub.description" class="text-xs text-gray-400 mt-0.5">{{ sub.description }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiService } from '@/services/ApiService'
import CardAvatar from '@/components/ui/CardAvatar.vue'

const { t } = useI18n()

interface ToolMetadata {
  pluginId: string
  name: string
  displayName: string
  description: string
  enabled: boolean
  isMcp: boolean
  icon?: string
  source?: 'builtin' | 'dev' | 'user'
  tools?: any[]
}

const loading = ref(false)
const error = ref<string | null>(null)
const updatingTools = ref<Set<string>>(new Set())

const globalTools = ref<ToolMetadata[]>([])

// Detail dialog
const detailVisible = ref(false)
const currentTool = ref<ToolMetadata | null>(null)

function showDetail(tool: ToolMetadata) {
  currentTool.value = tool
  detailVisible.value = true
}

async function loadGlobalTools() {
  loading.value = true
  error.value = null
  
  try {
    const response = await apiService.queryPlugins()
    globalTools.value = response.plugins
  } catch (err: any) {
    console.error('加载全局工具失败:', err)
    const errorMsg = err.message || t('plugins.localTools.loadFailed')
    error.value = errorMsg
    ElMessage.error(errorMsg)
  } finally {
    loading.value = false
  }
}

async function updateGlobalToolStatus(pluginId: string, enabled: boolean) {
  try {
    const response = await apiService.updateGlobalToolStatus(pluginId, enabled)
    if (response.success) {
      const tool = globalTools.value.find(t => t.pluginId === pluginId)
      if (tool) {
        tool.enabled = enabled
      }
    }
  } catch (err: any) {
    console.error('更新全局工具状态失败:', err)
    ElMessage.error(err.message || t('plugins.localTools.updateFailed'))
  }
}

function handleToggleTool(pluginId: string, enabled: boolean) {
  const tool = globalTools.value.find(t => t.pluginId === pluginId)
  if (!tool) return
  
  const previousState = tool.enabled
  
  try {
    updatingTools.value.add(pluginId)
    updateGlobalToolStatus(pluginId, enabled)
  } catch (err: any) {
    console.error('更新工具状态失败:', err)
    tool.enabled = previousState
    ElMessage.error(err.message || t('plugins.localTools.toggleFailed'))
  } finally {
    updatingTools.value.delete(pluginId)
  }
}

async function handleUninstall(pluginId: string) {
  try {
    await ElMessageBox.confirm(t('plugins.localTools.uninstallConfirm'), t('plugins.localTools.uninstallTitle'), {
      confirmButtonText: t('plugins.localTools.uninstallBtn'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
    const response = await apiService._request(`/plugins/${pluginId}`, { method: 'DELETE' })
    if (response.success) {
      ElMessage.success(t('plugins.localTools.uninstallSuccess'))
      await loadGlobalTools()
    }
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error(err.message || t('plugins.localTools.uninstallFailed'))
    }
  }
}

onMounted(() => {
  loadGlobalTools()
})
</script>

<style scoped>
</style>
