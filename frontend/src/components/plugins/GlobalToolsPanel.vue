<template>
  <div class="space-y-4">
    <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
      全局工具设置决定了哪些工具对所有角色可用。角色级别的工具设置会在此基础上进一步限制。
    </div>

    <!-- 网格布局：每行3列 -->
    <div class="grid grid-cols-3 gap-4">
      <div
        v-for="tool in tools"
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

interface ToolMetadata {
  namespace: string
  name: string
  displayName: string
  description: string
  enabled: boolean
  isMcp: boolean
  tools?: any[]
}

interface Props {
  tools: ToolMetadata[]
  loading: boolean
}

const props = defineProps<Props>()
const updatingTools = ref<Set<string>>(new Set())

const emit = defineEmits<{
  'update-status': [namespace: string, enabled: boolean]
}>()

function handleToggleTool(namespace: string, enabled: boolean) {
  const tool = props.tools.find(t => t.namespace === namespace)
  if (!tool) return
  
  const previousState = tool.enabled
  
  try {
    updatingTools.value.add(namespace)
    emit('update-status', namespace, enabled)
  } catch (err: any) {
    console.error('更新工具状态失败:', err)
    tool.enabled = previousState
    ElMessage.error(err.message || '更新工具状态失败')
  } finally {
    updatingTools.value.delete(namespace)
  }
}
</script>
