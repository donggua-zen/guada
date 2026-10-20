<template>
  <div class="grid grid-cols-[repeat(8,2rem)] gap-1.5">
    <GdTooltip
      v-for="option in options"
      :key="option.key ?? 'default'"
      :content="labelOf(option.key)"
      placement="top"
    >
      <button
        type="button"
        class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border transition-colors"
        :class="modelValue === option.key
          ? 'border-(--gd-color-primary) bg-(--gd-color-sidebar-bg-active) text-(--gd-color-primary)'
          : 'border-(--gd-color-border) text-(--gd-color-text) hover:bg-(--gd-color-sidebar-bg-hover)'"
        :aria-label="labelOf(option.key)"
        :aria-pressed="modelValue === option.key"
        @click="emit('update:modelValue', option.key)"
      >
        <component :is="option.component" class="h-4 w-4" />
      </button>
    </GdTooltip>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import GdTooltip from '@/components/ui/GdTooltip.vue'
import {
  GROUP_ICON_OPTIONS,
  type GroupIconKey,
  type GroupIconOption,
} from '@/utils/groupIcon'

/** 分组图标选择器：null = 默认文件夹。 */
defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const { t } = useI18n()
const options: GroupIconOption[] = GROUP_ICON_OPTIONS

function labelOf(key: GroupIconKey | null): string {
  return key
    ? t(`ui.sidebar.groupIconNames.${key}`)
    : t('ui.sidebar.groupIconDefault')
}
</script>
