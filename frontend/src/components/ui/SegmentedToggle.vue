<template>
  <div class="flex items-center gap-0.5 p-0.5 rounded-md"
    :class="[variant === 'ghost' ? 'bg-transparent' : 'bg-gray-100 dark:bg-[#1a1b1e]', { 'opacity-50 pointer-events-none': disabled }]">
    <button v-for="option in options" :key="String(option.value)" type="button"
      @click="emit('update:modelValue', option.value)"
      class="px-2 py-1 rounded text-xs font-medium transition-all duration-200 flex items-center gap-1 cursor-pointer"
      :class="modelValue === option.value
        ? variant === 'ghost'
          ? 'bg-(--gd-color-sidebar-bg-active) text-(--gd-color-sidebar-text-active)'
          : 'bg-white dark:bg-[#3a3b3f] text-gray-900 dark:text-[#e8e9ed] shadow-sm'
        : variant === 'ghost'
          ? 'text-(--gd-color-text) hover:bg-(--gd-color-sidebar-bg-hover)'
          : 'text-gray-500 dark:text-[#8b8d95] hover:text-gray-700 dark:hover:text-[#c0c1c5]'">
      <component v-if="option.icon" :is="option.icon" class="w-3.5 h-3.5" />
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

export interface SegmentedOption {
  label: string
  value: string | number | boolean
  /** 可选图标：动态组件（<component :is> 接受组件定义或组件名） */
  icon?: string | Component
}

defineProps<{
  modelValue: string | number | boolean
  options: SegmentedOption[]
  disabled?: boolean
  /**
   * default = 独立灰底胶囊（设置页等有卡片背景的场景）
   * ghost   = 透明容器 + 主题激活色（侧栏等透明背景场景，避免自带底色与主题不一致）
   */
  variant?: 'default' | 'ghost'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
}>()
</script>
