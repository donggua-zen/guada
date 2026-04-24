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

    <GlobalToolsPanel 
      :tools="globalTools" 
      :loading="loading" 
      @update-status="updateGlobalToolStatus"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import GlobalToolsPanel from './GlobalToolsPanel.vue'

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

onMounted(() => {
  loadGlobalTools()
})
</script>

<style scoped>
/* 移除底边框以统一风格 */
</style>
