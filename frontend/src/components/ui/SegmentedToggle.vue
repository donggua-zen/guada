<template>
  <div class="flex items-center gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-[#1a1b1e]"
    :class="{ 'opacity-50 pointer-events-none': disabled }">
    <button v-for="option in options" :key="String(option.value)" type="button"
      @click="emit('update:modelValue', option.value)"
      class="px-2 py-1 rounded text-xs font-medium transition-all duration-200 flex items-center gap-1"
      :class="modelValue === option.value
        ? 'bg-white dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
        : 'text-gray-500 dark:text-[#8b8d95] hover:text-gray-700 dark:hover:text-[#c0c1c5]'">
      <component v-if="option.icon" :is="option.icon" class="w-3.5 h-3.5" />
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
export interface SegmentedOption {
  label: string
  value: string | number | boolean
  icon?: any
}

defineProps<{
  modelValue: string | number | boolean
  options: SegmentedOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()
</script>
