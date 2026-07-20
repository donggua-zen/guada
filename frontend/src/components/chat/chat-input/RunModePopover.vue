<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="200" :anchor-el="anchorEl">
    <template #header>
      <div class="flex items-center space-x-2">
        <el-icon size="16" class="text-gray-600 dark:text-gray-400">
          <ClipboardTask20Regular />
        </el-icon>
        <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">运行模式</span>
      </div>
    </template>
    <div class="popover-content space-y-0.5">
      <div v-for="opt in options" :key="opt.value"
        class="rm-item flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-all text-sm" @click="handleSelect(opt.value)">
        <div class="flex items-center space-x-2">
          <el-icon size="16" class="text-gray-500 dark:text-gray-400">
            <component :is="opt.icon" />
          </el-icon>
          <div class="flex flex-col">
            <span>{{ opt.label }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ opt.desc }}</span>
          </div>
        </div>
        <el-icon v-if="currentValue === opt.value" size="16" class="text-gray-500 dark:text-gray-400">
          <CheckmarkCircle20Filled />
        </el-icon>
      </div>
    </div>
  </CustomPopover>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus'
import { DrinkCoffee20Regular, ClipboardTask20Regular, CheckmarkCircle20Filled } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'

defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentValue: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [mode: string]
}>()

const options = [
  { value: 'normal', label: '工作模式', desc: '所有工具可用', icon: DrinkCoffee20Regular },
  { value: 'plan', label: '计划模式', desc: '仅允许只读工具', icon: ClipboardTask20Regular },
]

function handleSelect(mode: string) {
  emit('select', mode)
  emit('update:visible', false)
}
</script>

<style scoped>
.popover-content {
  padding: 4px 0;
}

.rm-item:hover {
  background: var(--color-sidebar-bg-hover);
}
</style>
