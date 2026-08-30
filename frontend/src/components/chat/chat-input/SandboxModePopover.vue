<template>
  <GdPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="260" :anchor-el="anchorEl">
    <template #header>
    </template>
    <div class="popover-content space-y-0.5">
      <div v-for="opt in options" :key="opt.value"
        class="rm-item flex items-center justify-between px-1.5 py-1.5 cursor-pointer transition-all text-sm rounded-(--gd-size-dialog-rounded-radius)"
        :class="{ 'rm-item--danger': opt.danger }"
        @click="handleSelect(opt.value)">
        <div class="flex items-center space-x-2">
          <el-icon size="16" :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'">
            <component :is="opt.icon" />
          </el-icon>
          <div class="flex flex-col">
            <span :class="opt.danger ? 'text-red-500 font-medium' : ''">{{ opt.label }}</span>
            <span class="text-xs text-gray-400 dark:text-gray-500">{{ opt.desc }}</span>
          </div>
        </div>
        <el-icon v-if="currentValue === opt.value" size="16"
          :class="opt.danger ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'">
          <CheckmarkCircle20Filled />
        </el-icon>
      </div>
    </div>
  </GdPopover>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ElIcon } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { ShieldLock20Regular, ClipboardTask20Regular, ShieldError16Regular, CheckmarkCircle20Filled } from '@vicons/fluent'
import GdPopover from '../../ui/GdPopover.vue'

const { t } = useI18n()

interface RunModeOption {
  value: string
  label: string
  desc: string
  icon: Component
  danger?: boolean
}

defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentValue: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [mode: string]
}>()

const options = computed<RunModeOption[]>(() => [
  { value: 'read-only', label: t('chat.input.runModeReadOnly'), desc: t('chat.input.runModeReadOnlyDesc'), icon: ClipboardTask20Regular },
  { value: 'workspace-write', label: t('chat.input.runModeWorkspaceWrite'), desc: t('chat.input.runModeWorkspaceWriteDesc'), icon: ShieldLock20Regular },
  { value: 'danger-full-access', label: t('chat.input.runModeFullAccess'), desc: t('chat.input.runModeFullAccessDesc'), icon: ShieldError16Regular, danger: true },
])

function handleSelect(mode: string) {
  emit('select', mode)
  emit('update:visible', false)
}
</script>

<style scoped>
.popover-content {
  padding: 0;
}

.rm-item:hover {
  background: var(--gd-color-sidebar-bg-hover);
}

.rm-item--danger:hover {
  background: rgba(239, 68, 68, 0.08);
}
</style>
