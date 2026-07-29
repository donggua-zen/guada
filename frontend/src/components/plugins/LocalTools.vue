<template>
  <div class="flex-1 overflow-hidden">
    <div class="sessions-header py-1 text-lg font-semibold flex justify-between items-center mb-6">
      <span>本地工具</span>
      <el-button 
        v-if="loading" 
        :loading="true" 
        size="small"
      >
        加载中...
      </el-button>
    </div>

    <div class="space-y-4">
      <div class="text-sm text-gray-600 dark:text-[#8b8d95] mb-4">
        全局工具设置决定了哪些工具对所有角色可用。角色级别的工具设置会在此基础上进一步限制。
      </div>

      <!-- 工具卡片列表 -->
      <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));">
        <div
          v-for="tool in globalTools"
          :key="tool.pluginId"
          class="rounded-lg border border-gray-200 dark:border-[#232428] overflow-hidden bg-white dark:bg-[#232428] transition-all hover:border-(--color-primary)"
        >
          <div class="p-5 pb-4">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <img
                  v-if="tool.icon"
                  :src="`/api/v1/plugins/${tool.pluginId}/icon`"
                  class="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <div v-else class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-[#333] flex items-center justify-center flex-shrink-0 text-lg font-bold text-gray-500 dark:text-[#8b8d95]">
                  {{ tool.displayName?.charAt(0) || '?' }}
                </div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-[#e8e9ed] truncate">
                  {{ tool.displayName }}
                </h3>
              </div>
              <el-switch
                :model-value="tool.enabled"
                :loading="updatingTools.has(tool.pluginId)"
                @update:model-value="(val: string | number | boolean) => handleToggleTool(tool.pluginId, !!val)"
                inline-prompt
                active-text="启动"
                inactive-text="禁用"
                size="large"
                class="-mt-2"
              />
            </div>
            
            <div class="flex items-center gap-2 mb-3">
              <el-tag v-if="tool.source === 'dev'" size="small" type="warning" effect="dark">DEV</el-tag>
              <el-tag v-else-if="tool.source === 'user'" size="small" type="success" effect="plain">外部</el-tag>
              <el-button
                v-if="tool.source === 'dev' || tool.source === 'user'"
                link
                size="small"
                type="danger"
                @click="handleUninstall(tool.pluginId)"
              >
                卸载
              </el-button>
            </div>
            
            <p class="text-sm text-gray-600 dark:text-[#8b8d95] mb-3 line-clamp-3 min-h-[3.75rem]">
              {{ tool.description }}
            </p>
            
            <div class="text-sm text-gray-500 dark:text-[#6b6d75]">
              <el-tag size="small" type="info" effect="plain" class="cursor-pointer"
                @click="toggleToolList(tool.pluginId)">
                {{ tool.tools?.length || 0 }} 个工具
              </el-tag>
            </div>

            <!-- 工具列表（可展开查看，只读） -->
            <el-collapse-transition>
              <div v-if="expandedTools.has(tool.pluginId)" class="mt-3 pt-3 border-t border-gray-100 dark:border-[#333]">
                <div v-for="sub in tool.tools || []" :key="sub.name"
                  class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-[#2a2a2e]">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-gray-700 dark:text-[#d0d1d5] truncate">{{ sub.name }}</div>
                    <div v-if="sub.description" class="text-xs text-gray-400 truncate">{{ sub.description }}</div>
                  </div>
                </div>
              </div>
            </el-collapse-transition>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox, ElCollapseTransition } from 'element-plus'
import { apiService } from '@/services/ApiService'

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
const expandedTools = ref<Set<string>>(new Set())

function toggleToolList(pluginId: string) {
  const next = new Set(expandedTools.value)
  if (next.has(pluginId)) {
    next.delete(pluginId)
  } else {
    next.add(pluginId)
  }
  expandedTools.value = next
}

async function loadGlobalTools() {
  loading.value = true
  error.value = null
  
  try {
    const response = await apiService.queryPlugins()
    globalTools.value = response.plugins
  } catch (err: any) {
    console.error('加载全局工具失败:', err)
    const errorMsg = err.message || '加载全局工具失败'
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
    ElMessage.error(err.message || '更新全局工具状态失败')
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
    ElMessage.error(err.message || '更新工具状态失败')
  } finally {
    updatingTools.value.delete(pluginId)
  }
}

async function handleUninstall(pluginId: string) {
  try {
    await ElMessageBox.confirm('确定要卸载此插件吗？插件文件将被删除。', '卸载插件', {
      confirmButtonText: '卸载',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const response = await apiService._request(`/plugins/${pluginId}`, { method: 'DELETE' })
    if (response.success) {
      ElMessage.success('插件已卸载')
      await loadGlobalTools()
    }
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error(err.message || '卸载插件失败')
    }
  }
}

onMounted(() => {
  loadGlobalTools()
})
</script>

<style scoped>
</style>
