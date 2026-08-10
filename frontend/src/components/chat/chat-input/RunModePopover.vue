<template>
  <CustomPopover :show="visible" @update:show="$emit('update:visible', $event)" :width="260" :anchor-el="anchorEl">
    <template #header>
    </template>
    <div class="popover-content space-y-0.5">
      <div v-for="opt in options" :key="opt.value"
        class="rm-item flex items-center justify-between px-1.5 py-1.5 cursor-pointer transition-all text-sm rounded-(--size-dialog-rounded-radius)"
        @click="handleSelect(opt.value)">
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
import { computed } from 'vue'
import { ElIcon } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { DrinkCoffee20Regular, ShieldLock20Regular, ClipboardTask20Regular, CheckmarkCircle20Filled } from '@vicons/fluent'
import CustomPopover from '../../ui/CustomPopover.vue'

const { t } = useI18n()

defineProps<{
  visible: boolean
  anchorEl: HTMLElement | null
  currentValue: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'select': [mode: string]
}>()

const options = computed(() => [
  { value: 'normal', label: t('chat.input.runModeNormal'), desc: t('chat.input.runModeNormalDesc'), icon: DrinkCoffee20Regular },
  { value: 'sandbox', label: t('chat.input.runModeSandboxTest'), desc: t('chat.input.runModeSandboxDesc'), icon: ShieldLock20Regular },
  { value: 'plan', label: t('chat.input.runModePlan'), desc: t('chat.input.runModePlanDesc'), icon: ClipboardTask20Regular },
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
  background: var(--color-sidebar-bg-hover);
}
</style>
