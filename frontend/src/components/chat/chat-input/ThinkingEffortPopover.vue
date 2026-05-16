<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="180" :anchor-el="anchorEl">
    <template #header>
      <div class="flex items-center gap-2">
        <el-icon size="16" class="text-gray-600 dark:text-gray-400">
          <LightbulbFilament24Regular />
        </el-icon>
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">思考强度</span>
      </div>
    </template>
    <div class="popover-content space-y-1">
      <div v-for="effort in options" :key="effort"
        class="flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-all text-sm" :class="{
          'bg-pink-50 dark:bg-pink-900/20': currentValue === effort,
          'hover:bg-gray-50 dark:hover:bg-gray-800/50': currentValue !== effort
        }" :data-effort="effort" @click="handleSelect(effort)">
        <span>{{ getLabel(effort) }}</span>
        <span class="text-xs text-gray-400 dark:text-gray-500">{{ effort }}</span>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus'
import { LightbulbFilament24Regular } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'
import { getThinkingEffortLabel } from '@/utils/modelUtils'

const props = defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  options: string[]
  currentValue: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [effort: string]
}>()

/**
 * 获取思考强度的显示标签
 */
function getLabel(effort: string): string {
  return getThinkingEffortLabel(effort)
}

/**
 * 处理选择思考强度
 */
function handleSelect(effort: string) {
  emit('select', effort)
  emit('update:visible', false)
}
</script>

<style scoped>
.popover-content {
  padding: 4px 0;
}
</style>
