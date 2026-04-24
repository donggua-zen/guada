<template>
  <div class="space-y-4">
    <div class="text-sm text-gray-600 dark:text-gray-400 mb-4">
      角色工具设置在全局设置的基础上进一步限制。最终可用的工具是全局启用和角色启用的交集。
      选择"继承全局"表示使用全局设置。
    </div>

    <div
      v-for="tool in tools"
      :key="tool.namespace"
      class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-[#1e1e1e] transition-all hover:shadow-md"
    >
      <div class="p-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {{ tool.displayName }}
              </h3>
              <el-tag 
                v-if="tool.effectiveEnabled" 
                type="success" 
                size="small"
              >
                有效启用
              </el-tag>
              <el-tag 
                v-else 
                type="info" 
                size="small"
              >
                已禁用
              </el-tag>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {{ tool.description }}
            </p>
            <div v-if="tool.tools && tool.tools.length > 0" class="mt-3">
              <div class="text-xs text-gray-500 dark:text-gray-500 mb-2">
                包含 {{ tool.tools.length }} 个工具函数
              </div>
              <div class="flex flex-wrap gap-2">
                <el-tag
                  v-for="t in tool.tools"
                  :key="t.name"
                  size="small"
                  type="info"
                  effect="plain"
                >
                  {{ t.name }}
                </el-tag>
              </div>
            </div>
          </div>
          <div class="flex-shrink-0 flex flex-col gap-2">
            <el-select
              :model-value="getCharacterSetting(tool.namespace)"
              @update:model-value="(val) => handleSettingChange(tool.namespace, val)"
              :loading="updatingTools.has(tool.namespace)"
              size="small"
              style="width: 120px"
            >
              <el-option label="继承全局" value="all" />
              <el-option label="启用" :value="true" />
              <el-option label="禁用" :value="false" />
            </el-select>
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
  effectiveEnabled: boolean
  isMcp: boolean
  tools?: any[]
}

interface Props {
  tools: ToolMetadata[]
  characterId: string
  loading: boolean
}

const props = defineProps<Props>()
const updatingTools = ref<Set<string>>(new Set())

const emit = defineEmits<{
  'update-status': [characterId: string, namespace: string, enabled: boolean | 'all']
  'character-change': [characterId: string]
}>()

function getCharacterSetting(namespace: string): boolean | 'all' {
  const tool = props.tools.find(t => t.namespace === namespace)
  if (!tool) return 'all'
  
  if (tool.enabled === true && tool.effectiveEnabled === true) {
    return 'all'
  }
  
  return tool.effectiveEnabled
}

function handleSettingChange(namespace: string, value: boolean | 'all') {
  if (!props.characterId) {
    ElMessage.warning('请先选择一个角色')
    return
  }
  
  try {
    updatingTools.value.add(namespace)
    emit('update-status', props.characterId, namespace, value)
  } catch (err: any) {
    console.error('更新角色工具设置失败:', err)
    ElMessage.error(err.message || '更新角色工具设置失败')
  } finally {
    updatingTools.value.delete(namespace)
  }
}
</script>
