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
      <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        全局工具设置决定了哪些工具对所有角色可用。角色级别的工具设置会在此基础上进一步限制。
      </div>

      <!-- 网格布局：每行3列 -->
      <div class="grid grid-cols-3 gap-4">
        <div
          v-for="tool in globalTools"
          :key="tool.namespace"
          class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-[#1e1e1e] transition-all hover:shadow-md"
        >
          <div class="p-4">
            <div class="flex items-start justify-between gap-2 mb-2">
              <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 flex-1 truncate">
                {{ tool.displayName }}
              </h3>
              <el-switch
                :model-value="tool.enabled"
                :loading="updatingTools.has(tool.namespace)"
                @update:model-value="(val: boolean) => handleToggleTool(tool.namespace, val)"
                inline-prompt
                active-text="启动"
                inactive-text="禁用"
                size="large"
              />
            </div>
            
            <p class="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2 min-h-[2.5rem]">
              {{ tool.description }}
            </p>
            
            <div class="text-xs text-gray-500 dark:text-gray-500">
              <el-tag size="small" type="info" effect="plain">
                {{ tool.tools?.length || 0 }} 个工具
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'

interface ToolMetadata {
  namespace: string
  name: string
  displayName: string
  description: string
  enabled: boolean
  isMcp: boolean
  tools?: any[]
}

const loading = ref(false)
const error = ref<string | null>(null)
const updatingTools = ref<Set<string>>(new Set())

const globalTools = ref<ToolMetadata[]>([])

async function loadGlobalTools() {
  loading.value = true
  error.value = null
  
  try {
    const response = await apiService.fetchGlobalTools()
    globalTools.value = response.tools
  } catch (err: any) {
    console.error('加载全局工具失败:', err)
    const errorMsg = err.message || '加载全局工具失败'
    error.value = errorMsg
    ElMessage.error(errorMsg)
  } finally {
    loading.value = false
  }
}

async function updateGlobalToolStatus(namespace: string, enabled: boolean) {
  try {
    const response = await apiService.updateGlobalToolStatus(namespace, enabled)
    if (response.success) {
      const tool = globalTools.value.find(t => t.namespace === namespace)
      if (tool) {
        tool.enabled = enabled
      }
    }
  } catch (err: any) {
    console.error('更新全局工具状态失败:', err)
    ElMessage.error(err.message || '更新全局工具状态失败')
  }
}

function handleToggleTool(namespace: string, enabled: boolean) {
  const tool = globalTools.value.find(t => t.namespace === namespace)
  if (!tool) return
  
  const previousState = tool.enabled
  
  try {
    updatingTools.value.add(namespace)
    updateGlobalToolStatus(namespace, enabled)
  } catch (err: any) {
    console.error('更新工具状态失败:', err)
    tool.enabled = previousState
    ElMessage.error(err.message || '更新工具状态失败')
  } finally {
    updatingTools.value.delete(namespace)
  }
}

onMounted(() => {
  loadGlobalTools()
})
</script>

<style scoped>
/* 移除底边框以统一风格 */
</style>
